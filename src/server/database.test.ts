import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDatabase } from './database';
import { createHandlers } from './handlers';
import { createApiRouter } from './router';
import { createAdminHandlers } from './admin';
import { superAdminEmail } from '../auth/roles';

/**
 * These run against the real store rather than a stub.
 *
 * Every other suite hands the handlers a `vi.fn()` that returns whatever rows it
 * was told to, so a query the in-memory engine cannot parse, or a column it does
 * not have, is invisible to them: the fake answers happily. Only a test that goes
 * through `createMemoryDatabase()` exercises the parser and the executor against
 * the SQL the application actually sends.
 */

const image = Buffer.alloc(24);
image.set([137, 80, 78, 71, 13, 10, 26, 10]);
image.write('IHDR', 12, 'ascii');
image.writeUInt32BE(1200, 16);
image.writeUInt32BE(1200, 20);

const productPayload = {
  name: 'Glow Ritual Vitamin C Face Serum',
  category: 'Skincare',
  brand: 'Glow & Grace',
  sku: 'GG-SERUM-1',
  price: 849,
  mrp: 1099,
  stock: 12,
  description: 'A brightening daily serum.',
  slug: 'glow-ritual-vitamin-c',
  metaTitle: 'Glow Ritual Vitamin C Face Serum',
  images: [{
    filename: 'serum.png',
    mimeType: 'image/png',
    data: image.toString('base64'),
    width: 1200,
    height: 1200,
  }],
};

let database: ReturnType<typeof createMemoryDatabase>['database'];

beforeEach(() => {
  ({ database } = createMemoryDatabase());
});

