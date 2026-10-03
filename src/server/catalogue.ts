/**
 * Structural rather than imported, so this module never depends on the handlers
 * that depend on it.
 */
type QueryRunner = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

/**
 * Every product column the code reads that a migration can add or remove.
 *
 * The catalogue table has grown column by column: db/migrations/003_products.sql
 * created it, 005_admin_console.sql added the publishing flags, and
 * 013_product_details.sql added the SEO and rich text blocks. Every one of those
 * migrations can reach a database that has not had it applied, and a query that
 * names an absent column fails with 42703 - the whole storefront 500s and the
 * whole console 503s over columns that are metadata, not the price or the stock.
 *
 * So the optional columns are declared once here, and every product query is
 * built from a `CatalogueShape` that says which groups the database actually has.
 * A drifted database gets the shape it can serve instead of an error.
 *
 * `catalogue-columns.test.ts` asserts this list against the SQL in db/, so a
 * column cannot be added to a migration and read by the code without being
 * declared here.
 */

/** The products columns db/init.sql creates. Every query may always name these. */
export const baseProductColumns = [
  'id',
  'name',
  'category',
  'brand',
  'sku',
  'price',
  'mrp',
  'stock',
  'rating',
  'reviews',
  'badge',
  'image',
  'description',
] as const;

/** products.published and products.featured, from db/migrations/005_admin_console.sql. */
export const publishingColumns = ['published', 'featured', 'updated_at'] as const;

/** The ten columns from db/migrations/013_product_details.sql. */
export const productDetailColumns = [
  'slug',
  'meta_title',
  'meta_description',
  'shades',
  'highlights',
  'features_and_specification',
  'measurement',
  'material_and_care',
  'additional_details',
  'item_details',
] as const;

export type ProductDetailColumn = (typeof productDetailColumns)[number];

/** What the products table looks like on the database this deployment points at. */
export type CatalogueShape = {
  publishing: boolean;
  details: boolean;
};

export const currentCatalogueShape: CatalogueShape = { publishing: true, details: true };

const publishingMigration = 'db/migrations/005_admin_console.sql';
const detailMigration = 'db/migrations/013_product_details.sql';

/** The migrations that have to be applied for the missing groups to appear. */
export function catalogueMigrations(shape: CatalogueShape): string[] {
  const migrations: string[] = [];
  if (!shape.publishing) migrations.push(publishingMigration);
  if (!shape.details) migrations.push(detailMigration);
  return migrations;
}

export function catalogueDriftHint(shape: CatalogueShape): string {
  const migrations = catalogueMigrations(shape);
  if (migrations.length === 0) return 'The catalogue schema is up to date.';
  return `products is missing columns that this build reads: ${missingCatalogueColumns(shape).join(', ')}. `
    + `Apply ${migrations.join(' and ')} to this database, or run "npm run db:migrate:production".`;
}

export function missingCatalogueColumns(shape: CatalogueShape): string[] {
  return [
    ...(shape.publishing ? [] : [...publishingColumns]),
    ...(shape.details ? [] : [...productDetailColumns]),
  ];
}

/** The inverse of `missingCatalogueColumns`: read a drift report back as a shape. */
export function shapeFromMissingColumns(missing: readonly string[]): CatalogueShape {
  const absent = new Set(missing);
  return {
    publishing: !publishingColumns.some((column) => absent.has(column)),
    details: !productDetailColumns.some((column) => absent.has(column)),
  };
}

/**
 * The operator-facing sentence for a list of absent columns.
 *
 * Shared by /api/health and `npm run db:check` so the two cannot disagree about
 * what a drifted database needs.
 */
export function describeProductColumnDrift(missing: readonly string[]): string {
  if (missing.length === 0) return 'Every product column this build reads is present.';
  const shape = shapeFromMissingColumns(missing);
  return `products is missing ${missing.length === 1 ? 'a column' : `${missing.length} columns`} this build reads: `
    + `${missing.join(', ')}. The shop still serves without them, but the console cannot edit them. `
    + `Apply ${catalogueMigrations(shape).join(' and ')} to this database, or run "npm run db:migrate:production".`;
}

/**
 * The two flag columns, or constants with the meaning they had before
 * migration 005: everything is published and nothing is featured.
 *
 * No trailing comma: every fragment here is comma-free and the caller joins, so a
 * fragment can never collide with the comma after it.
 */
export function publishingSelect(shape: CatalogueShape): string {
  return shape.publishing
    ? 'product.published, product.featured'
    : 'TRUE AS published, FALSE AS featured';
}

/** The unconditional part of every product query, from one shared list. */
export function baseSelect(alias = 'product'): string {
  return baseProductColumns.map((column) => `${alias}.${column}`).join(', ');
}

