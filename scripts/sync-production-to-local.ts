import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import {
  assertSyncTargetIsLocal,
  clientConfig,
  describeResolvedDatabase,
  resolveLocalDatabase,
  resolveProductionDatabase,
  type ResolvedDatabase,
} from '../src/server/config.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Set(process.argv.slice(2));
const dryRun = flags.has('--dry-run');
const schemaOnly = flags.has('--schema-only');
const skipImages = flags.has('--skip-images');

const pageSize = 200;
const batchRowLimit = 200;
const batchByteLimit = 4 * 1024 * 1024;

const copyOrder = ['contact_requests', 'newsletter_subscribers', 'products', 'product_images', 'orders', 'order_items'] as const;

type Row = Record<string, unknown>;

function quoteIdentifier(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function valueBytes(value: unknown) {
  if (Buffer.isBuffer(value)) return value.byteLength;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (value === null || value === undefined) return 0;
  return 8;
}

async function connect(resolved: ResolvedDatabase) {
  const client = new Client(clientConfig(resolved));
  await client.connect();
  return client;
}

async function sharedColumns(source: Client, target: Client, table: string) {
  const remote = await source.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  const local = await target.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  const localNames = new Set(local.rows.map((row) => row.column_name));
  return remote.rows.map((row) => row.column_name).filter((name) => localNames.has(name));
}

async function insertRows(target: Client, table: string, columns: string[], rows: Row[]) {
  if (rows.length === 0) return;
  const columnList = columns.map(quoteIdentifier).join(', ');
  let batch: Row[] = [];
  let bytes = 0;

  async function flush() {
    if (batch.length === 0) return;
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const offset = values.length;
      columns.forEach((column) => { values.push(row[column] ?? null); });
      return `(${columns.map((_, index) => `$${offset + index + 1}`).join(', ')})`;
    });
    await target.query(`INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES ${tuples.join(', ')}`, values);
    batch = [];
    bytes = 0;
  }

  for (const row of rows) {
    const size = columns.reduce((total, column) => total + valueBytes(row[column]), 0);
    if (batch.length > 0 && (batch.length >= batchRowLimit || bytes + size > batchByteLimit)) await flush();
    batch.push(row);
    bytes += size;
  }
  await flush();
}

async function copyTable(source: Client, target: Client, table: string, columns: string[]) {
  const columnList = columns.map(quoteIdentifier).join(', ');
  let copied = 0;
  let offset = 0;
  for (;;) {
    const page = await source.query(
      `SELECT ${columnList} FROM ${quoteIdentifier(table)} ORDER BY ${quoteIdentifier(columns[0])} LIMIT ${pageSize} OFFSET ${offset}`,
    );
    if (page.rows.length === 0) break;
    await insertRows(target, table, columns, page.rows as Row[]);
    copied += page.rows.length;
    offset += page.rows.length;
    if (page.rows.length < pageSize) break;
  }
  return copied;
}

async function alignSequences(target: Client) {
  const identity = await target.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND is_identity = 'YES'`,
  );
  for (const column of identity.rows) {
    const sequence = await target.query<{ sequence_name: string | null }>(
      'SELECT pg_get_serial_sequence($1, $2) AS sequence_name',
      [`public.${column.table_name}`, column.column_name],
    );
    const sequenceName = sequence.rows[0]?.sequence_name;
    if (!sequenceName) continue;
    const maximum = await target.query<{ value: string }>(
      `SELECT COALESCE(MAX(${quoteIdentifier(column.column_name)}), 0)::text AS value FROM ${quoteIdentifier(column.table_name)}`,
    );
    const bounds = await target.query<{ value: string }>(
      'SELECT COALESCE(last_value, start_value)::text AS value FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2',
      ['public', sequenceName.split('.').pop() ?? sequenceName],
    );
    const next = Math.max(Number(maximum.rows[0]?.value ?? 0) + 1, Number(bounds.rows[0]?.value ?? 1));
    await target.query('SELECT setval($1::regclass, $2::bigint, true)', [sequenceName, next - 1]);
  }
}

async function main() {
  const production = resolveProductionDatabase();
  const local = resolveLocalDatabase();
  assertSyncTargetIsLocal(production.description, local.description);

  console.log(`Source (production, read only): ${describeResolvedDatabase(production)}`);
  console.log(`Target (local, overwritten):     ${describeResolvedDatabase(local)}`);

  const source = await connect(production);
  const target = await connect(local);
  const tables = copyOrder.filter((table) => !(skipImages && table === 'product_images'));
  const counts: Array<{ table: string; available: number; copied: number }> = [];

  try {
    if (!dryRun) {
      await target.query(readFileSync(join(projectRoot, 'db', 'init.sql'), 'utf8'));
      console.log('\nApplied db/init.sql to the local database.');
    }

    for (const table of tables) {
      const present = await source.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${table}`]);
      if (present.rows[0]?.present !== true) {
        console.log(`- ${table}: not present in production, skipped.`);
        continue;
      }
      const counted = await source.query<{ value: string }>(`SELECT count(*)::text AS value FROM ${quoteIdentifier(table)}`);
      counts.push({ table, available: Number(counted.rows[0]?.value ?? 0), copied: 0 });
    }

    if (dryRun || schemaOnly) {
      for (const entry of counts) console.log(`- ${entry.table}: ${entry.available} rows in production`);
      console.log(dryRun ? '\nDry run, nothing was written.' : '\nSchema only, no rows were copied.');
      return;
    }

    if (counts.length > 0) {
      await target.query(`TRUNCATE TABLE ${counts.map((entry) => quoteIdentifier(entry.table)).join(', ')} RESTART IDENTITY CASCADE`);
    }

    for (const entry of counts) {
      const columns = await sharedColumns(source, target, entry.table);
      if (columns.length === 0) {
        console.log(`- ${entry.table}: no shared columns, skipped.`);
        continue;
      }
      entry.copied = await copyTable(source, target, entry.table, columns);
    }

    await alignSequences(target);

    for (const entry of counts) console.log(`- ${entry.table}: copied ${entry.copied} of ${entry.available} rows`);
    console.log('\nLocal identity sequences realigned. The local database now mirrors production.');
    console.log('Local changes are never pushed back to production.');
  } finally {
    await Promise.all([source.end().catch(() => undefined), target.end().catch(() => undefined)]);
  }
}

main().catch((error: unknown) => {
  console.error(`\nSync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
