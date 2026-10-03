/**
 * The product columns, declared once.
 *
 * This used to be a shape negotiation: the catalogue table had grown column by
 * column across migrations, so every query was built from the set of columns the
 * database happened to have, and an absent one had to be probed for before it
 * could be named. Nothing here grows or migrates any more - the catalogue lives
 * in process memory with one fixed set of columns - so there is one shape, and it
 * is the shape below.
 */

/** The columns every product query may always name. */
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

/** The console's visibility flags, plus the timestamp both writes stamp. */
export const publishingColumns = ['published', 'featured', 'updated_at'] as const;

/** The SEO and rich text blocks the product page renders. */
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

/** Everything a product row carries, in select order. */
export const productColumns = [
  ...baseProductColumns,
  'published',
  'featured',
  ...productDetailColumns,
] as const;

/**
 * The unconditional part of every product query, from one shared list.
 *
 * No trailing comma: every fragment here is comma-free and the caller joins, so a
 * fragment can never collide with the comma after it.
 */
export function baseSelect(alias = 'product'): string {
  return baseProductColumns.map((column) => `${alias}.${column}`).join(', ');
}

/** The two flag columns. */
export function publishingSelect(alias = 'product'): string {
  return `${alias}.published, ${alias}.featured`;
}

/** The SEO and rich text columns. */
export function detailSelect(alias = 'product'): string {
  return productDetailColumns.map((column) => `${alias}.${column}`).join(', ');
}