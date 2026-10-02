import { describe, expect, it, vi } from 'vitest';
import { createHandlers, type Database, type QueryResult } from './handlers';
import { createApiRouter } from './router';
import { createAdminHandlers } from './admin';

/** A PostgreSQL error as the driver reports it. */
function queryFailure(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

const missing = (code: '42P01' | '42703', message: string) => queryFailure(code, message);

/**
 * A database that only ever had db/init.sql and migrations 002-004 applied, which
 * is the state the deployed Neon database was in: no site_pages, no console
 * tables and no products.published.
 */
function unmigratedDatabase(queryImpl: (text: string, values: unknown[]) => Promise<QueryResult> | QueryResult) {
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes('site_pages')) return missing('42P01', 'relation "site_pages" does not exist');
    if (text.includes('product.published')) {
      return missing('42703', 'column product.published does not exist');
    }
    // The products table here predates `published`, so an INSERT that names it
    // must fail. Matched on the statement being an INSERT rather than on the
    // surrounding text, because the legacy read path spells the same column as
    // `TRUE AS published` and is expected to get through.
    if (text.includes('INSERT INTO products') && /(^|[\s,(])published\s*,/.test(text)) {
      return missing('42703', 'column product.published does not exist');
    }
    if (text.includes('admin_users') || text.includes('admin_sessions')) {
      return missing('42P01', 'relation "admin_users" does not exist');
    }
    if (text.includes('job_vacancies') || text.includes('demo_datasets')) {
      return missing('42P01', 'relation "job_vacancies" does not exist');
    }
    return queryImpl(text, values);
  });
  return { database: { query } satisfies Database, query };
}

const productRow = {
  id: 9,
  name: 'Glow Ritual Vitamin C Face Serum',
  category: 'Skincare',
  price: 849,
  mrp: 1099,
  stock: 12,
  rating: '4.5',
  reviews: 24,
  image: 'serum.jpg',
  description: 'A brightening daily serum.',
  images: [],
};

describe('storefront against a database that predates the console migrations', () => {
  it('lists the catalogue without the published and featured columns', async () => {
    const { database, query } = unmigratedDatabase((text) => (
      text.includes('count(*) > 0') ? { rows: [{ managed: true }], rowCount: 1 } : { rows: [productRow], rowCount: 1 }
    ));

    const result = await createHandlers(database).products('GET', undefined);

    expect(result.status).toBe(200);
    expect(result.body.products).toEqual([expect.objectContaining({ id: 9, published: true, featured: false })]);
    expect(result.body.catalogueManaged).toBe(true);
    // The retry is what keeps the shop open, and it must not filter on the column.
    expect(query.mock.calls[1]?.[0]).toContain('TRUE AS published, FALSE AS featured');
    expect(String(query.mock.calls[1]?.[0])).not.toContain('WHERE product.published');
  });

  it('saves a product without the published column', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const { database, query } = unmigratedDatabase((text) => {
      if (text.includes('WITH created_product')) {
        saved.push({ sql: text, values: [] });
        return { rows: [productRow], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const image = Buffer.alloc(24);
      image.set([137, 80, 78, 71, 13, 10, 26, 10]);
      image.write('IHDR', 12, 'ascii');
      image.writeUInt32BE(1200, 16);
      image.writeUInt32BE(1200, 20);

      const result = await createHandlers(database).products('POST', {
        name: 'Test glow serum',
        category: 'Skincare',
        brand: 'Glow & Grace',
        sku: 'GG-SERUM-SCHEMA',
        price: 500,
        mrp: 700,
        stock: 8,
        description: 'A carefully made product description.',
        images: [{ filename: 'serum.png', mimeType: 'image/png', data: image.toString('base64'), width: 1200, height: 1200 }],
      });

      expect(result.status).toBe(201);
      const fallback = String(query.mock.calls.at(-1)?.[0]);
      expect(fallback).toMatch(/INSERT INTO products \(name, category, brand, sku, price, mrp, stock, image, description,/);
      // The point of the retry: the first INSERT named `published`, which this
      // database does not have, so the fallback must not name it either.
      expect(fallback).not.toContain('published');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('serves the bundled page list when site_pages does not exist', async () => {
    const { database } = unmigratedDatabase(() => ({ rows: [], rowCount: 0 }));

    const result = await createApiRouter(database).handle({ method: 'GET', path: '/api/site/pages' });

    expect(result?.status).toBe(200);
    const pages = result?.body.pages as Array<{ slug: string; visible: boolean }>;
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((page) => page.visible)).toBe(true);
    expect(pages.map((page) => page.slug)).toContain('shop');
  });

  it('reports a 500 for an outage, because a fallback cannot invent the catalogue', async () => {
    const { database } = unmigratedDatabase(() => queryFailure('08006', 'connection failure'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await createHandlers(database).products('GET', undefined);
      expect(result.status).toBe(500);
      expect(result.body.error).toBe('server_error');
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('admin console against a database that predates the console migrations', () => {
  it('answers sign-in with an actionable 503 instead of a 500', async () => {
    const { database } = unmigratedDatabase(() => ({ rows: [], rowCount: 0 }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await createAdminHandlers(database).handle({
        method: 'POST',
        segments: ['session'],
        body: { email: 'admin@glowngrace.in', password: 'a-password-they-chose' },
      });

      expect(result.status).toBe(503);
      expect(result.body.error).toBe('schema_not_migrated');
      expect(result.body.code).toBe('42P01');
      expect(String(result.body.detail)).toContain('npm run db:migrate:production');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('retries seeding after a failure, so applying the migrations needs no restart', async () => {
    let migrated = false;
    const attempts: number[] = [];
    const database: Database = {
      query: vi.fn(async (text: string) => {
        if (text.includes('INSERT INTO site_pages')) {
          attempts.push(1);
          if (!migrated) return missing('42P01', 'relation "site_pages" does not exist');
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const admin = createAdminHandlers(database);
    try {
      const signIn = { method: 'POST', segments: ['session'], body: { email: 'admin@glowngrace.in', password: 'a-password-they-chose' } };
      expect((await admin.handle(signIn)).status).toBe(503);

      migrated = true;
      expect((await admin.handle(signIn)).status).not.toBe(503);
      expect(attempts).toHaveLength(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('never lets a handler failure escape as a rejected promise', async () => {
    // An outage, not schema drift: the session lookup fails before any console
    // query runs, and the failure still has to come back as a response.
    const database: Database = { query: vi.fn(() => queryFailure('08006', 'connection failure')) };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await createAdminHandlers(database).handle({
        method: 'GET',
        segments: ['products'],
        token: 'bearer-token',
      });

      expect(result.status).toBe(500);
      expect(result.body.error).toBe('server_error');
    } finally {
      consoleError.mockRestore();
    }
  });
});
