import { describe, expect, it, vi } from 'vitest';
import { createAdminHandlers, seedAdminData } from './admin';
import { hashPassword, sessionDurationMinutes, sessionExpiry } from './admin/passwords';
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

describe('admin session lifetime', () => {
  it('expires five minutes after sign-in and reports the moment to the client', async () => {
    // The exact window is asserted on the helper, where the clock is fixed.
    const issuedAt = new Date('2026-03-01T09:00:00.000Z');
    expect(sessionExpiry(issuedAt).toISOString()).toBe('2026-03-01T09:05:00.000Z');
    expect(sessionDurationMinutes).toBe(5);

    const { database, query } = makeDatabase(async (text) => {
      if (text.includes('FROM admin_users WHERE email')) {
        return { rows: [{ ...activeAdminRow, password_hash: await hashPassword('a-real-password') }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);

    const before = Date.now();
    const result = await admin.handle({ method: 'POST', segments: ['session'], body: { email: 'admin@glowngrace.in', password: 'a-real-password' } });

    expect(result.status).toBe(201);
    const body = result.body as { token: string; expiresAt: string; user: { email: string } };
    expect(typeof body.token).toBe('string');

    // The client relies on this value to sign the operator out on its own, so it
    // has to be a real, soon-enough deadline rather than a vague marker. The
    // upper bound has slack because verifying the scrypt hash runs between the
    // two readings.
    const expiresAt = Date.parse(body.expiresAt);
    const lifetime = expiresAt - before;
    expect(Number.isNaN(expiresAt)).toBe(false);
    expect(lifetime).toBeGreaterThan(4 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(5 * 60 * 1000 + 5000);

    // The stored row must carry the same deadline the client was told about.
    const insert = query.mock.calls.find(([text]) => String(text).includes('INSERT INTO admin_sessions'));
    expect(insert).toBeDefined();
    const storedExpiry = (insert?.[1] as unknown[])[2];
    expect(storedExpiry).toBeInstanceOf(Date);
    expect((storedExpiry as Date).toISOString()).toBe(body.expiresAt);
  });

  it('refuses to open a session for an account that is not Active', async () => {
    const { database } = makeDatabase(async (text) => {
      if (text.includes('FROM admin_users WHERE email')) {
        // A signup waiting for approval, and a suspended account, must both be
        // unable to sign in even with the right password.
        return { rows: [{ ...activeAdminRow, status: 'Pending', password_hash: await hashPassword('a-real-password') }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);

    const result = await admin.handle({ method: 'POST', segments: ['session'], body: { email: 'admin@glowngrace.in', password: 'a-real-password' } });

    expect(result.status).toBe(401);
    expect(result.body.error).toBe('invalid_credentials');
  });

  it('stops honouring a session row once it has expired', async () => {
    // currentUser() filters on expires_at > NOW(), so an expired row is simply
    // not returned and every console route answers 401.
    const { database } = makeDatabase(async (text) => {
      if (text.includes('FROM admin_sessions')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);

    const result = await admin.handle({ method: 'GET', segments: ['me'], token });

    expect(result.status).toBe(401);
    expect(result.body.error).toBe('unauthenticated');
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

/** The column list every user read uses, so a mock can recognise one. */
const userColumnsLiteral = () => 'id, name, email, role, avatar, status, phone, source, reviewed_at, created_at';

describe('admin password recovery route', () => {
  const memberRow = {
    ...activeAdminRow,
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Deepak Kumar',
    email: 'deepak@glowngrace.in',
    role: 'Placement Coordinator',
    status: 'Pending',
    phone: null,
    source: 'signup',
    reviewed_at: null,
  };

  /**
   * A console with one account and an in-memory password, so recovery can be
   * observed the way an operator would: by signing in with the result.
   */
  function recoveryConsole(rows: Array<Record<string, unknown>>) {
    const sessions = new Map<string, unknown>();
    const resets: Array<Record<string, unknown>> = [];
    const outbox: Array<Record<string, unknown>> = [];
    const { database } = makeDatabase(async (text, values) => {
      if (text.includes('FROM admin_sessions')) {
        // A signed-in operator, whoever they are acting on.
        if (text.includes('DELETE FROM admin_sessions')) {
          sessions.clear();
          return { rows: [], rowCount: sessions.size };
        }
        return { rows: [activeAdminRow], rowCount: 1 };
      }
      if (text.includes('FROM password_resets')) {
        const live = resets.filter((reset) => reset.token_lookup === values[0] && !reset.used_at);
        return { rows: live, rowCount: live.length };
      }
      if (text.includes('FROM email_outbox')) return { rows: outbox, rowCount: outbox.length };
      if (text.includes('INSERT INTO email_outbox')) {
        outbox.push({ id: `message-${outbox.length + 1}`, created_at: new Date(), read_at: null, ...values });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO password_resets')) {
        resets.push({ id: `reset-${resets.length + 1}`, user_id: values[0], token_hash: values[1], token_lookup: values[2], used_at: null });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('UPDATE password_resets SET used_at')) {
        for (const reset of resets) if (!reset.used_at) reset.used_at = new Date();
        return { rows: [], rowCount: resets.length };
      }
      if (text.includes('UPDATE admin_users SET password_hash')) {
        const account = rows.find((row) => row.id === values[0]);
        if (account) account.password_hash = values[1];
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('DELETE FROM admin_sessions')) {
        sessions.clear();
        return { rows: [], rowCount: 0 };
      }
      if (text.includes(userColumnsLiteral())) {
        return { rows, rowCount: rows.length };
      }
      if (text.includes('FROM admin_users')) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    });
    return { database, rows, sessions, resets, outbox };
  }

  it('sets a password without the current one, which is the whole point of recovery', async () => {
    const { database, rows } = recoveryConsole([{ ...memberRow }]);
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['users', String(memberRow.id), 'recover'],
      body: { newPassword: 'recovered-2026' },
      token,
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toContain('Password reset for Deepak Kumar');
    // The only proof that matters: the stored hash is the new password.
    const { verifyPassword } = await import('./admin/passwords');
    expect(await verifyPassword('recovered-2026', String(rows[0].password_hash))).toBe(true);
  });

  it('accepts the published sample password, which the ordinary password form refuses', async () => {
    // `demo123` is 7 characters and the policy minimum is 8. Without this
    // exemption the seeded demo state is unrecoverable by any route, which is
    // precisely the bug this work exists to fix.
    const { database, rows } = recoveryConsole([{ ...memberRow }]);
    const admin = createAdminHandlers(database);

    const rejected = await admin.handle({
      method: 'POST',
      segments: ['users', String(memberRow.id), 'password'],
      body: { currentPassword: 'anything-long-enough', newPassword: 'demo123' },
      token,
    });
    expect(rejected.status).toBe(400);

    const accepted = await admin.handle({
      method: 'POST',
      segments: ['users', String(memberRow.id), 'recover'],
      body: { newPassword: 'demo123' },
      token,
    });
    expect(accepted.status).toBe(200);
    const { verifyPassword } = await import('./admin/passwords');
    expect(await verifyPassword('demo123', String(rows[0].password_hash))).toBe(true);
  });

  it('reports a member as they are, not as active, because recovery is not approval', async () => {
    const { database } = recoveryConsole([{ ...memberRow }]);
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['users', String(memberRow.id), 'recover'],
      body: { newPassword: 'recovered-2026' },
      token,
    });

type RecoveredUser = { status: string; source: string };
    expect((result.body.user as RecoveredUser).status).toBe('Pending');
    expect((result.body.user as RecoveredUser).source).toBe('signup');
  });

  it('refuses a password that is neither long enough nor the sample one', async () => {
    const { database } = recoveryConsole([{ ...memberRow }]);
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['users', String(memberRow.id), 'recover'],
      body: { newPassword: 'short' },
      token,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_password');
    expect(result.body.message).toContain('sample password demo123');
  });

  it('404s a member who has been deleted', async () => {
    const { database } = recoveryConsole([]);
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['users', '00000000-0000-4000-8000-000000000009', 'recover'],
      body: { newPassword: 'recovered-2026' },
      token,
    });

    expect(result.status).toBe(404);
    expect(result.body.error).toBe('not_found');
  });

  it('puts every account on one password and signs everyone out, including the caller', async () => {
    const { database, rows } = recoveryConsole([
      { ...activeAdminRow },
      { ...memberRow },
      { ...activeAdminRow, id: '00000000-0000-4000-8000-000000000003', email: 'aditi@glowngrace.in' },
    ]);
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['users', 'recover-all'],
      body: { newPassword: 'demo123' },
      token,
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Password reset for all 3 console accounts. Everyone has been signed out.');
    const { verifyPassword } = await import('./admin/passwords');
    for (const row of rows) {
      expect(await verifyPassword('demo123', String(row.password_hash))).toBe(true);
    }
  });
});

describe('forgotten password flow', () => {
  function resetConsole(accounts: Array<Record<string, unknown>>) {
    const inserts: string[] = [];
    const messages: Array<{ recipient: string; body: string }> = [];
    const { database } = makeDatabase(async (text, values) => {
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      if (text.includes('FROM email_outbox')) {
        return {
          rows: messages.map((message, index) => ({ id: `message-${index}`, ...message, created_at: new Date('2026-03-01T10:00:00.000Z'), read_at: null })),
          rowCount: messages.length,
        };
      }
      if (text.includes('INSERT INTO email_outbox')) {
        messages.push({ recipient: String(values[0]), body: String(values[2]) });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO password_resets')) {
        inserts.push(String(values[1]));
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM password_resets')) return { rows: [], rowCount: 0 };
      if (text.includes('FROM admin_users WHERE email')) return { rows: accounts, rowCount: accounts.length };
      return { rows: [], rowCount: 0 };
    });
    return { database, inserts, messages };
  }

  it('answers identically whether or not the address has an account', async () => {
    // A differing answer on an unauthenticated route is an account-existence
    // oracle, so both branches must return the same status and the same body.
    const { database } = resetConsole([{ id: 'user-1', name: 'Glow & Grace Admin', email: 'admin@glowngrace.in' }]);
    const admin = createAdminHandlers(database);
    const known = await admin.handle({ method: 'POST', segments: ['password-reset'], body: { email: 'admin@glowngrace.in' } });
    const unknown = await admin.handle({ method: 'POST', segments: ['password-reset'], body: { email: 'nobody@glowngrace.in' } });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
  });

  it('writes the reset token to the outbox rather than a mail server', async () => {
    const { database, inserts, messages } = resetConsole([{ id: 'user-1', name: 'Glow & Grace Admin', email: 'admin@glowngrace.in' }]);
    const admin = createAdminHandlers(database);
    const result = await admin.handle({ method: 'POST', segments: ['password-reset'], body: { email: 'admin@glowngrace.in' } });

    expect(result.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(messages).toHaveLength(1);
    // The token travels in the message body as a path, and the stored digest is
    // not the token.
    const token = /token=([0-9a-f]{64})/.exec(messages[0].body)?.[1];
    expect(token).toBeTruthy();
    expect(inserts[0]).not.toBe(token);
  });

  it('rejects a malformed address', async () => {
    const { database } = resetConsole([]);
    const admin = createAdminHandlers(database);
    const result = await admin.handle({ method: 'POST', segments: ['password-reset'], body: { email: 'not-an-address' } });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_email');
  });

  it('redeems a real token once and only once', async () => {
    const account = { id: 'user-1', name: 'Glow & Grace Admin', email: 'admin@glowngrace.in', password_hash: 'stale' };
    const token = 'a'.repeat(64);
const { hashResetToken } = await import('./admin/passwords');
    const { tokenHash } = await hashResetToken(token);
    let usedAt: Date | null = null;
    const updates: string[] = [];

    const { database } = makeDatabase(async (text, values) => {
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      if (text.includes('FROM password_resets')) {
        return { rows: usedAt ? [] : [{ id: 'reset-1', user_id: account.id, token_hash: tokenHash }], rowCount: usedAt ? 0 : 1 };
      }
      if (text.includes('UPDATE password_resets SET used_at = NOW() WHERE id')) {
        usedAt = new Date();
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('UPDATE admin_users SET password_hash')) {
        updates.push(String(values[1]));
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('SELECT id, password_hash FROM admin_users')) {
        return { rows: [{ id: account.id, password_hash: account.password_hash }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const admin = createAdminHandlers(database);
    const first = await admin.handle({
      method: 'POST',
      segments: ['password-reset', 'confirm'],
      body: { token, newPassword: 'brand-new-2026' },
    });
    expect(first.status).toBe(200);
    expect(first.body.message).toBe('Password updated. You can sign in with it now.');

    const { verifyPassword } = await import('./admin/passwords');
    expect(await verifyPassword('brand-new-2026', updates[0])).toBe(true);

    // The second attempt finds nothing, because the row is now used.
    const second = await admin.handle({
      method: 'POST',
      segments: ['password-reset', 'confirm'],
      body: { token, newPassword: 'another-one-2026' },
    });
    expect(second.status).toBe(400);
    expect(second.body.error).toBe('invalid_reset_token');
    expect(updates).toHaveLength(1);
  });

  it('refuses a token whose lookup matches but whose scrypt hash does not', async () => {
    // Proves the lookup digest is only a pointer: the scrypt hash is the
    // decision, so a collision or a tampered column still cannot mint a session.
    const { hashResetToken, resetTokenLookup } = await import('./admin/passwords');
    const { tokenHash } = await hashResetToken('b'.repeat(64));
    const { database } = makeDatabase(async (text) => {
      if (text.includes('FROM password_resets')) {
        return { rows: [{ id: 'reset-1', user_id: 'user-1', token_hash: tokenHash }], rowCount: 1 };
      }
      if (text.includes('UPDATE admin_users SET password_hash')) throw new Error('A forged token must not set a password.');
      return { rows: [], rowCount: 0 };
    });

    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['password-reset', 'confirm'],
      body: { token: 'c'.repeat(64), newPassword: 'brand-new-2026' },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_reset_token');
    // The lookup is a plain SHA-256 of the token, which the client never sees.
    expect(resetTokenLookup('c'.repeat(64))).toHaveLength(64);
  });

  it('answers the same way for an unknown, an expired and an already-used token', async () => {
    const { database } = makeDatabase(async (text) => {
      if (text.includes('FROM password_resets')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['password-reset', 'confirm'],
      body: { token: 'd'.repeat(64), newPassword: 'brand-new-2026' },
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_reset_token');
    expect(result.body.message).toBe('That reset link has expired or has already been used. Ask for a new one.');
  });

  it('holds a redeemed password to the ordinary policy, including the sample password', async () => {
    // Recovery may set `demo123`; a link emailed to a person may not, because
    // anyone who has read the README could guess it.
    const { database } = makeDatabase(async (text) => {
      if (text.includes('FROM password_resets')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['password-reset', 'confirm'],
      body: { token: 'e'.repeat(64), newPassword: 'demo123' },
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_password');
  });

  it('requires a signed-in console to read the reset inbox', async () => {
    const { database } = makeDatabase(async (text) => {
      if (text.includes('FROM admin_sessions')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const admin = createAdminHandlers(database);
    const result = await admin.handle({ method: 'GET', segments: ['password-reset', 'messages'] });

    expect(result.status).toBe(401);
  });

  it('lists the waiting reset messages for a signed-in operator', async () => {
    const { database, messages } = resetConsole([]);
    messages.push({ recipient: 'admin@glowngrace.in', body: 'Open /reset-password?token=' + 'f'.repeat(64) });
    const admin = createAdminHandlers(database);
    const result = await admin.handle({ method: 'GET', segments: ['password-reset', 'messages'], token });

    expect(result.status).toBe(200);
const inbox = result.body.messages as Array<{ recipient: string }>;
    expect(inbox).toHaveLength(1);
    expect(inbox[0].recipient).toBe('admin@glowngrace.in');
  });
});
