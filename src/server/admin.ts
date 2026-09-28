import { z } from 'zod';
import type { Product } from '../data/catalog.js';
import { mapProduct, parseProductImages } from './handlers.js';
import {
  collectionByKey,
  mapRow,
  validateFields,
  type Collection,
  type Row,
} from './admin/collections.js';
import { hashPassword, newSessionToken, passwordPolicy, sessionExpiry, verifyPassword } from './admin/passwords.js';
import {
  candidateSeeds,
  customerSeeds,
  demoDatasets,
  jobSeeds,
  orderItemSeeds,
  orderSeeds,
  partnerSeeds,
  reviewSeeds,
  sitePageSeeds,
  type DemoDatasetKey,
} from './admin/seeds.js';
import type { Database } from './handlers.js';

export type AdminRequest = {
  method: string;
  segments: string[];
  body?: unknown;
  token?: string | null;
};

export type AdminResult = { status: number; body: Record<string, unknown> };

export const adminRoles = [
  'Store Administrator',
  'Store Manager',
  'Inventory Manager',
  'Partnerships Lead',
  'Content & Reviews',
  'Placements Coordinator',
] as const;

const orderStatusFlow = ['Placed', 'Processing', 'Packed', 'Shipped', 'Delivered'] as const;
const orderStatuses = ['Placed', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Returned', 'Cancelled'] as const;

export const orderStatusFlowList = [...orderStatusFlow];
export const orderStatusesList = [...orderStatuses];

const password = z.string().min(passwordPolicy.minLength, `Use at least ${passwordPolicy.minLength} characters.`)
  .max(passwordPolicy.maxLength, `Use at most ${passwordPolicy.maxLength} characters.`);

// Spreadsheets can only offer Yes/No, TRUE/FALSE or 1/0, so accept all of those
// instead of letting z.coerce.boolean() turn the text "false" into true.
const flag = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(text)) return true;
    if (['false', 'no', 'n', '0', ''].includes(text)) return false;
  }
  return value;
}, z.boolean({ invalid_type_error: 'Use Yes or No.' }));

const signInSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(passwordPolicy.maxLength),
});

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  role: z.enum(adminRoles),
  password,
  avatar: z.string().trim().max(180).optional().default(''),
});

const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(254).optional(),
  role: z.enum(adminRoles).optional(),
  avatar: z.string().trim().max(180).optional(),
  status: z.enum(['Active', 'Paused']).optional(),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(passwordPolicy.maxLength),
  newPassword: password,
});

const productUpdateSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  category: z.enum(['Makeup', 'Skincare', 'Fragrance', 'Gifting']).optional(),
  brand: z.string().trim().max(120).optional(),
  sku: z.string().trim().max(64).optional(),
  price: z.coerce.number().int().positive().max(99999999).optional(),
  mrp: z.coerce.number().int().positive().max(99999999).optional(),
  stock: z.coerce.number().int().min(0).max(999999).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  reviews: z.coerce.number().int().min(0).max(999999).optional(),
  badge: z.string().trim().max(40).optional(),
  description: z.string().trim().min(1).max(3000).optional(),
  published: flag.optional(),
  featured: flag.optional(),
  images: z.array(z.object({
    filename: z.string().trim().min(1).max(180).regex(/^[^\\/]+$/),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    data: z.string().max(409600),
    width: z.number().int().min(1).max(1200),
    height: z.number().int().min(1).max(1200),
  })).max(10).optional(),
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(2).max(180),
  category: z.enum(['Makeup', 'Skincare', 'Fragrance', 'Gifting']),
  brand: z.string().trim().max(120).optional().default(''),
  sku: z.string().trim().max(64).optional().default(''),
  price: z.coerce.number().int().positive().max(99999999),
  mrp: z.coerce.number().int().positive().max(99999999),
  stock: z.coerce.number().int().min(0).max(999999),
  description: z.string().trim().min(1).max(3000),
  published: flag.default(true),
  featured: flag.default(false),
  rating: z.coerce.number().min(0).max(5).optional().default(0),
  reviews: z.coerce.number().int().min(0).max(999999).optional().default(0),
  badge: z.string().trim().max(40).optional().default(''),
  image: z.string().trim().max(180).optional().default(''),
});

const orderUpdateSchema = z.object({
  status: z.enum(['Placed', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Returned', 'Cancelled']).optional(),
  customer: z.string().trim().min(2).max(160).optional(),
  email: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(6).max(32).optional(),
  address: z.string().trim().min(2).max(240).optional(),
  locality: z.string().trim().min(2).max(120).optional(),
  city: z.string().trim().min(2).max(100).optional(),
  state: z.string().trim().min(2).max(100).optional(),
  postalCode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Use a 6 digit PIN code.').optional(),
  deliveryMethod: z.enum(['Standard', 'Express', 'Same day']).optional(),
});

const settingsSchema = z.object({
  profile: z.object({
    storeName: z.string().trim().min(1).max(120),
    tagline: z.string().trim().max(160),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().max(32),
    address: z.string().trim().max(300),
  }).partial().optional(),
  delivery: z.object({
    freeAbove: z.coerce.number().int().min(0).max(9999999),
    deliveryFee: z.coerce.number().int().min(0).max(99999),
    gst: z.coerce.number().min(0).max(100),
    returns: z.coerce.number().int().min(0).max(365),
  }).partial().optional(),
  notifications: z.record(z.boolean()).optional(),
  preview: z.object({ livePreview: z.boolean() }).partial().optional(),
});

const bulkSchema = z.object({
  dataset: z.enum(['products', 'jobs', 'candidates', 'partners', 'customers', 'reviews', 'users']),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean()]))).min(1).max(500),
});

