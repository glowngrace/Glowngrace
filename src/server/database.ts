import type { Pool } from 'pg';
import { Pool as PostgresPool } from 'pg';
import type { Database } from './handlers.js';
import { describeResolvedDatabase, maskHost, resolveRuntimeDatabase, type ResolvedDatabase } from './config.js';

export class DatabaseQueryError extends Error {
  code: string | undefined;

  constructor(message: string, options: { cause?: unknown; code?: string }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DatabaseQueryError';
    this.code = options.code;
  }
}

let pool: Pool | undefined;
let poolKey: string | undefined;

function getPool(): { pool: Pool; resolved: ResolvedDatabase } {
  const resolved = resolveRuntimeDatabase();
  const key = `${resolved.variable}:${resolved.connectionString}`;
  if (!pool || poolKey !== key) {
    void pool?.end().catch(() => undefined);
    const created = new PostgresPool(resolved.pool);
    created.on('error', (error: Error) => {
      console.error(`Idle PostgreSQL client error on ${maskHost(resolved.description.host)}: ${error.message}`);
    });
    pool = created;
    poolKey = key;
  }
  return { pool, resolved };
}

function describeFailure(resolved: ResolvedDatabase, error: unknown) {
  const cause = error as { code?: unknown; message?: unknown };
  const code = typeof cause?.code === 'string' ? cause.code : undefined;
  const message = typeof cause?.message === 'string' ? cause.message : String(error);
  return `Database query failed on ${describeResolvedDatabase(resolved)}${code ? ` [${code}]` : ''}: ${message}`;
}

export const database: Database = {
  async query(text, values) {
    const active = getPool();
    try {
      const result = await active.pool.query(text, values);
      return { rows: result.rows as Array<Record<string, unknown>>, rowCount: result.rowCount };
    } catch (error) {
      const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : undefined;
      throw new DatabaseQueryError(describeFailure(active.resolved, error), { cause: error, code });
    }
  },
};
