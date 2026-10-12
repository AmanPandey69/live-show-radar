import { scanDependencies, scanRepo } from "../lib/guard/no-anthropic";

const root = process.cwd();
const deps = scanDependencies(root);
const hits = scanRepo(root);
if (deps.length || hits.length) {
  console.error("✗ Forbidden AI provider usage found (this app must use Gemini only):");
  for (const d of deps) console.error(`  dependency  ${d}`);
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.label}]  ${h.text}`);
  process.exit(1);
}
console.log("✓ No forbidden SDKs, endpoints or keys. Gemini only.");