const demoDataSchema = z.object({
  dataset: z.enum(['all', ...demoDatasets.map((dataset) => dataset.key)] as [string, ...string[]]),
  action: z.enum(['hide', 'show', 'delete', 'reset', 'reset-all']),
});

const pageUpdateSchema = z.object({ visible: z.boolean() });

const orderStatusLabels: Record<string, string> = {
  placed: 'Placed',
  processing: 'Processing',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

const orderStatusToColumn: Record<string, string> = {
  Placed: 'placed',
  Processing: 'processing',
  Packed: 'packed',
  Shipped: 'shipped',
  Delivered: 'delivered',
  Returned: 'returned',
  Cancelled: 'cancelled',
};

const deliveryLabels: Record<string, string> = { standard: 'Standard', express: 'Express', same_day: 'Same day' };

function fail(status: number, error: string, message: string, extra: Record<string, unknown> = {}): AdminResult {
  return { status, body: { error, message, ...extra } };
}

function orderLabel(value: unknown) {
  return orderStatusLabels[String(value)] ?? 'Placed';
}

function orderColumnValue(label: string) {
  return orderStatusToColumn[label] ?? 'placed';
}

function deliveryLabel(value: unknown) {
  return deliveryLabels[String(value)] ?? 'Standard';
}

function mapOrder(row: Row) {
  const totalPaise = Number(row.total_paise ?? 0);
  const createdAt = row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at));
  return {
    id: String(row.order_number),
    customer: String(row.customer_name),
    email: String(row.email),
    phone: String(row.phone),
    address: String(row.street_address),
    locality: String(row.locality),
    city: String(row.city),
    state: String(row.state),
    postalCode: String(row.postal_code),
    deliveryMethod: deliveryLabel(row.delivery_method),
    status: orderLabel(row.status),
    items: Number(row.item_count ?? 0),
    total: Math.round(totalPaise) / 100,
    date: createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    createdAt: createdAt.toISOString(),
  };
}

function mapUser(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    role: String(row.role),
    avatar: row.avatar ? String(row.avatar) : '',
    status: String(row.status ?? 'Active'),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
  };
}

const orderSelect = `SELECT order_record.id, order_record.order_number, order_record.customer_name, order_record.email,
  order_record.phone, order_record.street_address, order_record.locality, order_record.city, order_record.state,
  order_record.postal_code, order_record.delivery_method, order_record.status, order_record.total_paise,
  order_record.created_at, (SELECT count(*)::int FROM order_items AS item WHERE item.order_id = order_record.id) AS item_count
  FROM orders AS order_record`;

const productSelect = `SELECT product.id, product.name, product.category, product.brand, product.sku, product.price,
  product.mrp, product.stock, product.rating, product.reviews, product.badge, product.image, product.description,
  product.published, product.featured,
  COALESCE(
    (SELECT json_agg('/api/products/' || product.id || '/images/' || image.position ORDER BY image.position)
     FROM product_images AS image WHERE image.product_id = product.id),
    '[]'::json
  ) AS images
  FROM products AS product`;

