import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Exam constraint: the app must not use the Claude/Anthropic API anywhere.
 * Patterns are assembled from parts so this file does not match itself.
 */
const A = "anthrop" + "ic";
export const FORBIDDEN: { label: string; re: RegExp }[] = [
  { label: "SDK package", re: new RegExp(`@${A}-ai/`, "i") },
  { label: "API endpoint", re: new RegExp(`api\\.${A}\\.com`, "i") },
  { label: "API header", re: new RegExp(`${A}-version`, "i") },
  { label: "SDK import", re: new RegExp(`from\\s+["']${A}["']|require\\(["']${A}["']\\)`, "i") },
  { label: "API key env", re: new RegExp(`${A.toUpperCase()}_API_KEY`) },
  { label: "Claude model id", re: /["'`]claude-(?:3|opus|sonnet|haiku|fable)[\w.-]*["'`]/i },
];

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".vercel", "coverage", "fixtures"]);
const EXT = /\.(ts|tsx|js|mjs|cjs|json|ya?ml|sql|env|example|md)$/;

export interface Hit { file: string; line: number; label: string; text: string }

export function scanRepo(root: string): Hit[] {
  const hits: Hit[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (EXT.test(name) || name === ".env.example") {
        const lines = readFileSync(p, "utf8").split("\n");
        lines.forEach((text, i) => {
          for (const f of FORBIDDEN) if (f.re.test(text)) hits.push({ file: relative(root, p), line: i + 1, label: f.label, text: text.trim().slice(0, 160) });
        });
      }
    }
  };
  walk(root);
  return hits;
}

/** Dependencies declared in package.json and the lockfile (covers transitive installs too). */
export function scanDependencies(root: string): string[] {
  const bad: string[] = [];
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(pkg[field] ?? {})) if (name.toLowerCase().includes(A)) bad.push(`${field}:${name}`);
  }
  try {
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    for (const key of Object.keys(lock.packages ?? {})) if (key.toLowerCase().includes(`node_modules/@${A}`) || key.toLowerCase().endsWith(`node_modules/${A}`)) bad.push(`lockfile:${key}`);
  } catch {
    /* no lockfile yet */
  }
  return bad;
}
