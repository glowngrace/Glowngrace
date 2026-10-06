import { z } from 'zod';
import type { Product } from '../data/catalog.js';
import { joinProductTags, mapProduct, parseProductImages, productRichTextSchema, productSlugSchema, productTagsSchema, type ParsedProductImage } from './handlers.js';
import { baseSelect, detailSelect, publishingSelect } from './catalogue.js';
import { sanitizeRichText } from '../lib/rich-text.js';
import {
  collectionByKey,
  mapRow,
  validateFields,
  type Collection,
  type Row,
} from './admin/collections.js';
import { hashPassword, generateStrongPassword, generateOwnerPassword, newSessionToken, newResetToken, passwordPolicy, passwordPolicyError, removedDemoPassword, resetTokenExpiry, resetTokenLookup, sessionExpiry, verifyPassword, hashResetToken } from './admin/passwords.js';
import { consoleRoles, signupRoles, superAdminEmail, superAdminRole } from '../auth/roles.js';
import { ownerCredentialsMessage, saveOwnerPassword } from './admin/owner-password.js';
import { tryDeliverPendingMail } from './mailer.js';
import { datasetCountSql, mapDatasetRowCounts } from './admin/datasets.js';
import { normalizeStoreSettings, validateStoreSettings, type StoreSettings } from './admin/settings.js';
import {
  DatabaseConfigError,
  describeResolvedDatabase,
  maskHost,
  resolveLocalDatabase,
  resolveProductionDatabase,
  syncIsEnabled,
} from './config.js';
import { isPostgresDatabase } from './postgres.js';
import { syncFromNeon, type SyncResult } from './sync-from-neon.js';
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
  switchablePageSlugs,
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

export const adminRoles = consoleRoles;

/**
 * The roles the public registration form offers.
 *
 * Portal roles only, and that is the security boundary rather than a detail of
 * the form: a back-office role is granted from the console. A registration is
 * written as Pending and cannot sign in, so even an approved request is a
 * deliberate act by somebody who can already see the team list.
 */
export { signupRoles };

/** The one account whose password is generated rather than chosen. */
export const ownerAccount = { email: superAdminEmail, role: superAdminRole, name: 'Glow & Grace Super Admin' } as const;

const orderStatusFlow = ['Placed', 'Processing', 'Packed', 'Shipped', 'Delivered'] as const;
const orderStatuses = ['Placed', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Returned', 'Cancelled'] as const;

export const orderStatusFlowList = [...orderStatusFlow];
export const orderStatusesList = [...orderStatuses];

/**
 * The account lifecycle the console enforces: a signup starts as pending and
 * becomes active only when somebody with the right role reviews it.
 *
 * This used to be Active/Paused. The column still defaults to 'Active' and the
 * seeded rows are all Active, so the vocabulary change is invisible until an
 * approval is recorded, at which point the old enum would reject 'Suspended'
 * with a 400 and 'Paused' would violate the database constraint with a 500.
 */
export const userStatuses = ['Pending', 'Active', 'Suspended'] as const;

const password = z.string().min(passwordPolicy.minLength, `Use at least ${passwordPolicy.minLength} characters.`)
  .max(passwordPolicy.maxLength, `Use at most ${passwordPolicy.maxLength} characters.`);

/**
 * Recovery holds a password to exactly the same standard as every other form.
 *
 * It used to be allowed to skip the minimum length so the published sample
 * credential could be put back. With no demo accounts there is no such
 * credential, so the ordinary policy is the whole rule.
 */
const recoveryPassword = password;

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
  status: z.enum(userStatuses).optional(),
  phone: z.string().trim().max(24).optional(),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(passwordPolicy.maxLength),
  newPassword: password,
});

/**
 * Recovery does not ask for the current password, which is the whole point: the
 * operator either cannot read it or is locked out of the account that would let
 * them change it.
 */
const passwordRecoverSchema = z.object({ newPassword: recoveryPassword });

/** One password applied to every console account, for restoring the demo state. */
const passwordRecoverAllSchema = z.object({ newPassword: recoveryPassword });

const passwordResetRequestSchema = z.object({ email: z.string().trim().email().max(254) });

const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(32).max(200),
  newPassword: password,
});

/**
 * The owner's password, as it arrives from the screen.
 *
 * The generated value goes out as a response and comes back in a body, because
 * the point of the flow is that the operator can edit what was generated before
 * keeping it. It is held to exactly the policy every other password in the
 * project is held to - the same `password` schema as a change and a reset - so a
 * hand-typed value cannot buy a shorter or longer credential than the sign-in
 * form would accept.
 */
const ownerPasswordSchema = z.object({ password });

/**
 * The public registration form.
 *
 * Unauthenticated by necessity, so it is deliberately narrow: no status, no
 * role beyond the published list, and nothing that would let a caller grant
 * themselves access. `role` is checked against `signupRoles` rather than
 * `adminRoles`, because a visitor asking for "Partner Salon" has to be
 * describable here too.
 */
const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  role: z.enum(signupRoles),
  password,
  phone: z.string().trim().max(24).optional().default(''),
});

/** A newly uploaded product image, still base64 in the request body. */
const productImageUpload = z.object({
  filename: z.string().trim().min(1).max(180).regex(/^[^\\/]+$/),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.string().max(409600),
  width: z.number().int().min(1).max(1200),
  height: z.number().int().min(1).max(1200),
});

/**
 * One entry in a product's gallery, as the console sends it.
 *
 * Alongside a fresh upload, an entry may be the URL of an image the product
 * already has. That is what lets the edit form show the saved gallery, reorder it
 * and drop one entry without re-encoding bytes the browser never held: a kept URL
 * has its stored row copied through untouched by `setProductImages`.
 *
 * A create cannot keep anything, so it takes uploads only.
 */
const productImageWrite = z.union([
  productImageUpload,
  z.string().trim().regex(/^\/api\/products\/\d+\/images\/\d+$/, 'That is not an image URL of a product.'),
]);

const productImageUploads = z.array(productImageUpload).max(10).optional();

/**
 * The session token a request is answered against, or null.
 *
 * `newSessionToken()` mints a UUID and `admin_sessions.token` is a `uuid`
 * column, so anything else cannot match a session. It has to be recognised
 * here rather than by the query: passed through, a token that is not a UUID
 * makes Postgres raise `invalid input syntax for type uuid`, which the route
 * catches as a 500. A browser holding a stale or truncated token would then be
 * told the console is broken instead of being asked to sign in again.
 */
const sessionTokenSchema = z.string().uuid();

