import type { QueryResult } from './handlers.js';

/**
 * Statement helpers for tests that assert on the SQL the handlers send.
 *
 * A stubbed driver returns whatever rows it was told to and never parses the SQL,
 * so it happily accepts a query containing the text of a JavaScript function or a
 * doubled comma. Both of those shipped, with every unit test passing while
 * production answered 500. Reading the statements back is how a suite notices that
 * without a database.
 */

/**
 * Every statement the fake received.
 *
 * Tests care about specific statements, and `calls[1]` is exactly the kind of index
 * arithmetic that breaks the next time a query is added.
 */
export function statements(query: { mock: { calls: unknown[][] } }): Array<{ text: string; values: unknown[] }> {
  return query.mock.calls.map((call) => ({ text: String(call[0]), values: (call[1] as unknown[] | undefined) ?? [] }));
}

/** The statements that write a product row, for the insert-shape assertions. */
export function productWrites(query: { mock: { calls: unknown[][] } }): string[] {
  return statements(query).map((statement) => statement.text).filter((text) => /INSERT INTO products|UPDATE products/.test(text));
}

export type { QueryResult };