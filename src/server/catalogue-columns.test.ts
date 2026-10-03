import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  baseProductColumns,
  baseSelect,
  catalogueDriftHint,
  catalogueMigrations,
  currentCatalogueShape,
  describeProductColumnDrift,
  detailSelect,
  dropUnavailableColumns,
  missingCatalogueColumns,
  productDetailColumns,
  publishingColumns,
  publishingSelect,
  resetCatalogueShapeCache,
  resolveCatalogueShape,
  shapeFromMissingColumns,
  type CatalogueShape,
} from './catalogue';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dbDirectory = join(projectRoot, 'db');
const migrationsDirectory = join(dbDirectory, 'migrations');

/**
 * Every column db/ ever adds to products, read from the SQL itself.
 *
 * `ADD COLUMN [IF NOT EXISTS] <name>` is the only way a column can appear on a
 * table that already exists, and `CREATE TABLE products (...)` is the only way
 * the table itself starts. Parsing those two shapes is enough to answer the only
 * question this file cares about: does the SQL in db/ create every column the
 * code is allowed to name?
 */
function columnsCreatedBy(file: string): Set<string> {
  const sql = readFileSync(file, 'utf8');
  const columns = new Set<string>();
  for (const match of sql.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
    columns.add(match[1].toLowerCase());
  }
  const createTable = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?products\s*\(([\s\S]*?)\n\);/i);
  if (createTable) {
    for (const line of createTable[1].split('\n')) {
      const column = line.trim().match(/^([a-z_][a-z0-9_]*)\s+[a-z]/i);
      if (column) columns.add(column[1].toLowerCase());
    }
  }
  return columns;
}

const schemaFiles = [
  join(dbDirectory, 'init.sql'),
  ...readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => join(migrationsDirectory, name)),
];

const everyColumnInSchema = new Set(schemaFiles.flatMap((file) => [...columnsCreatedBy(file)]));

const noShape: CatalogueShape = { publishing: false, details: false };

describe('the column lists match the SQL in db/', () => {
  it.each([
    ['base', baseProductColumns],
    ['publishing', publishingColumns],
    ['product detail', productDetailColumns],
  ])('creates every %s column somewhere in db/', (_label, columns) => {
    const missing = [...columns].filter((column) => !everyColumnInSchema.has(column));
    expect(missing).toEqual([]);
  });

  it('attributes the publishing columns to migration 005 and the detail columns to 013', () => {
    // The migration named in the error an operator reads has to be the file that
    // actually adds the column, or the fix instruction is a dead end.
    const publishing = columnsCreatedBy(join(migrationsDirectory, '005_admin_console.sql'));
    for (const column of publishingColumns) expect(publishing.has(column)).toBe(true);

    const details = columnsCreatedBy(join(migrationsDirectory, '013_product_details.sql'));
    for (const column of productDetailColumns) expect(details.has(column)).toBe(true);
  });

  it('names migration files that exist', () => {
    for (const shape of [currentCatalogueShape, { ...noShape, details: true }, { ...noShape, publishing: true }, noShape]) {
      for (const migration of catalogueMigrations(shape)) {
        expect(() => readFileSync(join(projectRoot, migration), 'utf8')).not.toThrow();
      }
    }
  });

  it('declares every column any migration adds to products', () => {
    // Every migration is scanned, 005 and 013 included: the failure this guards
    // against was a column added to products and never declared, so exempting
    // the two files that already exist would exempt exactly where it happened.
    // Only `ADD COLUMN` counts. A column from the original CREATE TABLE that no
    // query reads, `created_at`, is not something this has to know about.
    const known = new Set<string>([...baseProductColumns, ...publishingColumns, ...productDetailColumns]);
    const undeclared: string[] = [];
    for (const file of schemaFiles) {
      const name = file.split(/[\\/]/).pop() ?? '';
      if (name === 'init.sql') continue;
      const sql = readFileSync(file, 'utf8');
      for (const match of sql.matchAll(/ALTER\s+TABLE\s+products[\s\S]*?;/gi)) {
        for (const added of match[0].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
          if (!known.has(added[1].toLowerCase())) undeclared.push(`${name}:${added[1].toLowerCase()}`);
        }
      }
    }
    expect(undeclared).toEqual([]);
  });
});

