import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { loadEnvironment } from '../src/server/env.js';

loadEnvironment();

const { default: pg } = await import('pg');
const { clientConfig, describeResolvedDatabase, requiredTables, adminTables, resolveLocalDatabase, resolveProductionDatabase } =
  await import('../src/server/config.js');
const { schemaFiles, schemaLabel } = await import('./lib/schema.js');

/**
 * Applies `db/init.sql` and every migration in `db/migrations`.
 *
 * Two targets, and only one of them is a normal thing to do:
 *
 *   local        the default. Safe to re-run; every statement is `IF NOT EXISTS`
 *                or an upsert, so a current database is left current.
 *   production   `npm run db:migrate -- production`. This one is not idempotent
 *                by accident - 010 removes rows on purpose - so it asks first
 *                unless `--yes` is passed.
 *
 * It runs as one client with autocommit off and a single COMMIT, so a failure
 * half way through leaves the database exactly as it was rather than with the
 * first three migrations applied and the fourth not.
 */

const args = process.argv.slice(2);
const target = args.includes('production') ? 'production' : 'local';
const onlyIndex = args.indexOf('--only');
const only = onlyIndex === -1 ? undefined : args[onlyIndex + 1];
const assumeYes = args.includes('--yes') || args.includes('-y');

// Anything unrecognised is refused rather than ignored. `--target=production`
// looks like it names the production database, and silently migrating the local
// one instead is the kind of wrong that is only noticed much later.
const known = new Set(['production', '--yes', '-y', '--only', only ?? '']);
const unknown = args.filter((argument) => !known.has(argument));
if (unknown.length > 0) {
  console.error(`\nUnrecognised argument${unknown.length === 1 ? '' : 's'}: ${unknown.map((argument) => `"${argument}"`).join(', ')}`);
  console.error('Usage: npm run db:migrate -- [production] [--only <migration>] [--yes]');
  process.exit(1);
}

const resolved = target === 'local' ? resolveLocalDatabase() : resolveProductionDatabase();

if (target === 'production' && !assumeYes) {
  console.log('\nThis will apply every migration to PRODUCTION Neon.');
  console.log(`Target: ${describeResolvedDatabase(resolved)}`);
  console.log('\n010_remove_demo_accounts.sql deletes rows on purpose, so this is not safe to');
  console.log('re-run casually. Type "migrate production" to continue.');
  const answer = await new Promise<string>((resolveAnswer) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk: string) => resolveAnswer(chunk.trim()));
  });
  if (answer !== 'migrate production') {
    console.log('\nCancelled. Nothing was changed.');
    process.exit(0);
  }
}

const files = schemaFiles(only);
const client = new pg.Client(clientConfig(resolved));

try {
  await client.connect();
  console.log(`\nApplying schema to ${target === 'local' ? 'the local Docker database' : 'PRODUCTION Neon'}`);
  console.log(`Target: ${describeResolvedDatabase(resolved)}\n`);

  await client.query('BEGIN');
  for (const file of files) {
    await client.query(readFileSync(file, 'utf8'));
    console.log(`  applied ${schemaLabel(file)}`);
  }
  await client.query('COMMIT');

  const allTables = [...requiredTables, ...adminTables];
  const presence = await client.query<Record<string, unknown>>(
    `SELECT ${allTables.map((table) => `to_regclass('public.${table}') IS NOT NULL AS ${table}`).join(', ')}`,
  );
  const row = presence.rows[0] ?? {};
  const missing = allTables.filter((table) => row[table] !== true);
  if (missing.length > 0) {
    console.error(`\nStill missing after migrating: ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${allTables.length} tables are present.`);
  }
} catch (error) {
  const cause = error as { code?: string; message?: string };
  console.error(`\nMigration failed and was rolled back: ${cause?.message ?? String(error)}${cause?.code ? ` (code=${cause.code})` : ''}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}