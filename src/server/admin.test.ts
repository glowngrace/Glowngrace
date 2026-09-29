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
  const stamps = new Map<string, Date>();
  return makeDatabase(async (text, values) => {
    if (text.includes('FROM admin_sessions')) {
      return { rows: [activeAdminRow], rowCount: 1 };
    }
    if (text.includes('FROM store_settings')) {
      return {
        rows: [...store.entries()].map(([key, value]) => ({ key, value, updated_at: stamps.get(key) })),
        rowCount: store.size,
      };
    }
    if (text.includes('INSERT INTO store_settings')) {
      const key = String(values[0]);
      const incoming = JSON.parse(String(values[1])) as Record<string, unknown>;
      // Mirrors the JSONB `value = store_settings.value || EXCLUDED.value`
      // upsert: a partial section merges into what is already stored rather than
      // replacing it. Without this the double would hide the merge behaviour the
      // console depends on.
      const existing = store.get(key) as Record<string, unknown> | undefined;
      store.set(key, { ...(existing ?? {}), ...incoming });
      stamps.set(key, new Date('2026-02-01T10:00:00.000Z'));
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

const token = 'bearer-token';

describe('admin settings handler', () => {
  it('merges a partial notification save instead of clearing the other switches', async () => {
    const { database } = storeDatabase();
    const admin = createAdminHandlers(database);
    const first = await admin.handle({
      method: 'PUT',
      segments: ['settings'],
      body: { notifications: { orders: true, lowStock: true, partners: true, reviews: true } },
      token,
    });
    expect(first.status).toBe(200);

    // The console now saves one section at a time, so a single flipped switch
    // must not take the other three down with it.
    const result = await admin.handle({
      method: 'PUT',
      segments: ['settings'],
      body: { notifications: { orders: false } },
      token,
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Settings saved.');
    expect((result.body.settings as { notifications: Record<string, boolean> }).notifications)
      .toEqual({ orders: false, lowStock: true, partners: true, reviews: true });
  });

  it('stamps the settings response with an updatedAt timestamp', async () => {
    const { database } = storeDatabase();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'PUT',
      segments: ['settings'],
      body: { profile: { storeName: 'Glow & Grace' } },
      token,
    });

    expect(result.status).toBe(200);
    expect(Number.isNaN(new Date(String(result.body.updatedAt)).getTime())).toBe(false);
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
    // The console highlights the offending input, so the error has to name the
    // field rather than only explaining that something was wrong.
    expect((result.body.errors as Record<string, string>)['profile.email']).toMatch(/valid email/i);
  });

  it('rejects a fractional delivery fee even when it arrives as a string', async () => {
    const { database } = storeDatabase();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'PUT',
      segments: ['settings'],
      body: { delivery: { deliveryFee: '49.5' } },
      token,
    });

    expect(result.status).toBe(400);
    expect((result.body.errors as Record<string, string>)['delivery.deliveryFee']).toMatch(/whole number/i);
  });
});

/**
 * Every console write addresses a nested path such as /products/11 or
 * /pages/careers, and those are exactly the paths a Vercel `[...path]` function
 * fails to match, so the handler behind them had no coverage of its own.
 */
describe('admin product update route', () => {
  const productRow: Record<string, unknown> = {
    id: 11,
    name: 'K.B. Compact Powder',
    category: 'Makeup',
    brand: 'Kajal Bhatt',
    sku: 'GG-SKM-1001',
    price: 649,
    mrp: 849,
    stock: 24,
    rating: '4.5',
    reviews: 18,
    badge: 'Bestseller',
    image: 'compact.jpg',
    description: 'A soft compact powder for an even finish.',
    published: true,
    featured: false,
    images: [],
  };

  function productDatabase() {
    const stored = { ...productRow };
    return makeDatabase(async (text, values) => {
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      if (text.includes('UPDATE products')) {
        // Only the SET clause names columns; the trailing WHERE binds the id.
        const setClause = text.slice(text.indexOf('SET '), text.indexOf(' WHERE '));
        const columns = [...setClause.matchAll(/(\w+) = \$\d+/g)].map((match) => match[1]);
        columns.forEach((column, index) => {
          stored[column] = values[index + 1];
        });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM products AS product')) {
        const wanted = text.includes('WHERE product.id = $1') ? Number(values[0]) : stored.id;
        return wanted === stored.id ? { rows: [{ ...stored }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  it('saves a product addressed by its nested reference', async () => {
    const { database, query } = productDatabase();
    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['products', '11'],
      body: { price: 599 },
      token,
    });

    expect(result).toMatchObject({ status: 200, body: { product: { id: 11, price: 599 }, message: 'Product updated.' } });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE products'), [11, 599]);
  });

  it('publishes and unpublishes a product through the same nested reference', async () => {
    const { database, query } = productDatabase();
    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['products', '11'],
      body: { published: false },
      token,
    });

    expect(result).toMatchObject({ status: 200, body: { product: { id: 11, published: false } } });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE products'), [11, false]);
  });

  it('refuses a product reference that is not a whole number', async () => {
    const { database } = productDatabase();
    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['products', 'not-a-number'],
      body: { price: 599 },
      token,
    });

    expect(result).toMatchObject({ status: 400, body: { error: 'invalid_id' } });
  });

  it('reports a product that is no longer in the catalogue', async () => {
    const { database } = productDatabase();
    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['products', '999'],
      body: { price: 599 },
      token,
    });

    expect(result).toMatchObject({ status: 404, body: { error: 'not_found' } });
  });

  it('asks for a sign-in instead of reporting the nested route as missing', async () => {
    const { database } = productDatabase();
    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['products', '11'],
      body: { price: 599 },
    });

    expect(result).toMatchObject({ status: 401, body: { error: 'unauthenticated' } });
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

  it('rejects a visibility change for a page the console may not switch', async () => {
    const { database, query } = makeDatabase(async (text) => {
      if (text.includes('UPDATE site_pages')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);
    // Checkout is a real storefront page, but hiding it would strand shoppers
    // mid-purchase, so the console refuses it before it reaches the database.
    for (const slug of ['checkout', 'home', 'about', 'admin', 'wishlist']) {
      const result = await admin.handle({ method: 'PATCH', segments: ['pages', slug], body: { visible: false }, token });
      expect(result).toMatchObject({ status: 400, body: { error: 'page_not_switchable' } });
    }
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE site_pages'), expect.anything());
  });

  it('only lists the three switchable pages to the console, but still serves every page to the storefront', async () => {
    const { database } = makeDatabase(async (text) => {
      if (text.includes('FROM site_pages')) return { rows: pageRows, rowCount: pageRows.length };
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);

    const listed = await admin.handle({ method: 'GET', segments: ['pages'], token });
    expect(listed.status).toBe(200);
    expect((listed.body as { pages: Array<{ slug: string }> }).pages.map((page) => page.slug)).toEqual(['shop', 'careers']);

    // The storefront gates and navigation still need the full list.
    expect((await admin.publicPages()).map((page) => page.slug)).toEqual(['home', 'shop', 'careers']);
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
