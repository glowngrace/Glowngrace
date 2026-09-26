import { describe, expect, it, vi } from 'vitest';
import { createHandlers, type Database } from '../src/server/handlers';

function makeDatabase(): Database {
  return { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };
}

describe('contact API handler', () => {
  it('validates the payload and saves a normalized request with parameters', async () => {
    const database = makeDatabase();
    const result = await createHandlers(database).contact('POST', {
      name: '  Maya Singh ',
      email: ' Maya@example.com ',
      phone: '+91 98765 43210',
      topic: 'Product advice',
      message: 'I would love a shade recommendation.',
    });

    expect(result.status).toBe(201);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('VALUES ($1, $2, $3, $4, $5)'),
      ['Maya Singh', 'Maya@example.com', '+91 98765 43210', 'Product advice', 'I would love a shade recommendation.'],
    );
  });

  it('rejects invalid payloads without querying the database', async () => {
    const database = makeDatabase();
    const result = await createHandlers(database).contact('POST', { name: 'x', email: 'nope' });

    expect(result.status).toBe(400);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('returns method-not-allowed for unsupported methods', async () => {
    expect(await createHandlers(makeDatabase()).contact('GET', {})).toMatchObject({ status: 405 });
  });
});

describe('newsletter API handler', () => {
  it('stores the normalized email and safely upserts duplicate subscriptions', async () => {
    const database = makeDatabase();
    const result = await createHandlers(database).newsletter('POST', { email: '  hello@example.com ' });

    expect(result.status).toBe(201);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (email) DO UPDATE'),
      ['hello@example.com'],
    );
  });
});
