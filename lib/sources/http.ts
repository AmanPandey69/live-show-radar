import robotsParser from "robots-parser";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "@/lib/config/env";
import type { Repo } from "@/lib/db/repo";
import { sha256 } from "@/lib/text/normalize";

export class BlockedError extends Error {
  constructor(public url: string, public reason: string) {
    super(`blocked: ${reason} (${url})`);
    this.name = "BlockedError";
  }
}

export interface HttpResult {
  url: string;
  status: number;
  notModified: boolean;
  body: string;
  hash: string;
}

export interface Http {
  get(url: string, opts?: { conditional?: boolean; accept?: string; minIntervalMs?: number }): Promise<HttpResult>;
}

/**
 * Polite fetcher: honest UA, robots.txt for `*`, per-host spacing, ETag / If-Modified-Since,
 * and challenge detection. It never retries a block with different headers.
 */
export class PoliteHttp implements Http {
  private robots = new Map<string, { parser: ReturnType<typeof robotsParser> | null; at: number }>();
  private lastHit = new Map<string, number>();

  constructor(private repo: Repo, private ua = env().HTTP_USER_AGENT, private timeoutMs = 15_000) {}

  private async allowed(url: string): Promise<boolean> {
    const u = new URL(url);
    const key = u.origin;
    let entry = this.robots.get(key);
    if (!entry || Date.now() - entry.at > 6 * 3_600_000) {
      let parser: ReturnType<typeof robotsParser> | null = null;
      try {
        const res = await fetch(`${key}/robots.txt`, { headers: { "user-agent": this.ua }, signal: AbortSignal.timeout(this.timeoutMs) });
        const txt = await res.text();
        // SPAs sometimes return index.html for /robots.txt: treat as "no rules".
        if (res.ok && !/^\s*<(!doctype|html)/i.test(txt)) parser = robotsParser(`${key}/robots.txt`, txt);
      } catch {
        parser = null;
      }
      entry = { parser, at: Date.now() };
      this.robots.set(key, entry);
    }
    return entry.parser ? entry.parser.isAllowed(url, "*") !== false : true;
  }

  private async space(host: string, minIntervalMs: number) {
    const last = this.lastHit.get(host) ?? 0;
    const wait = last + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastHit.set(host, Date.now());
  }

  async get(url: string, opts: { conditional?: boolean; accept?: string; minIntervalMs?: number } = {}): Promise<HttpResult> {
    if (!(await this.allowed(url))) throw new BlockedError(url, "robots.txt disallows");
    const host = new URL(url).host;
    await this.space(host, opts.minIntervalMs ?? 3000);
    const headers: Record<string, string> = { "user-agent": this.ua, accept: opts.accept ?? "text/html,application/xml;q=0.9,*/*;q=0.8" };
    const cached = opts.conditional ? await this.repo.getHttpCache(url) : null;
    if (cached?.etag) headers["if-none-match"] = cached.etag;
    if (cached?.last_modified) headers["if-modified-since"] = cached.last_modified;

    const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 304 && cached) {
      return { url, status: 304, notModified: true, body: "", hash: cached.content_hash ?? "" };
    }
    const body = await res.text();
    if (res.status === 403 || res.status === 429 || res.status === 503) {
      const challenge = /cloudflare|just a moment|attention required|captcha|access denied/i.test(body.slice(0, 4000)) || res.headers.has("cf-ray");
      throw new BlockedError(url, challenge ? `bot protection (${res.status})` : `HTTP ${res.status}`);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const hash = sha256(body);
    if (opts.conditional) {
      await this.repo.setHttpCache({
        url, etag: res.headers.get("etag"), last_modified: res.headers.get("last-modified"), content_hash: hash, fetched_at: new Date().toISOString(),
      });
    }
    return { url, status: res.status, notModified: false, body, hash };
  }
}

/** Replays saved snapshots: URL → file under fixtures/. Unknown URLs 404. */
export class FixtureHttp implements Http {
  constructor(private map: Record<string, string>, private root = join(process.cwd(), "fixtures")) {}
  async get(url: string): Promise<HttpResult> {
    const file = this.map[url];
    if (!file) throw new Error(`HTTP 404 for ${url} (no fixture)`);
    if (file === "BLOCKED") throw new BlockedError(url, "bot protection (403)");
    const body = readFileSync(join(this.root, file), "utf8");
    return { url, status: 200, notModified: false, body, hash: sha256(body) };
  }
}
