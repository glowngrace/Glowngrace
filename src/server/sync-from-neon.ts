import type { Client } from 'pg';
import {
  assertSyncTargetIsLocal,
  clientConfig,
  describeResolvedDatabase,
  maskHost,
  resolveLocalDatabase,
  resolveProductionDatabase,
  type ResolvedDatabase,
} from './config.js';

/**
 * Copying the Neon production database down into the local Docker one.
 *
 * This is the only code in the project that opens a connection to production,
 * and it is built to open as few of them as possible. Every design choice below
 * exists for that reason:
 *
 *   One connection, opened once. A pooled Neon endpoint multiplexes over a
 *   single TCP connection anyway, and each new one can wake a compute that then
 *   has to be paid for. The sync holds one for its whole run and closes it.
 *
 *   One query for the answer, not one per question. Row counts for every table
 *   arrive in a single statement built from scalar subqueries, and so do the
 *   fingerprints. Reading 18 tables 18 times is 18 round trips to a database
 *   8000 km away; the same 18 answers cost one.
 *
 *   A fingerprint before anything is copied. Two cheap queries - one per side -
 *   say whether local already matches production. A second click on an unchanged
 *   database then costs those two queries and nothing else, instead of pulling
 *   every row again to overwrite it with itself.
 *
 *   Paged reads, batched writes. Rows arrive a page at a time and leave in
 *   batches bounded by both row count and bytes, because `product_images` holds
 *   up to 300 KB of binary per row and an unbounded `INSERT` of those will blow
 *   past Neon's parameter limit and past the local server's memory.
 *
 *   Images are optional. They are the bulk of the bytes and the least useful
 *   thing to have locally, so `--skip-images` (or the checkbox on the admin
 *   button) leaves that one table alone.
 *
 * One thing is deliberately never copied: `admin_sessions`. Copying it would
 * make a production session token valid against the local database without
 * anybody signing in, which is the kind of convenience that turns into an
 * incident. Sign in locally as usual after a sync.
 */

export type SyncTable = {
  name: string;
  /** Primary key: what the fingerprint reads as "the newest row", and what keyset paging walks. */
  key: string;
  /** Timestamp compared between the two sides to spot a change. */
  marker: string;
  /** True when the table holds rows every other row depends on. */
  parent?: boolean;
};

/**
 * Copy order, and therefore the truncate order reversed.
 *
 * `product_images` and `order_items` reference `products` and `orders`, so the
 * parents are cleared first and refilled first. Getting this backwards fails on
 * the foreign key rather than quietly.
 *
 * The key is named per table because three of them have no `id`: `store_settings`,
 * `site_pages` and `demo_datasets` are keyed by their own natural key.
 */
export const syncTables: SyncTable[] = [
  { name: 'contact_requests', key: 'id', marker: 'created_at' },
  { name: 'newsletter_subscribers', key: 'id', marker: 'updated_at' },
  { name: 'store_settings', key: 'key', marker: 'updated_at' },
  { name: 'site_pages', key: 'slug', marker: 'updated_at' },
  { name: 'products', key: 'id', marker: 'updated_at' },
  { name: 'product_images', key: 'id', marker: 'created_at', parent: true },
  { name: 'orders', key: 'id', marker: 'created_at' },
  { name: 'order_items', key: 'id', marker: 'created_at', parent: true },
  { name: 'admin_users', key: 'id', marker: 'updated_at' },
  // After `admin_users`: it is keyed by a foreign key into it, so it has to be
  // emptied and refilled around it rather than the other way round.
  { name: 'owner_password_events', key: 'id', marker: 'created_at' },
  { name: 'job_vacancies', key: 'id', marker: 'updated_at' },
  { name: 'candidates', key: 'id', marker: 'updated_at' },
  { name: 'partner_salons', key: 'id', marker: 'updated_at' },
  { name: 'customers', key: 'id', marker: 'updated_at' },
  { name: 'reviews', key: 'id', marker: 'updated_at' },
  { name: 'demo_datasets', key: 'key', marker: 'updated_at' },
  { name: 'email_outbox', key: 'id', marker: 'created_at' },
];

export type SyncOptions = {
  skipImages?: boolean;
  /** Copy even when the fingerprints already agree. */
  force?: boolean;
  /** Report what would happen and change nothing. */
  dryRun?: boolean;
  /** Print each step. */
  log?: (message: string) => void;
};

export type SyncResult = {
  status: 'ok' | 'unchanged' | 'dry-run';
  source: string;
  target: string;
  copied: Record<string, number>;
  available: Record<string, number>;
  skipImages: boolean;
  durationMs: number;
  message: string;
};

const pageSize = 500;
const batchRowLimit = 500;
/** Postgres caps a statement at 65535 bind parameters; 500 rows x ~25 columns is well inside it. */
const batchByteLimit = 2 * 1024 * 1024;

