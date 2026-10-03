import 'dotenv/config';
import { Client } from 'pg';
import {
  describeProductColumnDrift,
  productDetailColumns,
  publishingColumns,
} from '../src/server/catalogue.js';
import {
  DatabaseConfigError,
  clientConfig,
  maskHost,
  requiredTables,
  resolveLocalDatabase,
  resolveProductionDatabase,
  type ResolvedDatabase,
} from '../src/server/config.js';

type Target = 'local' | 'production';
type Outcome = { target: Target; label: string } & Record<string, unknown>;

function resolveTarget(target: Target): ResolvedDatabase {
  return target === 'local' ? resolveLocalDatabase() : resolveProductionDatabase();
}

async function inspect(target: Target): Promise<Outcome> {
  const base: Outcome = { target, label: target === 'local' ? 'Local Docker' : 'Production Neon' };
  let resolved: ResolvedDatabase;
  try {
    resolved = resolveTarget(target);
  } catch (error) {
    return {
      ...base,
      ok: false,
      configured: false,
      reason: error instanceof DatabaseConfigError ? error.message : String(error),
    };
  }
  const described = `${resolved.variable} ${maskHost(resolved.description.host)}:${resolved.description.port}/${resolved.description.database} provider=${resolved.description.provider} ssl=${resolved.ssl}`;
  const client = new Client(clientConfig(resolved));
  const startedAt = Date.now();
  try {
    await client.connect();
    const presence = await client.query<Record<string, unknown>>(
      `SELECT version() AS version, current_database() AS name, ${requiredTables.map((table) => `to_regclass('public.${table}') IS NOT NULL AS ${table}`).join(', ')}`,
    );
    const row = presence.rows[0] ?? {};
    const missingTables = requiredTables.filter((table) => row[table] !== true);
    // products gains columns in migrations 005 and 013, so table presence alone
    // cannot tell a current database from one that is a release behind.
    let missingProductColumns: string[] = [];
    if (!missingTables.includes('products')) {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'products' AND column_name = ANY($1::text[])`,
        [[...publishingColumns, ...productDetailColumns]],
      );
      const present = new Set(columns.rows.map((entry) => entry.column_name));
      missingProductColumns = [...publishingColumns, ...productDetailColumns]
        .filter((column) => !present.has(column));
    }
    const counts: Record<string, number> = {};
    for (const table of missingTables.length === 0 ? requiredTables : []) {
      const counted = await client.query<{ value: string }>(`SELECT count(*)::text AS value FROM "${table}"`);
      counts[table] = Number(counted.rows[0]?.value ?? 0);
    }
    await client.end();
    return {
      ...base,
      ok: missingTables.length === 0 && missingProductColumns.length === 0,
      configured: true,
      connection: described,
      version: String(row.version ?? '').split(' ').slice(0, 2).join(' '),
      latencyMs: Date.now() - startedAt,
      missingTables,
      missingProductColumns,
      counts,
    };
  } catch (error) {
    await client.end().catch(() => undefined);
    const cause = error as { code?: string; message?: string };
    return {
      ...base,
      ok: false,
      configured: true,
      connection: described,
      reason: `${cause?.message ?? String(error)}${cause?.code ? ` (code=${cause.code})` : ''}`,
    };
  }
}

function report(outcome: Outcome) {
  console.log(`\n${outcome.label}`);
  if (outcome.configured === false) {
    console.log('  configured: no');
    console.log(`  reason:     ${outcome.reason}`);
    return;
  }
  console.log(`  connection: ${outcome.connection}`);
  if (outcome.version) console.log(`  version:    ${outcome.version}`);
  if (typeof outcome.latencyMs === 'number') console.log(`  latency:    ${outcome.latencyMs} ms`);
  if (Array.isArray(outcome.missingTables)) {
    const missing = outcome.missingTables as string[];
    console.log(`  reachable:  yes`);
    console.log(`  tables:     ${missing.length === 0 ? 'all present' : `missing ${missing.join(', ')}`}`);
    const missingColumns = (outcome.missingProductColumns as string[] | undefined) ?? [];
    console.log(`  columns:    ${missingColumns.length === 0
      ? 'every product column this build reads is present'
      : `products is missing ${missingColumns.join(', ')}`}`);
    if (missingColumns.length > 0) console.log(`  drift:      ${describeProductColumnDrift(missingColumns)}`);
    if (outcome.counts) {
      for (const [table, count] of Object.entries(outcome.counts as Record<string, number>)) {
        console.log(`    ${table.padEnd(24)} ${count}`);
      }
    }
  } else {
    console.log('  reachable:  no');
    console.log(`  reason:     ${outcome.reason}`);
  }
}

const requested = process.argv.slice(2).filter((argument) => argument === 'local' || argument === 'production');
const targets: Target[] = requested.length > 0 ? requested as Target[] : ['local', 'production'];

let failed = false;
for (const target of targets) {
  const outcome = await inspect(target);
  report(outcome);
  if (outcome.ok !== true) failed = true;
}
console.log('');
process.exitCode = failed ? 1 : 0;
