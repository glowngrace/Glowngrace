import { describe, expect, it } from 'vitest';
import {
  baseProductColumns,
  baseSelect,
  detailSelect,
  productColumns,
  productDetailColumns,
  publishingColumns,
  publishingSelect,
} from './catalogue';

describe('the product column lists', () => {
  it('partitions the row into the three groups the queries read', () => {
    // The lists are concatenated into one select, so a column in two of them would
    // be selected twice and a column in none of them would never be readable.
    const seen = [...baseProductColumns, 'published', 'featured', ...productDetailColumns];
    expect(new Set([...baseProductColumns, ...publishingColumns, ...productDetailColumns]).size)
      .toBe(baseProductColumns.length + publishingColumns.length + productDetailColumns.length);
    for (const column of seen) expect(productColumns).toContain(column);
  });

  it('stamps updated_at on writes without ever selecting it', () => {
    // It is a write-only column: every UPDATE sets it, and no query reads it back,
    // so it is deliberately absent from the select list.
    expect(publishingColumns).toContain('updated_at');
    expect(productColumns).not.toContain('updated_at');
  });

  it('names the columns the product page reads', () => {
    for (const column of [
      'id',
      'name',
      'category',
      'price',
      'mrp',
      'stock',
      'rating',
      'reviews',
      'badge',
      'image',
      'description',
      'published',
      'featured',
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
    ]) {
      expect(productColumns).toContain(column);
    }
  });
});

/**
 * The queries are checked here without a database on purpose.
 *
 * A stubbed driver returns whatever rows it was told to and never parses the SQL,
 * so it happily accepts a query containing the text of a JavaScript function or a
 * doubled comma. Both of those shipped: `${baseSelect}` interpolated the function
 * itself, and a fragment that ended in a comma was joined to another one that
 * added its own. Every unit test passed and production answered 500. This asserts
 * the shape of the SQL text so the mistake is caught in milliseconds rather than by
 * a customer.
 */
describe('the assembled product SQL is well formed', () => {
  const images = `COALESCE(
    (SELECT json_agg('/api/products/' || product.id ORDER BY image.position)
     FROM product_images AS image WHERE image.product_id = product.id),
    '[]'::json
  ) AS images`;

  const storefront = `SELECT ${baseSelect()},
              ${detailSelect()},
              ${publishingSelect()},
              ${images}
       FROM products AS product WHERE product.published ORDER BY product.id`;

  const console_ = `SELECT ${baseSelect('product')},
  ${detailSelect('product')},
  ${publishingSelect('product')},
  ${images}
  FROM products AS product`;

  for (const [name, sql] of [['storefront', storefront], ['console', console_]] as const) {
    it(`builds valid ${name} SQL`, () => {
      // No JavaScript leaked into the SQL.
      expect(sql).not.toMatch(/function |=>|undefined|\[object/);
      // No doubled, leading or trailing comma in the select list.
      const selectList = sql.slice(sql.indexOf('SELECT') + 6, sql.indexOf('FROM products'));
      expect(selectList).not.toMatch(/,\s*,/);
      expect(selectList.trim().startsWith(',')).toBe(false);
      expect(selectList.trimEnd().endsWith(',')).toBe(false);
      // The pieces are actually in the statement.
      expect(sql).toContain('FROM products AS product');
      for (const column of productColumns) {
        expect(selectList.toLowerCase()).toContain(`product.${column}`.toLowerCase());
      }
    });
  }

  it('selects every product column exactly once', () => {
    // Counted per column over the three fragments rather than over the whole
    // statement, because the gallery subquery also mentions product.id.
    const columnList = `${baseSelect()}, ${detailSelect()}, ${publishingSelect()}`;
    for (const column of productColumns) {
      const occurrences = columnList.match(new RegExp(`product\\.${column}\\b`, 'g')) ?? [];
      expect({ column, occurrences: occurrences.length }).toEqual({ column, occurrences: 1 });
    }
  });

  it('filters the storefront on published and leaves the console unfiltered', () => {
    expect(storefront).toContain('WHERE product.published');
    expect(console_).not.toContain('WHERE product.published');
  });

  it('reads the gallery through a correlated subquery', () => {
    expect(storefront).toContain('FROM product_images AS image WHERE image.product_id = product.id');
    expect(storefront).toContain("'[]'::json");
  });
});