type Row = Record<string, unknown>;

/**
 * The driver, with date and timestamp columns left as text.
 *
 * By default `pg` parses `date`, `timestamp` and `timestamptz` into JavaScript
 * `Date`s, and a `Date` only holds milliseconds. A row written on production
 * almost always carries microseconds, so every timestamp that came back through
 * a `Date` lost its last three digits on the way into the local database. The
 * rows still looked right, and the difference was invisible until the sync's own
 * "has anything changed?" fingerprint compared the two sides and found that they
 * never agreed - so it copied all over again on every single click.
 *
 * Reading them as text and writing the same text back is exact, and it also
 * avoids a `date` column being shifted a day by a client and server that disagree
 * about the timezone.
 *
 * `setTypeParser` is global to the `pg` module, which is fine here: this is the
 * only code that copies one database into another, and the application pool sets
 * its own parsers when it starts.
 */
let driverLoaded: Promise<typeof import('pg').default> | null = null;
async function driver() {
  if (!driverLoaded) {
    driverLoaded = import('pg').then((module) => {
      const pg = module.default;
      pg.types.setTypeParser(1082, (value: string) => value); // date
      pg.types.setTypeParser(1114, (value: string) => value); // timestamp
      pg.types.setTypeParser(1184, (value: string) => value); // timestamptz
      return pg;
    });
  }
  return driverLoaded;
}

