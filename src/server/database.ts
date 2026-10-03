import { createStore, execute, type Store, type TableDefinition } from './sql-execute.js';
import { parseSql } from './sql.js';
import type { Database, QueryResult } from './handlers.js';

/**
 * The application's data store.
 *
 * This used to be a PostgreSQL pool pointed at a local Docker database in
 * development and at Neon in production. Both are gone: the connection handling,
 * the configuration reader and the schema migrations went with them, and this
 * module answers the same `query(text, values)` interface from memory instead.
 *
 * That means every table starts empty and stays empty for the life of the
 * process. Nothing is read from or written to disk, so a restart is a clean
 * slate and two instances never see each other's rows. It is a working
 * replacement for the shape of the code above it, not a place to keep anything.
 */

export class QueryError extends Error {
  code: string | undefined;

  constructor(message: string, options: { cause?: unknown; code?: string } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'QueryError';
    this.code = options.code;
  }
}

/**
 * Every table the application reads or writes, with the columns it has.
 *
 * The column list is load-bearing rather than decorative: it is what the
 * executor resolves `SELECT`, `INSERT` and `UPDATE` against, so a column the
 * code names but this does not declare is a failure rather than a silently
 * missing value.
 */
export const tables: TableDefinition[] = [
  {
    name: 'contact_requests',
    columns: ['id', 'name', 'email', 'phone', 'topic', 'message', 'created_at'],
    generated: { id: 'uuid' },
    timestamps: ['created_at'],
  },
  {
    name: 'newsletter_subscribers',
    columns: ['id', 'email', 'created_at', 'updated_at'],
    unique: [['email']],
    generated: { id: 'uuid' },
    timestamps: ['created_at', 'updated_at'],
  },
  {
    name: 'products',
    columns: [
      'id', 'name', 'category', 'brand', 'sku', 'price', 'mrp', 'stock', 'rating',
      'reviews', 'badge', 'image', 'description', 'created_at', 'published',
      'featured', 'updated_at', 'slug', 'meta_title', 'meta_description', 'shades',
      'highlights', 'features_and_specification', 'measurement', 'material_and_care',
      'additional_details', 'item_details',
    ],
    // A blank SKU is stored as NULL and does not clash, which is what the
    // partial unique index used to express.
    unique: [['sku'], ['id']],
    generated: { id: 'serial' },
    serialStart: 9,
    timestamps: ['created_at', 'updated_at'],
  },
  {
    name: 'product_images',
    columns: ['id', 'product_id', 'position', 'filename', 'mime_type', 'image_data', 'width', 'height', 'created_at'],
    unique: [['product_id', 'position']],
    generated: { id: 'uuid' },
    timestamps: ['created_at'],
  },
  {
    name: 'orders',
    columns: [
      'id', 'order_number', 'customer_name', 'email', 'phone', 'street_address',
      'locality', 'city', 'state', 'postal_code', 'landmark', 'delivery_method',
      'payment_method', 'status', 'subtotal_paise', 'shipping_paise', 'tax_paise',
      'total_paise', 'created_at',
    ],
    unique: [['order_number'], ['id']],
    generated: { id: 'uuid' },
    timestamps: ['created_at'],
  },
  {
    name: 'order_items',
    columns: ['id', 'order_id', 'product_id', 'product_name', 'unit_price_paise', 'quantity', 'created_at'],
    generated: { id: 'uuid' },
    timestamps: ['created_at'],
  },
  {
    name: 'admin_users',
    columns: [
      'id', 'name', 'email', 'role', 'password_hash', 'avatar', 'status',
      'created_at', 'updated_at', 'phone', 'source', 'reviewed_at', 'reviewed_by',
      'password_rotated_at', 'password_hold_until',
    ],
    unique: [['email'], ['id']],
    generated: { id: 'uuid' },
    timestamps: ['created_at', 'updated_at'],
  },
  {
    name: 'admin_sessions',
    columns: ['token', 'user_id', 'created_at', 'expires_at'],
    unique: [['token']],
    timestamps: ['created_at'],
  },
  {
    name: 'store_settings',
    columns: ['key', 'value', 'updated_at'],
    unique: [['key']],
    timestamps: ['updated_at'],
  },
  {
    name: 'site_pages',
    columns: ['slug', 'label', 'path', 'visible', 'position', 'updated_at'],
    unique: [['slug']],
    timestamps: ['updated_at'],
  },
  {
    name: 'job_vacancies',
    columns: [
      'id', 'title', 'partner', 'area', 'type', 'salary', 'experience', 'skills',
      'description', 'applications', 'status', 'created_at', 'updated_at',
    ],
    unique: [['id']],
    timestamps: ['created_at', 'updated_at'],
  },
  {
    name: 'candidates',
    columns: [
      'id', 'name', 'role', 'experience', 'city', 'rating', 'stage', 'email',
      'phone', 'avatar', 'created_at', 'updated_at',
    ],
    unique: [['id']],
    timestamps: ['created_at', 'updated_at'],
  },
  {
    name: 'partner_salons',
    columns: [
      'id', 'name', 'area', 'type', 'rating', 'vacancies', 'status', 'phone',
      'email', 'owner', 'since', 'avatar', 'created_at', 'updated_at',
    ],
    unique: [['id']],
    timestamps: ['created_at', 'updated_at'],
  },
  {
    name: 'customers',
    columns: [
      'id', 'name', 'email', 'phone', 'orders', 'spent', 'tier', 'last_order_on',
      'created_at', 'updated_at',
    ],
    unique: [['id'], ['email']],
    timestamps: ['created_at', 'updated_at'],
  },
  {
    name: 'reviews',
    columns: [
      'id', 'author', 'product_name', 'rating', 'text', 'status', 'avatar',
      'reviewed_on', 'created_at', 'updated_at',
    ],
    unique: [['id']],
    timestamps: ['created_at', 'updated_at'],
  },
  {
    name: 'demo_datasets',
    columns: ['key', 'label', 'visible', 'seeded', 'updated_at'],
    unique: [['key']],
    timestamps: ['updated_at'],
  },
  {
    name: 'password_resets',
    columns: ['id', 'user_id', 'token_hash', 'token_lookup', 'expires_at', 'used_at', 'created_at'],
    generated: { id: 'uuid' },
    timestamps: ['created_at'],
  },
  {
    name: 'email_outbox',
    columns: ['id', 'kind', 'recipient', 'subject', 'body', 'created_at', 'read_at', 'sent_at'],
    generated: { id: 'uuid' },
    timestamps: ['created_at'],
  },
];

/** Creates a store with every table present and empty. */
export function createMemoryDatabase(): { database: Database; store: Store } {
  const store = createStore(tables);

  const database: Database = {
    async query(text: string, values: unknown[] = []): Promise<QueryResult> {
      let statement;
      try {
        statement = parseSql(text);
      } catch (error) {
        throw new QueryError(`Could not read the query: ${(error as Error).message}`, { cause: error });
      }
      try {
        return execute(store, statement, values) as QueryResult;
      } catch (error) {
        // The code is carried across so a caller can still branch on 23505 the way
        // it did when `pg` raised it, which is how the duplicate SKU becomes a 409
        // rather than a 500.
        const code = (error as { code?: unknown }).code;
        throw new QueryError(`The in-memory store could not run the query: ${(error as Error).message}`, {
          cause: error,
          code: typeof code === 'string' ? code : undefined,
        });
      }
    },
  };

  return { database, store };
}

const { database, store } = createMemoryDatabase();

export { database, store };

/** Test seam: empties every table without rebuilding the store. */
export function resetMemoryDatabase() {
  for (const rows of store.rows.values()) rows.length = 0;
  store.sequences.clear();
}