function sessionToken(token?: string | null) {
  if (!token) return null;
  const parsed = sessionTokenSchema.safeParse(token);
  return parsed.success ? parsed.data : null;
}

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
  description: productRichTextSchema.optional(),
  slug: productSlugSchema.optional(),
  metaTitle: z.string().trim().max(180).optional(),
  metaDescription: productRichTextSchema.optional(),
  shades: productTagsSchema.optional(),
  highlights: productTagsSchema.optional(),
  featuresAndSpecification: productRichTextSchema.optional(),
  measurement: productRichTextSchema.optional(),
  materialAndCare: productRichTextSchema.optional(),
  additionalDetails: productRichTextSchema.optional(),
  itemDetails: productRichTextSchema.optional(),
  published: flag.optional(),
  featured: flag.optional(),
  /**
   * The complete gallery, or `undefined` to leave it alone. A present array is
   * authoritative, which is why the console only sends one when the operator
   * actually changed the gallery.
   */
  images: z.array(productImageWrite).max(10).optional(),
});

export const productCreateSchema = z.object({
  name: z.string().trim().min(2).max(180),
  category: z.enum(['Makeup', 'Skincare', 'Fragrance', 'Gifting']),
  brand: z.string().trim().max(120).optional().default(''),
  sku: z.string().trim().max(64).optional().default(''),
  price: z.coerce.number().int().positive().max(99999999),
  mrp: z.coerce.number().int().positive().max(99999999),
  stock: z.coerce.number().int().min(0).max(999999),
  description: z.string().trim().min(1, 'A description is required.').max(3000).transform(sanitizeRichText),
  published: flag.default(true),
  featured: flag.default(false),
  rating: z.coerce.number().min(0).max(5).optional().default(0),
  reviews: z.coerce.number().int().min(0).max(999999).optional().default(0),
  badge: z.string().trim().max(40).optional().default(''),
  image: z.string().trim().max(180).optional().default(''),
  slug: productSlugSchema.optional().default(''),
  metaTitle: z.string().trim().max(180).optional().default(''),
  metaDescription: productRichTextSchema.optional().default(''),
  shades: productTagsSchema.optional().default([]),
  highlights: productTagsSchema.optional().default([]),
  featuresAndSpecification: productRichTextSchema.optional().default(''),
  measurement: productRichTextSchema.optional().default(''),
  materialAndCare: productRichTextSchema.optional().default(''),
  additionalDetails: productRichTextSchema.optional().default(''),
  itemDetails: productRichTextSchema.optional().default(''),
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

/**
 * `mapUser` is also handed rows whose SELECT predates a column, because
 * `currentUser` and the sign-in query are deliberately narrow. Reading an absent
 * key must therefore produce an empty string rather than the text "undefined",
 * which is what a bare String(row.x) would put in front of an operator.
 */
function text(value: unknown) {
  return value === null || value === undefined ? '' : String(value);
}

function stamp(value: unknown): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapUser(row: Row) {
  return {
    id: text(row.id),
    name: text(row.name),
    email: text(row.email),
    role: text(row.role),
    avatar: text(row.avatar),
    status: text(row.status) || 'Active',
    phone: text(row.phone),
    source: text(row.source) || 'console',
    reviewedAt: stamp(row.reviewed_at),
    createdAt: stamp(row.created_at) ?? text(row.created_at),
  };
}

/** The console columns every user-facing query and RETURNING clause needs. */
const userColumns = 'id, name, email, role, avatar, status, phone, source, reviewed_at, created_at';

const orderSelect = `SELECT order_record.id, order_record.order_number, order_record.customer_name, order_record.email,
  order_record.phone, order_record.street_address, order_record.locality, order_record.city, order_record.state,
  order_record.postal_code, order_record.delivery_method, order_record.status, order_record.total_paise,
  order_record.created_at, (SELECT count(*)::int FROM order_items AS item WHERE item.order_id = order_record.id) AS item_count
  FROM orders AS order_record`;

const productImagesSelect = `COALESCE(
    (SELECT json_agg('/api/products/' || product.id || '/images/' || image.position ORDER BY image.position)
     FROM product_images AS image WHERE image.product_id = product.id),
    '[]'::json
  ) AS images`;

/** The one product query the console reads, with every product column named. */
function productSelect() {
  return `SELECT ${baseSelect('product')},
  ${detailSelect('product')},
  ${publishingSelect('product')},
  ${productImagesSelect}
  FROM products AS product`;
}

/** The parsed shape both the console form and a bulk upload row arrive in. */
type InsertableProduct = z.infer<typeof productCreateSchema>;

/**
 * One INSERT builder for the console form and the bulk upload template.
 *
 * They were two copies of the same hand-numbered 24-placeholder string, which is
 * how the two drifted apart and why a new column had to be renumbered twice. The
 * placeholders are generated from the column list here, so every other number
 * shifts safely when one is added.
 */
function productInsert(product: InsertableProduct) {
  // name, value, and whether an empty string should become NULL.
  const columns: Array<[string, unknown, boolean]> = [
    ['name', product.name, false],
    ['category', product.category, false],
    ['brand', product.brand, true],
    ['sku', product.sku, true],
    ['price', product.price, false],
    ['mrp', product.mrp, false],
    ['stock', product.stock, false],
    ['image', product.image || `${product.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.jpg`, false],
    ['description', product.description, false],
    ['slug', product.slug, true],
    ['meta_title', product.metaTitle, true],
    ['meta_description', product.metaDescription, true],
    ['shades', joinProductTags(product.shades), false],
    ['highlights', joinProductTags(product.highlights), false],
    ['features_and_specification', product.featuresAndSpecification, true],
    ['measurement', product.measurement, true],
    ['material_and_care', product.materialAndCare, true],
    ['additional_details', product.additionalDetails, true],
    ['item_details', product.itemDetails, true],
    ['published', product.published, false],
    ['featured', product.featured, false],
    ['rating', product.rating, false],
    ['reviews', product.reviews, false],
    ['badge', product.badge, true],
  ];
  return {
    values: columns.map(([, value]) => value),
    text: `INSERT INTO products (${columns.map(([name]) => name).join(', ')})
      VALUES (${columns.map(([, , nullable], position) => {
        const placeholder = `$${position + 1}`;
        return nullable ? `NULLIF(${placeholder}, '')` : placeholder;
      }).join(', ')}) RETURNING id`,
  };
}

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
 * Replaces the published password on a row that is still sitting on it.
 *
 * The console used to be seeded with an administrator whose password was printed
 * in the README, so an old database can still hold a row that anybody can sign
 * in with. Deleting the row is not an option: this file is replayed on every
 * migration run, and a row an operator has since given a real password must
 * survive that. Comparing the stored hash against a hardcoded one does not work
 * either, because every hash carries its own random salt, so such a comparison
 * only ever matches the single row the value was copied from.
 *
 * So the question is answered where it can be: by verifying the password against
 * the row's own salt. A row holding anything an operator chose does not verify, so
 * it is left exactly as it is.
 */
async function retirePublishedAdminPassword(database: Database) {
  const found = await database.query(
    'SELECT id, password_hash FROM admin_users WHERE email = $1',
    ['admin@glowngrace.in'],
  );
  const row = found.rows[0] as { id: string; password_hash: string } | undefined;
  if (!row) return;
  if (!await verifyPassword(removedDemoPassword, String(row.password_hash))) return;

  // Replaced rather than deleted: the address is the console's stable entry
  // point, and the replacement is a password nobody holds, which is the state the
  // reset script exists to claim from.
  await database.query(
    'UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
    [await hashPassword(generateStrongPassword()), row.id],
  );
  // Any session opened with the published password is worthless now.
  await database.query('DELETE FROM admin_sessions WHERE user_id = $1', [row.id]);
}

/**
 * The five colleagues the console used to be seeded with, all sharing the one
 * published password.
 *
 * Kept as a named list rather than a SQL `IN` clause because what happens to each
 * of these rows is decided one at a time.
 */
export const publishedDemoAdminEmails = [
  'deepak@glowngrace.in',
  'aditi@glowngrace.in',
  'rohit@glowngrace.in',
  'neha@glowngrace.in',
  'karan@glowngrace.in',
] as const;

/**
 * Removes the seeded colleagues that are still sitting on the published password,
 * and leaves alone the ones that have been claimed.
 *
 * A migration used to delete these five by address, on the reasoning that a
 * demo row is nothing an operator would keep. Production disproved that:
 * `deepak@glowngrace.in` had been claimed with a password somebody chose, and a
 * delete by address takes the account and its history with it, unasked. The
 * reasoning that already protected `admin@glowngrace.in` applies here unchanged,
 * so it is applied here: a row is only removed while the password it holds still
 * verifies against the published one.
 *
 * A claimed row therefore survives with the password its owner chose, and an
 * unclaimed one goes, which is the whole point - after this, no account anywhere is
 * reachable with a credential that was printed in a README. Anything still signed
 * in with the published password has its sessions destroyed in the same call.
 */
async function retirePublishedDemoAccounts(database: Database) {
  for (const email of publishedDemoAdminEmails) {
    const found = await database.query(
      'SELECT id, password_hash FROM admin_users WHERE email = $1',
      [email],
    );
    const row = found.rows[0] as { id: string; password_hash: string } | undefined;
    if (!row) continue;
    if (!await verifyPassword(removedDemoPassword, String(row.password_hash))) continue;

    await database.query('DELETE FROM admin_users WHERE id = $1', [row.id]);
    // A session opened with the published password is worthless now, and the row
    // it belonged to is gone anyway.
    await database.query('DELETE FROM admin_sessions WHERE user_id = $1', [row.id]);
  }
}

/**
 * Brings a freshly migrated database up to the console's starting point: the
 * storefront page list, the preview collections and the one bootstrap
 * administrator. Running it twice is a no-op, so it doubles as the
 * "reset demo data" replay.
 */
/**
 * The owner's first password.
 *
 * Normally this is generated and mailed, because an account whose password was
 * typed by a human is an account whose password is in a shell history and a
 * password manager. But the store starts empty on every boot, so a generated
 * password that could not be mailed leaves nobody able to open the console at
 * all - the outbox row dies with the process.
 *
 * `OWNER_PINNED_PASSWORD` is the way out, and the only reason it is read here. It
 * used to need `OWNER_PINNED_HOLD_UNTIL` naming the moment the weekly rotation
 * took it back. There is no rotation now - the owner chooses the password, on
 * `/superadmin/ggpass`, and it lasts until they choose another - so a pinned seed
 * password is a bootstrap rather than a time bomb and needs no date.
 */
function seededOwnerCredentials() {
  const pinned = process.env.OWNER_PINNED_PASSWORD?.trim();
  if (!pinned) return { password: generateOwnerPassword(), pinned: false };

  const refused = passwordPolicyError(pinned);
  if (refused) throw new Error(`OWNER_PINNED_PASSWORD was refused: ${refused}`);
  return { password: pinned, pinned: true };
}

/**
 * Creates the console's own starting content, including the sample orders.
 *
 * Returns the sample order lines that could not be attached to a product. A line
 * is only written when a `products` row matches its name, so seeding before the
 * catalogue exists produces orders with no lines rather than lines pointing at
 * products that do not exist. Callers that have a catalogue to offer should seed
 * that first and check this came back empty.
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
  // `product_id` is resolved from `products` by name rather than written as a
  // literal, so a line can only be attached to a product that exists. The name is
  // looked up first, separately, because the insert's own `rowCount` of 0 means
  // two different things - the line is already there, or there was no product to
  // attach it to - and only the second is worth reporting.
  const unattachedOrderItems: string[] = [];
  for (const item of orderItemSeeds) {
    const product = await database.query('SELECT id FROM products WHERE name = $1 LIMIT 1', [item.productName]);
    if (product.rows.length === 0) {
      unattachedOrderItems.push(`${item.orderNumber} / ${item.productName}`);
      continue;
    }
    const productId = (product.rows[0] as { id: number }).id;
    await database.query(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price_paise, quantity)
       SELECT id, $2, $3, $4, $5 FROM orders WHERE order_number = $1 AND NOT EXISTS (
         SELECT 1 FROM order_items AS existing
         WHERE existing.order_id = orders.id AND existing.product_id = $2 AND existing.quantity = $5
       )`,
      [item.orderNumber, productId, item.productName, item.unitPricePaise, item.quantity],
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
// A random secret nobody holds, not a published one. The address exists so
  // the console has a stable second owner to be opened with, but the only way in
  // is the owner account below, or an admin resetting this one by hand.
  [await hashPassword(generateStrongPassword())],
  );
  await retirePublishedAdminPassword(database);
  await retirePublishedDemoAccounts(database);
  // The owner account. Nobody chooses this password: it is generated here, stored
  // hashed, and written to the outbox, because seeding happens with nobody at the
  // keyboard and an account whose password reached nobody is the same as no
  // account at all. `/superadmin/ggpass` is the on-demand version, and it shows
  // the password on screen instead of mailing it, because there is a person there.
  //
  // The outbox row is only written when the insert actually created the row, so a
  // boot that finds the account already there does not mail a password that was
  // never stored. A pinned password is the one exception: the operator already has
  // it, so mailing it back would be noise.
  const { password: ownerPassword, pinned } = seededOwnerCredentials();
  const created = await database.query(
    `INSERT INTO admin_users (id, name, email, role, password_hash, avatar, status)
     VALUES ('00000000-0000-4000-8000-0000000000f1', $1, $2, $3, $4, '/images/partner1.jpg', 'Active')
     ON CONFLICT (email) DO NOTHING`,
    [ownerAccount.name, ownerAccount.email, ownerAccount.role, await hashPassword(ownerPassword)],
  );
  if (created.rowCount && !pinned) {
    const message = ownerCredentialsMessage({ password: ownerPassword, role: ownerAccount.role, now: new Date() });
    await database.query(
      `INSERT INTO email_outbox (kind, recipient, subject, body)
       VALUES ('owner-credentials', $1, $2, $3)`,
      [ownerAccount.email, message.subject, message.body],
    );
    // Sent straight away, because this password is generated once and its hash is
    // already in place. The row stays in the outbox either way.
    await tryDeliverPendingMail(database);
  }
  return { unattachedOrderItems };
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
  const reseeded = await seedAdminData(database);
  if (reseeded.unattachedOrderItems.length > 0) {
    // A shop with no products yet: the sample orders are created, but their lines
    // name products that are not there, so they are left out rather than written
    // against an invented id. Worth a line in the log, because "I reseeded orders
    // and they have no items" is otherwise a confusing thing to find.
    console.warn(`Reseeding orders left ${reseeded.unattachedOrderItems.length} line(s) out: this database has no matching products.`);
  }
  await database.query(
    'UPDATE demo_datasets SET visible = TRUE, seeded = TRUE, updated_at = NOW() WHERE key = $1',
    [dataset],
  );
}

const syncRequestSchema = z.object({
  skipImages: z.boolean().optional(),
  force: z.boolean().optional(),
}).partial();

/**
 * What the console's "Sync from Neon" panel shows before anything is pressed.
 *
 * Reports both ends without connecting to either, and never includes a password:
 * the local host is printed plainly and the Neon one masked, which is enough to
 * tell "pointed at the wrong project" from "pointed at nothing".
 */
export function describeLocalDatabase(database: Database) {
  let local: { connection: string } | { connection: string } | { error: string } = { error: '' };
  try {
    local = { connection: describeResolvedDatabase(resolveLocalDatabase()) };
  } catch (error) {
    local = { error: error instanceof Error ? error.message : String(error) };
  }

  let neon: Record<string, unknown>;
  try {
    const production = resolveProductionDatabase();
    neon = {
      configured: true,
      project: process.env.NEON_PROJECT_NAME ?? null,
      host: maskHost(production.description.host),
      connection: describeResolvedDatabase(production),
    };
  } catch (error) {
    neon = {
      configured: false,
      project: process.env.NEON_PROJECT_NAME ?? null,
      reason: error instanceof DatabaseConfigError
        ? error.message
        : error instanceof Error ? error.message : String(error),
    };
  }

  return {
    store: isPostgresDatabase(database) ? 'postgres' : 'memory',
    local,
    neon,
    syncEnabled: syncIsEnabled(),
  };
}

async function syncNeonIntoLocal(body: unknown): Promise<AdminResult> {
  const parsed = syncRequestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return fail(400, 'invalid_request', 'Send skipImages and force as booleans, or nothing at all.');
  }
  try {
    const result: SyncResult = await syncFromNeon({
      skipImages: parsed.data.skipImages === true,
      force: parsed.data.force === true,
      log: (message) => console.log('[neon sync]', message),
    });
    return {
      status: 200,
      body: {
        status: result.status,
        message: result.message,
        source: result.source,
        target: result.target,
        copied: result.copied,
        available: result.available,
        skipImages: result.skipImages,
        durationMs: result.durationMs,
      },
    };
  } catch (error) {
    if (error instanceof DatabaseConfigError) {
      return fail(503, 'database_not_configured', error.message);
    }
    const cause = error as { code?: string; message?: string };
    console.error('The Neon sync failed', error);
    return fail(502, 'sync_failed', `${cause?.message ?? String(error)}. Nothing was pushed back: data only ever flows from production to local.`);
  }
}

export function createAdminHandlers(database: Database) {
  let seeded: Promise<void> | undefined;
  const ensureSeeded = () => {
    // Discarded here: this is the boot path on an empty database, where the
    // catalogue is not written, so unattached order lines are expected.
    seeded ??= seedAdminData(database).then(() => undefined).catch((error: unknown) => {
      console.error('Unable to seed admin data', error);
      // A rejected promise must not stay cached, or every later request would
      // replay a failure that has already been fixed.
      seeded = undefined;
      throw error;
    });
    return seeded;
  };

  /**
   * Whether an id is the owner account.
   *
   * The address is the identity, not the id, so this survives a row being
   * recreated and it cannot be fooled by a client that made up an id.
   */
  async function isOwnerAccount(id: string) {
    const found = await database.query('SELECT 1 FROM admin_users WHERE id = $1 AND email = $2', [id, superAdminEmail]);
    return found.rows.length > 0;
  }

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
    const result = await database.query(`${productSelect()} ORDER BY product.id`, []);
    return result.rows.map((row) => mapProduct(row) as Product);
  }

  async function readProduct(productId: number) {
    const result = await database.query(`${productSelect()} WHERE product.id = $1`, [productId]);
    return result.rows[0] ? mapProduct(result.rows[0]) : null;
  }

  async function insertProductImages(productId: number, images: ParsedProductImage[]) {
    for (const image of images) {
      await database.query(
        `INSERT INTO product_images (product_id, position, filename, mime_type, image_data, width, height)
         VALUES ($1, $2, $3, $4, decode($5, 'base64'), $6, $7)`,
        [productId, image.position, image.filename, image.mimeType, image.data, image.width, image.height],
      );
    }
  }

  /**
   * Rewrites a product's gallery to exactly the set it was given.
   *
   * The set is authoritative, so an entry the console left out really was removed.
   * That is only safe because a kept URL is a real reference: its stored row is
   * copied through instead of being dropped, which is what used to go wrong. An
   * edit form that could only send freshly picked files replaced the whole gallery
   * with them, so adding one image silently deleted the rest.
   *
   * Nothing is deleted until the whole set has been resolved and validated, so a
   * rejected edit leaves the existing gallery intact.
   */
  async function setProductImages(productId: number, images: Array<z.infer<typeof productImageWrite>>) {
    const existing = await database.query(
      'SELECT position, filename, mime_type, image_data, width, height FROM product_images WHERE product_id = $1',
      [productId],
    );
    const stored = new Map(existing.rows.map((row) => [Number(row.position), row]));

    const wanted: Array<{ filename: string; mimeType: string; data: string; width: number; height: number }> = [];
    for (const item of images) {
      if (typeof item !== 'string') {
        wanted.push(item);
        continue;
      }
      const row = stored.get(Number(item.slice(item.lastIndexOf('/') + 1)));
      // A URL for a row that is gone, or for another product, cannot be honoured.
      if (!row) return false;
      wanted.push({
        filename: text(row.filename),
        mimeType: text(row.mime_type),
        data: Buffer.from(row.image_data as Buffer).toString('base64'),
        width: Number(row.width),
        height: Number(row.height),
      });
    }

    const { images: valid, invalid } = parseProductImages(wanted);
    if (invalid) return false;
    await database.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
    await insertProductImages(productId, valid);
    return true;
  }

  /**
   * Reads the settings and normalises them.
   *
   * `store_settings` holds one JSONB row per section, so a section can be
   * missing entirely or hold a value an older build accepted. Normalising here
   * means `GET /api/admin/settings` and every `PUT` response are the same
   * complete shape, which is what the console's controlled inputs need.
   */
  async function readSettings(): Promise<{ settings: StoreSettings; updatedAt: string | null }> {
    const result = await database.query('SELECT key, value, updated_at FROM store_settings');
    const stored: Record<string, unknown> = {};
    let updatedAt: Date | null = null;
    for (const row of result.rows) {
      const value = row.value;
      stored[String(row.key)] = typeof value === 'string' ? JSON.parse(value) : value;
      const stamp = row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at ?? ''));
      if (!Number.isNaN(stamp.getTime()) && (updatedAt === null || stamp > updatedAt)) updatedAt = stamp;
    }
    return { settings: normalizeStoreSettings(stored), updatedAt: updatedAt?.toISOString() ?? null };
  }

  /**
   * Writes the sections the client actually sent.
   *
   * Sections are merged at the JSONB level, so a delivery change never
   * rewrites the profile and a notification switch never rewrites the
   * thresholds. That is what stops one half-typed form from breaking another:
   * the console now sends a single section per save, and this persists exactly
   * that section.
   */
  async function saveSettings(input: unknown): Promise<AdminResult> {
    const validation = validateStoreSettings(input);
    if (!validation.ok) {
      return fail(400, 'invalid_settings', 'Please check the highlighted settings and try again.', { errors: validation.errors });
    }
    for (const section of validation.sections) {
      const value = validation.update[section as keyof typeof validation.update];
      if (!value) continue;
      await database.query(
        `INSERT INTO store_settings (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = store_settings.value || EXCLUDED.value, updated_at = NOW()`,
        [section, JSON.stringify(value)],
      );
    }
    const saved = await readSettings();
    return { status: 200, body: { settings: saved.settings, updatedAt: saved.updatedAt } };
  }

  /**
   * The pages the console may switch on and off.
   *
   * The storefront keeps receiving every row from `publicPages`, because the
   * gates and navigation need to know the state of all of them. The console
   * only ever sees the three editorial pages it is allowed to change.
   */
  async function listSwitchablePages() {
    const all = await listPages();
    return all.filter((page) => (switchablePageSlugs as readonly string[]).includes(page.slug));
  }

  /**
 * The pages, falling back to the bundled list while the store is empty.
 *
 * The store starts empty, so an unseeded deployment would otherwise serve a
 * storefront with no navigation at all. Every page is shown until the console
 * says otherwise, which is what a page with no saved visibility looks like.
 */
