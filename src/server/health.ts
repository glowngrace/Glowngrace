import { store, tables } from './database.js';

/**
 * What /api/health reports.
 *
 * There is no database to connect to any more, so the checks a connection needed
 * - can the connection string be read, is the host reachable, do the tables exist -
 * have nothing to ask. What remains is the one thing that can still fail: the
 * store itself, which is process memory, so the only honest question is whether
 * this process came up with its tables.
 *
 * The block is deliberately not called `database`. Reporting one that no longer
 * exists would be a claim nothing here can back, and the only reader is the
 * deployment check, which is better served by being told what the store is.
 */

export type HealthReport = {
  status: 'ok' | 'error';
  store: 'memory';
  tables: number;
  rows: Record<string, number>;
  productCount: number;
  reason?: string;
};

export function checkHealth(): HealthReport {
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