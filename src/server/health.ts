import { database, resolvedDatabase, store, storeKind, tables } from './database.js';
import { adminTables, maskHost, requiredTables } from './config.js';

/**
 * What /api/health reports.
 *
 * The answer depends on which store this process booted with, and the two are
 * genuinely different claims:
 *
 *   memory    there is no database. The only honest question is whether this
 *             process came up with its tables, so the report describes the
 *             in-process store and nothing else.
 *   postgres  there is a database, so the report says which one, whether it
 *             answered, how long it took, and which tables are missing. A
 *             migrated-but-empty database is `ok` with zero rows; an unmigrated
 *             one is `error` naming the tables to migrate.
 *
 * The block is not called `database` in the memory case on purpose: reporting a
 * connection that does not exist would be a claim nothing here can back.
 */

export type HealthReport = {
  status: 'ok' | 'error';
  store: 'memory' | 'postgres';
  tables: number;
  rows: Record<string, number>;
  productCount: number;
  database?: {
    variable: string;
    provider: string;
    host: string;
    port: number;
    name: string;
    ssl: string;
    latencyMs: number;
    missingTables: string[];
    missingAdminTables?: string[];
  };
  reason?: string;
};

/**
 * Health is polled - by a deployment check, by a monitor, by a browser - and on
 * Neon every poll is a connection. The counts cannot meaningfully change inside
 * a few seconds, so an answer is reused for this long rather than asking again.
 * Set `HEALTH_CACHE_MS=0` to ask every time.
 */
const cacheMs = (() => {
  const raw = Number(process.env.HEALTH_CACHE_MS ?? '5000');
  return Number.isFinite(raw) && raw >= 0 ? raw : 5_000;
})();

let cached: { expiresAt: number; report: HealthReport } | null = null;

function memoryReport(): HealthReport {
  try {
    const rows: Record<string, number> = {};
    for (const table of tables) rows[table.name] = store.rows.get(table.name)?.length ?? 0;
    return {
      status: 'ok',
      store: 'memory',
      tables: tables.length,
      rows,
      productCount: rows.products ?? 0,
    };
  } catch (error) {
    return {
      status: 'error',
      store: 'memory',
      tables: 0,
      rows: {},
      productCount: 0,
      reason: error instanceof Error ? error.message : 'The in-memory store could not be read.',
    };
  }
}

/**
 * One round trip for presence, one for the counts. Never one per table: on the
 * local Docker database that is merely wasteful, and against Neon it is the
 * difference between a health check that costs nothing and one that wakes
 * compute for eighteen queries.
 */
async function postgresReport(): Promise<HealthReport> {
  if (!resolvedDatabase) throw new Error('This process reports a PostgreSQL store but has no connection configured.');
  const { description, variable, ssl } = resolvedDatabase;

  const startedAt = Date.now();
  const summary: HealthReport = {
    status: 'error',
    store: 'postgres',
    tables: 0,
    rows: {},
    productCount: 0,
    database: {
      variable,
      provider: description.provider,
      host: maskHost(description.host),
      port: description.port,
      name: description.database,
      ssl,
      latencyMs: 0,
      missingTables: [],
    },
  };

  const allTables = [...requiredTables, ...adminTables];
  const presence = await database.query(
    `SELECT ${allTables.map((table) => `to_regclass('public.${table}') IS NOT NULL AS ${table}`).join(', ')}`,
  );
  const found = presence.rows[0] ?? {};
  const missingTables = requiredTables.filter((table) => found[table] !== true);
  const missingAdminTables = adminTables.filter((table) => found[table] !== true);
  if (summary.database) summary.database.missingTables = missingTables;

  if (missingTables.length > 0) {
    summary.database = summary.database
      ? { ...summary.database, missingTables, missingAdminTables }
      : undefined;
    return {
      ...summary,
      reason: `Missing tables: ${missingTables.join(', ')}. Run \`npm run db:migrate\` against the local database.`,
    };
  }

  // Only counted once the tables are known to exist, so an unmigrated database
  // gets one clear message instead of eighteen.
  const counts = await database.query(
    `SELECT ${allTables.map((table) => `(SELECT count(*)::int FROM "${table}") AS ${table}`).join(', ')}`,
  );
  const row = counts.rows[0] ?? {};
  const rows: Record<string, number> = {};
  for (const table of allTables) rows[table] = Number(row[table] ?? 0);

  return {
    status: 'ok',
    store: 'postgres',
    tables: allTables.length - missingAdminTables.length,
    rows,
    productCount: rows.products ?? 0,
    database: {
      variable,
      provider: description.provider,
      host: maskHost(description.host),
      port: description.port,
      name: description.database,
      ssl,
      latencyMs: Date.now() - startedAt,
      missingTables,
      missingAdminTables,
    },
  };
}

export async function checkHealth(): Promise<HealthReport> {
  if (storeKind === 'memory') return memoryReport();
  if (cached && cached.expiresAt > Date.now()) return cached.report;

  let report: HealthReport;
  try {
    report = await postgresReport();
  } catch (error) {
    const cause = error as { code?: string; message?: string };
    report = {
      status: 'error',
      store: 'postgres',
      tables: 0,
      rows: {},
      productCount: 0,
      reason: `${cause?.message ?? String(error)}${cause?.code ? ` (code=${cause.code})` : ''}. `
        + 'Check `npm run db:check`, and that Docker is running if this is the local database.',
    };
  }
  // A failure is not cached: a database that has just come back up should be
  // reported as healthy on the very next poll, not after the TTL.
  if (report.status === 'ok') cached = { expiresAt: Date.now() + cacheMs, report };
  return report;
}