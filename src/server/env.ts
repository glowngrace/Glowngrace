import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Loads the environment files this project reads.
 *
 * `dotenv/config` only ever opens `.env`, which is the wrong shape for a project
 * with a development database: the credentials that point at local Docker are
 * per-machine and have no business in a file that is shared, while `.env` is the
 * file that is shared. So `.env.local` is the one that carries them.
 *
 * The order below is the precedence, because both calls pass no `override` and
 * dotenv never overwrites a variable that already has a value:
 *
 *   1. whatever the real process environment set (Docker, CI, Vercel)
 *   2. `.env.local`
 *   3. `.env`
 *
 * Reading `.env.local` first is therefore what makes it win over `.env`, and
 * `override: false` on both is what stops either from overwriting a variable the
 * platform set for us. Vite applies the same order to the front end.
 */
let loaded = false;

export function loadEnvironment(root: string = process.cwd()): void {
  if (loaded) return;
  loaded = true;
  for (const file of ['.env.local', '.env']) {
    const path = resolve(root, file);
    if (existsSync(path)) config({ path });
  }
}

/** Test seam: lets a test load a different root, or load again. */
export function resetEnvironmentForTests() {
  loaded = false;
}