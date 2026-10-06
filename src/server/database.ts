import { createStore, execute, type Store, type TableDefinition } from './sql-execute.js';
import { parseSql } from './sql.js';
import type { Database, QueryResult } from './handlers.js';
import { QueryError, codeOf } from './query-error.js';
import { createPostgresDatabase, type PostgresDatabase } from './postgres.js';
import {
  runtimeDatabaseVariables,
  resolveRuntimeDatabase,
  wantsLocalDatabase,
  type ResolvedDatabase,
} from './config.js';

export { QueryError } from './query-error.js';

/**
 * The application's data store.
 *
 * Two implementations answer the same `query(text, values)` interface, and this
 * module picks between them once at boot:
 *
 *   postgres  the local Docker database in development, Neon in production.
 *             Nothing about the code above this line changes between the two.
 *   memory    an in-process SQL parser and executor, used when no database is
 *             configured at all - which is how the unit tests run, with no
 *             container and no network.
 *
 * The switch is `USE_LOCAL_DATABASE` in `.env.local`. Absent it, and outside a
 * Vercel deployment, the store stays in memory: a checkout with no database
 * configured should not fail, and tests must never reach for a real one.
 */

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
        throw new QueryError(`The in-memory store could not run the query: ${(error as Error).message}`, {
          cause: error,
          code: codeOf(error),
        });
      }
    },
  };

  return { database, store };
}

export type StoreKind = 'postgres' | 'memory';

/**
 * Which store this process should use.
 *
 * Explicit first, then the flag, then the deployment shape. The default matters:
 * an unconfigured checkout and a unit test both want memory, and neither should
 * have to opt out of a database it never configured.
 */
export function resolveStoreKind(env: NodeJS.ProcessEnv = process.env): StoreKind {
  const explicit = env.DATABASE_BACKEND?.trim().toLowerCase();
  if (explicit === 'memory' || explicit === 'in-memory') return 'memory';
  if (explicit === 'postgres' || explicit === 'postgresql' || explicit === 'pg') return 'postgres';
  if (wantsLocalDatabase(env)) return 'postgres';
  // On Vercel a connection string is injected rather than written down, so its
  // presence is the signal. Anything else that merely has DATABASE_URL exported
  // is a developer who has not said which database they meant.
  if (env.VERCEL && runtimeDatabaseVariables.some((variable) => env[variable]?.trim())) return 'postgres';
  return 'memory';
}

const memory = createMemoryDatabase();

function selectStore(): { kind: StoreKind; database: Database } {
  if (resolveStoreKind() === 'memory') return { kind: 'memory', database: memory.database };
  // Resolved eagerly and allowed to throw. A missing or malformed DATABASE_URL
  // is a setup mistake, and silently answering from memory instead would let a
  // developer believe they were testing against PostgreSQL while nothing was
  // being persisted at all.
  return { kind: 'postgres', database: createPostgresDatabase(resolveRuntimeDatabase()) };
}

const selected = selectStore();

const { store } = memory;
const database = selected.database;

export { database, store };

/** Which of the two stores this process ended up with, for /api/health. */
export const storeKind = selected.kind;

/** True when this process is holding a real connection pool. */
export const isPostgres = selected.kind === 'postgres';

/**
 * How the chosen PostgreSQL was configured, or `null` for the memory store.
 *
 * Read-only, and already stripped of anything sensitive by
 * `describeResolvedDatabase`: the host is masked for a remote one, and the
 * password is never part of the type.
 */
export const resolvedDatabase: ResolvedDatabase | null = selected.kind === 'postgres'
  ? (selected.database as PostgresDatabase).resolved
  : null;

/**
 * Releases pooled connections. Called from the shutdown paths in the API server
 * and the scripts; a no-op for the memory store, which has nothing to release.
 */
export async function closeDatabase() {
  if (selected.kind !== 'postgres') return;
  await (selected.database as PostgresDatabase).end();
}

/** Test seam: empties every table without rebuilding the store. */
export function resetMemoryDatabase() {
  for (const rows of store.rows.values()) rows.length = 0;
  store.sequences.clear();
}