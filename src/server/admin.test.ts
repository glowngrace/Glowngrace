import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminHandlers, publishedDemoAdminEmails, seedAdminData } from './admin';
import { orderItemSeeds } from './admin/seeds';
import { hashPassword, removedDemoPassword, sessionDurationMinutes, sessionExpiry, verifyPassword } from './admin/passwords';
import { retiredSuperAdminEmail, superAdminEmail } from '../auth/roles';
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

// A real session token, which means a real UUID: `admin_sessions.token` is a
// `uuid` column, so a session is refused before it reaches the database unless
// the value looks like one. A fixture of `'bearer-token'` would test the
// rejection path while claiming to test the authenticated one.
const token = '3f1c9a52-8d47-4e6b-9a10-2c5b7e8d4f31';

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

/**
 * The console could lose a product's entire gallery in two different ways: a
 * create never wrote `product_images` at all, and an edit replaced every row with
 * only the files picked in that one session, so adding a single image silently
 * deleted the rest. These tests keep `product_images` as a real table inside the
 * fake, because what matters is which images survive the round trip rather than
 * which statements happened to be issued.
 */
describe('admin product images', () => {
  /** A minimal but genuinely decodable PNG, distinguishable by its last byte. */
  function png(salt: number) {
    const bytes = Buffer.alloc(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    bytes.write('IHDR', 12, 'ascii');
    bytes.writeUInt32BE(1200, 16);
    bytes.writeUInt32BE(1200, 20);
    bytes.writeUInt8(salt, 23);
    return bytes;
  }

  const upload = (filename: string, salt: number) => ({
    filename,
    mimeType: 'image/png' as const,
    data: png(salt).toString('base64'),
    width: 1200,
    height: 1200,
  });

  type StoredImage = { position: number; filename: string; mime_type: string; image_data: Buffer; width: number; height: number };

  function imageDatabase(startWith: StoredImage[] = []) {
    const product = {
      id: 77,
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
    };
    const gallery: StoredImage[] = [...startWith];
    const url = (position: number) => `/api/products/${product.id}/images/${position}`;

    const query = vi.fn(async (text: string, values: unknown[] = []): Promise<QueryResult> => {
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      // Mirrors the `json_agg` the real SELECT builds, so the response body the
      // console reads back reflects what the table actually holds.
      if (text.includes('FROM products AS product')) {
        return { rows: [{ ...product, images: gallery.map((image) => url(image.position)) }], rowCount: 1 };
      }
      // Checked before the read below: this DELETE carries the same FROM clause.
      if (text.includes('DELETE FROM product_images')) {
        gallery.length = 0;
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM product_images WHERE product_id')) return { rows: gallery.map((image) => ({ ...image })), rowCount: gallery.length };
      if (text.includes('INSERT INTO product_images')) {
        gallery.push({
          position: Number(values[1]),
          filename: String(values[2]),
          mime_type: String(values[3]),
          image_data: Buffer.from(String(values[4]), 'base64'),
          width: Number(values[5]),
          height: Number(values[6]),
        });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO products')) return { rows: [{ id: product.id }], rowCount: 1 };
      if (text.includes('UPDATE products')) {
        const setClause = text.slice(text.indexOf('SET '), text.indexOf(' WHERE '));
        // `values[0]` is the id bound to `$1`, so the first SET column is `$2`.
        [...setClause.matchAll(/(\w+) = \$\d+/g)].forEach((match, index) => {
          (product as unknown as Record<string, unknown>)[match[1]] = values[index + 1];
        });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    return { database: { query } satisfies Database, query, gallery, product };
  }

  const stored = (position: number, filename: string, salt: number): StoredImage => ({
    position,
    filename,
    mime_type: 'image/png',
    image_data: png(salt),
    width: 1200,
    height: 1200,
  });

  const details = { name: 'K.B. Compact Powder', category: 'Makeup', price: 649, mrp: 849, stock: 24, description: 'A soft compact powder for an even finish.' };

  it('stores the images uploaded while adding a product', async () => {
    const { database, gallery } = imageDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'POST',
      segments: ['products'],
      body: { ...details, images: [upload('cover.png', 1), upload('angle.png', 2)] },
      token,
    });

    expect(result.status).toBe(201);
    // The bug: the form demanded an image and the server wrote no row at all.
    expect(gallery.map((image) => image.filename)).toEqual(['cover.png', 'angle.png']);
    expect((result.body.product as { images: string[] }).images).toEqual([
      '/api/products/77/images/0',
      '/api/products/77/images/1',
    ]);
  });

  it('refuses an undecodable upload without leaving a product behind', async () => {
    const { database, query, gallery } = imageDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'POST',
      segments: ['products'],
      body: { ...details, images: [{ filename: 'broken.png', mimeType: 'image/png', data: Buffer.from('not a png').toString('base64'), width: 1200, height: 1200 }] },
      token,
    });

    expect(result).toMatchObject({ status: 400, body: { error: 'invalid_product_image' } });
    expect(query.mock.calls.some(([text]) => String(text).includes('INSERT INTO products'))).toBe(false);
    expect(gallery).toHaveLength(0);
  });

  it('keeps the saved gallery when an edit adds one more image', async () => {
    const { database, gallery } = imageDatabase([stored(0, 'cover.png', 1), stored(1, 'angle.png', 2)]);

    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['products', '77'],
      // The console can only re-encode the new file, so it references the two it kept.
      body: { stock: 30, images: ['/api/products/77/images/0', upload('back.png', 3)] },
      token,
    });

    expect(result.status).toBe(200);
    // The bug: only `back.png` survived and the other two were deleted.
    expect(gallery.map((image) => image.filename)).toEqual(['cover.png', 'back.png']);
    expect(gallery[0].image_data.equals(png(1))).toBe(true);
    expect(gallery.map((image) => image.position)).toEqual([0, 1]);
  });

  it('leaves the gallery completely alone when an edit does not touch it', async () => {
    const { database, query, gallery } = imageDatabase([stored(0, 'cover.png', 1), stored(1, 'angle.png', 2)]);

    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['products', '77'],
      body: { price: 599 },
      token,
    });

    expect(result).toMatchObject({ status: 200, body: { product: { price: 599 } } });
    expect(gallery.map((image) => image.filename)).toEqual(['cover.png', 'angle.png']);
    // Nothing rewrites the gallery: reading the product is fine, because its
    // SELECT carries a `product_images` subquery, but no row is fetched for a
    // rewrite and none is written back.
    expect(query.mock.calls.some(([text]) => /DELETE FROM product_images|INSERT INTO product_images|SELECT position, filename/.test(String(text)))).toBe(false);
  });

  it('refuses a reference to an image that is no longer stored, keeping the gallery', async () => {
    const { database, query, gallery } = imageDatabase([stored(0, 'cover.png', 1)]);

    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['products', '77'],
      body: { images: ['/api/products/77/images/7'] },
      token,
    });

    expect(result).toMatchObject({ status: 400, body: { error: 'invalid_product_image' } });
    // Validated before anything is deleted, so a bad reference is not destructive.
    expect(query.mock.calls.some(([text]) => String(text).includes('DELETE FROM product_images'))).toBe(false);
    expect(gallery.map((image) => image.filename)).toEqual(['cover.png']);
  });

  it('empties the gallery only when the console sends an empty set on purpose', async () => {
    const { database, gallery } = imageDatabase([stored(0, 'cover.png', 1), stored(1, 'angle.png', 2)]);

    const result = await createAdminHandlers(database).handle({
      method: 'PATCH',
      segments: ['products', '77'],
      body: { images: [] },
      token,
    });

    expect(result.status).toBe(200);
    expect(gallery).toHaveLength(0);
  });
});

