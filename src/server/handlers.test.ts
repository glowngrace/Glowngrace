import { describe, expect, it, vi } from 'vitest';
import { statements } from './catalogue-fake';
import { createHandlers, type Database, type QueryResult } from './handlers';

function makeDatabase(
  queryImpl?: (text: string, values?: unknown[]) => Promise<QueryResult>,
) {
  const run = queryImpl ?? (async () => ({ rows: [], rowCount: 0 }));
  const query = vi.fn(run);
  return { database: { query } satisfies Database, query };
}

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
  it('uses catalogue prices and persists a server-calculated order and its lines', async () => {
    const { database, query } = makeDatabase(async (text, values = []) => (
      text.includes('SELECT count(*)::int AS item_count')
        ? { rows: [{ item_count: 1 }], rowCount: 1 }
        : { rows: [{ id: 'order-uuid', order_number: values[0], total_paise: 183190 }], rowCount: 1 }
    ));
    const result = await createHandlers(database).checkout('POST', checkoutPayload);

    expect(result).toEqual({
      status: 201,
      body: {
        orderNumber: expect.stringMatching(/^GG-[0-9A-F]{12}$/),
        total: 1831.9,
        message: expect.stringContaining('cash on delivery'),
      },
    });
    // The order row, a read back for its id, one line, then the line count that
    // confirms the write before the order is confirmed to the customer.
    expect(query).toHaveBeenCalledTimes(4);
    const written = statements(query);
    expect(written[0].text).toContain('INSERT INTO orders');
    expect(written[0].values).toEqual(expect.arrayContaining([169800, 4900, 8490, 183190]));
    expect(written[2].text).toContain('INSERT INTO order_items');
    expect(written[2].values).toEqual(['order-uuid', 4, 'Glow Ritual Vitamin C Face Serum', 84900, 2]);
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
    const { database, query } = makeDatabase(async (sql, values = []) => {
      if (sql.includes('SELECT id, name, price')) {
        return { rows: [{ id: 9, name: 'New catalogue serum', price: 500 }], rowCount: 1 };
      }
      if (sql.includes('SELECT count(*)::int AS item_count')) return { rows: [{ item_count: 1 }], rowCount: 1 };
      return { rows: [{ id: 'order-uuid', order_number: values[0], total_paise: 109900 }], rowCount: 1 };
    });
    const result = await createHandlers(database).checkout('POST', {
      ...checkoutPayload,
      items: [{ productId: 9, quantity: 2 }],
    });

    expect(result).toMatchObject({ status: 201, body: { total: 1099 } });
    // The price lookup, then the same four statements as the catalogue order.
    expect(query).toHaveBeenCalledTimes(5);
    const savedItems = statements(query).find((statement) => statement.text.includes('INSERT INTO order_items'));
    expect(savedItems?.values).toEqual(['order-uuid', 9, 'New catalogue serum', 50000, 2]);
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
    // The product row, then one statement per image.
    expect(query).toHaveBeenCalledTimes(2);
    const [product, ...images] = statements(query);
    expect(product.text).toContain('INSERT INTO products');
    expect(product.values[7]).toBe('serum.png');
    expect(images).toHaveLength(1);
    expect(images[0].text).toContain('INSERT INTO product_images');
    expect(images[0].text).toContain("decode($5, 'base64')");
    expect(images[0].values).toEqual([9, 0, 'serum.png', 'image/png', expect.any(String), 1200, 1200]);
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
    const { database, query } = makeDatabase(async (text) => (text.includes('INSERT INTO products')
      ? {
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
          }],
          rowCount: 1,
        }
      : { rows: [], rowCount: 1 }));

    const result = await createHandlers(database).products('POST', { ...productPayload, images });
    expect(result).toMatchObject({ status: 201, body: { product: { images: expect.arrayContaining(['/api/products/10/images/9']) } } });
    const savedImages = statements(query).filter((statement) => statement.text.includes('INSERT INTO product_images'));
    expect(savedImages).toHaveLength(10);
    expect(savedImages[0].values).toEqual([10, 0, 'serum-0.png', 'image/png', expect.any(String), 800, 600]);
    expect(savedImages[9].values?.[1]).toBe(9);
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
    // Catalogue list, the ownership count, then the one image that exists.
    expect(query).toHaveBeenCalledTimes(3);
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
