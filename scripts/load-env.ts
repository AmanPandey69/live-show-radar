import { existsSync, readFileSync } from "node:fs";

/** Minimal .env.local loader for CLI scripts (Next.js loads it automatically for the app). Values are never printed. */
export function loadEnvFile(path = ".env.local") {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