/**
 * The console showed a slug, two SEO fields and two tag lists on the product form
 * for a long time without ever saving them, so these check that each route into
 * the catalogue actually writes them: a single add, a bulk sheet, and an edit.
 */
describe('admin product detail fields', () => {
  const details = { name: 'K.B. Compact Powder', category: 'Makeup', price: 649, mrp: 849, stock: 24, description: 'A soft compact powder for an even finish.' };

  function detailDatabase() {
    const stored: Record<string, unknown> = {
      id: 77, ...details, published: true, featured: false, images: [],
      measurement: '30 ml x 45 mm', material_and_care: 'Glass bottle',
    };
    const query = vi.fn(async (text: string, values: unknown[] = []): Promise<QueryResult> => {
      if (text.includes('FROM admin_sessions')) return { rows: [activeAdminRow], rowCount: 1 };
      if (text.includes('FROM products AS product')) return { rows: [{ ...stored }], rowCount: 1 };
      if (text.includes('INSERT INTO products')) {
        // The column list names every destination, so the bound values are mapped
        // back by name rather than by a fixed index.
        const columns = text.slice(text.indexOf('(') + 1, text.indexOf(')')).split(',').map((name) => name.trim());
        columns.forEach((column, index) => { stored[column] = values[index]; });
        return { rows: [{ id: 77 }], rowCount: 1 };
      }
      if (text.includes('UPDATE products')) {
        const setClause = text.slice(text.indexOf('SET '), text.indexOf(' WHERE '));
        [...setClause.matchAll(/(\w+) = \$\d+/g)].forEach((match, index) => { stored[match[1]] = values[index + 1]; });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    return { database: { query } satisfies Database, query, stored };
  }

  const detail = { slug: 'kb-compact-powder', metaTitle: 'K.B. Compact Powder', metaDescription: 'A soft compact powder for an even finish.', shades: ['Rose Nude', 'Amber Glow'], highlights: ['Long-lasting'] };

  it('saves the slug, SEO fields and tag lists when a product is added', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'POST', segments: ['products'], body: { ...details, ...detail }, token,
    });

    expect(result.status).toBe(201);
    expect(stored).toMatchObject({
      slug: 'kb-compact-powder',
      meta_title: 'K.B. Compact Powder',
      meta_description: 'A soft compact powder for an even finish.',
      // Tags are stored as one comma-separated column, the way `skills` already is.
      shades: 'Rose Nude, Amber Glow',
      highlights: 'Long-lasting',
    });
  });

  it('accepts the same tag lists as one spreadsheet cell during a bulk import', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'POST',
      segments: ['bulk'],
      // A spreadsheet row is all strings, so a cell of "Rose Nude, Amber Glow" is
      // what the template actually delivers for the shades column.
      body: { dataset: 'products', rows: [{ ...details, ...detail, shades: 'Rose Nude, Amber Glow', highlights: 'Long-lasting' }] },
      token,
    });

    expect(result.status).toBe(201);
    expect(stored.shades).toBe('Rose Nude, Amber Glow');
    expect(stored.slug).toBe('kb-compact-powder');
  });

  it('saves an edit that only changes the slug, meta and tag fields', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'PATCH', segments: ['products', '77'], body: { ...detail }, token,
    });

    expect(result.status).toBe(200);
    expect(stored).toMatchObject({
      slug: 'kb-compact-powder',
      meta_title: 'K.B. Compact Powder',
      meta_description: 'A soft compact powder for an even finish.',
      shades: 'Rose Nude, Amber Glow',
      highlights: 'Long-lasting',
    });
  });

  it('leaves a blank slug alone, because most products have none yet', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'PATCH', segments: ['products', '77'], body: { slug: '' }, token,
    });

    expect(result.status).toBe(200);
    expect(stored.slug).toBeNull();
  });

  it('refuses a slug that is not lowercase words joined by hyphens', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'PATCH', segments: ['products', '77'], body: { slug: 'K.B. Compact Powder' }, token,
    });

    expect(result.status).toBe(400);
    expect((result.body.errors as Record<string, string>).slug).toMatch(/lowercase words/i);
    expect(stored.slug).toBeUndefined();
  });

  it('clears the tag lists when they are emptied', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'PATCH', segments: ['products', '77'], body: { shades: [], highlights: [] }, token,
    });

    expect(result.status).toBe(200);
    expect(stored.shades).toBe('');
    expect(stored.highlights).toBe('');
  });

  const information = { featuresAndSpecification: '12% vitamin C\nHyaluronic acid', measurement: '30 ml x 45 mm', materialAndCare: 'Glass bottle', additionalDetails: 'Made in India', itemDetails: 'Item code GG-SKM-1001' };

  it('saves every Product Information section the console can edit', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'POST', segments: ['products'], body: { ...details, ...information }, token,
    });

    expect(result.status).toBe(201);
    expect(stored).toMatchObject({
      // Copy is stored as HTML, so a typed line break is kept as a break.
      features_and_specification: '12% vitamin C<br>Hyaluronic acid',
      measurement: '30 ml x 45 mm',
      material_and_care: 'Glass bottle',
      additional_details: 'Made in India',
      item_details: 'Item code GG-SKM-1001',
    });
  });

  it('blanks a Product Information section instead of keeping stale copy', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'PATCH', segments: ['products', '77'], body: { measurement: '', materialAndCare: '' }, token,
    });

    expect(result.status).toBe(200);
    expect(stored.measurement).toBeNull();
    expect(stored.material_and_care).toBeNull();
  });

  it('strips markup that is not on the allow list before it is stored', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'POST',
      segments: ['products'],
      // A script pasted into a product field must not reach the database.
      body: { ...details, ...information, materialAndCare: 'Glass bottle<script>alert(1)</script><b onclick="x()">Handle with care</b>' },
      token,
    });

    expect(result.status).toBe(201);
    expect(stored.material_and_care).toBe('Glass bottle<b>Handle with care</b>');
  });

  it('refuses an empty description, which the console marks required', async () => {
    const { database } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'POST', segments: ['products'], body: { ...details, description: '   ' }, token,
    });

    expect(result.status).toBe(400);
  });

  it('reads the saved sections back onto the product', async () => {
    const { database } = detailDatabase();

    const result = await createAdminHandlers(database).handle({ method: 'GET', segments: ['products'], token });

    expect(result.status).toBe(200);
    // Snake_case columns have to come back as the camelCase names the form reads.
    const [product] = (result.body.products as Array<Record<string, unknown>>);
    expect(product.measurement).toBe('30 ml x 45 mm');
    expect(product.materialAndCare).toBe('Glass bottle');
  });

  it('carries the Product Information sections through a bulk import', async () => {
    const { database, stored } = detailDatabase();

    const result = await createAdminHandlers(database).handle({
      method: 'POST', segments: ['bulk'], body: { dataset: 'products', rows: [{ ...details, ...information }] }, token,
    });

    expect(result.status).toBe(201);
    expect(stored.material_and_care).toBe('Glass bottle');
    expect(stored.additional_details).toBe('Made in India');
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
      token,
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
      token,
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('wrong_password');
    expect(query.mock.calls.some(([text]) => String(text).includes('UPDATE admin_users'))).toBe(false);
  });
});

