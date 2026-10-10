import { expect, test, type Page, type Route } from '@playwright/test';
import { bulkTemplateByDataset } from '../src/lib/bulk-templates';

/**
 * The product bulk upload, end to end through the console.
 *
 * The server side is stubbed, but its response shape and wording are the ones
 * `POST /api/admin/bulk` actually produces, so these tests pin the contract
 * between the endpoint and the screen. The regression they guard is a silent
 * one: a rejected spreadsheet used to leave the operator with "sent for
 * import", no error banner (the reload after the import cleared it) and nothing
 * in the browser console.
 */

const owner = {
  id: 'admin-owner',
  name: 'Glow & Grace Super Admin',
  email: 'glowngracebiz@gmail.com',
  role: 'Super Admin',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-01',
};

const settings = {
  profile: { storeName: 'Glow & Grace', tagline: 'Kajal, colour and care', email: 'hello@glowngrace.in', phone: '+91 98765 43210', address: '12 Linking Road, Bandra West, Mumbai 400050' },
  delivery: { freeAbove: 1299, deliveryFee: 99, gst: 18, returns: 14 },
  notifications: { orders: true, lowStock: true, partners: false, reviews: true },
  preview: { livePreview: false },
  updatedAt: '2026-02-01T10:00:00.000Z',
};

type Product = { id: number; name: string; category: string; sku: string; price: number; mrp: number; stock: number; rating: number; reviews: number; image: string; description: string; published: boolean };

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** A one-row products sheet built from the shipped template: header plus data. */
function productSheet(name: string) {
  const template = bulkTemplateByDataset.get('products')!;
  const row = template.columns.map((column) => (column === 'name' ? name : String(template.example[template.columns.indexOf(column)])));
  return [template.columns.join(','), row.map(csvCell).join(',')].join('\n');
}

/**
 * A console whose product list can grow and whose bulk endpoint answers with a
 * chosen outcome, so both the accepted and the rejected path can be driven from
 * one place.
 */
async function stubConsole(page: Page, bulk: (rows: Array<Record<string, string>>) => { status?: number; body: unknown }) {
  const state = { products: [] as Product[] };

  // Every endpoint `AdminStore.reload` reads, with the exact key each helper
  // expects, so the console boots without the real session these stubs replace.
  const collections: Record<string, unknown> = {
    me: { user: owner },
    products: { products: state.products },
    orders: { orders: [] },
    jobs: { records: [] },
    candidates: { records: [] },
    partners: { records: [] },
    customers: { records: [] },
    reviews: { records: [] },
    users: { users: [owner], roles: ['Super Admin', 'Store Administrator'] },
    pages: { pages: [] },
    'demo-data': { datasets: [] },
    settings: { settings, updatedAt: settings.updatedAt },
    summary: { orders: 0, products: 0, jobs: 0, candidates: 0, partners: 0, customers: 0, reviews: 0, pages: [], hiddenDatasets: [] },
    'local-db': { store: 'postgres', local: { connection: 'local' }, neon: { configured: false } },
  };

  await page.route('**/api/admin/**', (route: Route) => {
    const path = route.request().url().replace(/^.*\/api\/admin\//, '').split('?')[0].replace(/\/$/, '');
    const collection = path === 'products' ? { products: state.products } : collections[path];
    if (route.request().method() === 'GET' && collection) return route.fulfill({ json: collection });
    return route.continue();
  });

  await page.route('**/api/admin/bulk', (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const request = route.request().postDataJSON() as { rows: Array<Record<string, string>> };
    const outcome = bulk(request.rows);
    // An accepted row shows up on the next read, exactly as a real import does.
    if ((outcome.body as { created?: string[] }).created?.length) {
      const first = request.rows[0];
      state.products = [{
        id: 99, name: first.name, category: first.category ?? 'Skincare', sku: first.sku ?? '', price: Number(first.price ?? 0),
        mrp: Number(first.mrp ?? 0), stock: Number(first.stock ?? 0), rating: Number(first.rating ?? 0), reviews: Number(first.reviews ?? 0),
        image: '', description: first.description ?? '', published: true,
      }];
    }
    return route.fulfill({ status: outcome.status ?? 201, json: outcome.body });
  });

  await page.route('**/api/admin/session', (route: Route) => route.fulfill({
    json: { token: '3f1c9a52-8d47-4e6b-9a10-2c5b7e8d4f31', expiresAt: new Date(Date.now() + 300_000).toISOString(), user: owner },
  }));

  return state;
}

async function signInAndOpenProducts(page: Page) {
  await page.goto('/login');
  await page.locator('#login-email').fill(owner.email);
  await page.locator('#login-password').fill('a-password-the-owner-chose');
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });
  if (test.info().project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  }
  await page.getByRole('navigation', { name: 'Dashboard sections' }).getByRole('button', { name: /^Products/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Products' })).toBeVisible();
}

async function uploadProductSheet(page: Page, name: string) {
  await page.locator('#bulk-products').setInputFiles({
    name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(productSheet(name)),
  });
}

test('a product sheet the server accepts is written and shown', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await stubConsole(page, (rows) => ({ body: { created: ['99'], errors: [], message: `${rows.length} rows imported.` } }));
  await signInAndOpenProducts(page);
  await uploadProductSheet(page, 'E2E Bulk Serum');

  // The note reports the truth rather than "sent for import".
  await expect(page.locator('#bulk-products-note')).toContainText(/1 row from Rows imported/, { timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  // The reload after the import brings the new row onto the table.
  await expect(page.getByRole('cell', { name: /E2E Bulk Serum/ }).first()).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('a row the server rejects is announced and logged, not silently dropped', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await stubConsole(page, () => ({
    body: {
      created: [],
      errors: [{ row: 2, message: 'The original price must be at least the selling price.', errors: { mrp: 'Lower the original price or raise the selling price.' } }],
      message: '0 rows imported, 1 skipped.',
    },
  }));
  await signInAndOpenProducts(page);
  await uploadProductSheet(page, 'E2E Rejected Serum');

  // The operator is told, and the banner survives the reload that follows.
  await expect(page.getByRole('alert')).toContainText(/1 row skipped/, { timeout: 20_000 });
  await expect(page.getByRole('alert')).toContainText(/row 2/);
  await expect(page.locator('#bulk-products-note')).toContainText(/None of the 1 row in Rows could be imported — 1 skipped/);
  // And the detail is left in the browser console for whoever is debugging.
  await expect.poll(() => consoleErrors.join('\n')).toContain('bulk import');
  await expect.poll(() => consoleErrors.join('\n')).toContain('1 products row skipped');
});
