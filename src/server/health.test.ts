import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeClient = {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
  connect(): Promise<void>;
  end(): Promise<void>;
};

const state = vi.hoisted(() => ({ client: {} as FakeClient }));

vi.mock('pg', () => ({
  Client: class {
    constructor() {
      return state.client;
    }
  },
}));

const { checkDatabaseHealth } = await import('./health');

const localUrl = 'postgresql://glow_grace:local_secret@localhost:5435/glow_grace';
const neonUrl = 'postgresql://neondb_owner:neon_secret@ep-abc-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require';
const tableNames = ['contact_requests', 'newsletter_subscribers', 'products', 'product_images', 'orders', 'order_items'];

function allTables() {
  return Object.fromEntries(tableNames.map((table) => [table, true]));
}

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn(async (text: string) => {
      if (text.includes('to_regclass')) return { rows: [{ ...allTables(), name: 'neondb', ...overrides }], rowCount: 1 };
      if (text.includes('information_schema.columns')) return { rows: [{ published: true, featured: true }], rowCount: 1 };
      return { rows: [{ total: '4' }], rowCount: 1 };
    }),
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('database health report', () => {
  beforeEach(() => {
    state.client = fakeClient();
  });

  it('reports a missing connection string as a configuration error and never echoes a secret', async () => {
    const report = await checkDatabaseHealth({});
    expect(report.status).toBe('error');
    expect(report.database.configured).toBe(false);
    expect(report.database.reachable).toBe(false);
    expect(report.database.missingTables).toEqual(tableNames);
    expect(report.database.reason).toMatch(/DATABASE_URL or NEON_DATABASE_URL/);
  });

  it('labels the Vercel runtime and the local shell', async () => {
    expect((await checkDatabaseHealth({ DATABASE_URL: localUrl })).environment).toBe('local');
    expect((await checkDatabaseHealth({ DATABASE_URL: localUrl, VERCEL: '1' })).environment).toBe('vercel');
  });

  it('reports ok with a masked host and a product count when every table exists', async () => {
    const report = await checkDatabaseHealth({ DATABASE_URL: neonUrl, DATABASE_SSL: 'require' });
    expect(report.status).toBe('ok');
    expect(report.database).toMatchObject({
      configured: true,
      reachable: true,
      provider: 'neon',
      missingTables: [],
      productCount: 4,
      ssl: 'require',
      variable: 'DATABASE_URL',
    });
    expect(report.database.host).toMatch(/^e\*+\./);
    expect(JSON.stringify(report)).not.toContain('neon_secret');
  });

  it('reports degraded when the connection works but the schema was never applied', async () => {
    state.client = fakeClient({
      connect: vi.fn(async () => undefined),
      end: vi.fn(async () => undefined),
      query: vi.fn(async (text: string) => {
        if (text.includes('to_regclass')) return { rows: [{ products: false, product_images: false }], rowCount: 1 };
        return { rows: [{ total: '0' }], rowCount: 1 };
      }),
    });
    const report = await checkDatabaseHealth({ DATABASE_URL: localUrl, LOCAL_DATABASE_SSL: 'disable' });
    expect(report.status).toBe('degraded');
    expect(report.database.reachable).toBe(true);
    expect(report.database.missingTables).toEqual([
      'contact_requests', 'newsletter_subscribers', 'products', 'product_images', 'orders', 'order_items',
    ]);
    expect(report.database.reason).toMatch(/Apply db\/init\.sql/);
    expect(report.database.productCount).toBeNull();
  });

  it('reports the columns the catalogue query needs when every table is present', async () => {
    state.client = fakeClient({
      query: vi.fn(async (text: string) => {
        if (text.includes('to_regclass')) return { rows: [{ ...allTables(), name: 'neondb' }], rowCount: 1 };
        if (text.includes('information_schema.columns')) return { rows: [{ published: false, featured: false }], rowCount: 1 };
        return { rows: [{ total: '4' }], rowCount: 1 };
      }),
    });
    const report = await checkDatabaseHealth({ DATABASE_URL: localUrl, LOCAL_DATABASE_SSL: 'disable' });

    expect(report.status).toBe('ok');
    expect(report.database.missingTables).toEqual([]);
    expect(report.database.missingProductColumns).toEqual(['published', 'featured']);
    expect(report.database.reason).toMatch(/db\/migrations\/005_admin_console\.sql/);
  });

  it('reports an unreachable database with the driver error code', async () => {
    state.client = {
      query: vi.fn(),
      connect: vi.fn(async () => { throw Object.assign(new Error('The server does not support SSL connections'), { code: 'ECONNREFUSED' }); }),
      end: vi.fn(async () => undefined),
    };
    const report = await checkDatabaseHealth({ DATABASE_URL: localUrl, LOCAL_DATABASE_SSL: 'disable' });
    expect(report.status).toBe('error');
    expect(report.database.reachable).toBe(false);
    expect(report.database.reason).toMatch(/does not support SSL/);
    expect(report.database.reason).toMatch(/code=ECONNREFUSED/);
    expect(JSON.stringify(report)).not.toContain('local_secret');
  });

  it('closes the client even when the connection attempt fails', async () => {
    const end = vi.fn(async () => undefined);
    state.client = { query: vi.fn(), connect: vi.fn(async () => { throw new Error('boom'); }), end };
    await checkDatabaseHealth({ DATABASE_URL: localUrl });
    expect(end).toHaveBeenCalled();
  });
});