describe('the store answers the queries the application sends', () => {
  it('starts with every table present and empty', async () => {
    for (const table of ['products', 'orders', 'order_items', 'admin_users', 'site_pages', 'store_settings']) {
      const result = await database.query(`SELECT count(*)::int AS total FROM ${table}`);
      expect({ table, total: result.rows[0]?.total }).toEqual({ table, total: 0 });
    }
  });

  it('reports the catalogue as unowned until a product is added', async () => {
    const handlers = createHandlers(database);
    const empty = await handlers.products('GET', undefined);
    expect(empty).toMatchObject({ status: 200, body: { products: [], catalogueManaged: false } });
  });

  it('stores a product and reads it back with its gallery', async () => {
    const handlers = createHandlers(database);
    const created = await handlers.products('POST', productPayload);
    expect(created.status).toBe(201);
    const product = created.body.product as { id: number; images: string[] };
    expect(product.id).toBeGreaterThan(0);
    expect(product.images).toEqual([`/api/products/${product.id}/images/0`]);

    const listed = await handlers.products('GET', undefined);
    expect(listed).toMatchObject({ status: 200, body: { catalogueManaged: true } });
    expect(listed.body.products).toHaveLength(1);
    expect(listed.body.products?.[0]).toMatchObject({
      name: productPayload.name,
      slug: productPayload.slug,
      metaTitle: productPayload.metaTitle,
      images: [`/api/products/${product.id}/images/0`],
    });

    // The gallery bytes survive, so the image route can serve them.
    const served = await handlers.productImage(product.id, 0);
    expect(served).toEqual({ status: 200, mimeType: 'image/png', data: image });
    expect(await handlers.productImage(product.id, 10)).toEqual({ status: 404 });
  });

  it('refuses a second product with the same SKU', async () => {
    const handlers = createHandlers(database);
    expect((await handlers.products('POST', productPayload)).status).toBe(201);
    const duplicate = await handlers.products('POST', productPayload);
    expect(duplicate).toMatchObject({ status: 409, body: { error: 'duplicate_sku' } });
  });

  it('keeps a blank SKU without treating it as a duplicate', async () => {
    const handlers = createHandlers(database);
    const withoutSku = { ...productPayload, sku: '' };
    expect((await handlers.products('POST', withoutSku)).status).toBe(201);
    expect((await handlers.products('POST', withoutSku)).status).toBe(201);
  });

  it('prices a checkout from the stored catalogue and records the order', async () => {
    const handlers = createHandlers(database);
    await handlers.products('POST', productPayload);

    const order = await handlers.checkout('POST', {
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      phone: '+91 98765 43210',
      address: '10 Rose Garden Road',
      locality: 'Gomti Nagar',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      postalCode: '226010',
      deliveryMethod: 'express',
      paymentMethod: 'cod',
      items: [{ productId: 9, quantity: 2 }],
    });

    // 1698.00 of serum plus express shipping and tax, which is the total the customer
    // is charged rather than the subtotal.
    expect(order).toMatchObject({ status: 201, body: { total: 1831.9 } });
    const orderNumber = (order.body as { orderNumber: string }).orderNumber;

    const stored = await database.query(
      'SELECT id, order_number, total_paise, payment_method FROM orders WHERE order_number = $1',
      [orderNumber],
    );
    expect(stored.rows[0]).toMatchObject({ order_number: orderNumber, total_paise: 183190, payment_method: 'cod' });

    const lines = await database.query('SELECT product_id, product_name, unit_price_paise, quantity FROM order_items WHERE order_id = $1', [stored.rows[0].id]);
    expect(lines.rows).toEqual([{
      product_id: 9,
      product_name: productPayload.name,
      unit_price_paise: 84900,
      quantity: 2,
    }]);
  });

  it('refuses a checkout for a product the catalogue does not have', async () => {
    const handlers = createHandlers(database);
    const order = await handlers.checkout('POST', {
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      phone: '+91 98765 43210',
      address: '10 Rose Garden Road',
      locality: 'Gomti Nagar',
      city: 'Lucknow',
      state: 'Uttar Pradesh',
      postalCode: '226010',
      deliveryMethod: 'express',
      paymentMethod: 'cod',
      items: [{ productId: 404, quantity: 1 }],
    });
    expect(order.status).toBe(400);
    const written = await database.query('SELECT count(*)::int AS total FROM orders');
    expect(written.rows[0]?.total).toBe(0);
  });

  it('serves the bundled page list before anything is saved', async () => {
    const router = createApiRouter(database);
    const result = await router.handle({ method: 'GET', path: '/api/site/pages' });
    expect(result?.status).toBe(200);
    const pages = result?.body.pages as Array<{ slug: string; visible: boolean }>;
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((page) => page.visible)).toBe(true);
  });

  it('accepts a contact request and a newsletter signup', async () => {
    // Contact and newsletter are their own serverless functions rather than
    // routes on the shared router, so they are driven through the handlers the
    // way api/contact.ts and api/newsletter.ts drive them.
    const handlers = createHandlers(database);
    expect((await handlers.contact('POST', {
      name: 'Priya',
      email: 'priya@example.com',
      topic: 'Product question',
      message: 'I would like to know about the serum.',
    })).status).toBe(201);
    expect((await handlers.newsletter('POST', { email: 'priya@example.com' })).status).toBe(201);

    const contacts = await database.query('SELECT name, email, topic FROM contact_requests');
    expect(contacts.rows).toEqual([{ name: 'Priya', email: 'priya@example.com', topic: 'Product question' }]);
    const subscribers = await database.query('SELECT email FROM newsletter_subscribers');
    expect(subscribers.rows).toEqual([{ email: 'priya@example.com' }]);
  });

  it('does not share rows between two stores', async () => {
    const other = createMemoryDatabase();
    await createHandlers(database).products('POST', productPayload);
    const listed = await createHandlers(other.database).products('GET', undefined);
    expect(listed.body.products).toEqual([]);
  });
});

