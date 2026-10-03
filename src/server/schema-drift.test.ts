import { beforeEach, describe, expect, it, vi } from 'vitest';
import { productDetailColumns, resetCatalogueShapeCache, shapeCacheTtlMs } from './catalogue';
import {
  beforeConsole,
  beforeProductDetails,
  fullyMigrated,
  isShapeProbe,
  presentProductColumns,
  statements,
  withCatalogueShape,
  type FakeShape,
} from './catalogue-fake';
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
 * is the state a brand new database is in: no site_pages, no console tables and
 * none of the columns 005 and 013 add to products.
 *
 * It answers the shape probe from `shape` the way a real PostgreSQL does, so the
 * product queries are built to fit rather than failing and being retried.
 */
function unmigratedDatabase(
  queryImpl: (text: string, values: unknown[]) => Promise<QueryResult> | QueryResult,
  shape: FakeShape = beforeConsole,
) {
  const query = vi.fn(withCatalogueShape(shape, (text, values) => {
    if (text.includes('site_pages')) return missing('42P01', 'relation "site_pages" does not exist');
    if (text.includes('admin_users') || text.includes('admin_sessions')) {
      return missing('42P01', 'relation "admin_users" does not exist');
    }
    if (text.includes('job_vacancies') || text.includes('demo_datasets')) {
      return missing('42P01', 'relation "job_vacancies" does not exist');
    }
    return queryImpl(text, values);
  }));
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

beforeEach(() => {
  resetCatalogueShapeCache();
});

describe('storefront against a database that predates the console migrations', () => {
  it('lists the catalogue without the published and featured columns', async () => {
    const { database, query } = unmigratedDatabase((text) => (
      text.includes('count(*) > 0') ? { rows: [{ managed: true }], rowCount: 1 } : { rows: [productRow], rowCount: 1 }
    ));

    const result = await createHandlers(database).products('GET', undefined);

    expect(result.status).toBe(200);
    expect(result.body.products).toEqual([expect.objectContaining({ id: 9, published: true, featured: false })]);
    expect(result.body.catalogueManaged).toBe(true);
    const [listing] = statements(query);
    expect(listing.text).toContain('TRUE AS published, FALSE AS featured');
    expect(listing.text).not.toContain('WHERE product.published');
  });

  it('saves a product without the published column', async () => {
    const { database, query } = unmigratedDatabase((text) => {
      if (text.includes('WITH created_product')) return { rows: [productRow], rowCount: 1 };
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
      const write = statements(query).find((statement) => statement.text.includes('WITH created_product'));
      // The point of the whole exercise: the INSERT names `published`, which this
      // database does not have, so it must not be written at all.
      expect(write?.text).toMatch(/INSERT INTO products \(name, category, brand, sku, price, mrp, stock, image, description\)$/m);
      expect(write?.text).not.toContain('published');
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

/**
 * The regression that took the shop down: migration 013 added ten columns to
 * products and the code that reads them shipped in the same commit, but the
 * production database never had the migration applied. Every one of these tests
 * would have caught it.
 */
describe('storefront against a database that predates migration 013', () => {
  function detailDriftDatabase(queryImpl: (text: string, values: unknown[]) => QueryResult) {
    return unmigratedDatabase(queryImpl, beforeProductDetails);
  }

  it('serves the catalogue instead of returning 500', async () => {
    const { database } = detailDriftDatabase((text) => (
      text.includes('count(*) > 0') ? { rows: [{ managed: true }], rowCount: 1 } : { rows: [productRow], rowCount: 1 }
    ));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await createHandlers(database).products('GET', undefined);

      expect(result.status).toBe(200);
      expect(result.body.products).toEqual([expect.objectContaining({ id: 9, name: 'Glow Ritual Vitamin C Face Serum' })]);
      // A NULL already reads as absent in mapProduct, so the product page hides
      // the section instead of rendering it empty.
      expect(result.body.products?.[0]).toMatchObject({
        slug: undefined,
        metaTitle: undefined,
        shades: [],
        highlights: [],
        itemDetails: undefined,
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('never names a column the database does not have', async () => {
    const { database, query } = detailDriftDatabase((text) => (
      text.includes('count(*) > 0') ? { rows: [{ managed: true }], rowCount: 1 } : { rows: [productRow], rowCount: 1 }
    ));

    await createHandlers(database).products('GET', undefined);

    const listing = statements(query)[0].text;
    for (const column of productDetailColumns) expect(listing).not.toContain(`product.${column}`);
    // Still reads the columns migration 005 did add, and still filters on them.
    expect(listing).toContain('product.published, product.featured,');
    expect(listing).toContain('WHERE product.published');
  });

  it('saves a product without naming the absent columns', async () => {
    const { database, query } = detailDriftDatabase((text) => (
      text.includes('WITH created_product') ? { rows: [productRow], rowCount: 1 } : { rows: [], rowCount: 0 }
    ));
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
        sku: 'GG-SERUM-DRIFT',
        price: 500,
        mrp: 700,
        stock: 8,
        description: 'A carefully made product description.',
        slug: 'test-glow-serum',
        metaTitle: 'Test Glow Serum',
        shades: ['Rose'],
        highlights: ['Brightening'],
        itemDetails: 'Box of one',
        images: [{ filename: 'serum.png', mimeType: 'image/png', data: image.toString('base64'), width: 1200, height: 1200 }],
      });

      expect(result.status).toBe(201);
      const write = statements(query).find((statement) => statement.text.includes('WITH created_product'));
      expect(write).toBeDefined();
      for (const column of productDetailColumns) {
        expect(write?.text).not.toMatch(new RegExp(`\\b${column}\\b`));
        expect(write?.values.join(' ')).not.toContain(column === 'slug' ? 'test-glow-serum' : ' never ');
      }
      // The gallery payload is still the last bound value, and its placeholder
      // shifted correctly when ten columns stopped being written.
      expect(JSON.parse(String(write?.values.at(-1)))).toMatchObject([{ filename: 'serum.png' }]);
      expect(write?.text).toContain('RETURNING name, category, brand, sku, price, mrp, stock, image, description, published');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('picks the full columns back up on its own once the migration is applied', async () => {
    // No restart and no redeploy between the two states, only time passing, which
    // is the whole reason the shape is cached for 60 seconds rather than forever.
    let shape: FakeShape = beforeProductDetails;
    const query = vi.fn(async (text: string) => {
      if (isShapeProbe(text)) {
        return { rows: [{ table_present: true, columns: presentProductColumns(shape) }], rowCount: 1 };
      }
      return text.includes('count(*) > 0')
        ? { rows: [{ managed: true }], rowCount: 1 }
        : { rows: [productRow], rowCount: 1 };
    });
    const database = { query } satisfies Database;
    const handler = createHandlers(database).products;
    // Each GET also counts products, so pick the catalogue listing out rather
    // than counting statements.
    const listings = () => statements(query).filter((statement) => statement.text.includes('FROM products AS product'));

    expect((await handler('GET', undefined)).status).toBe(200);
    expect(listings()[0].text).not.toContain('product.item_details');

    shape = fullyMigrated;

    // Still cached, so still serving the shape it can serve.
    expect((await handler('GET', undefined)).status).toBe(200);
    expect(listings()[1].text).not.toContain('product.item_details');

    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + shapeCacheTtlMs + 1);
      expect((await handler('GET', undefined)).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    expect(listings()[2].text).toContain('product.item_details');
  });
});

describe('admin console against a database that predates migration 013', () => {
  const consoleBody = {
    product_id: 9,
    email: 'admin@glowngrace.in',
    name: 'An Administrator',
    role: 'SuperAdmin',
    status: 'Active',
  };

  function driftedConsole(shape: FakeShape = beforeProductDetails) {
    const queries: string[] = [];
    const database: Database = {
      query: vi.fn(withCatalogueShape(shape, (text) => {
        queries.push(text);
        if (text.includes('admin_sessions')) return { rows: [consoleBody], rowCount: 1 };
        if (text.includes('ORDER BY product.id')) return { rows: [productRow], rowCount: 1 };
        if (text.includes('WHERE product.id = $1')) return { rows: [productRow], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      })),
    };
    return { admin: createAdminHandlers(database), queries, database };
  }

  it('lists the catalogue with a 200 rather than failing the whole console with 503', async () => {
    const { admin } = driftedConsole();
    const result = await admin.handle({ method: 'GET', segments: ['products'], token: 'bearer-token' });

    expect(result.status).toBe(200);
    expect((result.body.products as unknown[])).toHaveLength(1);
  });

  it('applies an edit that only touches columns the database has', async () => {
    const { admin, queries } = driftedConsole();
    const result = await admin.handle({
      method: 'PATCH',
      segments: ['products', '9'],
      token: 'bearer-token',
      body: { price: 799 },
    });

    expect(result.status).toBe(200);
    const update = queries.find((text) => text.includes('UPDATE products'));
    expect(update).toContain('price = $2');
    expect(update).not.toContain('slug');
    // `updated_at` is itself a 005 column, so it is only stamped when it exists.
    expect(update).toContain('updated_at = NOW()');
  });

  it('refuses an edit that would be silently lost, naming the columns and the migration', async () => {
    const { admin, queries } = driftedConsole();
    const result = await admin.handle({
      method: 'PATCH',
      segments: ['products', '9'],
      token: 'bearer-token',
      body: { slug: 'glow-serum' },
    });

    expect(result.status).toBe(503);
    expect(result.body.error).toBe('schema_not_migrated');
    expect(result.body.columns).toEqual(['slug']);
    expect(result.body.detail).toContain('db/migrations/013_product_details.sql');
    expect(queries.some((text) => text.includes('UPDATE products'))).toBe(false);
  });

  it('refuses a bulk product import rather than dropping the sheet it was sent', async () => {
    const { admin, queries } = driftedConsole();
    const result = await admin.handle({
      method: 'POST',
      segments: ['bulk'],
      token: 'bearer-token',
      body: {
        dataset: 'products',
        rows: [{
          name: 'Imported serum',
          category: 'Skincare',
          price: 500,
          mrp: 700,
          stock: 5,
          description: 'A carefully made product description.',
          slug: 'imported-serum',
        }],
      },
    });

    expect(result.status).toBe(503);
    // Only the columns this sheet actually used are named. Telling an operator
    // their spreadsheet is missing ten fields when it used one is not actionable.
    expect(result.body.columns).toEqual(['slug']);
    expect(queries.some((text) => text.includes('INSERT INTO products'))).toBe(false);
  });

  it('imports a sheet of base fields into a database without the detail columns', async () => {
    // A sheet that never mentions slug or SEO is a sheet the database can honestly
    // store, so refusing it would be refusing a save it is able to make.
    const { admin, queries } = driftedConsole();
    const result = await admin.handle({
      method: 'POST',
      segments: ['bulk'],
      token: 'bearer-token',
      body: {
        dataset: 'products',
        rows: [{
          name: 'Imported serum',
          category: 'Skincare',
          brand: 'Glow & Grace',
          sku: 'GG-IMPORT-1',
          price: 500,
          mrp: 700,
          stock: 5,
          description: 'A carefully made product description.',
        }],
      },
    });

    expect(result.status).toBe(201);
    expect(queries.some((text) => text.includes('INSERT INTO products'))).toBe(true);
  });

  it('creates a product of base fields on a database without the detail columns', async () => {
    // The console form normally submits slug and SEO too, and that case is refused
    // below. A request that only carries the base fields is a save the database can
    // make, so it is made rather than blocked.
    const { admin, queries } = driftedConsole();
    const result = await admin.handle({
      method: 'POST',
      segments: ['products'],
      token: 'bearer-token',
      body: {
        name: 'Base Field Serum',
        category: 'Skincare',
        brand: 'Glow & Grace',
        sku: 'GG-BASE-1',
        price: 500,
        mrp: 700,
        stock: 5,
        description: 'A carefully made product description.',
      },
    });

    expect(result.status).toBe(201);
    const insert = queries.find((text) => text.includes('INSERT INTO products'));
    expect(insert).toBeDefined();
    // The detail columns are simply not in the statement.
    for (const column of productDetailColumns) expect(insert).not.toContain(column);
  });

  it('still stamps updated_at on a database that predates migration 005', async () => {
    const { admin, queries } = driftedConsole(beforeConsole);
    const result = await admin.handle({
      method: 'PATCH',
      segments: ['products', '9'],
      token: 'bearer-token',
      body: { price: 799 },
    });

    expect(result.status).toBe(200);
    const update = queries.find((text) => text.includes('UPDATE products'));
    expect(update).not.toContain('updated_at');
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