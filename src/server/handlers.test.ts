import { describe, expect, it, vi } from 'vitest';
import { createHandlers, type Database, type QueryResult } from './handlers';

function makeDatabase(queryImpl?: (text: string, values: unknown[]) => Promise<QueryResult>) {
  const query = vi.fn(queryImpl ?? (async () => ({ rows: [], rowCount: 0 })));
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
    const savedItems = JSON.parse(String(values[15])) as Array<Record<string, unknown>>;
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
    expect((await handler('POST', { ...checkoutPayload, items: [{ productId: 9999, quantity: 1 }] })).status).toBe(400);
    expect((await handler('POST', { ...checkoutPayload, items: [{ productId: 4, quantity: 1 }, { productId: 4, quantity: 1 }] })).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
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
});