describe('the SQL the engine supports', () => {
  it('numbers generated ids from the serial sequence', async () => {
    const first = await database.query("INSERT INTO products (name, category, price, mrp, stock, image, description) VALUES ('a', 'c', 1, 2, 3, 'i', 'd') RETURNING id");
    const second = await database.query("INSERT INTO products (name, category, price, mrp, stock, image, description) VALUES ('b', 'c', 1, 2, 3, 'i', 'd') RETURNING id");
    expect(first.rows[0]?.id).toBe(9);
    expect(second.rows[0]?.id).toBe(10);
  });

  it('aggregates with count, coalesce and sum', async () => {
    await database.query("INSERT INTO products (name, category, price, mrp, stock, image, description) VALUES ('a', 'c', 100, 120, 3, 'i', 'd')");
    await database.query("INSERT INTO products (name, category, price, mrp, stock, image, description) VALUES ('b', 'c', 200, 240, 5, 'i', 'd')");
    const result = await database.query('SELECT count(*)::int AS total, COALESCE(SUM(stock), 0)::int AS stock FROM products');
    expect(result.rows[0]).toEqual({ total: 2, stock: 8 });
  });

  it('answers an ANY lookup', async () => {
    await database.query("INSERT INTO products (id, name, category, price, mrp, stock, image, description) VALUES (7, 'a', 'c', 1, 2, 3, 'i', 'd')");
    const found = await database.query('SELECT id, name FROM products WHERE id = ANY($1::integer[])', [[7, 99]]);
    expect(found.rows).toEqual([{ id: 7, name: 'a' }]);
  });

  it('stores settings as json and reads them back as json', async () => {
    await database.query("INSERT INTO store_settings (key, value) VALUES ('profile', '{\"storeName\":\"Glow & Grace\"}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()");
    const read = await database.query("SELECT value FROM store_settings WHERE key = 'profile'");
    expect(read.rows[0]?.value).toEqual({ storeName: 'Glow & Grace' });
  });

  it('applies an update and stamps the timestamp', async () => {
    await database.query("INSERT INTO products (id, name, category, price, mrp, stock, image, description) VALUES (7, 'a', 'c', 100, 120, 3, 'i', 'd')");
    const updated = await database.query("UPDATE products SET price = $2, updated_at = NOW() WHERE id = $1", [7, 150]);
    expect(updated.rowCount).toBe(1);
    const read = await database.query('SELECT price, updated_at FROM products WHERE id = $1', [7]);
    expect(read.rows[0]?.price).toBe(150);
    expect(read.rows[0]).toHaveProperty('updated_at');
  });

  it('reports a unique violation with the postgres error code', async () => {
    await database.query("INSERT INTO products (name, category, sku, price, mrp, stock, image, description) VALUES ('a', 'c', 'ONE', 1, 2, 3, 'i', 'd')");
    await expect(database.query("INSERT INTO products (name, category, sku, price, mrp, stock, image, description) VALUES ('b', 'c', 'ONE', 1, 2, 3, 'i', 'd')"))
      .rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a statement it cannot parse rather than guessing', async () => {
    await expect(database.query('WITH x AS (SELECT 1) SELECT * FROM x')).rejects.toThrow(/Could not read the query/);
  });
});

/**
 * Getting into the console on a store that starts empty.
 *
 * The owner's password is generated and mailed, which is right for the seed and
 * wrong for `/superadmin/ggpass`: seeding happens with nobody at the keyboard, so
 * there is no screen to show a password on. The pinned password is the escape hatch
 * for a machine with no mail host at all, where the outbox row would die with the
 * process.
 *
 * A pinned password used to need a date it would be taken back on, because the
 * weekly rotation would otherwise have replaced it. There is no rotation now, so it
 * is simply a seed-time value that lasts until the owner replaces it from the
 * screen - and a pin that does not meet the password policy is refused outright.
 */
