import 'dotenv/config';
import { loadEnvironment } from '../src/server/env.js';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { schemaFiles } from './lib/schema.js';

loadEnvironment();

const { default: pg } = await import('pg');
const { neon } = await import('@neondatabase/serverless');
const {
  DatabaseConfigError,
  clientConfig,
  describeResolvedDatabase,
  requiredTables,
  adminTables,
  resolveLocalDatabase,
  resolveProductionDatabase,
} = await import('../src/server/config.js');
const { publishingColumns, productDetailColumns } = await import('../src/server/catalogue.js');

/**
 * The product columns this build reads, and the migrations that add them.
 *
 * A database from before the catalogue migrations still serves the storefront,
 * so a missing column is a warning rather than a failure. The migration name is
 * read from the files rather than hard-coded, so the advice cannot fall out of
 * step with `db/migrations`.
 */
const productColumnsToCheck = [...publishingColumns, ...productDetailColumns];
const migrationFor = new Map<string, string>();
for (const file of schemaFiles()) {
  const label = basename(file);
  for (const match of readFileSync(file, 'utf8').matchAll(/ALTER TABLE\s+(?:IF EXISTS\s+)?products[\s\S]*?ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?([a-z_]+)"?/gi)) {
    const column = match[1].toLowerCase();
    if (!migrationFor.has(column)) migrationFor.set(column, label);
  }
}

/**
 * Reports whether each configured database is reachable, migrated and stocked.
 *
 *   npm run db:check              both
 *   npm run db:check -- local     just the Docker one
 *   npm run db:check -- production just Neon
 *
 * The two are checked by different drivers on purpose.
 *
 * Local goes through `pg`, because that is the driver the application itself
 * uses and a check that used a different one could report a problem the app does
 * not have.
 *
 * Neon goes through `@neondatabase/serverless` over HTTP, because a check is
 * exactly the case that driver is for: a single stateless round trip, with no
 * connection to open, no pool to keep warm, and no compute held awake between
 * calls. Reaching for a TCP connection and a `pg` pool to run one `SELECT` would
 * be the expensive way to ask whether the expensive thing works.
 *
 * Either way the whole report is one query per database.
 */

type Target = 'local' | 'production';

const allTables = [...requiredTables, ...adminTables];

function countsQuery() {
  return `SELECT
    version() AS version,
    current_database() AS name,
    ${allTables.map((table) => `(SELECT count(*)::text FROM "${table}") AS ${table}`).join(',\n    ')}`;
}

function presenceQuery() {
  return `SELECT ${allTables.map((table) => `to_regclass('public.${table}') IS NOT NULL AS ${table}`).join(', ')}`;
}

function interpret(row: Record<string, unknown>, startedAt: number) {
  const missingTables = requiredTables.filter((table) => row[`present_${table}`] !== true);
  const missingAdminTables = adminTables.filter((table) => row[`present_${table}`] !== true);

  let missingProductColumns: string[] = [];
  if (!missingTables.includes('products')) {
    const present = new Set(
      Object.keys(row)
        .filter((key) => key.startsWith('column_'))
        .map((key) => key.slice('column_'.length)),
    );
    missingProductColumns = productColumnsToCheck
      .filter((column) => !present.has(column));
  }

  const counts: Record<string, number> = {};
  for (const table of allTables) {
    if (row[table] !== undefined) counts[table] = Number(row[table]);
  }

  return {
    ok: missingTables.length === 0 && missingProductColumns.length === 0,
    version: String(row.version ?? '').split(' ').slice(0, 2).join(' '),
    name: String(row.name ?? ''),
    latencyMs: Date.now() - startedAt,
    missingTables,
    missingAdminTables,
    missingProductColumns,
    counts,
  };
}

async function inspectLocal(): Promise<Record<string, unknown>> {
  const label = 'Local Docker';
  let resolved;
  try {
    resolved = resolveLocalDatabase();
  } catch (error) {
    return { label, ok: false, configured: false, reason: error instanceof Error ? error.message : String(error) };
  }

  const startedAt = Date.now();
  const client = new pg.Client(clientConfig(resolved));
  try {
    await client.connect();
    const presence = await client.query<Record<string, unknown>>(presenceQuery());
    const present = presence.rows[0] ?? {};
    const prefixed: Record<string, unknown> = { version: undefined, name: undefined };
    for (const [key, value] of Object.entries(present)) prefixed[`present_${key}`] = value;

    const presentTables = requiredTables.filter((table) => present[table] === true);
    if (presentTables.includes('products')) {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'products'`,
      );
      for (const column of columns.rows) prefixed[`column_${column.column_name}`] = true;
    }

    const counts = await client.query<Record<string, unknown>>(countsQuery());
    const merged = { ...prefixed, ...(counts.rows[0] ?? {}) };

    // The verdict comes last: `interpret` decides whether the database is usable,
    // and a `true` written before the spread would be overwritten by it anyway.
    return { label, configured: true, connection: describeResolvedDatabase(resolved), ...interpret(merged, startedAt) };
  } catch (error) {
    const cause = error as { code?: string; message?: string };
    return {
      label,
      ok: false,
      configured: true,
      connection: describeResolvedDatabase(resolved),
      reason: `${cause?.message ?? String(error)}${cause?.code ? ` (code=${cause.code})` : ''}`,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * One HTTP request. The presence and count queries are combined into a single
 * statement rather than sent as two, because on Neon the round trip costs far
 * more than the extra text does.
 */
async function inspectProduction(): Promise<Record<string, unknown>> {
  const label = 'Production Neon';
  let resolved;
  try {
    resolved = resolveProductionDatabase();
  } catch (error) {
    return {
      label,
      ok: false,
      configured: false,
      reason: error instanceof DatabaseConfigError
        ? error.message
        : error instanceof Error ? error.message : String(error),
    };
  }

  const startedAt = Date.now();
  try {
    const sql = neon(resolved.connectionString);
    const tables = allTables.map((table) => `to_regclass('public.${table}') IS NOT NULL AS present_${table}`).join(',\n      ');
    const counted = allTables.map((table) => `(SELECT count(*)::text FROM "${table}") AS ${table}`).join(',\n      ');
    const columns = productColumnsToCheck
      .map((column) => `to_regclass('public.products') IS NOT NULL AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = '${column}'
      ) AS column_${column}`).join(',\n      ');

    // `query` resolves to the rows themselves over HTTP, with no `rows` envelope:
    // there is no driver-side result object to unwrap on this path.
    const response = await sql.query(
      `SELECT version() AS version, current_database() AS name,
      ${tables},
      ${columns},
      ${counted}`,
    );
    return {
      label,
      configured: true,
      connection: describeResolvedDatabase(resolved),
      driver: '@neondatabase/serverless over HTTP (one request)',
      ...interpret((response[0] ?? {}) as Record<string, unknown>, startedAt),
    };
  } catch (error) {
    const cause = error as { code?: string; message?: string };
    return {
      label,
      ok: false,
      configured: true,
      connection: describeResolvedDatabase(resolved),
      reason: `${cause?.message ?? String(error)}${cause?.code ? ` (code=${cause.code})` : ''}`,
    };
  }
}

function report(outcome: Record<string, unknown>) {
  console.log(`\n${outcome.label}`);
  if (outcome.configured === false) {
    console.log('  configured: no');
    console.log(`  reason:     ${outcome.reason}`);
    return;
  }
  console.log(`  connection: ${outcome.connection}`);
  if (outcome.driver) console.log(`  driver:     ${outcome.driver}`);
  if (outcome.version) console.log(`  version:    ${outcome.version}`);
  if (typeof outcome.latencyMs === 'number') console.log(`  latency:    ${outcome.latencyMs} ms`);

  if (outcome.reason) {
    console.log('  reachable:  no');
    console.log(`  reason:     ${outcome.reason}`);
    return;
  }

  const missingTables = (outcome.missingTables as string[]) ?? [];
  const missingColumns = (outcome.missingProductColumns as string[]) ?? [];
  console.log(`  reachable:  yes`);
  console.log(`  tables:     ${missingTables.length === 0 ? 'all present' : `missing ${missingTables.join(', ')}`}`);
  console.log(`  columns:    ${missingColumns.length === 0
    ? 'every product column this build reads is present'
    : `products is missing ${missingColumns.join(', ')}`}`);
  if (missingColumns.length > 0) {
    const migrations = [...new Set(missingColumns.map((column) => migrationFor.get(column)).filter(Boolean))];
    console.log(`  drift:      products is missing ${missingColumns.length} column${missingColumns.length === 1 ? '' : 's'} this build reads.`);
    console.log(`  fix:        apply ${migrations.length > 0 ? migrations.join(' and ') : 'db/migrations, then re-run'} against this database.`);
  }

  const counts = (outcome.counts ?? {}) as Record<string, number>;
  const rows = Object.entries(counts);
  if (rows.length > 0) {
    console.log('  rows:');
    for (const [table, count] of rows) console.log(`    ${table.padEnd(24)} ${count}`);
  }
}

const requested = process.argv.slice(2).filter((argument) => argument === 'local' || argument === 'production');
const targets: Target[] = requested.length > 0 ? (requested as Target[]) : ['local', 'production'];

let failed = false;
for (const target of targets) {
  const outcome = target === 'local' ? await inspectLocal() : await inspectProduction();
  report(outcome);
  if (outcome.ok !== true) failed = true;
}
console.log('');
process.exitCode = failed ? 1 : 0;