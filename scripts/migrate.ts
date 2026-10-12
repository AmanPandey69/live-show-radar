import { Pool } from "@neondatabase/serverless";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "./load-env";

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (put it in .env.local or run `npx vercel env pull .env.local`).");
  process.exit(1);
}
const pool = new Pool({ connectionString: url });
const dir = join(process.cwd(), "db", "migrations");
for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  console.log(`→ applying ${f}`);
  await pool.query(readFileSync(join(dir, f), "utf8"));
}
await pool.end();
console.log("✓ migrations applied");
