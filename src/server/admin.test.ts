import { describe, expect, it, vi } from 'vitest';
import { createAdminHandlers, seedAdminData } from './admin';
import { hashPassword } from './admin/passwords';
import type { Database, QueryResult } from './handlers';

const activeAdminRow = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Glow & Grace Admin',
  email: 'admin@glowngrace.in',
  role: 'Store Administrator',
  avatar: '/images/partner1.jpg',
  status: 'Active',
  created_at: '2026-01-01',
};

function makeDatabase(queryImpl?: (text: string, values: unknown[]) => Promise<QueryResult>) {
  const query = vi.fn(async (text: string, values: unknown[] = []) => (queryImpl ? queryImpl(text, values) : { rows: [], rowCount: 0 }));
  return { database: { query } satisfies Database, query };
}

function storeDatabase() {
  const store = new Map<string, unknown>();
  return makeDatabase(async (text, values) => {
    if (text.includes('FROM admin_sessions')) {
      return { rows: [activeAdminRow], rowCount: 1 };
    }
    if (text.includes('FROM store_settings')) {
      return { rows: [...store.entries()].map(([key, value]) => ({ key, value })), rowCount: store.size };
    }
    if (text.includes('INSERT INTO store_settings')) {
      store.set(String(values[0]), JSON.parse(String(values[1])));
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

const token = 'bearer-token';

describe('admin settings handler', () => {
  it('accepts a partial save that only carries notifications', async () => {
    const { database } = storeDatabase();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'PUT',
      segments: ['settings'],
      body: { notifications: { orders: false, reviews: true } },
      token,
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Settings saved.');
    expect((result.body.settings as { notifications: Record<string, boolean> }).notifications).toEqual({ orders: false, reviews: true });
  });

  it('accepts a partial save that only carries the delivery block', async () => {
    const { database } = storeDatabase();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'PUT',
      segments: ['settings'],
      body: { delivery: { freeAbove: 1299 } },
      token,
    });

    expect(result.status).toBe(200);
    expect((result.body.settings as { delivery: { freeAbove: number } }).delivery.freeAbove).toBe(1299);
  });

  it('still rejects values that break the store profile rules', async () => {
    const { database } = storeDatabase();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'PUT',
      segments: ['settings'],
      body: { profile: { email: 'not-an-email' } },
      token,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_settings');
  });
});

describe('storefront page visibility', () => {
  const pageRows = [
    { slug: 'home', label: 'Home', path: '/', visible: true, position: 0 },
    { slug: 'shop', label: 'Shop', path: '/shop', visible: true, position: 1 },
    { slug: 'careers', label: 'Careers', path: '/careers', visible: false, position: 2 },
  ];

  function pageDatabase() {
    return makeDatabase(async (text) => {
      if (text.includes('FROM site_pages')) return { rows: pageRows, rowCount: pageRows.length };
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
  }

  it('publishes the label, path and visibility the storefront needs', async () => {
    const { database } = pageDatabase();
    await expect(createAdminHandlers(database).publicPages()).resolves.toEqual([
      { slug: 'home', label: 'Home', path: '/', visible: true, position: 0 },
      { slug: 'shop', label: 'Shop', path: '/shop', visible: true, position: 1 },
      { slug: 'careers', label: 'Careers', path: '/careers', visible: false, position: 2 },
    ]);
  });

  it('hides a page through the admin route and restores it again', async () => {
    const visible = new Map(pageRows.map((row) => [row.slug, row.visible]));
    const { database, query } = makeDatabase(async (text, values) => {
      if (text.includes('UPDATE site_pages')) {
        visible.set(String(values[0]), values[1] === true);
        return { rows: [{ slug: values[0], visible: values[1] }], rowCount: 1 };
      }
      if (text.includes('FROM site_pages')) {
        return { rows: pageRows.map((row) => ({ ...row, visible: visible.get(row.slug) })), rowCount: pageRows.length };
      }
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);
    const request = (body: { visible: boolean }) => ({
      method: 'PATCH',
      segments: ['pages', 'careers'],
      body,
      token,
    });

    const hidden = await admin.handle(request({ visible: false }));
    expect(hidden).toMatchObject({ status: 200, body: { page: { slug: 'careers', visible: false } } });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE site_pages'), ['careers', false]);
    expect((await admin.publicPages()).find((page) => page.slug === 'careers')?.visible).toBe(false);

    const shown = await admin.handle(request({ visible: true }));
    expect(shown).toMatchObject({ status: 200, body: { page: { slug: 'careers', visible: true } } });
    expect((await admin.publicPages()).find((page) => page.slug === 'careers')?.visible).toBe(true);
  });

  it('rejects a visibility change that names a page outside the storefront', async () => {
    const { database } = makeDatabase(async (text) => {
      if (text.includes('UPDATE site_pages')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['pages', 'checkout'],
      body: { visible: false },
      token,
    });

    expect(result).toMatchObject({ status: 404 });
  });

  it('refuses a page change without an admin session', async () => {
    const { database, query } = pageDatabase();
    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['pages', 'careers'],
      body: { visible: false },
    });

    expect(result.status).toBe(401);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE site_pages'), expect.anything());
  });
});

describe('admin team password route', () => {
  it('changes a password instead of falling through to the create-user handler', async () => {
    const updates: string[] = [];
    const { database } = makeDatabase(async (text) => {
      if (text.includes('FROM admin_sessions')) {
        return { rows: [activeAdminRow], rowCount: 1 };
      }
      if (text.includes('SELECT id, password_hash FROM admin_users')) {
        return { rows: [{ id: 'user-2', password_hash: await hashPassword('verify123') }], rowCount: 1 };
      }
      if (text.includes('UPDATE admin_users SET password_hash')) {
        updates.push(text);
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['users', 'user-2', 'password'],
      body: { currentPassword: 'verify123', newPassword: 'verify456' },
      token: 'bearer-token',
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Password changed. Other sessions were signed out.');
    expect(updates).toHaveLength(1);
  });

  it('rejects a wrong current password without changing anything', async () => {
    const { database, query } = makeDatabase(async (text) => {
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      if (text.includes('SELECT id, password_hash FROM admin_users')) {
        return { rows: [{ id: 'user-2', password_hash: await hashPassword('verify123') }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['users', 'user-2', 'password'],
      body: { currentPassword: 'wrong-password', newPassword: 'verify456' },
      token: 'bearer-token',
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('wrong_password');
    expect(query.mock.calls.some(([text]) => String(text).includes('UPDATE admin_users'))).toBe(false);
  });
});

describe('admin demo seeding', () => {
  it('writes payment_method in the column slot the orders constraint checks', async () => {
    const { database, query } = makeDatabase();
    await seedAdminData(database);

    const orderInsert = query.mock.calls.find(([text]) => String(text).includes('INSERT INTO orders'));
    if (!orderInsert) throw new Error('The orders seed insert was never run.');
    const columns = String(orderInsert[0]).match(/INSERT INTO orders \(([^)]*)\)/)?.[1]?.split(',').map((column) => column.trim()) ?? [];
    const paymentIndex = columns.indexOf('payment_method');
    const statusIndex = columns.indexOf('status');
    expect(paymentIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBe(paymentIndex + 1);

    const values = orderInsert[1] as unknown[];
    const rowWidth = columns.length;
    expect(values.length % rowWidth).toBe(0);

    for (let row = 0; row < values.length / rowWidth; row += 1) {
      const start = row * rowWidth;
      expect(values[start + paymentIndex]).toBe('cod');
      expect(['placed', 'processing', 'packed', 'shipped', 'delivered', 'returned', 'cancelled']).toContain(values[start + statusIndex]);
    }
  });
});
