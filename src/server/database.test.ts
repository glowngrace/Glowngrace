import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryDatabase } from './database';
import { createHandlers } from './handlers';
import { createApiRouter } from './router';
import { createAdminHandlers } from './admin';
import { rotateOwnerPasswordIfDue } from './admin/owner-password';
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
 * The owner's password is generated and mailed, which is right for production
 * but leaves a machine with no mail host with no way in at all, because the
 * outbox dies with the process. The pinned password is the escape hatch, and it
 * only earns to exist if a hand-chosen one cannot quietly become permanent.
 */
describe('the owner account on a freshly started store', () => {
  const pinned = { OWNER_PINNED_PASSWORD: 'Andy@1983$$' };
  const sevenDaysOut = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    delete process.env.OWNER_PINNED_PASSWORD;
    delete process.env.OWNER_PINNED_HOLD_UNTIL;
  });

  it('signs in with the pinned password', async () => {
    const { database } = createMemoryDatabase();
    Object.assign(process.env, pinned, { OWNER_PINNED_HOLD_UNTIL: sevenDaysOut() });
    const admin = createAdminHandlers(database);
    await admin.seed();

    const login = await admin.handle({ method: 'POST', segments: ['session'], body: { email: superAdminEmail, password: 'Andy@1983$$' } });
    expect(login.status).toBe(201);
  });

  it('refuses a pinned password that was given no expiry', async () => {
    const { database } = createMemoryDatabase();
    Object.assign(process.env, pinned);
    await expect(createAdminHandlers(database).seed()).rejects.toThrow(/hold date is not optional/);
  });

  it('refuses a hold that has already passed, or one further out than a month', async () => {
    const { database } = createMemoryDatabase();
    Object.assign(process.env, pinned, { OWNER_PINNED_HOLD_UNTIL: '2020-01-01T00:00:00Z' });
    await expect(createAdminHandlers(database).seed()).rejects.toThrow(/already passed/);

    const tooFar = createMemoryDatabase().database;
    Object.assign(process.env, { OWNER_PINNED_HOLD_UNTIL: '2099-01-01T00:00:00Z' });
    await expect(createAdminHandlers(tooFar).seed()).rejects.toThrow(/at most 30 days/);
  });

  it('stores the hold so the rotation gives the password back', async () => {
    const { database } = createMemoryDatabase();
    Object.assign(process.env, pinned, { OWNER_PINNED_HOLD_UNTIL: sevenDaysOut() });
    await createAdminHandlers(database).seed();

    const owner = await database.query('SELECT email, password_hold_until FROM admin_users WHERE email = $1', [superAdminEmail]);
    expect(owner.rows[0]?.password_hold_until).toBeInstanceOf(Date);
    // A hold in the future means the account is not due, whatever the rotation
    // stamp says.
    expect((await rotateOwnerPasswordIfDue(database)).rotated).toBe(false);
  });

  it('does not mail a password the operator already has', async () => {
    const { database } = createMemoryDatabase();
    Object.assign(process.env, pinned, { OWNER_PINNED_HOLD_UNTIL: sevenDaysOut() });
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
});