/**
 * The detail columns, or typed NULLs standing in for them.
 *
 * NULLs rather than dropping the names so every `mapProduct` caller still gets
 * the same keys back. A NULL already reads as absent there, so the product page
 * hides the section instead of rendering an empty one, and nothing downstream has
 * to know which shape it received.
 */
export function detailSelect(shape: CatalogueShape): string {
  if (shape.details) return productDetailColumns.map((column) => `product.${column}`).join(', ');
  return productDetailColumns
    .map((column) => `NULL::TEXT AS ${column}`)
    .join(', ');
}

/**
 * Drops any addressed column the database does not have, and reports what went.
 *
 * The console update builds its column list from whatever the request carried, so
 * on a database without the detail columns a form submit would otherwise try to
 * write `slug`. Returning the dropped names lets the caller refuse the edit with
 * a 503 that names them, instead of quietly saving the other fields and losing
 * the SEO block.
 */
export function dropUnavailableColumns(
  shape: CatalogueShape,
  columns: Record<string, unknown>,
): { columns: Record<string, unknown>; dropped: string[] } {
  const available = new Set<string>([
    ...baseProductColumns,
    ...(shape.publishing ? [...publishingColumns] : []),
    ...(shape.details ? [...productDetailColumns] : []),
  ]);
  const kept: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [column, value] of Object.entries(columns)) {
    if (available.has(column)) kept[column] = value;
    else dropped.push(column);
  }
  return { columns: kept, dropped };
}

/**
 * Reads the shape from information_schema once per warm instance.
 *
 * A serverless instance handles many requests against one pooled connection, so
 * the result is cached for `shapeCacheTtlMs` rather than re-queried. The short
 * TTL is what makes the fix self-healing: after the migration is applied the very
 * next request re-reads the schema and the full columns come back on their own,
 * with no redeploy and no cache flush.
 *
 * `CATALOGUE_SHAPE_CACHE_MS` lowers it. Nothing needs to wait a minute to be
 * sure, and the end-to-end drift check needs to see the flip without a sleep.
 */
export const shapeCacheTtlMs = readShapeCacheTtl();

function readShapeCacheTtl() {
  const raw = Number(process.env.CATALOGUE_SHAPE_CACHE_MS);
  return Number.isFinite(raw) && raw >= 0 && raw <= 3_600_000 ? raw : 60_000;
}

/**
 * One row, always: whether the table exists at all, and the optional columns it
 * holds.
 *
 * Asking for the columns on their own cannot tell "this database predates every
 * migration" apart from "the probe did not work", because both come back empty,
 * and guessing wrongly there means querying columns that are not there. The
 * to_regclass column settles it.
 *
 * `column_name::text` is load-bearing. `information_schema.sql_identifier` is a
 * domain, and `array_agg` over it resolves to a type the driver hands back as the
 * string `{a,b,c}` rather than an array - which reads as "no columns at all" and
 * makes a fully migrated database look like a pre-005 one. Casting to `text`
 * makes the aggregate a real `text[]`, which the driver parses.
 */
const presenceQuery = `SELECT to_regclass('public.products') IS NOT NULL AS table_present,
  COALESCE(array_agg(column_name::text), '{}'::text[]) AS columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'products' AND column_name = ANY($1::text[])`;

const cache = new Map<string, { shape: CatalogueShape; expiresAt: number }>();

/** Test seam: drops the cached shapes so one case cannot leak into the next. */
export function resetCatalogueShapeCache() {
  cache.clear();
}

/**
 * Reads the probe's column list, whatever shape the driver handed it over in.
 *
 * A `text[]` arrives as an array, but a type the driver has no parser for arrives
 * as the string `{a,b,c}`. Treating that string as "no columns" is the worst
 * possible failure: a fully migrated database looks like a pre-005 one, the shop
 * serves drafts and the console shows empty fields, with nothing in the logs. So
 * both forms are read, and an unrecognised form is treated as everything missing
 * rather than everything present.
 */
function readColumnList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const inner = trimmed.slice(1, -1);
      return inner === '' ? [] : inner.split(',').map((column) => column.replace(/^"|"$/g, ''));
    }
  }
  return [];
}

export async function resolveCatalogueShape(
  database: QueryRunner,
  key = 'default',
  now: number = Date.now(),
): Promise<CatalogueShape> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.shape;
  const result = await database.query(presenceQuery, [[...publishingColumns, ...productDetailColumns]]);
  const row = (result.rows[0] ?? {}) as { table_present?: unknown; columns?: unknown };
  if (row.table_present !== true) {
    // No products table at all. The real query raises 42P01 and the caller
    // reports that properly, which is more useful than a shape invented here.
    return currentCatalogueShape;
  }
  const present = new Set(readColumnList(row.columns));
  const shape: CatalogueShape = {
    publishing: publishingColumns.every((column) => present.has(column)),
    details: productDetailColumns.every((column) => present.has(column)),
  };
  cache.set(key, { shape, expiresAt: now + shapeCacheTtlMs });
  return shape;
}