function quoteIdentifier(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

function valueBytes(value: unknown) {
  if (Buffer.isBuffer(value)) return value.byteLength;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (value === null || value === undefined) return 0;
  return 8;
}

/**
 * Makes a value read out of one database safe to write into another.
 *
 * A `json`/`jsonb` column comes back already parsed, and `pg` turns every JSON
 * value into a JavaScript one: an object for `{...}`, but the bare string `yes`
 * for `"yes"`, and a number or boolean for its scalar. Only the first can be
 * written straight back. Every value in a JSON column is re-serialised, scalars
 * included, or `jsonb` rejects `"yes"` with "invalid input syntax for type json".
 *
 * Buffers and dates are left alone: they already round-trip, and they are never
 * JSON.
 */
function parameterValue(value: unknown, isJson: boolean): unknown {
  if (value === null || value === undefined) return null;
  if (isJson) return JSON.stringify(value);
  if (typeof value === 'object' && !Buffer.isBuffer(value) && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}

function tablesToCopy(skipImages: boolean) {
  return syncTables.filter((table) => !(skipImages && table.name === 'product_images'));
}

async function connect(resolved: ResolvedDatabase) {
  const pg = await driver();
  const client: Client = new pg.Client(clientConfig(resolved));
  await client.connect();
  return client;
}

/** Present only when the remote has the table at all. */
async function existingTables(client: Client, names: string[]) {
  // `unnest` is expanded in the FROM clause and its output column referenced in
  // the WHERE clause: a set-returning function cannot be called from WHERE.
  const result = await client.query<{ name: string }>(
    `SELECT name
     FROM unnest($1::text[]) AS present(name)
     WHERE to_regclass('public.' || name) IS NOT NULL`,
    [names],
  );
  return new Set(result.rows.map((row) => row.name));
}

/**
 * Count, newest row and highest key for every table, in one statement.
 *
 * This is the fingerprint. Two of these - one per database - are enough to tell
 * whether local already mirrors production without reading a single row.
 *
 * The key is cast to text because it is not the same type everywhere: `id` is an
 * integer on most tables, a UUID on `product_images` and absent on three, and
 * PostgreSQL has no `max(uuid)`. Both sides cast identically, and the value is
 * only ever compared for equality, so ordering never matters.
 */
async function fingerprint(client: Client, tables: SyncTable[]) {
  const parts = tables.map((table) => `
    SELECT '${table.name}' AS name,
           count(*)::text AS rows,
           COALESCE(max(${quoteIdentifier(table.marker)})::text, '') AS marker,
           COALESCE(max(${quoteIdentifier(table.key)}::text), '') AS highest
    FROM ${quoteIdentifier(table.name)}`);
  const result = await client.query<{ name: string; rows: string; marker: string; highest: string }>(
    `SELECT * FROM (${parts.join(' UNION ALL ')}) AS fingerprint`,
  );
  const map: Record<string, { rows: number; marker: string; highest: string }> = {};
  for (const row of result.rows) {
    map[row.name] = { rows: Number(row.rows), marker: row.marker, highest: row.highest };
  }
  return map;
}

/**
 * The columns both sides have, and which of those hold JSON.
 *
 * The two schemas come from the same migrations, but a local database that
 * predates a migration must not have a sync fail on a column the newer side has
 * and the older does not. The data types come back with the names because a
 * `jsonb` value needs re-serialising before it can be written again.
 */
async function sharedColumns(source: Client, target: Client, table: string) {
  // Both sides in one round trip each.
  const statement = `SELECT column_name, data_type
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`;
  const [remote, local] = await Promise.all([
    source.query<{ column_name: string; data_type: string }>(statement, [table]),
    target.query<{ column_name: string; data_type: string }>(statement, [table]),
  ]);
  const localTypes = new Map(local.rows.map((row) => [row.column_name, row.data_type]));
  const shared = remote.rows.filter((row) => localTypes.has(row.column_name));
  return {
    columns: shared.map((row) => row.column_name),
    // Either side's answer is the same; the remote is used because it is the one
    // whose values are being copied.
    json: new Set(shared.filter((row) => row.data_type === 'json' || row.data_type === 'jsonb').map((row) => row.column_name)),
  };
}

async function insertRows(target: Client, table: string, columns: string[], jsonColumns: Set<string>, rows: Row[]) {
  if (rows.length === 0) return;
  const columnList = columns.map(quoteIdentifier).join(', ');
  let batch: Row[] = [];
  let bytes = 0;

  async function flush() {
    if (batch.length === 0) return;
    const values: unknown[] = [];
    const tuples = batch.map((row) => {
      const offset = values.length;
      for (const column of columns) values.push(parameterValue(row[column], jsonColumns.has(column)));
      return `(${columns.map((_column, index) => `$${offset + index + 1}`).join(', ')})`;
    });
    const statement = `INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES ${tuples.join(', ')}`;
    try {
      await target.query(statement, values);
    } catch (error) {
      // "invalid input syntax for type json" says nothing about which row or
      // which column, and the statement itself only holds $1 placeholders. The
      // table, the row count and the JSON columns are named instead.
      const cause = error as { message?: string };
      throw new Error(
        `${table}: could not write ${batch.length} row(s): ${cause?.message ?? String(error)}.`
        + (jsonColumns.size > 0 ? ` JSON columns: ${[...jsonColumns].join(', ')}.` : ''),
      );
    }
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

async function copyTable(source: Client, target: Client, table: SyncTable, columns: string[], jsonColumns: Set<string>) {
  const columnList = columns.map(quoteIdentifier).join(', ');
  // Keyset pagination rather than OFFSET: OFFSET re-reads and re-discards every
  // row already sent, which on a big table is most of the transfer.
  // Falls back to the first shared column if the key is not among them, which is
  // the only way a table can be copied at all.
  const key = columns.includes(table.key) ? table.key : columns[0];
  let cursor: unknown = null;
  let copied = 0;
  for (;;) {
    // The first page has no cursor, and `key > NULL` is never true - every
    // comparison with NULL is unknown - so the first page is read without a
    // WHERE clause rather than with one.
    const where = cursor === null ? '' : `WHERE ${quoteIdentifier(key)} > $1`;
    const page = await source.query(
      `SELECT ${columnList} FROM ${quoteIdentifier(table.name)}
       ${where}
       ORDER BY ${quoteIdentifier(key)}
       LIMIT ${pageSize}`,
      cursor === null ? [] : [cursor],
    );
    if (page.rows.length === 0) break;
    await insertRows(target, table.name, columns, jsonColumns, page.rows as Row[]);
    copied += page.rows.length;
    if (page.rows.length < pageSize) break;
    cursor = (page.rows[page.rows.length - 1] as Row)[key];
  }
  return copied;
}

/**
 * Puts every identity sequence past the highest id now in the table.
 *
 * Without this a synced `products` table keeps its sequence at 1 and the first
 * product added locally collides with the first one that came from production.
 */
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
    const bounds = await target.query<{ value: string }>(
      'SELECT last_value::text AS value FROM pg_sequences WHERE schemaname = $1 AND sequencename = $2',
      ['public', sequenceName.split('.').pop() ?? sequenceName],
    );
    await target.query('SELECT setval($1::regclass, GREATEST($2::bigint, $3::bigint), true)', [
      sequenceName,
      Number(bounds.rows[0]?.value ?? 0),
      Number((await target.query<{ value: string }>(
        `SELECT COALESCE(MAX(${quoteIdentifier(column.column_name)}), 0)::text AS value FROM ${quoteIdentifier(column.table_name)}`,
      )).rows[0]?.value ?? 0),
    ]);
  }
}

/**
 * Runs the sync. Opens exactly one connection to Neon and one to local, and
 * closes both before returning.
 */
export async function syncFromNeon(options: SyncOptions = {}): Promise<SyncResult> {
  const startedAt = Date.now();
  const log = options.log ?? (() => undefined);
  const skipImages = options.skipImages === true;

  const production = resolveProductionDatabase();
  const local = resolveLocalDatabase();
  assertSyncTargetIsLocal(production.description, local.description);

  const sourceLabel = `${describeResolvedDatabase(production)}`.replace(
    production.description.host,
    maskHost(production.description.host),
  );
  const targetLabel = describeResolvedDatabase(local);

  const wanted = tablesToCopy(skipImages);
  const source = await connect(production);
  const target = await connect(local);

  try {
    const sourceTables = await existingTables(source, syncTables.map((table) => table.name));
    const targetTables = await existingTables(target, syncTables.map((table) => table.name));
    const shared = wanted.filter(
      (table) => sourceTables.has(table.name) && targetTables.has(table.name),
    );

    if (shared.length === 0) {
      throw new Error(
        'No table is present on both sides. Run `npm run db:migrate` against the local database first, '
        + `and check that ${sourceLabel} has been migrated.`,
      );
    }

    // Two statements, one per side. Everything else is decided from these.
    const [sourcePrint, targetPrint] = await Promise.all([
      fingerprint(source, shared),
      fingerprint(target, shared),
    ]);

    const available: Record<string, number> = {};
    const copied: Record<string, number> = {};
    for (const table of shared) available[table.name] = sourcePrint[table.name]?.rows ?? 0;

    const unchanged = shared.every((table) => {
      const from = sourcePrint[table.name];
      const to = targetPrint[table.name];
      return from && to && from.rows === to.rows && from.marker === to.marker && from.highest === to.highest;
    });

    if (unchanged && !options.force) {
      log('Local already matches Neon, nothing to copy.');
      return {
        status: 'unchanged',
        source: sourceLabel,
        target: targetLabel,
        copied: {},
        available,
        skipImages,
        durationMs: Date.now() - startedAt,
        message: 'The local database already matches Neon, so nothing was copied. '
          + 'Use "Sync anyway" to overwrite it regardless.',
      };
    }

    if (options.dryRun) {
      for (const table of shared) {
        log(`${table.name}: ${available[table.name]} rows in Neon, ${targetPrint[table.name]?.rows ?? 0} locally`);
      }
      return {
        status: 'dry-run',
        source: sourceLabel,
        target: targetLabel,
        copied: {},
        available,
        skipImages,
        durationMs: Date.now() - startedAt,
        message: 'Dry run: nothing was written.',
      };
    }

    log(`Copying ${shared.length} table${shared.length === 1 ? '' : 's'} from Neon into the local database.`);

    // Everything from here on is one transaction on the local database.
    //
    // The first step empties every table it is about to refill, so a failure
    // part way through used to leave the local database blank with no way back.
    // Inside a transaction, a dropped connection or a bad row rolls the whole
    // thing back and the rows that were there a minute ago are still there.
    await target.query('BEGIN');

    try {
      // Children first on the way out so the foreign keys never dangle, parents
      // first on the way back in.
      for (const table of [...shared].reverse().filter((entry) => entry.parent)) {
        await target.query(`TRUNCATE TABLE ${quoteIdentifier(table.name)} RESTART IDENTITY CASCADE`);
      }
      for (const table of [...shared].reverse().filter((entry) => !entry.parent)) {
        await target.query(`DELETE FROM ${quoteIdentifier(table.name)}`);
      }

      for (const table of shared) {
        const { columns, json } = await sharedColumns(source, target, table.name);
        if (columns.length === 0) {
          log(`${table.name}: no shared columns, skipped.`);
          continue;
        }
        copied[table.name] = await copyTable(source, target, table, columns, json);
        log(`${table.name}: copied ${copied[table.name]} of ${available[table.name]} rows`);
      }

      await alignSequences(target);
      await target.query('COMMIT');
    } catch (error) {
      await target.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const total = Object.values(copied).reduce((sum, value) => sum + value, 0);
    // Announced rather than left to be discovered. Copying `admin_users` replaces
    // the local rows with production's, which have different ids, and
    // `admin_sessions.user_id` cascades on delete - so every local session is
    // dropped as a side effect. The console's next request then answers 401, and
    // an operator who has just been signed out deserves to know it was the sync.
    const signedOut = 'admin_users' in copied;
    return {
      status: 'ok',
      source: sourceLabel,
      target: targetLabel,
      copied,
      available,
      skipImages,
      durationMs: Date.now() - startedAt,
      message: `Copied ${total} row${total === 1 ? '' : 's'} from Neon into the local database in `
        + `${Math.round((Date.now() - startedAt) / 1000)}s.`
        + (signedOut ? ' The console accounts came across too, so sign in again.' : ''),
    };
  } finally {
    // Both closed whatever happened: an abandoned Neon connection keeps a compute
    // awake and billing until the server times it out.
    await Promise.all([
      source.end().catch(() => undefined),
      target.end().catch(() => undefined),
    ]);
  }
}