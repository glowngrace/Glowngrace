import 'dotenv/config';
import { loadEnvironment } from '../src/server/env.js';
import { superAdminEmail } from '../src/auth/roles.js';

loadEnvironment();

const { createPostgresDatabase } = await import('../src/server/postgres.js');
const { resolveLocalDatabase, describeResolvedDatabase, DatabaseConfigError } = await import('../src/server/config.js');
const { seedAdminData } = await import('../src/server/admin.js');
const { products: sampleCatalogue } = await import('../src/data/catalog.js');
const { joinProductTags } = await import('../src/server/handlers.js');

/**
 * Fills an empty local database with the sample content the storefront ships
 * with.
 *
 * `npm run db:seed` after `npm run db:migrate` gives a local database the same
 * starting point a fresh deployment has, so a checkout, an admin screen or an
 * e2e run sees a populated shop rather than an empty one.
 *
 * Two different things are seeded, and the difference matters:
 *
 *   The console's own seed - pages, settings, demo datasets, sample orders, the
 *   owner account - comes from `seedAdminData`, which is the same function the
 *   running server calls. Nothing here re-implements it, so what a seeded local
 *   database holds and what a booting server would create are the same rows by
 *   construction.
 *
 *   The catalogue comes from `src/data/catalog.ts`, the bundle the storefront
 *   falls back to while `products` is empty. Writing it into the database is what
 *   turns `catalogueManaged` from false to true, which is the difference between
 *   the shop rendering bundled samples and the shop reading its own rows.
 *
 * Local only. There is no `production` argument, on purpose: seeding production
 * is not a thing this script should be able to do.
 */

const args = process.argv.slice(2);
const reset = args.includes('--reset');
let skipCatalogue = args.includes('--no-catalogue');

let database: ReturnType<typeof createPostgresDatabase>;
try {
  const resolved = resolveLocalDatabase();
  console.log(`\nSeeding ${describeResolvedDatabase(resolved)}\n`);
  database = createPostgresDatabase(resolved);
} catch (error) {
  if (error instanceof DatabaseConfigError) {
    console.error(`\n${error.message}\n`);
    console.error('Copy .env.local.example to .env.local, or run `npm start local` to do it for you.');
    process.exit(1);
  }
  throw error;
}

