import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { syncTables, syncFromNeon } from './sync-from-neon';
import { adminTables, requiredTables, isLocalHost, maskHost, syncIsEnabled } from './config';

/**
 * The list of tables, and the gates around copying them.
 *
 * The copy itself is exercised against two real PostgreSQL servers by
 * `npm run db:sync` and the console's sync button; what is worth a unit test is
 * everything around it, because that is the part that decides *whether* a copy
 * happens at all: which tables are in the list, which two are deliberately
 * missing from it, and the checks that refuse a run before a socket is opened.
 */

const saved = { ...process.env };

function environment(overrides: Record<string, string | undefined>) {
  for (const key of ['DATABASE_URL', 'PRODUCTION_DATABASE_URL', 'NEON_DATABASE_URL', 'SYNC_FROM_PRODUCTION', 'USE_LOCAL_DATABASE', 'LOCAL_DATABASE_SSL', 'DATABASE_SSL']) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  environment({
    DATABASE_URL: 'postgresql://glow_grace:secret@localhost:5435/glow_grace',
    LOCAL_DATABASE_SSL: 'disable',
  });
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in saved)) delete process.env[key];
  }
  Object.assign(process.env, saved);
});

const localUrl = 'postgresql://glow_grace:secret@localhost:5435/glow_grace';
const neonUrl = 'postgresql://neon_user:secret@ep-cool-pooler.aws-ap-southeast-2.neon.tech/neondb?sslmode=require';

describe('the tables a sync copies', () => {
  it('covers every table the application reads, bar the sessions, and adds the outbox', () => {
    const wanted = [...requiredTables, ...adminTables];
    const copied = syncTables.map((table) => table.name);
    // `admin_sessions` is the one table in the list that is left alone, and the
    // outbox is the one table carried across that the application does not read
    // on startup: it is there so a copy preserves what production has queued.
    expect(wanted.filter((table: string) => !copied.includes(table))).toEqual(['admin_sessions']);
    expect(copied.filter((table: string) => !wanted.includes(table as never))).toEqual(['email_outbox']);
    expect(copied).toHaveLength(wanted.length);
  });

  it('never copies a session or a password reset', () => {
    // A production session token that became valid against the local database is
    // a way in that nobody signed for, and a reset code is a way in that a
    // developer could use on production from their own machine.
    const names = syncTables.map((table) => table.name);
    expect(names).not.toContain('admin_sessions');
    expect(names).not.toContain('password_resets');
  });

  it('names a key for every table, including the three with no id column', () => {
    // `store_settings`, `site_pages` and `demo_datasets` are keyed by their own
    // natural key. A fingerprint that assumed `id` here failed outright with
    // "column id does not exist" the first time a sync was run.
    for (const table of syncTables) {
      expect(table.key, `${table.name} has no key`).toBeTruthy();
      expect(table.marker, `${table.name} has no marker`).toBeTruthy();
    }
    expect(syncTables.filter((table) => table.key !== 'id').map((table) => table.name).sort())
      .toEqual(['demo_datasets', 'site_pages', 'store_settings']);
  });

  it('refills the two child tables before their parents', () => {
    // `product_images.product_id` and `order_items.order_id` are foreign keys, so
    // copying them first is the only order that does not fail on insert.
    const names = syncTables.map((table) => table.name);
    expect(names.indexOf('product_images')).toBeGreaterThan(names.indexOf('products'));
    expect(names.indexOf('order_items')).toBeGreaterThan(names.indexOf('orders'));
  });
});

describe('reaching for the production database', () => {
  it('is off unless the developer turned it on', () => {
    environment({ SYNC_FROM_PRODUCTION: undefined, USE_LOCAL_DATABASE: 'true' });
    expect(syncIsEnabled()).toBe(false);

    environment({ SYNC_FROM_PRODUCTION: 'true', USE_LOCAL_DATABASE: 'true' });
    expect(syncIsEnabled()).toBe(true);
  });

  it('is off even when turned on, if the app is pointed somewhere else', () => {
    // The switch means "this process is a local development process that may pull
    // production down". A deployment that is not talking to the local database has
    // no business offering the sync at all.
    environment({ SYNC_FROM_PRODUCTION: 'true', USE_LOCAL_DATABASE: 'false' });
    expect(syncIsEnabled()).toBe(false);
  });

  it('refuses to run with no production connection string', async () => {
    environment({ USE_LOCAL_DATABASE: 'true', SYNC_FROM_PRODUCTION: 'true', NEON_DATABASE_URL: undefined, PRODUCTION_DATABASE_URL: undefined });
    await expect(syncFromNeon()).rejects.toThrow(/No production database connection string is configured/);
  });

  it('refuses to copy a database into itself', async () => {
    // The single most dangerous thing this code could do is treat the production
    // string as the local target, empty the tables, and refill them from the copy
    // it had just truncated. The guard is a host comparison, and it runs before
    // any connection is opened.
    environment({
      USE_LOCAL_DATABASE: 'true',
      SYNC_FROM_PRODUCTION: 'true',
      DATABASE_URL: localUrl,
      NEON_DATABASE_URL: localUrl,
    });
    await expect(syncFromNeon()).rejects.toThrow();
  });

  it('refuses to write to anything but a local host', async () => {
    // A production-shaped host with a different name is still not local, and the
    // only writable target this project has is the Docker volume.
    environment({
      USE_LOCAL_DATABASE: 'true',
      SYNC_FROM_PRODUCTION: 'true',
      DATABASE_URL: 'postgresql://glow_grace:secret@db.internal.example.com:5435/glow_grace',
      NEON_DATABASE_URL: neonUrl,
    });
    await expect(syncFromNeon()).rejects.toThrow();
  });
});

describe('describing a connection without printing its password', () => {
  it('masks the first label of a hostname and keeps the rest', () => {
    // The connection string turns up in the console and in `db:check` output, and
    // the endpoint identifies a Neon project better than its full hostname does.
    expect(maskHost('ep-cool-pooler.aws-ap-southeast-2.neon.tech'))
      .toBe(`e${'*'.repeat('p-cool-pooler'.length)}.aws-ap-southeast-2.neon.tech`);
    expect(maskHost('ab.example.com')).toBe('*.example.com');
  });

  it('leaves a local host readable, because it is not a secret', () => {
    expect(maskHost('localhost')).toBe('localhost');
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('ep-cool-pooler.aws-ap-southeast-2.neon.tech')).toBe(false);
  });
});