import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCatalogueShapeCache } from './catalogue';
import {
  fullyMigrated,
  statements,
  withCatalogueShape,
  type FakeShape,
} from './catalogue-fake';
import { createHandlers, type Database, type QueryResult } from './handlers';

function makeDatabase(
  queryImpl?: (text: string, values: unknown[]) => Promise<QueryResult>,
  shape: FakeShape = fullyMigrated,
) {
  const query = vi.fn(withCatalogueShape(shape, (text, values) => (
    queryImpl ? queryImpl(text, values) : { rows: [], rowCount: 0 }
  )));
  return { database: { query } satisfies Database, query };
}

beforeEach(() => {
  // The shape is cached per warm instance, which is the point in production and a
  // trap in a suite: without this one test's fake hands its shape to the next.
  resetCatalogueShapeCache();
});

const checkoutPayload = {
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
  items: [{ productId: 4, quantity: 2, price: 1 }],
};

describe('checkout handler', () => {
  it('uses catalogue prices and atomically persists a server-calculated order', async () => {
    const { database, query } = makeDatabase(async (_text, values) => ({
      rows: [{ order_number: values[0], total_paise: 183190, item_count: 1 }],
      rowCount: 1,
    }));
    const result = await createHandlers(database).checkout('POST', checkoutPayload);

    expect(result).toEqual({
      status: 201,
      body: {
        orderNumber: expect.stringMatching(/^GG-[0-9A-F]{12}$/),
        total: 1831.9,
        message: expect.stringContaining('cash on delivery'),
      },
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('WITH created_order AS');
    expect(sql).toContain('INSERT INTO order_items');
    expect(values).toEqual(expect.arrayContaining([169800, 4900, 8490, 183190]));
    const savedItems = JSON.parse(String(values?.[15])) as Array<Record<string, unknown>>;
    expect(savedItems).toEqual([{
      product_id: 4,
      product_name: 'Glow Ritual Vitamin C Face Serum',
      unit_price_paise: 84900,
      quantity: 2,
    }]);
  });

  it('rejects invalid, unknown, duplicated and non-COD orders without writing', async () => {
    const { database, query } = makeDatabase();
    const handler = createHandlers(database).checkout;

    expect((await handler('GET', checkoutPayload)).status).toBe(405);
    expect((await handler('POST', { ...checkoutPayload, postalCode: '000000' })).status).toBe(400);
    expect((await handler('POST', { ...checkoutPayload, paymentMethod: 'upi' })).status).toBe(400);
    expect((await handler('POST', { ...checkoutPayload, items: [{ productId: 4, quantity: 1 }, { productId: 4, quantity: 1 }] })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();

    expect((await handler('POST', { ...checkoutPayload, items: [{ productId: 9999, quantity: 1 }] })).status).toBe(400);
    expect(query).toHaveBeenCalledWith(
      'SELECT id, name, price FROM products WHERE id = ANY($1::integer[])',
      [[9999]],
    );
  });

  it('does not report success if the database cannot confirm the saved order', async () => {
    const { database } = makeDatabase();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const result = await createHandlers(database).checkout('POST', checkoutPayload);
      expect(result.status).toBe(500);
      expect(result.body.error).toBe('server_error');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('uses database-backed products and prices during checkout', async () => {
    const { database, query } = makeDatabase(async (sql, values) => sql.includes('SELECT id, name, price')
      ? { rows: [{ id: 9, name: 'New catalogue serum', price: 500 }], rowCount: 1 }
      : { rows: [{ order_number: values[0], total_paise: 109900, item_count: 1 }], rowCount: 1 });
    const result = await createHandlers(database).checkout('POST', {
      ...checkoutPayload,
      items: [{ productId: 9, quantity: 2 }],
    });

    expect(result).toMatchObject({ status: 201, body: { total: 1099 } });
    expect(query).toHaveBeenCalledTimes(2);
    const savedItems = JSON.parse(String(query.mock.calls[1][1]?.[15])) as Array<Record<string, unknown>>;
    expect(savedItems).toEqual([{
      product_id: 9,
      product_name: 'New catalogue serum',
      unit_price_paise: 50000,
      quantity: 2,
    }]);
  });
});

describe('products API handler', () => {
  const image = Buffer.alloc(24);
  image.set([137, 80, 78, 71, 13, 10, 26, 10]);
  image.write('IHDR', 12, 'ascii');
  image.writeUInt32BE(1200, 16);
  image.writeUInt32BE(1200, 20);
  const productPayload = {
    name: 'Test glow serum',
    category: 'Skincare',
    brand: 'Glow & Grace',
    sku: 'GG-SERUM-TEST',
    price: 500,
    mrp: 700,
    stock: 8,
    description: 'A carefully made product description.',
    images: [{
      filename: 'serum.png',
      mimeType: 'image/png',
      data: image.toString('base64'),
      width: 1200,
      height: 1200,
    }],
  };

  it('creates a catalogue product and persists its uploaded image', async () => {
    const { database, query } = makeDatabase(async () => ({
      rows: [{
        id: 9,
        name: 'Test glow serum',
        category: 'Skincare',
        brand: 'Glow & Grace',
        sku: 'GG-SERUM-TEST',
        price: 500,
        mrp: 700,
        stock: 8,
        rating: '0',
        reviews: 0,
        image: 'serum.png',
        description: 'A carefully made product description.',
        images: ['/api/products/9/images/0'],
      }],
      rowCount: 1,
    }));
    const result = await createHandlers(database).products('POST', productPayload);

    expect(result).toMatchObject({
      status: 201,
      body: { product: { id: 9, image: '/api/products/9/images/0', images: ['/api/products/9/images/0'], stock: 8 } },
    });
    // The shape probe, then the one statement that writes the row.
    expect(query).toHaveBeenCalledTimes(2);
    const [statement] = statements(query);
    expect(statement.text).toContain('INSERT INTO product_images');
    expect(statement.text).toContain("decode(image.data, 'base64')");
    expect(statement.values[7]).toBe('serum.png');
    // The image set is the last bound value, so it is addressed from the end:
    // adding a product column must not silently move it out from under a fixed index.
    expect(JSON.parse(String(statement.values.at(-1)))).toMatchObject([{ filename: 'serum.png', position: 0 }]);
  });

  it('accepts up to 10 images at any dimensions within the maximum', async () => {
    const smallImage = Buffer.from(image);
    smallImage.writeUInt32BE(800, 16);
    smallImage.writeUInt32BE(600, 20);
    const images = Array.from({ length: 10 }, (_value, index) => ({
      ...productPayload.images[0],
      filename: `serum-${index}.png`,
      data: smallImage.toString('base64'),
      width: 800,
      height: 600,
    }));
    const { database, query } = makeDatabase(async () => ({
      rows: [{
        id: 10,
        name: 'Test glow serum',
        category: 'Skincare',
        price: 500,
        mrp: 700,
        stock: 8,
        rating: '0',
        reviews: 0,
        image: 'serum-0.png',
        description: 'A carefully made product description.',
        images: Array.from({ length: 10 }, (_value, index) => `/api/products/10/images/${index}`),
      }],
      rowCount: 1,
    }));

    const result = await createHandlers(database).products('POST', { ...productPayload, images });
    expect(result).toMatchObject({ status: 201, body: { product: { images: expect.arrayContaining(['/api/products/10/images/9']) } } });
    const savedImages = JSON.parse(String(statements(query)[0].values.at(-1))) as Array<{ position: number; width: number; height: number }>;
    expect(savedImages).toHaveLength(10);
    expect(savedImages[0]).toMatchObject({ position: 0, width: 800, height: 600 });
    expect(savedImages[9]).toMatchObject({ position: 9 });
  });

  it('rejects unsupported image counts, dimensions and payloads without writing', async () => {
    const { database, query } = makeDatabase();
    const handler = createHandlers(database).products;
    expect((await handler('POST', { ...productPayload, images: [] })).status).toBe(400);
    expect((await handler('POST', { ...productPayload, images: Array(11).fill(productPayload.images[0]) })).status).toBe(400);
    expect((await handler('POST', { ...productPayload, images: [{ ...productPayload.images[0], width: 1600 }] })).status).toBe(400);
    expect((await handler('POST', { ...productPayload, images: [{ ...productPayload.images[0], data: 'not-base64' }] })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('lists saved products and serves only existing validated image positions', async () => {
    const { database, query } = makeDatabase(async (sql) => ({
      rows: sql.includes('SELECT mime_type, image_data')
        ? [{ mime_type: 'image/png', image_data: image }]
        : [{ id: 9, name: 'Test glow serum', category: 'Skincare', price: 500, mrp: 700, stock: 8, rating: '0', reviews: 0, image: 'serum.png', description: 'Test product.', images: ['/api/products/9/images/0'] }],
      rowCount: 1,
    }));
    const handler = createHandlers(database);

    expect(await handler.products('GET', undefined)).toMatchObject({
      status: 200,
      body: { products: [{ id: 9, images: ['/api/products/9/images/0'] }] },
    });
    expect(await handler.productImage(9, 0)).toEqual({ status: 200, mimeType: 'image/png', data: image });
    expect(await handler.productImage(9, 10)).toEqual({ status: 404 });
    // Probe, catalogue list, then the one image that exists.
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('reports an unstocked catalogue only while the products table is empty', async () => {
    async function catalogueManaged(rows: Array<Record<string, unknown>>) {
      const { database } = makeDatabase(async (sql) => ({
        rows: sql.includes('count(*) > 0') ? rows : [],
        rowCount: rows.length,
      }));
      const result = await createHandlers(database).products('GET', undefined);
      return result.body.catalogueManaged;
    }

    expect(await catalogueManaged([{ managed: false }])).toBe(false);
    expect(await catalogueManaged([{ managed: true }])).toBe(true);
    expect(await catalogueManaged([])).toBe(false);
  });
});
