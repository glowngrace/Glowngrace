/**
 * The error a query failure arrives as, whichever backend raised it.
 *
 * The Postgres driver already tags its errors with a SQLSTATE `code`, and the
 * handlers branch on that code - `23505` is what turns a duplicate SKU into a
 * 409 rather than a 500. The in-memory executor raises the same codes for the
 * same conditions, so wrapping both in one class keeps a single thing for the
 * handlers above to catch and keeps the code from being lost in translation.
 */
export class QueryError extends Error {
  code: string | undefined;

  constructor(message: string, options: { cause?: unknown; code?: string } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'QueryError';
    this.code = options.code;
  }
}

export function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : undefined;
}