async function insertSeedRows(database: Database, table: string, columns: string[], rows: Array<Array<string | number | boolean | null>>) {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const tuples = rows.map((row, rowIndex) => {
    const placeholders = row.map((_cell, cellIndex) => {
      values.push(row[cellIndex]);
      return `$${rowIndex * columns.length + cellIndex + 1}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  await database.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${tuples.join(', ')} ON CONFLICT DO NOTHING`,
    values,
  );
}

/**
 * Brings a freshly migrated database up to the console's starting point: the
 * storefront page list, the preview collections and the demo administrator.
 * Running it twice is a no-op, so it doubles as the "reset demo data" replay.
 */
export async function seedAdminData(database: Database) {
  await insertSeedRows(
    database,
    'site_pages',
    ['slug', 'label', 'path', 'visible', 'position'],
    sitePageSeeds.map((page) => [page.slug, page.label, page.path, true, page.position]),
  );
  await insertSeedRows(
    database,
    'job_vacancies',
    ['id', 'title', 'partner', 'area', 'type', 'salary', 'experience', 'skills', 'description', 'applications', 'status'],
    jobSeeds.job_vacancies.map((row) => [row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7] ?? '', '', row[8], row[9]]),
  );
  await insertSeedRows(database, 'candidates', ['id', 'name', 'role', 'experience', 'city', 'rating', 'stage', 'email', 'phone', 'avatar'], candidateSeeds.candidates);
  await insertSeedRows(database, 'partner_salons', ['id', 'name', 'area', 'type', 'rating', 'vacancies', 'status', 'phone', 'email', 'owner', 'since', 'avatar'], partnerSeeds.partner_salons);
  await insertSeedRows(database, 'customers', ['id', 'name', 'email', 'phone', 'orders', 'spent', 'tier', 'last_order_on'], customerSeeds.customers);
  await insertSeedRows(database, 'reviews', ['id', 'author', 'product_name', 'rating', 'text', 'status', 'avatar', 'reviewed_on'], reviewSeeds.reviews);
  await insertSeedRows(
    database,
    'orders',
    ['order_number', 'customer_name', 'email', 'phone', 'street_address', 'locality', 'city', 'state', 'postal_code', 'landmark', 'delivery_method', 'payment_method', 'status', 'subtotal_paise', 'shipping_paise', 'tax_paise', 'total_paise', 'created_at'],
    orderSeeds.orders.map((row) => [...row.slice(0, 11), 'cod', ...row.slice(11)]),
  );
  for (const item of orderItemSeeds) {
    await database.query(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price_paise, quantity)
       SELECT id, $2, $3, $4, $5 FROM orders WHERE order_number = $1 AND NOT EXISTS (
         SELECT 1 FROM order_items AS existing
         WHERE existing.order_id = orders.id AND existing.product_id = $2 AND existing.quantity = $5
       )`,
      [item.orderNumber, item.productId, item.productName, item.unitPricePaise, item.quantity],
    );
  }
  for (const dataset of demoDatasets) {
    await database.query(
      'INSERT INTO demo_datasets (key, label) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [dataset.key, dataset.label],
    );
  }
  await database.query(
    `INSERT INTO admin_users (id, name, email, role, password_hash, avatar, status)
     VALUES ('00000000-0000-4000-8000-000000000001', 'Glow & Grace Admin', 'admin@glowngrace.in', 'Store Administrator', $1, '/images/partner1.jpg', 'Active')
     ON CONFLICT (email) DO NOTHING`,
    ['scrypt$16384$8$1$8ad60c22a397f20a36e452887332fea3$b91fbd9edb011c0c620edfc8638f3b18c9128e24492126f98a960e81a3f003280c3ba4e74e2deb31e51f3004ba8c5aaf2dda974cd40e54c376a307f3842f6fae'],
  );
}

async function resetDataset(database: Database, dataset: DemoDatasetKey) {
  if (dataset === 'orders') {
    await database.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders)');
    await database.query('DELETE FROM orders');
  }
  if (dataset === 'jobs') await database.query('DELETE FROM job_vacancies');
  if (dataset === 'candidates') await database.query('DELETE FROM candidates');
  if (dataset === 'partners') await database.query('DELETE FROM partner_salons');
  if (dataset === 'customers') await database.query('DELETE FROM customers');
  if (dataset === 'reviews') await database.query('DELETE FROM reviews');
  await seedAdminData(database);
  await database.query(
    'UPDATE demo_datasets SET visible = TRUE, seeded = TRUE, updated_at = NOW() WHERE key = $1',
    [dataset],
  );
}

export function createAdminHandlers(database: Database) {
  let seeded: Promise<void> | undefined;
  const ensureSeeded = () => {
    seeded ??= seedAdminData(database).catch((error: unknown) => {
      console.error('Unable to seed admin data', error);
      throw error;
    });
    return seeded;
  };

  async function currentUser(token?: string | null) {
    if (!token) return null;
    const result = await database.query(
      `SELECT user_account.id, user_account.name, user_account.email, user_account.role, user_account.avatar,
              user_account.status, user_account.created_at
       FROM admin_sessions AS session
       JOIN admin_users AS user_account ON user_account.id = session.user_id
       WHERE session.token = $1 AND session.expires_at > NOW() AND user_account.status = 'Active'`,
      [token],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : null;
  }

  async function listCollection(collection: Collection) {
    const result = await database.query(
      `SELECT * FROM ${collection.table} ORDER BY ${collection.orderBy}`,
      [],
    );
    return result.rows.map((row) => mapRow(collection, row));
  }

  async function createRecord(collection: Collection, input: unknown) {
    const { values, errors, ok } = validateFields(collection, (input ?? {}) as Record<string, unknown>, 'create');
    if (!ok) return fail(400, 'invalid_record', 'Please correct the highlighted columns.', { errors });
    const columns = Object.keys(values);
    const result = await database.query(
      `INSERT INTO ${collection.table} (${columns.join(', ')}) VALUES (${columns.map((_column, index) => `$${index + 1}`).join(', ')})
       RETURNING *`,
      columns.map((column) => values[column]),
    );
    return { status: 201, body: { record: mapRow(collection, result.rows[0]), message: `${collection.label} added.` } };
  }

  async function updateRecord(collection: Collection, id: string, input: unknown) {
    const { values, errors, ok } = validateFields(collection, (input ?? {}) as Record<string, unknown>, 'update');
    if (!ok) return fail(400, 'invalid_record', 'Please correct the highlighted columns.', { errors });
    if (Object.keys(values).length === 0) return fail(400, 'empty_update', 'Change at least one column before saving.');
    const columns = Object.keys(values);
    const result = await database.query(
      `UPDATE ${collection.table} SET ${columns.map((column, index) => `${column} = $${index + 2}`).join(', ')}, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, ...columns.map((column) => values[column])],
    );
    if (result.rows.length === 0) return fail(404, 'not_found', `That ${collection.label.toLowerCase()} no longer exists.`);
    return { status: 200, body: { record: mapRow(collection, result.rows[0]), message: `${collection.label} updated.` } };
  }

  async function removeRecord(collection: Collection, id: string) {
    const result = await database.query(`DELETE FROM ${collection.table} WHERE id = $1 RETURNING id`, [id]);
    if (result.rows.length === 0) return fail(404, 'not_found', `That ${collection.label.toLowerCase()} no longer exists.`);
    return { status: 200, body: { deleted: String(id), message: `${collection.label} deleted.` } };
  }

  async function listOrders() {
    const result = await database.query(`${orderSelect} ORDER BY order_record.created_at DESC, order_record.order_number DESC`, []);
    return result.rows.map(mapOrder);
  }

  async function listProducts() {
    const result = await database.query(`${productSelect} ORDER BY product.id`, []);
    return result.rows.map((row) => mapProduct(row) as Product);
  }

  async function readProduct(productId: number) {
    const result = await database.query(`${productSelect} WHERE product.id = $1`, [productId]);
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
  }

  async function replaceProductImages(
    productId: number,
    images: Array<{ filename: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string; width: number; height: number }>,
  ) {
    const { images: valid, invalid } = parseProductImages(images);
    if (invalid) return false;
    await database.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
    for (const image of valid) {
      await database.query(
        `INSERT INTO product_images (product_id, position, filename, mime_type, image_data, width, height)
         VALUES ($1, $2, $3, $4, decode($5, 'base64'), $6, $7)`,
        [productId, image.position, image.filename, image.mimeType, image.data, image.width, image.height],
      );
    }
    return true;
  }

  async function saveSettings(input: unknown): Promise<AdminResult> {
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return fail(400, 'invalid_settings', 'Please check the store settings values.');
    for (const [key, value] of Object.entries(parsed.data)) {
      if (Object.keys(value ?? {}).length === 0) continue;
      await database.query(
        `INSERT INTO store_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = store_settings.value || EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)],
      );
    }
    return { status: 200, body: { settings: await readSettings() } };
  }

  async function readSettings() {
    const result = await database.query('SELECT key, value FROM store_settings');
    const settings: Record<string, unknown> = {};
    for (const row of result.rows) {
      const value = row.value;
      settings[String(row.key)] = typeof value === 'string' ? JSON.parse(value) : value;
    }
    return settings;
  }

  async function listPages() {
    const result = await database.query('SELECT slug, label, path, visible, position FROM site_pages ORDER BY position, slug', []);
    return result.rows.map((row) => ({
      slug: String(row.slug),
      label: String(row.label),
      path: String(row.path),
      visible: Boolean(row.visible),
      position: Number(row.position),
    }));
  }

  async function listDatasets() {
    const result = await database.query('SELECT key, label, visible, seeded FROM demo_datasets ORDER BY key', []);
    return result.rows.map((row) => ({
      key: String(row.key),
      label: String(row.label),
      visible: Boolean(row.visible),
      seeded: Boolean(row.seeded),
    }));
  }

  async function listUsers() {
    const result = await database.query(
      'SELECT id, name, email, role, avatar, status, created_at FROM admin_users ORDER BY created_at, name',
      [],
    );
    return result.rows.map(mapUser);
  }

  async function bulkImport(dataset: string, rows: Array<Record<string, unknown>>) {
    const created: string[] = [];
    const errors: Array<{ row: number; message: string; errors?: Record<string, string> }> = [];

    if (dataset === 'users') {
      for (const [index, row] of rows.entries()) {
        const parsed = userCreateSchema.safeParse({
          name: row.name,
          email: row.email,
          role: row.role,
          password: row.password,
          avatar: row.avatar ?? '',
        });
        if (!parsed.success) {
          errors.push({ row: index + 2, message: 'Check the team member columns.', errors: fieldErrors(parsed.error) });
          continue;
        }
        const result = await database.query(
          'INSERT INTO admin_users (name, email, role, password_hash, avatar) VALUES ($1, $2, $3, $4, NULLIF($5, \'\')) RETURNING id',
          [parsed.data.name, parsed.data.email.toLowerCase(), parsed.data.role, await hashPassword(parsed.data.password), parsed.data.avatar],
        );
        created.push(String(result.rows[0]?.id ?? ''));
      }
      return { created, errors };
    }

    if (dataset === 'products') {
      for (const [index, row] of rows.entries()) {
        const parsed = productCreateSchema.safeParse(row);
        if (!parsed.success) {
          errors.push({ row: index + 2, message: 'Check the product columns.', errors: fieldErrors(parsed.error) });
          continue;
        }
        const product = parsed.data;
        if (product.mrp < product.price) {
          errors.push({ row: index + 2, message: 'The original price must be at least the selling price.', errors: { mrp: 'Lower the original price or raise the selling price.' } });
          continue;
        }
        const result = await database.query(
          `INSERT INTO products (name, category, brand, sku, price, mrp, stock, image, description, published, featured, rating, reviews, badge)
           VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, ''))
           RETURNING id`,
          [
            product.name, product.category, product.brand, product.sku, product.price, product.mrp, product.stock,
            product.image || `${product.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.jpg`,
            product.description, product.published, product.featured, product.rating, product.reviews, product.badge,
          ],
        );
        created.push(String(result.rows[0]?.id ?? ''));
      }
      return { created, errors };
    }

    const collection = collectionByKey.get(dataset);
    if (!collection) return { created, errors };
    for (const [index, row] of rows.entries()) {
      const { values, errors: rowErrors, ok } = validateFields(collection, row, 'create');
      if (!ok) {
        errors.push({ row: index + 2, message: `Check the ${collection.label.toLowerCase()} columns.`, errors: rowErrors });
        continue;
      }
      const reference = await nextReference(collection);
      const columns = ['id', ...Object.keys(values)];
      const result = await database.query(
        `INSERT INTO ${collection.table} (${columns.join(', ')}) VALUES (${columns.map((_column, position) => `$${position + 1}`).join(', ')})
         RETURNING id`,
        [reference, ...Object.keys(values).map((column) => values[column])],
      );
      created.push(String(result.rows[0]?.id ?? ''));
    }
    return { created, errors };
  }

  async function nextReference(collection: Collection) {
    const result = await database.query(`SELECT id FROM ${collection.table} WHERE id LIKE $1 ORDER BY id DESC LIMIT 1`, [`${collection.referencePrefix}-%`]);
    const latest = String(result.rows[0]?.id ?? '');
    const numeric = Number(latest.split('-')[1] ?? '1000');
    return `${collection.referencePrefix}-${(Number.isFinite(numeric) ? numeric : 1000) + 1}`;
  }

  async function handle(request: AdminRequest): Promise<AdminResult> {
    const [resource, ...rest] = request.segments;
    const method = request.method.toUpperCase();
    const id = rest[0];

    if (resource === 'session') {
      if (method === 'POST') {
        await ensureSeeded();
        const parsed = signInSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_credentials', 'Enter a valid email address and password.');
        const result = await database.query(
          'SELECT id, name, email, role, password_hash, avatar, status, created_at FROM admin_users WHERE email = $1',
          [parsed.data.email.toLowerCase()],
        );
        const row = result.rows[0];
        if (!row || row.status !== 'Active' || !(await verifyPassword(parsed.data.password, String(row.password_hash)))) {
          return fail(401, 'invalid_credentials', 'That email address and password do not match a console account.');
        }
        const token = newSessionToken();
        await database.query('INSERT INTO admin_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, row.id, sessionExpiry()]);
        return { status: 201, body: { token, user: mapUser(row) } };
      }
      if (method === 'DELETE') {
        if (request.token) await database.query('DELETE FROM admin_sessions WHERE token = $1', [request.token]);
        return { status: 200, body: { message: 'Signed out of the console.' } };
      }
      return fail(405, 'method_not_allowed', 'Use POST to sign in and DELETE to sign out.');
    }

    const user = await currentUser(request.token);
    if (!user) {
      return fail(401, 'unauthenticated', 'Sign in to the console to continue.');
    }
    await ensureSeeded();

    if (resource === 'me') {
      if (method !== 'GET') return fail(405, 'method_not_allowed', 'The console account cannot be changed from here.');
      return { status: 200, body: { user } };
    }

    if (resource === 'summary') {
      if (method !== 'GET') return fail(405, 'method_not_allowed', 'The console summary is read-only.');
      const [orders, products, jobs, candidates, partners, customers, reviews, pages, datasets] = await Promise.all([
        database.query('SELECT count(*)::int AS total FROM orders'),
        database.query('SELECT count(*)::int AS total FROM products'),
        database.query('SELECT count(*)::int AS total FROM job_vacancies WHERE status = \'Open\''),
        database.query('SELECT count(*)::int AS total FROM candidates'),
        database.query('SELECT count(*)::int AS total FROM partner_salons'),
        database.query('SELECT count(*)::int AS total FROM customers'),
        database.query('SELECT count(*)::int AS total FROM reviews'),
        listPages(),
        listDatasets(),
      ]);
      return {
        status: 200,
        body: {
          orders: Number(orders.rows[0]?.total ?? 0),
          products: Number(products.rows[0]?.total ?? 0),
          jobs: Number(jobs.rows[0]?.total ?? 0),
          candidates: Number(candidates.rows[0]?.total ?? 0),
          partners: Number(partners.rows[0]?.total ?? 0),
          customers: Number(customers.rows[0]?.total ?? 0),
          reviews: Number(reviews.rows[0]?.total ?? 0),
          pages: pages.filter((page) => !page.visible).map((page) => page.slug),
          hiddenDatasets: datasets.filter((dataset) => !dataset.visible).map((dataset) => dataset.key),
        },
      };
    }

    if (resource === 'products') {
      if (method === 'GET') return { status: 200, body: { products: await listProducts() } };
      if (method === 'POST') {
        const parsed = productCreateSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_product', 'Check the product details and try again.', { errors: fieldErrors(parsed.error) });
        const product = parsed.data;
        if (product.mrp < product.price) return fail(400, 'invalid_product', 'The original price must be at least the selling price.');
        const result = await database.query(
          `INSERT INTO products (name, category, brand, sku, price, mrp, stock, image, description, published, featured, rating, reviews, badge)
           VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, $7, $8, $9, $10, $11, $12, $13, NULLIF($14, '')) RETURNING id`,
          [
            product.name, product.category, product.brand, product.sku, product.price, product.mrp, product.stock,
            product.image || `${product.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.jpg`,
            product.description, product.published, product.featured, product.rating, product.reviews, product.badge,
          ],
        );
        const created = await readProduct(Number(result.rows[0]?.id));
        if (!created) return fail(500, 'server_error', 'The product could not be saved.');
        return { status: 201, body: { product: created, message: 'Product added to the catalogue.' } };
      }
      if (method === 'PATCH' || method === 'PUT') {
        const productId = Number(id);
        if (!Number.isSafeInteger(productId) || productId < 1) return fail(400, 'invalid_id', 'That product reference is not valid.');
        const parsed = productUpdateSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_product', 'Check the product details and try again.', { errors: fieldErrors(parsed.error) });
        const update = parsed.data;
        const existing = await readProduct(productId);
        if (!existing) return fail(404, 'not_found', 'That product is no longer in the catalogue.');
        const price = update.price ?? existing.price;
        const mrp = update.mrp ?? existing.mrp;
        if (mrp < price) return fail(400, 'invalid_product', 'The original price must be at least the selling price.');
        const columns: Record<string, unknown> = {};
        if (update.name !== undefined) columns.name = update.name;
        if (update.category !== undefined) columns.category = update.category;
        if (update.brand !== undefined) columns.brand = update.brand || null;
        if (update.sku !== undefined) columns.sku = update.sku || null;
        if (update.price !== undefined) columns.price = update.price;
        if (update.mrp !== undefined) columns.mrp = update.mrp;
        if (update.stock !== undefined) columns.stock = update.stock;
        if (update.rating !== undefined) columns.rating = update.rating;
        if (update.reviews !== undefined) columns.reviews = update.reviews;
        if (update.badge !== undefined) columns.badge = update.badge || null;
        if (update.description !== undefined) columns.description = update.description;
        if (update.published !== undefined) columns.published = update.published;
        if (update.featured !== undefined) columns.featured = update.featured;
        if (Object.keys(columns).length === 0) return fail(400, 'empty_update', 'Change at least one detail before saving.');
        const names = Object.keys(columns);
        try {
          await database.query(
            `UPDATE products SET ${names.map((name, position) => `${name} = $${position + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
            [productId, ...names.map((name) => columns[name])],
          );
        } catch (error) {
          if (isUniqueViolation(error)) return fail(409, 'duplicate_sku', 'That SKU is already in the catalogue. Use a unique SKU or leave it blank.');
          throw error;
        }
        if (update.images && update.images.length > 0) {
          const replaced = await replaceProductImages(productId, update.images);
          if (!replaced) return fail(400, 'invalid_product_image', 'Each image must be a valid JPEG, PNG or WebP file no larger than 1200 × 1200 px or 300 KB.');
        }
        const saved = await readProduct(productId);
        if (!saved) return fail(404, 'not_found', 'That product is no longer in the catalogue.');
        return { status: 200, body: { product: saved, message: 'Product updated.' } };
      }
      if (method === 'DELETE') {
        const productId = Number(id);
        if (!Number.isSafeInteger(productId) || productId < 1) return fail(400, 'invalid_id', 'That product reference is not valid.');
        const result = await database.query('DELETE FROM products WHERE id = $1 RETURNING id', [productId]);
        if (result.rows.length === 0) return fail(404, 'not_found', 'That product is no longer in the catalogue.');
        return { status: 200, body: { deleted: productId, message: 'Product deleted from the catalogue.' } };
      }
      return fail(405, 'method_not_allowed', 'Products support list, create, update and delete.');
    }

    if (resource === 'orders') {
      if (method === 'GET') return { status: 200, body: { orders: await listOrders() } };
      if (method === 'PATCH' || method === 'PUT') {
        const parsed = orderUpdateSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_order', 'Please check the order details.', { errors: fieldErrors(parsed.error) });
        const update = parsed.data;
        const columns: Record<string, unknown> = {};
        if (update.status !== undefined) columns.status = orderColumnValue(update.status);
        if (update.customer !== undefined) columns.customer_name = update.customer;
        if (update.email !== undefined) columns.email = update.email;
        if (update.phone !== undefined) columns.phone = update.phone;
        if (update.address !== undefined) columns.street_address = update.address;
        if (update.locality !== undefined) columns.locality = update.locality;
        if (update.city !== undefined) columns.city = update.city;
        if (update.state !== undefined) columns.state = update.state;
        if (update.postalCode !== undefined) columns.postal_code = update.postalCode;
        if (update.deliveryMethod !== undefined) {
          columns.delivery_method = update.deliveryMethod === 'Express' ? 'express' : update.deliveryMethod === 'Same day' ? 'same_day' : 'standard';
        }
        if (Object.keys(columns).length === 0) return fail(400, 'empty_update', 'Change at least one detail before saving.');
        const names = Object.keys(columns);
        const result = await database.query(
          `UPDATE orders SET ${names.map((name, position) => `${name} = $${position + 2}`).join(', ')} WHERE order_number = $1 RETURNING order_number`,
          [id, ...names.map((name) => columns[name])],
        );
        if (result.rows.length === 0) return fail(404, 'not_found', 'That order no longer exists.');
        const orders = await listOrders();
        const saved = orders.find((order) => order.id === String(result.rows[0]?.order_number));
        return { status: 200, body: { order: saved, message: 'Order updated.' } };
      }
      if (method === 'DELETE') {
        const result = await database.query('DELETE FROM orders WHERE order_number = $1 RETURNING order_number', [id]);
        if (result.rows.length === 0) return fail(404, 'not_found', 'That order no longer exists.');
        return { status: 200, body: { deleted: id, message: 'Order deleted.' } };
      }
      return fail(405, 'method_not_allowed', 'Orders support list, update and delete.');
    }

    if (resource === 'users') {
      if (rest[0] === 'bulk' && method === 'POST') {
        const body = typeof request.body === 'object' && request.body !== null ? request.body as Record<string, unknown> : {};
        const parsed = bulkSchema.safeParse({ ...body, dataset: 'users' });
        if (!parsed.success) return fail(400, 'invalid_bulk', 'Check the spreadsheet and try again.');
        const outcome = await bulkImport('users', parsed.data.rows);
        return { status: 201, body: { ...outcome, message: `${outcome.created.length} team members imported.` } };
      }
      if (method === 'GET') return { status: 200, body: { users: await listUsers(), roles: adminRoles } };
      if (method === 'POST' && !id) {
        const parsed = userCreateSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_user', 'Check the team member details.', { errors: fieldErrors(parsed.error) });
        try {
          const result = await database.query(
            'INSERT INTO admin_users (name, email, role, password_hash, avatar) VALUES ($1, $2, $3, $4, NULLIF($5, \'\')) RETURNING id, name, email, role, avatar, status, created_at',
            [parsed.data.name, parsed.data.email.toLowerCase(), parsed.data.role, await hashPassword(parsed.data.password), parsed.data.avatar],
          );
          return { status: 201, body: { user: mapUser(result.rows[0]), message: 'Team member added.' } };
        } catch (error) {
          if (isUniqueViolation(error)) return fail(409, 'duplicate_email', 'That email address already has a console account.');
          throw error;
        }
      }
      if (id && rest[1] === 'password' && method === 'POST') {
        const parsed = passwordChangeSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_password', parsed.error.issues[0]?.message ?? 'Check the passwords and try again.');
        const result = await database.query('SELECT id, password_hash FROM admin_users WHERE id = $1', [id]);
        const row = result.rows[0];
        if (!row) return fail(404, 'not_found', 'That team member no longer exists.');
        if (!(await verifyPassword(parsed.data.currentPassword, String(row.password_hash)))) {
          return fail(400, 'wrong_password', 'The current password does not match. Nothing was changed.');
        }
        await database.query(
          'UPDATE admin_users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
          [id, await hashPassword(parsed.data.newPassword)],
        );
        await database.query('DELETE FROM admin_sessions WHERE user_id = $1 AND token <> $2', [id, request.token]);
        return { status: 200, body: { message: 'Password changed. Other sessions were signed out.' } };
      }
      if (id && (method === 'PATCH' || method === 'PUT')) {
        const parsed = userUpdateSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_user', 'Check the team member details.', { errors: fieldErrors(parsed.error) });
        const update = parsed.data;
        const columns: Record<string, unknown> = {};
        if (update.name !== undefined) columns.name = update.name;
        if (update.email !== undefined) columns.email = update.email.toLowerCase();
        if (update.role !== undefined) columns.role = update.role;
        if (update.avatar !== undefined) columns.avatar = update.avatar || null;
        if (update.status !== undefined) columns.status = update.status;
        if (Object.keys(columns).length === 0) return fail(400, 'empty_update', 'Change at least one detail before saving.');
        if (id === user.id && update.status === 'Paused') {
          return fail(400, 'self_pause', 'You cannot pause the account you are signed in with.');
        }
        const names = Object.keys(columns);
        try {
          const result = await database.query(
            `UPDATE admin_users SET ${names.map((name, position) => `${name} = $${position + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING id, name, email, role, avatar, status, created_at`,
            [id, ...names.map((name) => columns[name])],
          );
          if (result.rows.length === 0) return fail(404, 'not_found', 'That team member no longer exists.');
          return { status: 200, body: { user: mapUser(result.rows[0]), message: 'Team member updated.' } };
        } catch (error) {
          if (isUniqueViolation(error)) return fail(409, 'duplicate_email', 'That email address already has a console account.');
          throw error;
        }
      }
      if (id && method === 'DELETE') {
        if (id === user.id) return fail(400, 'self_delete', 'You cannot delete the account you are signed in with.');
        const result = await database.query('DELETE FROM admin_users WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return fail(404, 'not_found', 'That team member no longer exists.');
        return { status: 200, body: { deleted: id, message: 'Team member removed.' } };
      }
      return fail(405, 'method_not_allowed', 'Team members support list, create, update, delete and password changes.');
    }

    if (resource === 'settings') {
      if (method === 'GET') return { status: 200, body: { settings: await readSettings() } };
      if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
        const saved = await saveSettings(request.body);
        if (saved.status !== 200) return saved;
        return { status: 200, body: { ...saved.body, message: 'Settings saved.' } };
      }
      return fail(405, 'method_not_allowed', 'Settings are read with GET and saved with PUT.');
    }

    if (resource === 'pages') {
      if (method === 'GET') return { status: 200, body: { pages: await listPages() } };
      if (method === 'PATCH' || method === 'PUT') {
        const parsed = pageUpdateSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_page', 'Choose whether this page stays visible.');
        const result = await database.query(
          'UPDATE site_pages SET visible = $2, updated_at = NOW() WHERE slug = $1 RETURNING slug, visible',
          [id, parsed.data.visible],
        );
        if (result.rows.length === 0) return fail(404, 'not_found', 'That page is not part of the storefront.');
        return {
          status: 200,
          body: {
            page: { slug: String(result.rows[0].slug), visible: Boolean(result.rows[0].visible) },
            message: parsed.data.visible ? 'Page is visible again.' : 'Page hidden from the storefront.',
          },
        };
      }
      return fail(405, 'method_not_allowed', 'Pages support list and visibility changes.');
    }

    if (resource === 'demo-data') {
      if (method === 'GET') return { status: 200, body: { datasets: await listDatasets() } };
      if (method === 'POST') {
        const parsed = demoDataSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_demo_action', 'Choose a dataset and an action.');
        const { dataset, action } = parsed.data;
        if (dataset === 'all') {
          if (action === 'reset-all') {
            for (const entry of demoDatasets) await resetDataset(database, entry.key);
            return { status: 200, body: { datasets: await listDatasets(), message: 'Demo data restored.' } };
          }
          for (const entry of demoDatasets) {
            await database.query('UPDATE demo_datasets SET visible = $2, updated_at = NOW() WHERE key = $1', [entry.key, action === 'show']);
          }
          return { status: 200, body: { datasets: await listDatasets(), message: action === 'show' ? 'Demo data shown again.' : 'Demo data hidden.' } };
        }
        if (action === 'delete') {
          const entry = demoDatasets.find((candidate) => candidate.key === dataset);
          if (!entry) return fail(400, 'invalid_demo_action', 'That dataset is not available.');
          if (dataset === 'orders') {
            await database.query('DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders)');
            await database.query('DELETE FROM orders');
          } else {
            await database.query(`DELETE FROM ${entry.table}`);
          }
          await database.query('UPDATE demo_datasets SET seeded = FALSE, updated_at = NOW() WHERE key = $1', [dataset]);
          return { status: 200, body: { datasets: await listDatasets(), message: `${entry.label} deleted.` } };
        }
        if (action === 'reset') {
          await resetDataset(database, dataset as DemoDatasetKey);
          return { status: 200, body: { datasets: await listDatasets(), message: `${demoDatasets.find((entry) => entry.key === dataset)?.label} restored.` } };
        }
        await database.query('UPDATE demo_datasets SET visible = $2, updated_at = NOW() WHERE key = $1', [dataset, action === 'show']);
        const entry = demoDatasets.find((candidate) => candidate.key === dataset);
        return {
          status: 200,
          body: {
            datasets: await listDatasets(),
            message: action === 'show' ? `${entry?.label} shown again.` : `${entry?.label} hidden.`,
          },
        };
      }
      return fail(405, 'method_not_allowed', 'Demo data supports list and hide, show, delete and reset.');
    }

    if (resource === 'bulk' && method === 'POST') {
      const parsed = bulkSchema.safeParse(request.body);
      if (!parsed.success) return fail(400, 'invalid_bulk', 'Check the spreadsheet and try again.');
      const outcome = await bulkImport(parsed.data.dataset, parsed.data.rows);
      return {
        status: 201,
        body: {
          ...outcome,
          message: outcome.errors.length === 0
            ? `${outcome.created.length} rows imported.`
            : `${outcome.created.length} rows imported, ${outcome.errors.length} skipped.`,
        },
      };
    }

    const collection = resource ? collectionByKey.get(resource) : undefined;
    if (collection) {
      if (method === 'GET') return { status: 200, body: { records: await listCollection(collection) } };
      if (method === 'POST') return createRecord(collection, request.body);
      if (id && (method === 'PATCH' || method === 'PUT')) return updateRecord(collection, id, request.body);
      if (id && method === 'DELETE') return removeRecord(collection, id);
      return fail(405, 'method_not_allowed', 'This collection supports list, create, update and delete.');
    }

    return fail(404, 'not_found', 'That console endpoint does not exist.');
  }

  return {
    handle,
    publicPages: listPages,
    seed: ensureSeeded,
  };
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function fieldErrors(error: z.ZodError) {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map((part) => String(part)).join('.') || 'row';
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}