describe('SQL fragments name only columns the shape allows', () => {
  it('names every detail column when the database has them', () => {
    const fragment = detailSelect(currentCatalogueShape);
    for (const column of productDetailColumns) expect(fragment).toContain(`product.${column}`);
  });

  it('aliases every detail column to NULL when the database does not have them', () => {
    // NULLs rather than omissions, so mapProduct still gets the same keys back and
    // no caller has to know which shape it was handed.
    const fragment = detailSelect(noShape);
    for (const column of productDetailColumns) expect(fragment).toContain(`AS ${column}`);
    for (const column of productDetailColumns) expect(fragment).not.toContain(`product.${column}`);
  });

  it('keeps publishing and featured meaningful on a database without them', () => {
    // Before migration 005 everything was published and nothing was featured.
    expect(publishingSelect(noShape)).toBe('TRUE AS published, FALSE AS featured');
    expect(publishingSelect(currentCatalogueShape)).toBe('product.published, product.featured');
  });
});

/**
 * The queries are checked here without a database on purpose.
 *
 * A stubbed driver returns whatever rows it was told to and never parses the SQL,
 * so it happily accepts a query containing the text of a JavaScript function or a
 * doubled comma. Both of those shipped: `${baseSelect}` interpolated the function
 * itself, and a fragment that ended in a comma was joined to another one that
 * added its own. Every unit test passed and production answered 500. This
 * asserts the shape of the SQL text so the mistake is caught in milliseconds
 * rather than by a customer; `npm run db:verify:catalogue` then proves the same
 * queries against a real PostgreSQL.
 */
