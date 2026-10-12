import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanDependencies, scanRepo } from "@/lib/guard/no-anthropic";

describe("Gemini-only guard", () => {
  it("this repository has no forbidden SDK, endpoint or key", () => {
    expect(scanDependencies(process.cwd())).toEqual([]);
    expect(scanRepo(process.cwd())).toEqual([]);
  });

  it("detects a forbidden dependency and endpoint (self-test)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lsr-guard-"));
    const pkgName = "@" + "anthropic" + "-ai/sdk";
    writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: { [pkgName]: "1.0.0" } }));
    mkdirSync(join(dir, "lib"));
    writeFileSync(join(dir, "lib", "x.ts"), `fetch("https://api.${"anthropic"}.com/v1/messages")`);
    expect(scanDependencies(dir)).toHaveLength(1);
    expect(scanRepo(dir).map((h) => h.label)).toContain("API endpoint");
  });
});
