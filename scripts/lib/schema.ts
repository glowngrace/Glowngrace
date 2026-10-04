import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { projectRoot } from './docker.js';

/**
 * The schema, as an ordered list of files.
 *
 * `db/init.sql` creates the storefront tables and every migration after it is
 * idempotent, so the whole list can be replayed against a database that is
 * already current. That is what makes "run the migrations" a safe answer rather
 * than a question.
 */
export function schemaFiles(only?: string): string[] {
  const dbDirectory = join(projectRoot, 'db');
  const initial = join(dbDirectory, 'init.sql');
  const migrationsDirectory = join(dbDirectory, 'migrations');
  const migrations = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(migrationsDirectory, name));

  if (!only) return [initial, ...migrations];

  // `--only` exists so a single migration can be applied without replaying the
  // rest of db/, which would also re-run the destructive statements in
  // 010_remove_demo_accounts.sql. Accepts a full filename or a bare number.
  const wanted = only.endsWith('.sql') ? only : `${only.padStart(3, '0')}_`;
  const match = [initial, ...migrations].filter((file) => {
    // basename, not a split on a separator: the separator differs by platform,
    // and a Windows-only split matches nothing on Linux.
    const name = basename(file);
    return name === wanted || name.startsWith(wanted);
  });
  if (match.length !== 1) {
    throw new Error(
      `\n--only ${only} matched ${match.length} files in db/. Pass a migration filename or number, for example --only 013.`,
    );
  }
  return match;
}

export function schemaLabel(file: string) {
  return file.slice(projectRoot.length + 1);
}