describe('the assembled product SQL is well formed for every shape', () => {
  const shapes = [
    { label: 'fully migrated', shape: { publishing: true, details: true } },
    { label: 'missing the 013 columns', shape: { publishing: true, details: false } },
    { label: 'missing the 005 columns', shape: { publishing: false, details: false } },
    { label: 'missing both', shape: { publishing: false, details: true } },
  ];

  const images = `COALESCE(
    (SELECT json_agg('/api/products/' || product.id ORDER BY image.position)
     FROM product_images AS image WHERE image.product_id = product.id),
    '[]'::json
  ) AS images`;

  function storefront(shape: CatalogueShape) {
    return `SELECT ${baseSelect()},
              ${detailSelect(shape)},
              ${publishingSelect(shape)},
              ${images}
       FROM products AS product${shape.publishing ? ' WHERE product.published' : ''} ORDER BY product.id`;
  }

  function console(shape: CatalogueShape) {
    return `SELECT ${baseSelect('product')},
  ${detailSelect(shape)},
  ${publishingSelect(shape)},
  ${images}
  FROM products AS product`;
  }

  for (const { label, shape } of shapes) {
    for (const [name, sql] of [['storefront', storefront(shape)], ['console', console(shape)]] as const) {
      it(`builds valid ${name} SQL for a database ${label}`, () => {
        // No JavaScript leaked into the SQL.
        expect(sql).not.toMatch(/function |=>|undefined|\[object/);
        // No doubled, leading or trailing comma in the select list.
        const selectList = sql.slice(sql.indexOf('SELECT') + 6, sql.indexOf('FROM products'));
        expect(selectList).not.toMatch(/,\s*,/);
        expect(selectList.trim().startsWith(',')).toBe(false);
        expect(selectList.trimEnd().endsWith(',')).toBe(false);
        // The pieces are actually in the statement.
        expect(sql).toContain('FROM products AS product');
        for (const column of [...baseProductColumns, 'published', 'featured', ...productDetailColumns]) {
          expect(selectList.toLowerCase()).toContain(column.toLowerCase());
        }
      });
    }
  }

  it('never selects a column the shape does not have', () => {
    for (const { shape } of shapes) {
      const selectList = storefront(shape).split('FROM products')[0];
      for (const column of baseProductColumns) expect(selectList).toContain(`product.${column}`);
      if (!shape.details) {
        for (const column of productDetailColumns) expect(selectList).not.toContain(`product.${column}`);
      } else {
        for (const column of productDetailColumns) expect(selectList).toContain(`product.${column}`);
      }
      if (shape.publishing) {
        expect(selectList).toContain('product.published');
        expect(selectList).toContain('product.featured');
      } else {
        expect(selectList).toContain('TRUE AS published');
        expect(selectList).toContain('FALSE AS featured');
      }
    }
  });
});

describe('reading the shape probe', () => {
  function runner(columns: unknown) {
    return { query: async () => ({ rows: [{ table_present: true, columns }], rowCount: 1 }) };
  }

  it('reads a real array of columns', async () => {
    resetCatalogueShapeCache();
    const shape = await resolveCatalogueShape(runner([...publishingColumns, ...productDetailColumns]));
    expect(shape).toEqual({ publishing: true, details: true });
  });

  it('reads the brace-quoted string a driver returns for an unparsed array', async () => {
    // This is the bug that shipped. `array_agg` over `information_schema.sql_identifier`
    // has no driver parser, so PostgreSQL's `{a,b,c}` came back as a string, and
    // `Array.isArray` on it was false - which read as "this database has none of
    // the optional columns" on a fully migrated database. The shop served drafts,
    // the console showed empty SEO fields, and no test failed: every fake here
    // returned a real array.
    resetCatalogueShapeCache();
    const asString = `{${[...publishingColumns, ...productDetailColumns].join(',')}}`;
    expect(Array.isArray(asString)).toBe(false);
    const shape = await resolveCatalogueShape(runner(asString));
    expect(shape).toEqual({ publishing: true, details: true });
  });

  it('treats a genuinely empty list as a pre-migration database', async () => {
    resetCatalogueShapeCache();
    expect(await resolveCatalogueShape(runner([]))).toEqual({ publishing: false, details: false });
    expect(await resolveCatalogueShape(runner('{}'))).toEqual({ publishing: false, details: false });
  });

  it('assumes nothing is present when the probe result is unreadable', async () => {
    // Failing towards "no optional columns" degrades reads and refuses writes,
    // which is visible and recoverable. Failing towards "all present" queries
    // columns that are not there and takes the shop down.
    resetCatalogueShapeCache();
    expect(await resolveCatalogueShape(runner(undefined))).toEqual({ publishing: false, details: false });
    expect(await resolveCatalogueShape(runner(42))).toEqual({ publishing: false, details: false });
  });

  it('asks for a column list the driver can parse', async () => {
    const sql = await (async () => {
      let seen = '';
      resetCatalogueShapeCache();
      await resolveCatalogueShape({ query: async (text: string) => { seen = text; return { rows: [], rowCount: 0 }; } });
      return seen;
    })();
    // sql_identifier is a domain; without ::text the aggregate comes back as a
    // string and the whole shape detection silently stops working.
    expect(sql).toContain('array_agg(column_name::text)');
    expect(sql).toContain("'{}'::text[]");
  });
});

describe('reporting a drifted database', () => {
  it('round-trips a shape through its missing columns', () => {
    for (const shape of [currentCatalogueShape, { ...noShape, details: true }, { ...noShape, publishing: true }, noShape]) {
      expect(shapeFromMissingColumns(missingCatalogueColumns(shape))).toEqual(shape);
    }
  });

  it('says nothing needs doing when nothing is missing', () => {
    expect(describeProductColumnDrift([])).toMatch(/Every product column/);
    expect(catalogueDriftHint(currentCatalogueShape)).toMatch(/up to date/);
    expect(catalogueMigrations(currentCatalogueShape)).toEqual([]);
  });

  it('names the missing columns, the migration and the command', () => {
    const hint = catalogueDriftHint({ publishing: true, details: false });
    expect(hint).toContain('slug');
    expect(hint).toContain('item_details');
    expect(hint).toContain('db/migrations/013_product_details.sql');
    expect(hint).toContain('npm run db:migrate:production');
    // 005 is applied here, so it must not be blamed.
    expect(hint).not.toContain('005_admin_console.sql');
  });

  it('blames both migrations when the database predates the console', () => {
    expect(catalogueMigrations(noShape)).toEqual([
      'db/migrations/005_admin_console.sql',
      'db/migrations/013_product_details.sql',
    ]);
  });
});

describe('refusing a write the database cannot store', () => {
  it('keeps the columns it has and reports the ones it does not', () => {
    // Migration 005 is applied and 013 is not, so the detail columns go and the
    // publishing flags stay.
    const { columns, dropped } = dropUnavailableColumns({ publishing: true, details: false }, {
      name: 'Glow Ritual',
      price: 799,
      slug: 'glow-ritual',
      meta_title: 'Glow Ritual',
      shades: 'Rose',
      published: false,
    });

    expect(columns).toEqual({ name: 'Glow Ritual', price: 799, published: false });
    expect(dropped).toEqual(['slug', 'meta_title', 'shades']);
  });

  it('keeps everything on a fully migrated database', () => {
    const requested = { name: 'Glow Ritual', slug: 'glow-ritual', published: true, featured: false };
    expect(dropUnavailableColumns(currentCatalogueShape, requested)).toEqual({ columns: requested, dropped: [] });
  });

  it('drops the publishing columns too when migration 005 is missing', () => {
    const { dropped } = dropUnavailableColumns(noShape, { name: 'Glow Ritual', published: true, featured: true });
    expect(dropped).toEqual(['published', 'featured']);
  });
});