describe('the owner account on a freshly started store', () => {
  const pinned = { OWNER_PINNED_PASSWORD: 'Andy@1983$$' };

  beforeEach(() => {
    delete process.env.OWNER_PINNED_PASSWORD;
    delete process.env.OWNER_PINNED_HOLD_UNTIL;
  });

  it('signs in with the pinned password', async () => {
    const { database } = createMemoryDatabase();
    Object.assign(process.env, pinned);
    const admin = createAdminHandlers(database);
    await admin.seed();

    const login = await admin.handle({ method: 'POST', segments: ['session'], body: { email: superAdminEmail, password: 'Andy@1983$$' } });
    expect(login.status).toBe(201);
  });

  it('needs no expiry date for a pinned password, because nothing takes it back', async () => {
    const { database } = createMemoryDatabase();
    Object.assign(process.env, pinned);
    // A refusal would come back as a rejected promise, so reaching here at all is
    // the assertion; the account is proven usable by the sign-in above.
    await expect(createAdminHandlers(database).seed()).resolves.toBeUndefined();
  });

  it('refuses a pinned password the sign-in form would refuse', async () => {
    const { database } = createMemoryDatabase();
    Object.assign(process.env, { OWNER_PINNED_PASSWORD: 'short' });
    await expect(createAdminHandlers(database).seed()).rejects.toThrow(/at least 8 characters/);
  });

  it('stores no rotation or hold columns, because there is nothing left to schedule', async () => {
    const { database } = createMemoryDatabase();
    await createAdminHandlers(database).seed();

    // `SELECT *` returns the columns the store actually declares, so this is a
    // statement about the schema and not about one row's contents. The in-memory
    // store declares its own, and migration 015 drops the same two from Postgres.
    // If either side ever grows them back, this is the test that notices.
    const owner = await database.query('SELECT * FROM admin_users WHERE email = $1', [superAdminEmail]);
    expect(Object.keys(owner.rows[0] as object)).not.toContain('password_rotated_at');
    expect(Object.keys(owner.rows[0] as object)).not.toContain('password_hold_until');
  });

  it('does not mail a password the operator already has', async () => {
    const { database } = createMemoryDatabase();
    Object.assign(process.env, pinned);
    await createAdminHandlers(database).seed();

    const outbox = await database.query('SELECT recipient FROM email_outbox WHERE kind = $1', ['owner-credentials']);
    expect(outbox.rows).toEqual([]);
  });

  it('generates and queues a password when nothing is pinned', async () => {
    const { database } = createMemoryDatabase();
    await createAdminHandlers(database).seed();

    const outbox = await database.query('SELECT recipient FROM email_outbox WHERE kind = $1', ['owner-credentials']);
    expect(outbox.rows).toEqual([{ recipient: superAdminEmail }]);
  });

  it('generates one the owner can actually read off the page and type back in', async () => {
    const { database } = createMemoryDatabase();
    await createAdminHandlers(database).seed();

    const { password } = await mailedPassword(database);
    expect(password).toHaveLength(8);
    // No glyphs that are hard to tell apart, because this one is not going to be
    // emailed to anybody - it is going to be handed to a person and typed back.
    expect(password).not.toMatch(/[Il1O0]/);
  });
});

  /**
 * The whole journey, on the real store.
 *
 * Each of the three things the owner is promised is checked somewhere already -
 * the save writes a hash, the sign-in verifies, the confirmation carries no
 * password - but all three were checked against mocks that answer whatever they
 * were told. That combination can pass while the seam between them is broken: a
 * hash written under a parameter the verifier never reads is invisible to all of
 * them at once.
 *
 * So this drives the actual round trip the screen starts - generate, then save
 * exactly what came back - and then signs in with it. Nothing here is stubbed,
 * which is also why it is the only place that can catch a query the in-memory
 * engine parses differently from Postgres.
 */
