import type { Pool } from 'pg';
import { Pool as PostgresPool } from 'pg';
import type { Database } from './handlers.js';

let pool: Pool | undefined;

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required to use the database API.');
  if (!pool) {
    pool = new PostgresPool({ connectionString, max: 1, idleTimeoutMillis: 10_000 });
  }
  return pool;
}

export const database: Database = {
  async query(text, values) {
    const result = await getPool().query(text, values);
    return { rows: result.rows as Array<Record<string, unknown>>, rowCount: result.rowCount };
  },
};
