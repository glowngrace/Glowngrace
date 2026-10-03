import { productDetailColumns, publishingColumns } from './catalogue.js';
import type { QueryResult } from './handlers.js';

/**
 * Test doubles for a catalogue whose column groups are known up front.
 *
 * A real PostgreSQL always answers the shape probe in src/server/catalogue.ts, so
 * a fake that answers it with an unrelated row would quietly claim every optional
 * column is missing and hand the code the wrong shape. Every fake here declares
 * which migrations its products table has and answers the probe from that, which
 * is what makes "this database predates migration 013" a state a test can be in.
 */

export type FakeShape = { publishing: boolean; details: boolean };

/** db/migrations/005 and 013 applied: the shape a current database reports. */
export const fullyMigrated: FakeShape = { publishing: true, details: true };

/** The state production was actually in: 005 applied, 013 never run. */
export const beforeProductDetails: FakeShape = { publishing: true, details: false };

/** db/init.sql and 002-004 only, which is what a brand new database looks like. */
export const beforeConsole: FakeShape = { publishing: false, details: false };

export function presentProductColumns(shape: FakeShape): string[] {
  return [
    ...(shape.publishing ? [...publishingColumns] : []),
    ...(shape.details ? [...productDetailColumns] : []),
  ];
}

/** The one statement src/server/catalogue.ts sends to read the shape. */
export function isShapeProbe(text: string): boolean {
  return text.includes('information_schema.columns') && text.includes("to_regclass('public.products')");
}

/**
 * Answers the shape probe from `shape` and defers everything else to `impl`.
 *
 * `impl` may return a value or a promise, so a fake can throw synchronously the
 * way a failing driver does.
 */
export function withCatalogueShape(
  shape: FakeShape,
  impl: (text: string, values: unknown[]) => QueryResult | Promise<QueryResult>,
): (text: string, values?: unknown[]) => Promise<QueryResult> {
  return async (text: string, values: unknown[] = []) => {
    if (isShapeProbe(text)) {
      const columns = presentProductColumns(shape);
      // One row, as the real query returns. A shape with nothing present still
      // reports the table as present, which is the case the probe exists to tell
      // apart from a broken query.
      return { rows: [{ table_present: true, columns }], rowCount: 1 };
    }
    return impl(text, values);
  };
}

/**
 * Every statement a fake received except the shape probe.
 *
 * Tests care about the product query, and `calls[1]` after a probe is exactly the
 * kind of index arithmetic that breaks the next time a query is added.
 */
export function statements(query: { mock: { calls: unknown[][] } }): Array<{ text: string; values: unknown[] }> {
  return query.mock.calls
    .filter((call) => !isShapeProbe(String(call[0])))
    .map((call) => ({ text: String(call[0]), values: (call[1] as unknown[] | undefined) ?? [] }));
}

/** The statements that write a product row, for the insert-shape assertions. */
export function productWrites(query: { mock: { calls: unknown[][] } }): string[] {
  return statements(query).map((statement) => statement.text).filter((text) => /INSERT INTO products|UPDATE products/.test(text));
}