describe('the round trip the generate and save buttons start', () => {
  beforeEach(() => {
    delete process.env.OWNER_PINNED_PASSWORD;
    delete process.env.OWNER_PINNED_HOLD_UNTIL;
  });

  it('signs the owner in with the password it generated and then saved', async () => {
    const { database } = createMemoryDatabase();
    const admin = createAdminHandlers(database);
    await admin.seed();

    // Whatever the seed mailed is the starting credential, so the test does not
    // depend on how a fresh store happens to be set up.
    const before = await mailedPassword(database);
    const token = await admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: superAdminEmail, password: before.password },
    }).then((result) => (result.body as { token: string }).token);
    expect(token).toBeTruthy();

    // The generate step. No credential is written and the session still works,
    // which is the whole reason it is a separate request.
    const generated = await admin.handle({
      method: 'POST',
      segments: ['owner-password', 'generate'],
      token,
    });
    expect(generated.status).toBe(200);
    const fresh = (generated.body as { password: string }).password;
    expect(fresh).toMatch(/^[A-Za-z0-9]{8}$/);
    // A fresh password every time. Two generations handing back the same string
    // would make "generate again" useless to somebody who wants a different one.
    expect(fresh).not.toBe(before.password);

    // Generating has changed nothing about the account: the old password still
    // opens the console, so a closed tab or a refresh costs nobody their access.
    expect((await admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: superAdminEmail, password: before.password },
    })).status).toBe(201);

    // Now the save, with the value that came back from the generate step.
    const saved = await admin.handle({
      method: 'POST',
      segments: ['owner-password', 'save'],
      body: { password: fresh },
      token,
    });
    expect(saved.status).toBe(200);

    // The history the columns exist for: when the password was offered, and when
    // it was kept, as two rows of the same table. Nothing in here is a password -
    // it is the difference between an untouched account and one that has been
    // through this screen.
    const events = await database.query('SELECT * FROM owner_password_events');
    expect(events.rows.map((row) => (row as { kind: string }).kind)).toEqual(['generated', 'saved']);
    const owner = await database.query('SELECT * FROM admin_users WHERE email = $1', [superAdminEmail]);
    const row = owner.rows[0] as { password_changed_at: unknown; password_generated_at: unknown };
    expect(row.password_changed_at).toBeTruthy();
    expect(row.password_generated_at).toBeTruthy();

    // One character different, so the password is checked rather than merely
    // present in the response.
    const wrong = `${fresh.slice(0, -1)}${fresh.endsWith('a') ? 'b' : 'a'}`;

    // The old password is dead. A save that only added a second working password
    // would leave a compromised credential valid for ever.
    expect((await admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: superAdminEmail, password: before.password },
    })).status).toBe(401);

    expect((await admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: superAdminEmail, password: wrong },
    })).status).toBe(401);

    // And this is the promise the whole screen rests on: the value on the screen
    // is the one that opens the console.
    const signedIn = await admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: superAdminEmail, password: fresh },
    });
    expect(signedIn.status).toBe(201);
    const body = signedIn.body as { user: { email: string; role: string } };
    expect(body.user.email).toBe(superAdminEmail);
    expect(body.user.role).toBe('Super Admin');
  });

  it('ends every session when it saves, so the old password stops working everywhere', async () => {
    const { database } = createMemoryDatabase();
    const admin = createAdminHandlers(database);
    await admin.seed();
    const { password: seeded } = await mailedPassword(database);

    const tokens = await Promise.all([1, 2, 3].map(() => admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: superAdminEmail, password: seeded },
    }).then((result) => (result.body as { token: string }).token)));

    const generated = await admin.handle({
      method: 'POST',
      segments: ['owner-password', 'generate'],
      token: tokens[0],
    });
    const saved = await admin.handle({
      method: 'POST',
      segments: ['owner-password', 'save'],
      body: { password: (generated.body as { password: string }).password },
      token: tokens[0],
    });
    expect((saved.body as { sessionsRevoked: number }).sessionsRevoked).toBe(3);

    // Every one of them, the caller's included - which is why the page drops its
    // token and walks to sign-in rather than staying put.
    for (const token of tokens) {
      expect((await admin.handle({ method: 'GET', segments: ['me'], token })).status).toBe(401);
    }
  });

  it('queues a confirmation that carries no password', async () => {
    const { database } = createMemoryDatabase();
    const admin = createAdminHandlers(database);
    await admin.seed();
    const token = await ownerToken(database, admin);

    const generated = await admin.handle({ method: 'POST', segments: ['owner-password', 'generate'], token });
    const fresh = (generated.body as { password: string }).password;
    await admin.handle({ method: 'POST', segments: ['owner-password', 'save'], body: { password: fresh }, token });

    const confirmations = await database.query(
      `SELECT recipient, subject, body FROM email_outbox WHERE kind = 'owner-password-saved'`,
    );
    expect(confirmations.rows).toHaveLength(1);
    const row = confirmations.rows[0] as { recipient: string; body: string };
    expect(row.recipient).toBe(superAdminEmail);
    // The one mail in the project that carries no working credential.
    expect(row.body).not.toContain(fresh);
    expect(row.body).not.toMatch(/Password:\s*\S/);
  });

  it('refuses to save anything outside the owner policy, and keeps the account usable', async () => {
    const { database } = createMemoryDatabase();
    const admin = createAdminHandlers(database);
    await admin.seed();
    const { password: seeded } = await mailedPassword(database);
    const token = await ownerToken(database, admin);

    const refused = await admin.handle({
      method: 'POST',
      segments: ['owner-password', 'save'],
      body: { password: 'short' },
      token,
    });
    expect(refused.status).toBe(400);
    // A refused save must leave the owner exactly as they were, or a typo would
    // lock the account that cannot be locked out.
    expect((await admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: superAdminEmail, password: seeded },
    })).status).toBe(201);
  });

  it('saves an eight character password from the screen, and signs in with it', async () => {
    // The value arrives from the paste rather than from the generator, as far as
    // the server can tell, so this is the case that has to work: held to the
    // owner's own eight letters and numbers rather than to the longer policy a
    // reset or a team-member change is held to.
    const { database } = createMemoryDatabase();
    const admin = createAdminHandlers(database);
    await admin.seed();
    const token = await ownerToken(database, admin);

    expect((await admin.handle({
      method: 'POST',
      segments: ['owner-password', 'save'],
      body: { password: 'Mango9Tr' },
      token,
    })).status).toBe(200);

    const login = await admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: superAdminEmail, password: 'Mango9Tr' },
    });
    expect(login.status).toBe(201);
    expect((login.body as { user: { role: string } }).user.role).toBe('Super Admin');
  });

  it('answers 403 to anybody who is not the owner', async () => {
    const { database } = createMemoryDatabase();
    const admin = createAdminHandlers(database);
    await admin.seed();
    const created = await admin.handle({
      method: 'POST',
      segments: ['users'],
      body: { name: 'Rehana Kapoor', email: 'rehana@glowngrace.in', role: 'Store Administrator', password: 'Andy@1983$$' },
      token: await ownerToken(database, admin),
    });
    expect((created.body as { user: { id: string } }).user.id).toBeTruthy();

    // Postgres defaults a new account to Active; the in-memory store declares no
    // defaults, so it is set here. Without it there is no session to be refused
    // with, and the test would pass for the wrong reason.
    await database.query('UPDATE admin_users SET status = $1 WHERE email = $2', ['Active', 'rehana@glowngrace.in']);
    const otherToken = await admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: 'rehana@glowngrace.in', password: 'Andy@1983$$' },
    }).then((result) => (result.body as { token: string }).token);
    expect(otherToken).toBeTruthy();

    // Generating is refused as firmly as saving. A store administrator who could
    // mint a password for the owner would not be stopped by anything.
    for (const segments of [['owner-password', 'generate'], ['owner-password', 'save']]) {
      const result = await admin.handle({
        method: 'POST',
        segments,
        body: { password: 'Mango9Tr' },
        token: otherToken,
      });
      expect(result.status).toBe(403);
    }
  });

  it('answers 405 for anything it cannot do, rather than guessing', async () => {
    const { database } = createMemoryDatabase();
    const admin = createAdminHandlers(database);
    await admin.seed();
    const token = await ownerToken(database, admin);

    expect((await admin.handle({ method: 'GET', segments: ['owner-password', 'generate'], token })).status).toBe(405);
    expect((await admin.handle({ method: 'POST', segments: ['owner-password', 'rotate'], token })).status).toBe(404);
  });
});