try {
  const existing = await database.query('SELECT count(*)::text AS value FROM products');
  const catalogueIsSeeded = Number(existing.rows[0]?.value ?? 0) > 0;
  if (catalogueIsSeeded && !reset && !skipCatalogue) {
    console.log(`products already holds ${existing.rows[0]?.value} rows, so the catalogue was left alone.`);
    console.log('Pass --reset to clear it and seed the samples again.');
    skipCatalogue = true;
  }

  if (reset) {
    console.log('Clearing the demo tables first (--reset)...');
    await database.query('DELETE FROM order_items');
    await database.query('DELETE FROM orders');
    await database.query('DELETE FROM product_images');
    await database.query('DELETE FROM products');
    await database.query('DELETE FROM job_vacancies');
    await database.query('DELETE FROM candidates');
    await database.query('DELETE FROM partner_salons');
    await database.query('DELETE FROM customers');
    await database.query('DELETE FROM reviews');
    await database.query(`UPDATE demo_datasets SET visible = TRUE, seeded = TRUE`);
  }

  if (!skipCatalogue) {
    const columns = [
      'name', 'category', 'brand', 'sku', 'price', 'mrp', 'stock', 'rating', 'reviews',
      'badge', 'image', 'description', 'published', 'featured', 'slug', 'meta_title',
      'meta_description', 'shades', 'highlights', 'features_and_specification',
      'measurement', 'material_and_care', 'additional_details', 'item_details',
    ];
    let inserted = 0;
    let skipped = 0;
    for (const product of sampleCatalogue) {
      const values = [
        product.name,
        product.category,
        product.brand ?? null,
        product.sku ?? null,
        product.price,
        product.mrp,
        product.stock ?? 0,
        product.rating,
        product.reviews,
        product.badge ?? null,
        product.image,
        product.description,
        product.published ?? true,
        product.featured ?? false,
        product.slug ?? null,
        product.metaTitle ?? null,
        product.metaDescription ?? null,
        joinProductTags(product.shades ?? []),
        joinProductTags(product.highlights ?? []),
        product.featuresAndSpecification ?? null,
        product.measurement ?? null,
        product.materialAndCare ?? null,
        product.additionalDetails ?? null,
        product.itemDetails ?? null,
      ];
      // Checked rather than left to `ON CONFLICT DO NOTHING`: the bundled
      // catalogue has no `sku`, and `products_sku_unique_idx` only covers
      // non-null skus, so nothing in the schema would have stopped a second
      // `db:seed` inserting the same sixteen products a second time.
      const present = await database.query(
        `SELECT 1 FROM products
         WHERE ($1::text IS NOT NULL AND slug = $1)
            OR ($2::text IS NOT NULL AND sku = $2)
            OR name = $3
         LIMIT 1`,
        [product.slug ?? null, product.sku ?? null, product.name],
      );
      if (present.rows.length > 0) {
        skipped += 1;
        continue;
      }

      const result = await database.query(
        `INSERT INTO products (${columns.join(', ')})
         VALUES (${columns.map((_column, index) => `$${index + 1}`).join(', ')})
         ON CONFLICT DO NOTHING`,
        values,
      );
      inserted += result.rowCount ?? 0;
    }
    console.log(`Seeded ${inserted} catalogue product${inserted === 1 ? '' : 's'} from src/data/catalog.ts.`
      + (skipped > 0 ? ` Skipped ${skipped} already present.` : ''));
  }

  // After the catalogue, deliberately. The sample orders name their products and
  // `seedAdminData` resolves each line's `product_id` by joining `products` on
  // that name, so seeding them first - which is what this used to do - left every
  // line pointing at an id that was never issued.
  const seeded = await seedAdminData(database);
  console.log('Seeded pages, settings, demo datasets, sample orders and the admin accounts.');
  if (seeded.unattachedOrderItems.length > 0) {
    // Not fatal: the order lines name their product, so nothing is corrupt, but
    // they are missing and the count matters. The usual cause is the catalogue
    // holding different names, or `--no-catalogue` on a database with no products.
    console.warn(`\n  ${seeded.unattachedOrderItems.length} order line(s) had no matching product and were skipped:`);
    for (const line of seeded.unattachedOrderItems) console.warn(`    ${line}`);
  }

  const counts = await database.query(
    `SELECT
       (SELECT count(*)::text FROM products) AS products,
       (SELECT count(*)::text FROM orders) AS orders,
       (SELECT count(*)::text FROM order_items) AS order_items,
       (SELECT count(*)::text FROM admin_users) AS admin_users,
       (SELECT count(*)::text FROM site_pages) AS site_pages,
       (SELECT count(*)::text FROM partner_salons) AS partner_salons,
       (SELECT count(*)::text FROM customers) AS customers,
       (SELECT count(*)::text FROM reviews) AS reviews`,
  );
  const row = counts.rows[0] ?? {};
  console.log('');
  for (const [table, value] of Object.entries(row)) {
    console.log(`  ${table.padEnd(16)} ${value}`);
  }
  console.log('\nThe local database is ready. Sign in at /login with the owner account:');
  console.log(`  email    ${superAdminEmail}`);
  console.log(`  password ${process.env.OWNER_PINNED_PASSWORD
    ? 'the one in OWNER_PINNED_PASSWORD, held until OWNER_PINNED_HOLD_UNTIL'
    : 'generated, and written to the email_outbox table:'
  }`);
  if (!process.env.OWNER_PINNED_PASSWORD) {
    const outbox = await database.query(
      `SELECT body FROM email_outbox WHERE kind = 'owner-credentials' ORDER BY created_at DESC LIMIT 1`,
    );
    const generated = /Password: (.+)/.exec(String((outbox.rows[0] as { body?: string } | undefined)?.body ?? ''))?.[1];
    if (generated) console.log(`           ${generated}`);
  }
} catch (error) {
  const cause = error as { code?: string; message?: string };
  console.error(`\nSeeding failed: ${cause?.message ?? String(error)}${cause?.code ? ` (code=${cause.code})` : ''}`);
  console.error('Has the schema been applied? `npm run db:migrate`');
  process.exitCode = 1;
} finally {
  await database.end().catch(() => undefined);
}