describe('admin session lifetime', () => {
  it('expires ten minutes after sign-in and reports the moment to the client', async () => {
    // The exact window is asserted on the helper, where the clock is fixed.
    const issuedAt = new Date('2026-03-01T09:00:00.000Z');
    expect(sessionExpiry(issuedAt).toISOString()).toBe('2026-03-01T09:10:00.000Z');
    expect(sessionDurationMinutes).toBe(10);

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
    expect(lifetime).toBeGreaterThan(9 * 60 * 1000);
    expect(lifetime).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);

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

  it('answers 401 for a token that is not a UUID, without querying with it', async () => {
    // `admin_sessions.token` is a `uuid` column. A stale token in localStorage,
    // a truncated copy or a stray header reached Postgres and raised
    // `invalid input syntax for type uuid` (22P02), which the route caught as a
    // 500 - so a browser that simply needed to sign in again was told the
    // console was broken. Anything that is not a UUID is a failed sign-in.
    const { database, query } = makeDatabase(async () => ({ rows: [], rowCount: 0 }));
    const admin = createAdminHandlers(database);

    for (const bad of ['not.a.jwt', 'bearer-token', '', '  ', '12345', 'null', `${token}x`]) {
      const result = await admin.handle({ method: 'GET', segments: ['me'], token: bad });

      expect(result.status, `"${bad}" should not be a server error`).toBe(401);
      expect(result.body.error).toBe('unauthenticated');
      expect(
        query.mock.calls.filter(([text]) => String(text).includes('admin_sessions')),
        `"${bad}" should never reach the sessions table`,
      ).toEqual([]);
    }
  });

  it('signs out without querying with a token that is not a UUID', async () => {
    // The same malformed token on the way out used to fail the DELETE the same
    // way, so signing out of a console with a damaged session errored too.
    const { database, query } = makeDatabase(async () => ({ rows: [], rowCount: 0 }));
    const admin = createAdminHandlers(database);

    const result = await admin.handle({ method: 'DELETE', segments: ['session'], token: 'not.a.jwt' });

    expect(result.status).toBe(200);
    expect(
      query.mock.calls.filter(([text]) => String(text).includes('DELETE FROM admin_sessions')),
    ).toEqual([]);
  });
});

describe('admin demo seeding', () => {
  it('attaches every sample order line to a product that exists', async () => {
    // The defect: the lines carried a `productId` of 1..8 while `products.id` is
    // declared `START WITH 9`, so every seeded line pointed at a row that was
    // never created. `order_items.product_id` has no foreign key, so nothing
    // complained. The id is now looked up from `products` by `product_name`.
    const { database, query } = makeDatabase(async (text) => (
      text.includes('FROM products WHERE name =') ? { rows: [{ id: 17 }], rowCount: 1 } : { rows: [], rowCount: 1 }
    ));
    await seedAdminData(database);

    const lookup = query.mock.calls.find(([text]) => String(text).includes('FROM products WHERE name ='));
    if (!lookup) throw new Error('The product id was never resolved from the product name.');
    expect(lookup[1]).toEqual(['Velvet Matte Luxe Liquid Lipstick']);

    const line = query.mock.calls.find(([text]) => String(text).includes('INSERT INTO order_items'));
    if (!line) throw new Error('No sample order lines were seeded.');
    const [text, values] = line as [string, unknown[]];
    // The resolved id is passed as a parameter, never a literal baked into the seed.
    expect(text).toContain('SELECT id, $2, $3, $4, $5 FROM orders WHERE order_number = $1');
    expect(values).toEqual([expect.any(String), 17, 'Velvet Matte Luxe Liquid Lipstick', 59900, 2]);
    expect(orderItemSeeds.every((item) => !('productId' in item))).toBe(true);
  });

  it('reports order lines it could not attach instead of dropping them quietly', async () => {
    // Seeding with no catalogue is a real path - it is what the server does on
    // first boot against an empty database. The lines are skipped rather than
    // written against an invented id, and the caller is told which ones.
    const { database, query } = makeDatabase(async (text) => (
      text.includes('FROM products WHERE name =') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 1 }
    ));
    const seeded = await seedAdminData(database);

    expect(seeded.unattachedOrderItems).toHaveLength(16);
    expect(seeded.unattachedOrderItems[0]).toBe('GG-2046 / Velvet Matte Luxe Liquid Lipstick');
    // Nothing was written against a guessed id.
    expect(query.mock.calls.some(([text]) => String(text).includes('INSERT INTO order_items'))).toBe(false);
  });

  it('does not report a line that is already there', async () => {
    // The insert is idempotent, so a second `db:seed` writes nothing. That is a
    // success, not a line that went missing, and must not be reported as one.
    const { database } = makeDatabase(async (text) => (
      text.includes('FROM products WHERE name =') ? { rows: [{ id: 17 }], rowCount: 1 } : { rows: [], rowCount: 0 }
    ));
    const seeded = await seedAdminData(database);

    expect(seeded.unattachedOrderItems).toEqual([]);
  });

  it('seeds the owner account with a generated password nobody chose', async () => {
    const { database, query } = makeDatabase();
    await seedAdminData(database);

    const ownerInsert = query.mock.calls.find(([text, values]) => String(text).includes('INSERT INTO admin_users') && (values as unknown[]).includes(superAdminEmail));
    if (!ownerInsert) throw new Error('The owner account was never seeded.');
    const values = ownerInsert[1] as unknown[];
    expect(values).toContain('Super Admin');
    // The hash is of a generated password, so there is nothing to publish: the
    // owner learns it from the seed mail, and replaces it from the screen.
    const hash = String(values[3]);
    expect(hash.startsWith('scrypt$')).toBe(true);
    // Nothing is stamped, because nothing runs on a clock. The owner holds the
    // password until they choose a different one.
    expect(String(ownerInsert[0])).not.toContain('password_rotated_at');
    expect(String(ownerInsert[0])).not.toContain('password_hold_until');
  });

  it('mails the owner the password the account was created with', async () => {
    // Seeding happens with nobody at the keyboard, so there is no screen to show
    // the first password on and the outbox is the only way it can arrive.
    // Everything after this is replaced from `/superadmin/ggpass`.
    const { database, query } = makeDatabase(async (text, values) => (
      text.includes('INSERT INTO admin_users') && (values as unknown[]).includes(superAdminEmail)
        ? { rows: [], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    ));
    await seedAdminData(database);

    const ownerInsert = query.mock.calls.find(([text, values]) => String(text).includes('INSERT INTO admin_users') && (values as unknown[]).includes(superAdminEmail));
    if (!ownerInsert) throw new Error('The owner account was never seeded.');
    const storedHash = String((ownerInsert[1] as unknown[])[3]);

    const mail = query.mock.calls.find(([text]) => String(text).includes('INSERT INTO email_outbox'));
    if (!mail) throw new Error('The first owner password was never delivered.');
    const [text, values] = mail as [string, unknown[]];
    expect(text).toContain("'owner-credentials'");
    expect(values[0]).toBe(superAdminEmail);
    // The password in the message is the one the stored hash was made from, so
    // the link in it actually signs in.
    const sent = /^Password: (.+)$/m.exec(String(values[2]));
    expect(sent).not.toBeNull();
    expect(await verifyPassword(sent![1], storedHash)).toBe(true);
  });

  it('retires a bootstrap account still sitting on the published password', async () => {
    // An old database can still hold a row anybody can sign in with. It has to be
    // replaced, and the only way to recognise it is by verifying the password:
    // every hash carries its own random salt, so no stored value can be compared.
    const published = await hashPassword('demo123');
    const { database, query } = makeDatabase(async (text) => (
      text.includes('SELECT id, password_hash FROM admin_users')
        ? { rows: [{ id: 'bootstrap-1', password_hash: published }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    ));
    await seedAdminData(database);

    const replacement = query.mock.calls.find(([text]) => String(text).includes('UPDATE admin_users SET password_hash'));
    if (!replacement) throw new Error('The published password was left in place.');
    expect(await verifyPassword('demo123', String((replacement[1] as unknown[])[0]))).toBe(false);
    // Any session opened with it is worthless the moment the hash changes.
    expect(query.mock.calls.some(([text]) => String(text).includes('DELETE FROM admin_sessions WHERE user_id = $1'))).toBe(true);
  });

  it('leaves a bootstrap account an operator has claimed alone', async () => {
    // The seed is replayed on every migration run, so it must not touch a
    // password a person chose.
    const chosen = await hashPassword('a-password-the-operator-chose');
    const { database, query } = makeDatabase(async (text) => (
      text.includes('SELECT id, password_hash FROM admin_users')
        ? { rows: [{ id: 'bootstrap-1', password_hash: chosen }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    ));
    await seedAdminData(database);

    expect(query.mock.calls.some(([text]) => String(text).includes('UPDATE admin_users SET password_hash'))).toBe(false);
  });

  it('does not re-mail the first owner password on a later boot', async () => {
    // The insert conflicts, so the account kept the password it already had.
    const { database, query } = makeDatabase(async (text, values) => (
      text.includes('INSERT INTO admin_users') && (values as unknown[]).includes(superAdminEmail)
        ? { rows: [], rowCount: 0 }
        : { rows: [], rowCount: 0 }
    ));
    await seedAdminData(database);

    const mail = query.mock.calls.find(([text]) => String(text).includes('INSERT INTO email_outbox') && String(text).includes('owner-credentials'));
    expect(mail).toBeUndefined();
  });

  it('leaves an account nobody named out of the seed entirely', async () => {
    const { database, query } = makeDatabase();
    await seedAdminData(database);

    // The seeded rows are the storefront's own sample content plus the two
    // bootstrap accounts. No colleague is created for anybody to sign in as.
    const seededAddresses = query.mock.calls
      .filter(([text]) => String(text).includes('INSERT INTO admin_users'))
      .map(([text, values]) => [
        ...String(text).match(/[a-z0-9._-]+@[a-z0-9.]+/gi) ?? [],
        ...(values as unknown[]).filter((value): value is string => typeof value === 'string' && value.includes('@')),
      ])
      .flat();
    expect(seededAddresses).toEqual(expect.arrayContaining(['admin@glowngrace.in', superAdminEmail]));
    for (const address of ['deepak@glowngrace.in', 'aditi@glowngrace.in', 'rohit@glowngrace.in', 'neha@glowngrace.in', 'karan@glowngrace.in']) {
      expect(seededAddresses).not.toContain(address);
    }
  });

  it('deletes a seeded colleague that is still on the published password', async () => {
    // The shape production was in: four rows nobody had claimed, and one an
    // operator had already taken over.
    const demoHash = await hashPassword(removedDemoPassword);
    const claimedHash = await hashPassword('a-password-deepak-chose');
    const rows = new Map<string, { id: string; email: string; password_hash: string }>([
      ['deepak@glowngrace.in', { id: 'user-deepak', email: 'deepak@glowngrace.in', password_hash: claimedHash }],
      ['aditi@glowngrace.in', { id: 'user-aditi', email: 'aditi@glowngrace.in', password_hash: demoHash }],
      ['rohit@glowngrace.in', { id: 'user-rohit', email: 'rohit@glowngrace.in', password_hash: demoHash }],
      ['neha@glowngrace.in', { id: 'user-neha', email: 'neha@glowngrace.in', password_hash: demoHash }],
      ['karan@glowngrace.in', { id: 'user-karan', email: 'karan@glowngrace.in', password_hash: demoHash }],
    ]);
    const deleted: string[] = [];
    const sessionsCleared: string[] = [];
    const { database } = makeDatabase(async (text, values) => {
      if (text.includes('SELECT id, password_hash FROM admin_users WHERE email = $1')) {
        const row = rows.get(String(values[0]));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (text.includes('DELETE FROM admin_users')) {
        deleted.push(String(values[0]));
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('DELETE FROM admin_sessions WHERE user_id = $1')) {
        sessionsCleared.push(String(values[0]));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await seedAdminData(database);

    // The four unclaimed rows go, and every one of their sessions with them.
    expect(deleted).toEqual(['user-aditi', 'user-rohit', 'user-neha', 'user-karan']);
    expect(sessionsCleared).toEqual(expect.arrayContaining(['user-aditi', 'user-rohit', 'user-neha', 'user-karan']));
    // The claimed account is not touched, and it keeps the password its owner set.
    // This is the whole reason the deletion is a per-row check and not an `IN`
    // clause: deepak@glowngrace.in was real on production.
    expect(deleted).not.toContain('user-deepak');
    expect(rows.get('deepak@glowngrace.in')?.password_hash).toBe(claimedHash);
    expect(await verifyPassword('a-password-deepak-chose', String(rows.get('deepak@glowngrace.in')?.password_hash))).toBe(true);
  });

  it('leaves every seeded colleague alone once they all hold a real password', async () => {
    const claimedHash = await hashPassword('a-password-somebody-chose');
    const rows = new Map<string, { id: string; email: string; password_hash: string }>(publishedDemoAdminEmails.map((email, index) => [
      email,
      { id: `user-${index}`, email, password_hash: claimedHash },
    ]));
    const deleted: string[] = [];
    const { database } = makeDatabase(async (text, values) => {
      if (text.includes('SELECT id, password_hash FROM admin_users WHERE email = $1')) {
        const row = rows.get(String(values[0]));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (text.includes('DELETE FROM admin_users')) {
        deleted.push(String(values[0]));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await seedAdminData(database);

    expect(deleted).toEqual([]);
  });

  it('writes payment_method in the column slot the orders constraint checks', async () => {    const { database, query } = makeDatabase();
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

  it('holds recovery to the same password policy as every other form', async () => {
    // Recovery used to accept the published sample password, which was 7
    // characters against a minimum of 8. There is no published credential left
    // to restore, so the exemption is gone and a short password is refused.
    const { database, rows } = recoveryConsole([{ ...memberRow }]);
    const admin = createAdminHandlers(database);

    const rejected = await admin.handle({
      method: 'POST',
      segments: ['users', String(memberRow.id), 'password'],
      body: { currentPassword: 'anything-long-enough', newPassword: 'short' },
      token,
    });
    expect(rejected.status).toBe(400);

    const accepted = await admin.handle({
      method: 'POST',
      segments: ['users', String(memberRow.id), 'recover'],
      body: { newPassword: 'short' },
      token,
    });
    expect(accepted.status).toBe(400);
    expect(accepted.body.message).toContain('Use at least 8 characters.');

    const worked = await admin.handle({
      method: 'POST',
      segments: ['users', String(memberRow.id), 'recover'],
      body: { newPassword: 'recovered-2026' },
      token,
    });
    expect(worked.status).toBe(200);
    const { verifyPassword } = await import('./admin/passwords');
    expect(await verifyPassword('recovered-2026', String(rows[0].password_hash))).toBe(true);
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

  it('refuses a password that is too short', async () => {
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
    expect(result.body.message).toContain('Use at least 8 characters.');
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
      body: { newPassword: 'recovered-2026' },
      token,
    });

    expect(result.status).toBe(200);
    expect(result.body.message).toBe('Password reset for all 3 console accounts. Everyone has been signed out.');
    const { verifyPassword } = await import('./admin/passwords');
    for (const row of rows) {
      expect(await verifyPassword('recovered-2026', String(row.password_hash))).toBe(true);
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

  it('holds a redeemed password to the ordinary policy, including the removed sample password', async () => {
    // The published sample password used to be eight characters, so length alone
    // would have accepted it. A link emailed to a person may not set it, because
    // anyone who read an old README could guess it.
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

describe('public role-based registration', () => {
  const seededAdmin = activeAdminRow;

  /**
   * A console with a single account and no session, because registration is
   * reached by somebody who has never signed in.
   */
  function signupConsole() {
    // A console that is already seeded, so the owner account exists and the seed
    // does not treat this boot as the moment the owner password was issued.
    const rows: Array<Record<string, unknown>> = [
      { ...seededAdmin },
      { ...seededAdmin, id: '00000000-0000-4000-8000-0000000000f1', name: 'Glow & Grace Super Admin', email: superAdminEmail, role: 'Super Admin' },
    ];
    const outbox: Array<{ recipient: string; subject: string; body: string }> = [];
    const queries: string[] = [];
    const { database } = makeDatabase(async (text, values) => {
      queries.push(text);
      if (text.includes('INSERT INTO email_outbox')) {
        outbox.push({ recipient: String(values[0]), subject: String(values[1]), body: String(values[2]) });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO admin_users')) {
        // `ON CONFLICT (email) DO NOTHING` reports the row count it changed, so
        // an address that is already there creates nothing.
        if (rows.some((row) => row.email === values[1])) return { rows: [], rowCount: 0 };
        const created = {
          ...seededAdmin,
          id: '00000000-0000-4000-8000-00000000000a',
          name: values[0],
          email: values[1],
          role: values[2],
          password_hash: values[3],
          phone: values[4] === '' ? null : values[4],
          avatar: '',
          status: 'Pending',
          source: 'signup',
          reviewed_at: null,
        };
        rows.push(created);
        return { rows: [created], rowCount: 1 };
      }
      if (text.includes('FROM admin_users WHERE email')) {
        const match = rows.find((row) => row.email === values[0]);
        return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
      }
      if (text.includes('FROM admin_sessions')) return { rows: [seededAdmin], rowCount: 1 };
      if (text.includes('FROM admin_users')) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    });
    return { database, rows, outbox, queries };
  }

  const validSignup = {
    name: 'Reha Qureshi',
    email: 'Reha@Example.com',
    role: 'Candidate',
    password: 'a-good-password',
  };

  it('creates a Pending account and mints no session', async () => {
    const { database, rows } = signupConsole();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({ method: 'POST', segments: ['signup'], body: validSignup });

    expect(result.status).toBe(201);
    const user = result.body.user as { status: string; source: string; email: string; role: string };
    expect(user.status).toBe('Pending');
    expect(user.source).toBe('signup');
    // The address is keyed in lower case, the way sign-in and the unique index
    // both look it up.
    expect(user.email).toBe('reha@example.com');
    expect(user.role).toBe('Candidate');

    // Pending means the account cannot sign in, and the row must exist for an
    // administrator to be able to review it.
    const created = rows.find((row) => row.email === 'reha@example.com');
    expect(created).toBeDefined();
    const { verifyPassword } = await import('./admin/passwords');
    expect(await verifyPassword('a-good-password', String(created?.password_hash))).toBe(true);
  });

  it('leaves a registered account unable to sign in until it is approved', async () => {
    const { database } = signupConsole();
    const admin = createAdminHandlers(database);
    await admin.handle({ method: 'POST', segments: ['signup'], body: validSignup });

    const signIn = await admin.handle({
      method: 'POST',
      segments: ['session'],
      body: { email: 'reha@example.com', password: 'a-good-password' },
    });

    // The whole point of the Pending status: a request is a claim, never a grant.
    expect(signIn.status).toBe(401);
    expect(signIn.body.error).toBe('invalid_credentials');
  });

  it('reaches registration without a session', async () => {
    const { database, queries } = signupConsole();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({ method: 'POST', segments: ['signup'], body: validSignup });

    expect(result.status).toBe(201);
    expect(queries.some((query) => query.includes('FROM admin_sessions WHERE token = $1'))).toBe(false);
  });

  it('leaves the request in the outbox so an administrator knows it arrived', async () => {
    const { database, outbox } = signupConsole();
    const admin = createAdminHandlers(database);
    await admin.handle({ method: 'POST', segments: ['signup'], body: { ...validSignup, phone: '9876543210' } });

    expect(outbox).toHaveLength(1);
    expect(outbox[0].recipient).toBe('reha@example.com');
    expect(outbox[0].body).toContain('Candidate');
    expect(outbox[0].body).toContain('cannot sign in');
  });

  it('accepts a portal role and refuses a console one', async () => {
    const { database } = signupConsole();
    const admin = createAdminHandlers(database);
    for (const role of ['Customer', 'Candidate', 'Partner Salon']) {
      const result = await admin.handle({
        method: 'POST',
        segments: ['signup'],
        body: { ...validSignup, email: `${role.replaceAll(/\s+/g, '-').toLowerCase()}@example.com`, role },
      });
      expect(result.status).toBe(201);
    }
    // A back-office role is a grant, not a request. Accepting one here would let
    // anybody put "Super Admin" in the approval queue.
    for (const role of ['Super Admin', 'Store Administrator', 'Placement Coordinator']) {
      const refused = await admin.handle({
        method: 'POST',
        segments: ['signup'],
        body: { ...validSignup, email: `${role.replaceAll(/\s+/g, '-').toLowerCase()}@example.com`, role },
      });
      expect(refused.status).toBe(400);
      expect(refused.body.error).toBe('invalid_signup');
    }
  });

  it('refuses a role that is not on the published list', async () => {
    const { database, rows } = signupConsole();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['signup'],
      body: { ...validSignup, role: 'Owner' },
    });

    // Otherwise anybody could register themselves as whatever they liked.
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_signup');
    expect(rows.map((row) => row.email)).not.toContain('reha@example.com');
  });

  it('refuses a status in the request body, because the caller does not choose one', async () => {
    const { database, rows } = signupConsole();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({
      method: 'POST',
      segments: ['signup'],
      body: { ...validSignup, status: 'Active' },
    });

    // The account is Pending whatever was asked for, so the status is stripped
    // rather than trusted.
    expect(result.status).toBe(201);
    const created = rows.find((row) => row.email === 'reha@example.com');
    expect(created?.status).toBe('Pending');
  });

  it('says an address is taken, and points at signing in', async () => {
    const { database } = signupConsole();
    const admin = createAdminHandlers(database);
    await admin.handle({ method: 'POST', segments: ['signup'], body: validSignup });
    const again = await admin.handle({ method: 'POST', segments: ['signup'], body: validSignup });

    // Unlike the forgot-password route this names the clash: it is the visitor's
    // own address, and "sign in instead" is the useful answer.
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('duplicate_email');
    expect(again.body.message).toContain('Sign in instead');
  });

  it('holds a weak password and a missing field to the same standard as sign-in', async () => {
    const { database } = signupConsole();
    const admin = createAdminHandlers(database);

    const weak = await admin.handle({ method: 'POST', segments: ['signup'], body: { ...validSignup, password: 'short' } });
    expect(weak.status).toBe(400);
    // The complaint belongs beside the field, not only in the summary.
    expect((weak.body.errors as Record<string, string>).password).toContain('Use at least 8 characters.');

    const nameless = await admin.handle({ method: 'POST', segments: ['signup'], body: { ...validSignup, name: '' } });
    expect(nameless.status).toBe(400);
    expect(nameless.body.error).toBe('invalid_signup');

    const anonymous = await admin.handle({ method: 'POST', segments: ['signup'], body: { email: 'x@example.com', password: 'a-good-password' } });
    expect(anonymous.status).toBe(400);
  });

  it('refuses to be read', async () => {
    const { database } = signupConsole();
    const admin = createAdminHandlers(database);
    const result = await admin.handle({ method: 'GET', segments: ['signup'] });
    expect(result.status).toBe(405);
  });
});

describe('owner account protection', () => {
  const ownerId = '00000000-0000-4000-8000-0000000000f1';
  const operatorRow = { ...activeAdminRow, id: '00000000-0000-4000-8000-000000000002', email: 'operator@glowngrace.in' };

  /**
   * A console of two accounts: the operator making the request, and the owner
   * account they are trying to get rid of.
   */
  function ownerConsole() {
    const rows = [operatorRow, { ...activeAdminRow, id: ownerId, name: 'Glow & Grace Super Admin', email: superAdminEmail, role: 'Super Admin' }];
    const deleted: string[] = [];
    const { database } = makeDatabase(async (text, values) => {
      if (text.includes('FROM admin_sessions')) return { rows: [operatorRow], rowCount: 1 };
      if (text.includes('SELECT 1 FROM admin_users WHERE id = $1 AND email = $2')) {
        const match = rows.find((row) => row.id === values[0] && row.email === values[1]);
        return { rows: match ? [{ ok: 1 }] : [], rowCount: match ? 1 : 0 };
      }
      if (text.includes('DELETE FROM admin_users')) {
        deleted.push(String(values[0]));
        return { rows: [{ id: values[0] }], rowCount: 1 };
      }
      if (text.includes('UPDATE admin_users SET')) {
        const target = rows.find((row) => row.id === values[0]);
        if (!target) return { rows: [], rowCount: 0 };
        // The set clause names the columns, and the values follow the id in the
        // same order, so the two are read together.
        const assigned = (text.match(/SET (.*?) WHERE id = \$1/s)?.[1] ?? '').split(',').map((entry) => entry.trim().split(' ')[0]);
        const columns: Record<string, unknown> = {};
        assigned.forEach((column, position) => { columns[column] = values[position + 1]; });
        if (typeof columns.role === 'string') target.role = columns.role;
        if (typeof columns.name === 'string') target.name = columns.name;
        return { rows: [target], rowCount: 1 };
      }
      if (text.includes('FROM admin_users')) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    });
    return { database, rows, deleted };
  }

  it('refuses to delete the owner account, however the request arrives', async () => {
    const { database, deleted } = ownerConsole();
    const admin = createAdminHandlers(database);

    const result = await admin.handle({ method: 'DELETE', segments: ['users', ownerId], token });

    // This is the only account that can replace every other credential, so a
    // console session cannot remove it.
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('owner_protected');
    expect(deleted).toEqual([]);
  });

  it('refuses to move the owner account to another role', async () => {
    const { database, rows } = ownerConsole();
    const admin = createAdminHandlers(database);

    const result = await admin.handle({ method: 'PATCH', segments: ['users', ownerId], body: { role: 'Store Manager' }, token });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('owner_protected');
    expect(rows.find((row) => row.id === ownerId)?.role).toBe('Super Admin');
  });

  it('still lets the owner name be corrected, because that is not a grant', async () => {
    const { database, rows } = ownerConsole();
    const admin = createAdminHandlers(database);

    const result = await admin.handle({ method: 'PATCH', segments: ['users', ownerId], body: { name: 'Super Admin' }, token });

    expect(result.status).toBe(200);
    expect(rows.find((row) => row.id === ownerId)?.name).toBe('Super Admin');
  });

  it('deletes an ordinary team member as before', async () => {
    const { database, deleted } = ownerConsole();
    const admin = createAdminHandlers(database);
    const colleague = '00000000-0000-4000-8000-000000000003';

    const result = await admin.handle({ method: 'DELETE', segments: ['users', colleague], token });

    // The protection is on the owner account alone, not a general freeze.
    expect(result.status).toBe(200);
    expect(deleted).toEqual([colleague]);
  });

  it('does not protect an account still sitting on the address the owner used to be spelled with', async () => {
    // The owner address was misspelled until this branch. Nothing renames a row now,
    // because nothing outlives a restart, but if an account is still sitting on the
    // old spelling then that
    // account is an ordinary team member: it is not the way back in when the owner
    // password is lost, so it must not be mistaken for one and
    // protected from the cleanup it needs.
    const { database, deleted, rows } = ownerConsole();
    rows[1].email = retiredSuperAdminEmail;
    const admin = createAdminHandlers(database);

    const result = await admin.handle({ method: 'DELETE', segments: ['users', ownerId], token });

    expect(result.status).toBe(200);
    expect(deleted).toEqual([ownerId]);
    // And the misspelling is exactly what makes it a different account, so this
    // test cannot pass just because the protection was switched off.
    expect(retiredSuperAdminEmail).not.toBe(superAdminEmail);
  });
});

describe('the local database route', () => {
  const saved = { ...process.env };
  const ownerRow = { ...activeAdminRow, id: '00000000-0000-4000-8000-0000000000f1', name: 'Glow & Grace Super Admin', email: superAdminEmail, role: 'Super Admin' };

  /**
   * A console session whose `admin_sessions` lookup answers with one row, and a
   * switch that decides whether this process is allowed to reach for production
   * at all.
   */
function consoleFor(row: Record<string, unknown>, overrides: Record<string, string | undefined> = {}) {
    for (const key of ['USE_LOCAL_DATABASE', 'SYNC_FROM_PRODUCTION', 'DATABASE_URL', 'NEON_DATABASE_URL', 'DATABASE_SSL', 'LOCAL_DATABASE_SSL', 'NEON_PROJECT_NAME']) {
      delete process.env[key];
    }
    // `process.env` turns an explicit `undefined` into the string "undefined", so
    // an absent override is spelled as a delete rather than an assignment.
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.env.USE_LOCAL_DATABASE = 'USE_LOCAL_DATABASE' in overrides ? overrides.USE_LOCAL_DATABASE! : 'true';
    process.env.SYNC_FROM_PRODUCTION = 'SYNC_FROM_PRODUCTION' in overrides ? overrides.SYNC_FROM_PRODUCTION! : 'true';
    process.env.DATABASE_URL = overrides.DATABASE_URL ?? 'postgresql://glow_grace:secret@localhost:5435/glow_grace';
    process.env.LOCAL_DATABASE_SSL = 'disable';
    const { database } = makeDatabase(async (text) => {
      if (text.includes('FROM admin_sessions')) return { rows: [row], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    return createAdminHandlers(database);
  }

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in saved)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  });

  it('is not there at all when the sync has not been turned on', async () => {
    // 404 rather than 403: a deployment that never opted in should not be carrying
    // an endpoint that reaches for production, not merely hiding it from the UI.
    const admin = consoleFor(ownerRow, { SYNC_FROM_PRODUCTION: undefined });
    const result = await admin.handle({ method: 'GET', segments: ['local-db'], token });
    expect(result.status).toBe(404);
  });

  it('is not there when the process is not running against the local database', async () => {
    const admin = consoleFor(ownerRow, { USE_LOCAL_DATABASE: 'false' });
    const result = await admin.handle({ method: 'GET', segments: ['local-db'], token });
    expect(result.status).toBe(404);
  });

  it('refuses anyone who is not the owner', async () => {
    const admin = consoleFor(activeAdminRow);
    const result = await admin.handle({ method: 'GET', segments: ['local-db'], token });
    expect(result.status).toBe(403);
    expect((result.body as { error?: string }).error).toBe('forbidden');
  });

  it('needs a session', async () => {
    const admin = consoleFor(ownerRow);
    const result = await admin.handle({ method: 'GET', segments: ['local-db'], token: undefined });
    expect(result.status).toBe(401);
  });

  it('reports both databases to the owner without printing a password', async () => {
    const admin = consoleFor(ownerRow, {
      NEON_DATABASE_URL: 'postgresql://neon_user:hunter2@ep-cool-pooler.aws-ap-southeast-2.neon.tech/neondb?sslmode=require',
      NEON_PROJECT_NAME: 'neon-glowngraceproddb',
    });
    const result = await admin.handle({ method: 'GET', segments: ['local-db'], token });

    expect(result.status).toBe(200);
    const body = result.body as {
      store: string;
      local: { connection: string } | { error: string };
      neon: { configured: boolean; project: string | null; host?: string; connection?: string; reason?: string };
      syncEnabled: boolean;
    };
    expect(body.store).toBe('memory');
    expect(body.local).toEqual({ connection: expect.stringContaining('localhost:5435') });
    expect(body.neon.configured).toBe(true);
    expect(body.neon.project).toBe('neon-glowngraceproddb');
    expect(body.neon.host).toBe(`e${'*'.repeat('p-cool-pooler'.length)}.aws-ap-southeast-2.neon.tech`);
    expect(body.neon.connection).toContain('ssl=require');
    expect(body.syncEnabled).toBe(true);
    // The string the console renders. A password in here would end up in a
    // screenshot in a bug report.
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(JSON.stringify(body)).not.toContain('secret@');
  });

  it('says so plainly when no production database is configured', async () => {
    // A fresh clone has no Neon connection string yet, and the button needs an
    // explanation rather than a stack trace.
    const admin = consoleFor(ownerRow, { NEON_DATABASE_URL: undefined });
    const result = await admin.handle({ method: 'GET', segments: ['local-db'], token });

    expect(result.status).toBe(200);
    const body = result.body as { neon: { configured: boolean; reason?: string } };
    expect(body.neon.configured).toBe(false);
    expect(body.neon.reason).toMatch(/No production database connection string is configured/);
  });

  it('will not let the report be written to', async () => {
    const admin = consoleFor(ownerRow);
    const result = await admin.handle({ method: 'PUT', segments: ['local-db'], token });
    expect(result.status).toBe(405);
  });

  it('will only sync on a POST', async () => {
    const admin = consoleFor(ownerRow);
    const result = await admin.handle({ method: 'GET', segments: ['local-db', 'sync'], token });
    expect(result.status).toBe(405);
  });

  it('rejects switches that are not booleans before opening a connection', async () => {
    const admin = consoleFor(ownerRow);
    const result = await admin.handle({
      method: 'POST',
      segments: ['local-db', 'sync'],
      token,
      body: { skipImages: 'yes' },
    });
    expect(result.status).toBe(400);
    expect((result.body as { error?: string }).error).toBe('invalid_request');
  });

it('answers 503 when the owner presses the button with nothing to copy from', async () => {
    const admin = consoleFor(ownerRow, { NEON_DATABASE_URL: undefined });
    const result = await admin.handle({ method: 'POST', segments: ['local-db', 'sync'], token, body: {} });
    expect(result.status).toBe(503);
    expect((result.body as { error?: string }).error).toBe('database_not_configured');
  });
});

describe('the two owner password endpoints', () => {
  const ownerRow = { ...activeAdminRow, id: '00000000-0000-4000-8000-0000000000f1', name: 'Glow & Grace Super Admin', email: superAdminEmail, role: 'Super Admin' };

  /**
   * A console session answering as `row`, plus a database that recognises the
   * owner account when the save goes looking for it.
   */
  function consoleFor(row: Record<string, unknown>, ownerExists = true) {
    const { database, query } = makeDatabase(async (text) => {
      // Before the session lookup: `DELETE FROM admin_sessions WHERE user_id`
      // contains `FROM admin_sessions` too, and would otherwise answer as the
      // signed-in user.
      if (text.includes('DELETE FROM admin_sessions WHERE user_id')) return { rows: [], rowCount: 3 };
      if (text.includes('FROM admin_sessions')) return { rows: [row], rowCount: 1 };
      if (text.includes('FROM admin_users WHERE email = $1')) {
        return ownerExists
          ? { rows: [{ id: ownerRow.id, email: superAdminEmail, role: 'Super Admin' }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
    return { admin: createAdminHandlers(database), query };
  }

  /** The plaintext out of a generated response, for the save half of a round trip. */
  function generated(result: { status: number; body: unknown }) {
    expect(result.status).toBe(200);
    return (result.body as { generated: true; password: string }).password;
  }

  describe('generating', () => {
    it('hands a password back to the owner without touching the credential', async () => {
      const { admin, query } = consoleFor(ownerRow);
      const password = generated(await admin.handle({ method: 'POST', segments: ['owner-password', 'generate'], token }));

      expect(password).toMatch(/^[A-Za-z0-9]{8}$/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);

      // The whole reason this is a separate request. No credential is written and
      // nobody is signed out until the owner presses save, so a closed tab or a
      // second look costs nobody their access.
      expect(query.mock.calls.some(([text]) => String(text).includes('SET password_hash'))).toBe(false);
      expect(query.mock.calls.some(([text]) => String(text).includes('DELETE FROM admin_sessions'))).toBe(false);
      expect(query.mock.calls.some(([text]) => String(text).includes('INSERT INTO email_outbox'))).toBe(false);
    });

    it('records the moment, so an untouched account can be told from an abandoned one', async () => {
      // What a generate is allowed to write: not a password, never a password, but
      // the fact that one was offered. Without it a deployment cannot tell the
      // difference between an owner who never opened this screen and one who
      // generated a password, closed the tab, and left the old one in place.
      const { admin, query } = consoleFor(ownerRow);
      await admin.handle({ method: 'POST', segments: ['owner-password', 'generate'], token });

      const stamped = query.mock.calls.find(([text]) => String(text).includes('password_generated_at = $1'));
      expect(stamped).toBeDefined();
      expect((stamped![1] as unknown[])[1]).toBe(ownerRow.id);

      const event = query.mock.calls.find(([text]) => String(text).includes('INSERT INTO owner_password_events'));
      expect(event).toBeDefined();
      expect(String(event![0])).toContain("'generated'");
      expect((event![1] as unknown[])[0]).toBe(ownerRow.id);
    });

    it('gives a different one every time, because a repeat is useless to a locked-out owner', async () => {
      const seen = new Set<string>();
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const { admin } = consoleFor(ownerRow);
        seen.add(generated(await admin.handle({ method: 'POST', segments: ['owner-password', 'generate'], token })));
      }
      expect(seen.size).toBe(6);
    });

    it('returns the password only to the account it belongs to', async () => {
      const { admin } = consoleFor(ownerRow);
      const result = await admin.handle({ method: 'POST', segments: ['owner-password', 'generate'], token });
      const body = result.body as Record<string, unknown>;

      expect(Object.keys(body).sort()).toEqual(['email', 'generated', 'password']);
      // The address is echoed so the page can say where the password is going,
      // and it has to be the caller's own.
      expect(body.email).toBe(superAdminEmail);
    });

    it('refuses anybody who is not the owner account', async () => {
      // The gate that counts. The page hides the button from other roles, but a
      // hidden button is not access control - this has to hold for a direct POST
      // from anything signed in as somebody else.
      for (const row of [
        activeAdminRow,
        { ...activeAdminRow, role: 'Content Editor' },
        { ...activeAdminRow, role: 'Candidate' },
      ]) {
        const { admin, query } = consoleFor(row);
        const result = await admin.handle({ method: 'POST', segments: ['owner-password', 'generate'], token });

        expect(result.status).toBe(403);
        expect((result.body as { error?: string }).error).toBe('forbidden');
        // Nothing was written.
        expect(query.mock.calls.some(([text]) => String(text).includes('SET password_hash'))).toBe(false);
      }
    });

    it('needs a session', async () => {
      const { admin } = consoleFor(ownerRow);
      const result = await admin.handle({ method: 'POST', segments: ['owner-password', 'generate'], token: undefined });
      expect(result.status).toBe(401);
    });

    it('will only generate on a POST', async () => {
      const { admin } = consoleFor(ownerRow);
      const result = await admin.handle({ method: 'GET', segments: ['owner-password', 'generate'], token });

      expect(result.status).toBe(405);
    });
  });

  describe('saving', () => {
    it('hashes what it was given, ends every session and confirms the address', async () => {
      const { admin, query } = consoleFor(ownerRow);
      const result = await admin.handle({
        method: 'POST',
        segments: ['owner-password', 'save'],
        body: { password: 'Mango9Tr' },
        token,
      });

      expect(result.status).toBe(200);
      const body = result.body as { saved: boolean; email: string; sessionsRevoked: number };
      expect(body.saved).toBe(true);
      expect(body.email).toBe(superAdminEmail);
      expect(body.sessionsRevoked).toBe(3);

      const hash = query.mock.calls.find(([text]) => String(text).includes('SET password_hash = $1'));
      expect(hash).toBeDefined();
      // A hash, never the value that came off the screen. The plaintext has nowhere
      // else to live: the session is being torn down the same moment.
      expect(String((hash![1] as unknown[])[0])).toMatch(/^scrypt\$/);
      expect(String((hash![1] as unknown[])[0])).not.toContain('Mango');

      const revoke = query.mock.calls.find(([text]) => String(text).includes('DELETE FROM admin_sessions WHERE user_id = $1'));
      expect(revoke).toBeDefined();
      expect((revoke![1] as unknown[])[0]).toBe(ownerRow.id);

      // The change is stamped on the row as well as hashed into it, so "when did
      // this password start working" is answerable without reading a log.
      const changed = query.mock.calls.find(([text]) => String(text).includes('password_changed_at = $2'));
      expect(changed).toBeDefined();
      expect((changed![1] as unknown[])[2]).toBe(ownerRow.id);

      const event = query.mock.calls.find(([text]) => String(text).includes('INSERT INTO owner_password_events'));
      expect(event).toBeDefined();
      expect(String(event![0])).toContain("'saved'");
      expect((event![1] as unknown[])[0]).toBe(ownerRow.id);

      const mail = query.mock.calls.find(([text]) => String(text).includes('INSERT INTO email_outbox'));
      expect(mail).toBeDefined();
      expect((mail![1] as unknown[])[0]).toBe(superAdminEmail);
    });

    it('confirms to the owner address without carrying the password', async () => {
      // The one mail in the project with no working credential in it. This is what
      // makes it safe to say out loud that the password was changed, and it is why
      // the page can drop the value once the save is through.
      const { admin, query } = consoleFor(ownerRow);
      await admin.handle({ method: 'POST', segments: ['owner-password', 'save'], body: { password: 'Mango9Tr' }, token });

      const mail = query.mock.calls.find(([text]) => String(text).includes('INSERT INTO email_outbox'));
      const [recipient, subject, body] = mail![1] as unknown[];
      // The kind is in the statement, not the parameters, so it is checked there.
      expect(String(mail![0])).toContain("'owner-password-saved'");
      expect(recipient).toBe(superAdminEmail);
      expect(String(subject)).toContain('saved');
      expect(String(body)).not.toContain('Mango');
      expect(String(body)).not.toMatch(/Password:\s*\S/);
    });

    it('accepts any value on the owner policy, because the screen is what checks it', async () => {
      // The screen will only save what it generated, pasted back - but the server
      // never sees the generated value, so all it can hold the body to is the
      // policy. This is the path the owner takes with the value they copied.
      const { admin, query } = consoleFor(ownerRow);
      const result = await admin.handle({
        method: 'POST',
        segments: ['owner-password', 'save'],
        body: { password: 'Mango9Tr' },
        token,
      });

      expect(result.status).toBe(200);
      const hash = query.mock.calls.find(([text]) => String(text).includes('SET password_hash = $1'));
      expect(hash).toBeDefined();
    });

    it('refuses anything outside the owner policy, and writes nothing', async () => {
      // Otherwise the owner could save a password the screen would not have offered
      // them, and lock themselves out on the account with no way to recover it. The
      // owner holds to eight letters and numbers - the words under the field - rather
      // than to the shared length-only policy every other password uses, because
      // this is the one value the screen shows once and never again.
      for (const password of ['short', 'Mango!T9', 'M'.repeat(129)]) {
        const { admin, query } = consoleFor(ownerRow);
        const result = await admin.handle({
          method: 'POST',
          segments: ['owner-password', 'save'],
          body: { password },
          token,
        });

        expect(result.status).toBe(400);
        expect((result.body as { error?: string }).error).toBe('invalid_password');
        expect((result.body as { message?: string }).message).toBe('Password must be exactly 8 letters or numbers.');
        expect(query.mock.calls.some(([text]) => String(text).includes('SET password_hash'))).toBe(false);
        // And nobody was signed out for a refused change.
        expect(query.mock.calls.some(([text]) => String(text).includes('DELETE FROM admin_sessions'))).toBe(false);
      }
    });

    it('refuses anybody who is not the owner account', async () => {
      for (const row of [
        activeAdminRow,
        { ...activeAdminRow, role: 'Content Editor' },
      ]) {
        const { admin, query } = consoleFor(row);
        const result = await admin.handle({
          method: 'POST',
          segments: ['owner-password', 'save'],
          body: { password: 'Mango9Tr' },
          token,
        });

        expect(result.status).toBe(403);
        expect(query.mock.calls.some(([text]) => String(text).includes('SET password_hash'))).toBe(false);
      }
    });

    it('needs a session', async () => {
      const { admin } = consoleFor(ownerRow);
      const result = await admin.handle({
        method: 'POST',
        segments: ['owner-password', 'save'],
        body: { password: 'Mango9Tr' },
        token: undefined,
      });
      expect(result.status).toBe(401);
    });

    it('will only save on a POST', async () => {
      const { admin } = consoleFor(ownerRow);
      const result = await admin.handle({
        method: 'GET',
        segments: ['owner-password', 'save'],
        token,
      });

      expect(result.status).toBe(405);
    });

    it('says so when there is no owner account to save a password for', async () => {
      const { admin } = consoleFor(ownerRow, false);
      const result = await admin.handle({
        method: 'POST',
        segments: ['owner-password', 'save'],
        body: { password: 'Mango9Tr' },
        token,
      });

      expect(result.status).toBe(409);
      expect((result.body as { error?: string }).error).toBe('owner_missing');
    });
  });

  it('is not reachable at any other path under its name', async () => {
    // The old route was a single POST to /generate that rotated as it went. There
    // is no verb left for that here, so a stale bookmark gets a 404 rather than a
    // silent password change.
    const { admin, query } = consoleFor(ownerRow);
    const result = await admin.handle({ method: 'POST', segments: ['owner-password', 'rotate'], token });

    expect(result.status).toBe(404);
    expect(query.mock.calls.some(([text]) => String(text).includes('SET password_hash'))).toBe(false);
  });
});
