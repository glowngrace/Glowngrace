import pg from 'pg';
import type { Database, QueryResult } from './handlers.js';
import { QueryError, codeOf } from './query-error.js';
import type { ResolvedDatabase } from './config.js';

const { Pool, types } = pg;

/**
 * `int8` and `numeric` arrive as strings unless told otherwise, because the
 * driver refuses to assume a 64-bit integer or an arbitrary-precision decimal
 * survives the trip into a JavaScript number.
 *
 * Left alone they would also make the two backends disagree: the in-memory
 * executor returns a number for `rating NUMERIC(2,1)` and for
 * `subtotal_paise BIGINT`, so the same column would be a number in one store and
 * a string in the other, and every reader above would need to know which backend
 * it had. Neither type is anywhere near the boundary here - a rating is 0 to 5
 * and a paise amount is a rupee figure times 100 - so both are parsed, with the
 * string handed back untouched if the value is genuinely too large to represent.
 */
function numberParser(raw: string): string | number {
  const value = Number(raw);
  return Number.isSafeInteger(value) || Number.isFinite(value) ? value : raw;
}

types.setTypeParser(20, numberParser); // int8
types.setTypeParser(1700, numberParser); // numeric

export type PostgresDatabase = Database & {
  pool: pg.Pool;
  resolved: ResolvedDatabase;
  /** Releases every pooled connection. Called on shutdown and by the scripts. */
  end: () => Promise<void>;
};

/**
 * A `Database` backed by a real PostgreSQL.
 *
 * Deliberately the same two-method shape the in-memory store answers, so
 * nothing above `createHandlers`/`createAdminHandlers` knows or cares which one
 * it was handed.
 *
 * Nothing connects here. `new Pool()` opens no socket; the first socket is opened
 * by the first query, which means importing this module is free and a database
 * that is not up yet does not stop the API from booting and reporting why.
 */
export function createPostgresDatabase(resolved: ResolvedDatabase): PostgresDatabase {
  const pool = new Pool({
    ...resolved.pool,
    // Shows up in `pg_stat_activity`, which is the difference between a local
    // stray connection and one you can find and close.
    application_name: resolved.description.database.startsWith('neondb') ? 'glow-and-grace-neon' : 'glow-and-grace-local',
  });

  // A pool with no error listener throws on a backend that drops an idle
  // connection, which for a long-lived API process is a crash waiting for the
  // quietest moment of the night. The driver replaces the dead client itself;
  // all that is needed here is for the event to stop being fatal.
  pool.on('error', (error) => {
    console.error('Idle PostgreSQL connection failed', error.message);
  });

  const database: PostgresDatabase = {
    pool,
    resolved,

    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      try {
        const result = await pool.query(text, values as never[]);
        return { rows: result.rows, rowCount: result.rowCount ?? 0 };
      } catch (error) {
        throw new QueryError(
          `The database could not run the query: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error, code: codeOf(error) },
        );
      }
    },

    async end() {
      await pool.end();
    },
  };

  return database;
}

export function isPostgresDatabase(database: Database): database is PostgresDatabase {
  return typeof (database as Partial<PostgresDatabase>).end === 'function'
    && (database as Partial<PostgresDatabase>).pool !== undefined;
}