async function listPages() {
    const result = await database.query('SELECT slug, label, path, visible, position FROM site_pages ORDER BY position, slug', []);
    if (result.rows.length === 0) return sitePageSeeds.map((page) => ({ ...page, visible: true }));
    return result.rows.map((row) => ({
      slug: String(row.slug),
      label: String(row.label),
      path: String(row.path),
      visible: Boolean(row.visible),
      position: Number(row.position),
    }));
  }

  async function listDatasets() {
    const [rows, counts] = await Promise.all([database.query('SELECT key, label, visible, seeded FROM demo_datasets ORDER BY key', []), datasetRowCounts()]);
    const tableCounts = mapDatasetRowCounts(counts.keys, counts.rows[0]);
    return rows.rows.map((row) => ({
      key: String(row.key),
      label: String(row.label),
      visible: Boolean(row.visible),
      seeded: Boolean(row.seeded),
      rowCount: tableCounts[String(row.key)] ?? 0,
    }));
  }

  async function datasetRowCounts() {
    const { sql, keys } = datasetCountSql();
    return { keys, rows: (await database.query(sql, [])).rows };
  }

  async function listUsers() {
    const result = await database.query(
      `SELECT ${userColumns} FROM admin_users ORDER BY created_at, name`,
      [],
    );
    return result.rows.map(mapUser);
  }

  /**
   * Writes a new hash and ends every session the account holds.
   *
   * Every path that sets a password ends up here, so "the old password is no
   * longer trustworthy" is true of all of them: a session minted before a reset
   * must not survive it. The caller's own session is passed through when it
   * belongs to the same account, because otherwise an administrator recovering
   * their own password would be signed out by the request that fixed it.
   */
  async function setPassword(userId: string, newPassword: string, keepToken?: string | null) {
    await database.query(
      'UPDATE admin_users SET password_hash = $2, updated_at = NOW() WHERE id = $1',
      [userId, await hashPassword(newPassword)],
    );
    const token = keepToken ?? null;
    await database.query(
      token
        ? 'DELETE FROM admin_sessions WHERE user_id = $1 AND token <> $2'
        : 'DELETE FROM admin_sessions WHERE user_id = $1',
      token ? [userId, token] : [userId],
    );
  }

  /**
   * Starts the forgot-password flow.
   *
   * There is no SMTP transport in this deployment, so the message is written to
   * `email_outbox` and read back by the console rather than sent. The response
   * is identical whether or not the address has an account, because a differing
   * answer is an account-existence oracle on an unauthenticated route.
   */
  async function requestPasswordReset(input: unknown): Promise<AdminResult> {
    const parsed = passwordResetRequestSchema.safeParse(input);
    if (!parsed.success) return fail(400, 'invalid_email', 'Enter the email address for the account.');
    await ensureSeeded();
    const found = await database.query('SELECT id, name, email FROM admin_users WHERE email = $1', [parsed.data.email.toLowerCase()]);
    const account = found.rows[0];
    // A fixed string, and not one that repeats the address back. A response that
    // varies with the address is an account-existence oracle on an
    // unauthenticated route, however reassuring the wording.
    const message = 'If that address has a console account, a reset link is waiting for it.';
    if (!account) return { status: 200, body: { message } };

    // One live link at a time, so an older message in the outbox cannot be used
    // after the account holder has asked for a new one.
    await database.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [account.id]);

    const token = newResetToken();
    const expiresAt = resetTokenExpiry();
    const { tokenHash, tokenLookup } = await hashResetToken(token);
    await database.query(
      'INSERT INTO password_resets (user_id, token_hash, token_lookup, expires_at) VALUES ($1, $2, $3, $4)',
      [account.id, tokenHash, tokenLookup, expiresAt],
    );

    // A path rather than an absolute URL: the API has no reliable view of the
    // public host, and the console renders the link against the origin the
    // operator is already on.
    const path = `/reset-password?token=${token}`;
    await database.query(
      `INSERT INTO email_outbox (kind, recipient, subject, body)
       VALUES ('password-reset', $1, $2, $3)`,
      [
        text(account.email),
        'Your Glow & Grace console password',
        [
          `Hello ${text(account.name)},`,
          '',
          'Someone asked to reset the console password for this address. Open the link below to choose a new one.',
          `It works once and stops working at ${expiresAt.toISOString()}.`,
          '',
          path,
          '',
          'If this was not you, no action is needed: the old password still works until a reset completes.',
        ].join('\n'),
      ],
    );
    return { status: 200, body: { message } };
  }

  /**
   * Completes the forgot-password flow with a token and a new password.
   *
   * Unauthenticated by necessity, so every failure answers the same way: a
   * caller must not be able to tell an expired token from a wrong one from one
   * that never existed.
   */
  async function confirmPasswordReset(input: unknown): Promise<AdminResult> {
    const parsed = passwordResetConfirmSchema.safeParse(input);
    if (!parsed.success) {
      return fail(400, 'invalid_password', parsed.error.issues[0]?.message ?? 'Check the new password and try again.');
    }
    await ensureSeeded();
    const invalid = fail(400, 'invalid_reset_token', 'That reset link has expired or has already been used. Ask for a new one.');

    const tokenLookup = resetTokenLookup(parsed.data.token);
    const found = await database.query(
      `SELECT reset.id, reset.user_id, reset.token_hash
       FROM password_resets AS reset
       WHERE reset.token_lookup = $1 AND reset.used_at IS NULL AND reset.expires_at > NOW()`,
      [tokenLookup],
    );
    const row = found.rows[0];
    if (!row) return invalid;
    // token_lookup only narrows the search. The scrypt hash is what decides.
    if (!(await verifyPassword(parsed.data.token, String(row.token_hash)))) return invalid;

    await setPassword(text(row.user_id), parsed.data.newPassword);
    await database.query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [row.id]);
    return { status: 200, body: { message: 'Password updated. You can sign in with it now.' } };
  }

  /**
   * The public registration form.
   *
   * The row is written as Pending, so the account exists but cannot sign in:
   * `POST /session` and `currentUser` both require Active. Nothing here decides
   * whether the requested role is a sensible one either, because that judgement
   * belongs to the administrator who reviews it in the console.
   *
   * The duplicate-email answer does name the clash, unlike the forgot-password
   * route. That is the right trade on a registration form: the address is the
   * visitor's own, and telling them to sign in instead is more useful than a
   * neutral message that leaves them stuck in a loop.
   */
  async function registerSignup(input: unknown): Promise<AdminResult> {
    const parsed = signupSchema.safeParse(input);
    if (!parsed.success) return fail(400, 'invalid_signup', 'Check the details below and try again.', { errors: fieldErrors(parsed.error) });
    await ensureSeeded();
    const email = parsed.data.email.toLowerCase();

    const taken = await database.query('SELECT id FROM admin_users WHERE email = $1', [email]);
    if (taken.rows[0]) {
      return fail(409, 'duplicate_email', 'That email address already has an account. Sign in instead, or reset its password.');
    }

    let created;
    try {
      created = await database.query(
        `INSERT INTO admin_users (name, email, role, password_hash, phone, status, source)
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), 'Pending', 'signup')
         RETURNING ${userColumns}`,
        [parsed.data.name, email, parsed.data.role, await hashPassword(parsed.data.password), parsed.data.phone],
      );
    } catch (error) {
      // Two people can reach the form for the same address at the same time, so
      // the check above is a courtesy and this is what actually holds the line.
      if (isUniqueViolation(error)) {
        return fail(409, 'duplicate_email', 'That email address already has an account. Sign in instead, or reset its password.');
      }
      throw error;
    }

    const account = mapUser(created.rows[0]);
    await database.query(
      `INSERT INTO email_outbox (kind, recipient, subject, body)
       VALUES ('signup', $1, $2, $3)`,
      [
        text(account.email),
        'Your Glow & Grace account is waiting for approval',
        [
          `Hello ${text(account.name)},`,
          '',
          `We have your request for the ${text(account.role)} role.`,
          'An administrator reviews each request, and we will write again as soon as yours has been looked at.',
          'You cannot sign in until then, and you do not need to do anything else now.',
        ].join('\n'),
      ],
    );

    return {
      status: 201,
      body: {
        user: account,
        // The one thing a visitor needs to know, and the reason they cannot sign
        // in yet. It is deliberately not a session: the account is not Active.
        message: 'Thanks. Your request is with our team, and an administrator will review it before you can sign in.',
      },
    };
  }

  /**
   * The reset messages the deployment would have sent.
   *
   * This is how a locked-out operator gets their link: there is no mail server,
   * so the console is the delivery channel and this is the inbox.
   */
  async function listResetMessages() {
    const result = await database.query(
      `SELECT id, kind, recipient, subject, body, created_at, read_at
       FROM email_outbox WHERE kind = 'password-reset' ORDER BY created_at DESC LIMIT 20`,
      [],
    );
    return result.rows.map((row) => ({
      id: text(row.id),
      recipient: text(row.recipient),
      subject: text(row.subject),
      body: text(row.body),
      createdAt: stamp(row.created_at),
      readAt: stamp(row.read_at),
    }));
  }

  /**
   * Resets one account's password without asking for the current one.
   *
   * A signed-in administrator doing this for a colleague is the supported way
   * back into an account whose password has drifted away.
   */
  async function recoverPassword(userId: string, newPassword: string, token: string | null): Promise<AdminResult> {
    const found = await database.query(`SELECT ${userColumns} FROM admin_users WHERE id = $1`, [userId]);
    const account = found.rows[0];
    if (!account) return fail(404, 'not_found', 'That team member no longer exists.');
    await setPassword(userId, newPassword, token);
    return {
      status: 200,
      // The account as it actually is afterwards. Recovery is not an approval,
      // so it must not report a Pending or Suspended member as Active.
      body: { message: `Password reset for ${text(account.name)}. Their other sessions were signed out.`, user: mapUser(account) },
    };
  }

  /**
   * Puts every console account back on one password.
   *
   * Useful after an import or a bulk edit, when nobody remembers what they were
   * set to. Every session is dropped, including the caller's, because the
   * password they just signed in with no longer exists.
   */
  async function recoverAllPasswords(newPassword: string): Promise<AdminResult> {
    const accounts = await database.query('SELECT id FROM admin_users');
    for (const account of accounts.rows) await setPassword(text(account.id), newPassword);
    await database.query('DELETE FROM admin_sessions');
    return {
      status: 200,
      body: { message: `Password reset for all ${accounts.rows.length} console accounts. Everyone has been signed out.` },
    };
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
        const insert = productInsert(product);
        const result = await database.query(insert.text, insert.values);
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

  /**
   * Every console route answers with a response. A failure that escapes as a
   * rejected promise is not survivable: the Express server and the Vercel
   * function both have to answer something, and a database that is merely
   * behind the deployment has to say which migration is missing rather than
   * report a server error the operator cannot act on.
   */
  async function handle(request: AdminRequest): Promise<AdminResult> {
    try {
      return await dispatch(request);
    } catch (error) {
      console.error(`The admin console could not handle /${request.segments.join('/')}`, error);
      return fail(500, 'server_error', 'The console could not complete that request. Please try again shortly.');
    }
  }

  async function dispatch(request: AdminRequest): Promise<AdminResult> {
    const [resource, ...rest] = request.segments;
    const method = request.method.toUpperCase();
    const id = rest[0];
    // `admin_sessions.token` is a `uuid`, so a token that is not one cannot
    // match a session however long somebody keeps sending it. Handing it to
    // Postgres instead raises `22P02`, which escapes as a 500 and a stack
    // trace: a stale token in localStorage, a truncated copy and a stray
    // header would all read as the console being broken. It is an ordinary
    // failed sign-in, so it is treated as one before any query runs.
    const session = sessionToken(request.token);

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
        const expiresAt = sessionExpiry();
        await database.query('INSERT INTO admin_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [token, row.id, expiresAt]);
        return { status: 201, body: { token, expiresAt: expiresAt.toISOString(), user: mapUser(row) } };
      }
      if (method === 'DELETE') {
        if (session) await database.query('DELETE FROM admin_sessions WHERE token = $1', [session]);
        return { status: 200, body: { message: 'Signed out of the console.' } };
      }
      return fail(405, 'method_not_allowed', 'Use POST to sign in and DELETE to sign out.');
    }

    // Registration is the one route a visitor with no account at all has to
    // reach, so it is answered before the session check alongside the
    // forgot-password pair. It writes a Pending row and mints no session, so it
    // grants nothing: the account still cannot sign in.
    if (resource === 'signup') {
      if (method === 'POST') return registerSignup(request.body);
      return fail(405, 'method_not_allowed', 'Use POST to register an account.');
    }

    // The forgot-password flow is the one console route an operator who cannot
    // sign in has to reach, so it is answered before the session check. It is
    // also the only unauthenticated surface that writes to the database, which
    // is why it never reveals whether an address exists.
    if (resource === 'password-reset') {
      if (method === 'POST' && !id) return requestPasswordReset(request.body);
      if (method === 'POST' && id === 'confirm') return confirmPasswordReset(request.body);
    }

    const user = await currentUser(session);
    if (!user) {
      return fail(401, 'unauthenticated', 'Sign in to the console to continue.');
    }
    await ensureSeeded();

    if (resource === 'password-reset') {
      if (method === 'GET' && id === 'messages') return { status: 200, body: { messages: await listResetMessages() } };
      if (method === 'POST' && !id) return fail(401, 'unauthenticated', 'Sign in to the console to continue.');
      return fail(405, 'method_not_allowed', 'Use POST to ask for a reset link and POST /confirm to redeem one.');
    }

    if (resource === 'me') {
      if (method !== 'GET') return fail(405, 'method_not_allowed', 'The console account cannot be changed from here.');
      return { status: 200, body: { user } };
    }

    /**
     * The local development database, and the one button that pulls production
     * rows into it.
     *
     * Gated three separate times, because this is the only console route that
     * leaves the database this process is holding:
     *
     *   SYNC_FROM_PRODUCTION  off by default. With it off the route answers 404
     *                         rather than reaching for the network, so a deployed
     *                         console does not carry an endpoint that reads
     *                         production at all.
     *   the owner role        only the account that owns the deployment can pull
     *                         production data down.
     *   the local target      inside the sync, `assertSyncTargetIsLocal` refuses
     *                         to write anywhere but the local Docker database.
     */
    if (resource === 'local-db') {
      if (!syncIsEnabled()) return fail(404, 'not_found', 'That endpoint does not exist.');
      if (user.role !== superAdminRole) {
        return fail(403, 'forbidden', 'Only the owner account can sync from the production database.');
      }
      if (id === 'sync') {
        if (method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST to sync from the production database.');
        return syncNeonIntoLocal(request.body);
      }
      if (!id) {
        if (method !== 'GET') return fail(405, 'method_not_allowed', 'The local database report is read-only.');
        return { status: 200, body: describeLocalDatabase(database) };
      }
    }

    /**
     * Generating a password to look at, and saving it.
     *
     * Two requests rather than one, and the split is the whole design:
     *
     *   POST /owner-password/generate  makes a password and hands it back. Nothing
     *                                 is written, no session is touched, and the
     *                                 previous password still works - so a tab that
     *                                 closes or a walk away from the keyboard loses
     *                                 nothing. The alternative, which this replaced,
     *                                 replaced the credential immediately and mailed
     *                                 the new one to a mailbox nobody was watching.
     *   POST /owner-password/save      stores the password, from the body. This is
     *                                 the moment the old one stops working, every
     *                                 session is revoked, and a confirmation that
     *                                 carries no password is queued for the owner.
     *
     * Gated on the role rather than on the address, and always checked here even
     * though the caller has a session: a session proves who somebody is, not what
     * they are allowed to do, and this endpoint owns the account that cannot be
     * locked out of the deployment. The save revokes every session as it goes,
     * which includes the caller's, so that response is the last thing this session
     * sees.
     *
     * The generated value is the one secret this project now returns over HTTP,
     * and it is returned to the one account allowed to have it. It is never
     * logged, never written to the outbox, and never emailed.
     */
    if (resource === 'owner-password') {
      if (user.role !== superAdminRole) {
        return fail(403, 'forbidden', `Only the ${superAdminRole} account can generate a new owner password.`);
      }
      if (method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST to generate or save an owner password.');

      if (id === 'save') {
        const parsed = ownerPasswordSchema.safeParse(request.body);
        if (!parsed.success) {
          return fail(400, 'invalid_password', 'Enter a password of at least 8 characters.', { errors: fieldErrors(parsed.error) });
        }
        const result = await saveOwnerPassword(database, parsed.data.password);
        if (!result.saved) {
          return fail(409, 'owner_missing', 'There is no owner account to save a password for. Seed the console first.');
        }
        return {
          status: 200,
          body: {
            saved: true,
            email: result.email,
            sessionsRevoked: result.sessionsRevoked,
            message: `Your ${superAdminRole} password was saved and a confirmation was sent to ${result.email}.`,
          },
        };
      }

      if (id !== 'generate') return fail(404, 'not_found', 'That endpoint does not exist.');
      return {
        status: 200,
        body: {
          generated: true,
          // The only response in this project that carries a credential, and it goes
          // to the account that is allowed to have it and nowhere else.
          password: generateOwnerPassword(),
          email: user.email,
        },
      };
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
        // `productCreateSchema` deliberately carries no `images` key, because the
        // bulk upload template and this schema are asserted to be the same set of
        // columns and a spreadsheet cannot carry image bytes. The console form does
        // upload them, so they are read and stored here instead of being dropped.
        const uploaded = productImageUploads.safeParse((request.body as Record<string, unknown> | undefined)?.images);
        if (!uploaded.success) return fail(400, 'invalid_product_image', 'Each image must be a valid JPEG, PNG or WebP file no larger than 1200 x 1200 px or 300 KB.');
        // Validated before the product row exists, so a rejected upload cannot
        // leave a catalogue entry with no gallery behind it.
        const { images: validImages, invalid } = parseProductImages(uploaded.data ?? []);
        if (invalid) return fail(400, 'invalid_product_image', 'Each image must be a valid JPEG, PNG or WebP file no larger than 1200 x 1200 px or 300 KB.');
        // Only refused when the request actually carries a field the database
        // cannot store. A create of nothing but the base fields is saved on a
        // database without the 013 columns, because that is a save the console
        // can honestly make; it is the slug and SEO fields that cannot be
        // accepted, and those are named in the 503.
        const insert = productInsert(product);
        const result = await database.query(insert.text, insert.values);
        const createdId = Number(result.rows[0]?.id);
        if (validImages.length > 0) await insertProductImages(createdId, validImages);
        const created = await readProduct(createdId);
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
        if (update.slug !== undefined) columns.slug = update.slug || null;
        if (update.metaTitle !== undefined) columns.meta_title = update.metaTitle || null;
        if (update.metaDescription !== undefined) columns.meta_description = update.metaDescription || null;
        if (update.shades !== undefined) columns.shades = joinProductTags(update.shades);
        if (update.highlights !== undefined) columns.highlights = joinProductTags(update.highlights);
        if (update.featuresAndSpecification !== undefined) columns.features_and_specification = update.featuresAndSpecification || null;
        if (update.measurement !== undefined) columns.measurement = update.measurement || null;
        if (update.materialAndCare !== undefined) columns.material_and_care = update.materialAndCare || null;
        if (update.additionalDetails !== undefined) columns.additional_details = update.additionalDetails || null;
        if (update.itemDetails !== undefined) columns.item_details = update.itemDetails || null;
        if (update.published !== undefined) columns.published = update.published;
        if (update.featured !== undefined) columns.featured = update.featured;
        // A gallery-only edit carries no scalar column and is still a real edit, so
        // this guard only fires when nothing at all was addressed.
        if (Object.keys(columns).length === 0 && update.images === undefined) return fail(400, 'empty_update', 'Change at least one detail before saving.');
        const names = Object.keys(columns);
        if (names.length > 0) {
          const stamped = [...names, 'updated_at'];
          try {
            await database.query(
              `UPDATE products SET ${stamped.map((name, position) => `${name} = ${name === 'updated_at' ? 'NOW()' : `$${position + 2}`}`).join(', ')} WHERE id = $1`,
              [productId, ...names.map((name) => columns[name])],
            );
          } catch (error) {
            if (isUniqueViolation(error)) return fail(409, 'duplicate_sku', 'That SKU is already in the catalogue. Use a unique SKU or leave it blank.');
            throw error;
          }
        }
        // Only rewritten when the console actually sent a gallery. An earlier
        // length check meant a form that could not re-encode the saved images
        // deleted them by accident; the form now sends kept references instead.
        if (update.images !== undefined) {
          const replaced = await setProductImages(productId, update.images);
          if (!replaced) return fail(400, 'invalid_product_image', 'Each image must be a valid JPEG, PNG or WebP file no larger than 1200 x 1200 px or 300 KB.');
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
      // Checked before the generic "id is a record reference" branches below,
      // because "recover-all" is a verb, not a user id.
      if (rest[0] === 'recover-all' && method === 'POST') {
        const parsed = passwordRecoverAllSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_password', parsed.error.issues[0]?.message ?? 'Check the new password and try again.');
        return recoverAllPasswords(parsed.data.newPassword);
      }
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
            'INSERT INTO admin_users (name, email, role, password_hash, avatar) VALUES ($1, $2, $3, $4, NULLIF($5, \'\')) RETURNING ' + userColumns,
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
        await setPassword(id, parsed.data.newPassword, session);
        return { status: 200, body: { message: 'Password changed. Other sessions were signed out.' } };
      }
      if (id && rest[1] === 'recover' && method === 'POST') {
        const parsed = passwordRecoverSchema.safeParse(request.body);
        if (!parsed.success) return fail(400, 'invalid_password', parsed.error.issues[0]?.message ?? 'Check the new password and try again.');
        return recoverPassword(id, parsed.data.newPassword, session);
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
        if (update.phone !== undefined) columns.phone = update.phone || null;
        if (Object.keys(columns).length === 0) return fail(400, 'empty_update', 'Change at least one detail before saving.');
        // Moving your own account out of Active revokes the session making the
        // request, so the account would be unrecoverable without an
        // administrator. Suspending or leaving Pending are both refused; only the
        // fields that do not affect sign-in may be edited for oneself.
        if (id === user.id && update.status !== undefined && update.status !== 'Active') {
          return fail(400, 'self_status', `You cannot set your own status to ${update.status}. Ask another administrator.`);
        }
        // Moving the owner account to another role would take the deployment's way
        // back in with it, so nothing else may change the role of the one account
        // that can change every password.
        if (update.role !== undefined && update.role !== superAdminRole && await isOwnerAccount(id)) {
          return fail(400, 'owner_protected', `The owner account keeps the ${superAdminRole} role.`);
        }
        if (update.status !== undefined) columns.reviewed_at = new Date();
        if (update.status !== undefined) columns.reviewed_by = user.id;
        const names = Object.keys(columns);
        try {
          const result = await database.query(
            `UPDATE admin_users SET ${names.map((name, position) => `${name} = $${position + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING ${userColumns}`,
            [id, ...names.map((name) => columns[name])],
          );
          if (result.rows.length === 0) return fail(404, 'not_found', 'That team member no longer exists.');
          return { status: 200, body: { user: mapUser(result.rows[0]), message: 'Team member updated.' } };
        } catch (error) {
          if (isUniqueViolation(error)) return fail(409, 'duplicate_email', 'That email address already has a console account.');
          // A status the database constraint refuses means this build is older
          // than the migration, or newer than it. Saying so beats an anonymous
          // 500, because the fix is to run a migration.
          if (isCheckViolation(error)) {
            return fail(409, 'status_not_accepted', `This database does not accept the status ${update.status}. Run the pending migrations.`);
          }
          throw error;
        }
      }
      if (id && method === 'DELETE') {
        if (id === user.id) return fail(400, 'self_delete', 'You cannot delete the account you are signed in with.');
        // The owner account is the only way back into a deployment, so it
        // is not something a console session can remove. Recovery is a new password
        // from the owner screen, not a resurrected row.
        if (await isOwnerAccount(id)) return fail(400, 'owner_protected', 'The owner account cannot be deleted. Replace its password from /superadmin/ggpass instead.');
        const result = await database.query('DELETE FROM admin_users WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return fail(404, 'not_found', 'That team member no longer exists.');
        return { status: 200, body: { deleted: id, message: 'Team member removed.' } };
      }
      return fail(405, 'method_not_allowed', 'Team members support list, create, update, delete, password changes and password recovery.');
    }

    if (resource === 'settings') {
      if (method === 'GET') {
        const { settings, updatedAt } = await readSettings();
        return { status: 200, body: { settings, updatedAt } };
      }
      if (method === 'PUT' || method === 'PATCH' || method === 'POST') {
        const saved = await saveSettings(request.body);
        if (saved.status !== 200) return saved;
        return { status: 200, body: { ...saved.body, message: 'Settings saved.' } };
      }
      return fail(405, 'method_not_allowed', 'Settings are read with GET and saved with PUT.');
    }

    if (resource === 'pages') {
      if (method === 'GET') return { status: 200, body: { pages: await listSwitchablePages() } };
      if (method === 'PATCH' || method === 'PUT') {
        if (!(switchablePageSlugs as readonly string[]).includes(id ?? '')) {
          return fail(400, 'page_not_switchable', 'Only the Partners, Shop and Careers pages can be shown or hidden.');
        }
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

/** A CHECK constraint refused the value, which for this table means a status. */
function isCheckViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23514';
}

function fieldErrors(error: z.ZodError) {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map((part) => String(part)).join('.') || 'row';
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}
