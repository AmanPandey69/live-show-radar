import { env, hasDb } from "@/lib/config/env";
import { MemoryRepo } from "./memory";
import { NeonRepo } from "./neon";
import type { Repo } from "./repo";

let repo: Repo | null = null;

/** Neon when DATABASE_URL is set (and not MOCK_MODE); otherwise a process-local in-memory store. */
export function getRepo(): Repo {
  if (!repo) repo = hasDb() ? new NeonRepo(env().DATABASE_URL!) : new MemoryRepo();
  return repo;
}

export function setRepoForTests(r: Repo) {
  repo = r;
}