/** The password from the most recent credential message in the outbox. */
async function mailedPassword(database: Awaited<ReturnType<typeof createMemoryDatabase>>['database']) {
  const outbox = await database.query(
    `SELECT recipient, body FROM email_outbox
     WHERE kind = 'owner-credentials' AND recipient = $1
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [superAdminEmail],
  );
  const row = outbox.rows[0] as { recipient: string; body: string } | undefined;
  if (!row) throw new Error('no owner credential was queued for the owner address');
  const password = /Password:\s*(\S+)/.exec(row.body)?.[1];
  if (!password) throw new Error(`the queued message carried no password:\n${row.body}`);
  return { recipient: row.recipient, password };
}

/** A real session token for the owner, taken from a real sign-in. */
async function ownerToken(
  database: Awaited<ReturnType<typeof createMemoryDatabase>>['database'],
  admin: ReturnType<typeof createAdminHandlers>,
) {
  const { password } = await (async () => {
    const outbox = await database.query(
      `SELECT body FROM email_outbox WHERE kind = 'owner-credentials' ORDER BY created_at DESC, id DESC LIMIT 1`,
    );
    const body = String((outbox.rows[0] as { body: string }).body);
    return { password: /Password:\s*(\S+)/.exec(body)![1] };
  })();
  const login = await admin.handle({
    method: 'POST',
    segments: ['session'],
    body: { email: superAdminEmail, password },
  });
  return (login.body as { token: string }).token;
}