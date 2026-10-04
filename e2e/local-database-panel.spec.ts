import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Browser coverage for the local database panel and its one destructive button.
 *
 * Everything the panel talks to is stubbed, so no test here copies anything and
 * the suite is independent of whether a Neon connection string happens to be
 * configured. What is under test is the part jsdom does not settle: that the
 * button cannot be reached without a confirmation, that Escape and Cancel both
 * leave without sending anything, that focus comes back to the button that
 * opened the dialog, and that the role decides whether the panel is mounted at
 * all.
 */

const owner = {
  id: 'admin-owner',
  name: 'Glow & Grace Super Admin',
  email: 'owner@glowngrace.in',
  role: 'Super Admin',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-01',
};

const administrator = {
  id: 'admin-1',
  name: 'Rehana Kapoor',
  email: 'rehana@glowngrace.in',
  role: 'Store Administrator',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-01',
};

const report = {
  store: 'postgres',
  local: { connection: 'DATABASE_URL localhost:5435/glow_grace (provider=local, ssl=disable)' },
  neon: {
    configured: true,
    project: 'neon-glowngraceproddb',
    host: `e${'*'.repeat('p-cool-pooler'.length)}.aws-ap-southeast-2.neon.tech`,
    connection: 'NEON_DATABASE_URL e*************.aws-ap-southeast-2.neon.tech/neondb (provider=neon, ssl=require)',
  },
  syncEnabled: true,
};

const syncResult = {
  status: 'ok',
  message: 'Copied 97 rows from Neon into the local database in 2s. The console accounts came across too, so sign in again.',
  source: 'NEON_DATABASE_URL e*************.aws-ap-southeast-2.neon.tech/neondb (provider=neon, ssl=require)',
  target: 'DATABASE_URL localhost:5435/glow_grace (provider=local, ssl=disable)',
  copied: { products: 9, orders: 9, product_images: 0, site_pages: 15 },
  available: { products: 9, orders: 9, product_images: 2, site_pages: 15 },
  skipImages: true,
  durationMs: 2143,
};

/** A console whose local-db route answers as instructed. */
async function stubConsole(page: Page, options: {
  user?: typeof owner;
  report?: unknown;
  reportStatus?: number;
  onSync?: (body: Record<string, unknown>) => { status: number; json: unknown } | null;
} = {}) {
  const user = options.user ?? owner;
  const syncs: Record<string, unknown>[] = [];

  await page.route('**/api/admin/**', (route) => {
    const path = route.request().url().replace(/^.*\/api\/admin\//, '');
    if (route.request().method() !== 'GET') return route.continue();
    if (path === 'me') return route.fulfill({ json: { user } });
    if (path === 'local-db') {
      if (options.reportStatus) return route.fulfill({ status: options.reportStatus, json: { error: 'not_found', message: 'That endpoint does not exist.' } });
      return route.fulfill({ json: options.report ?? report });
    }
    const collections: Record<string, unknown> = {
      products: { products: [] },
      orders: { orders: [] },
      // All five of these arrive under `records`, not under their own name.
      jobs: { records: [] },
      candidates: { records: [] },
      partners: { records: [] },
      customers: { records: [] },
      reviews: { records: [] },
      users: { users: [user], roles: ['Super Admin', 'Store Administrator'] },
      pages: { pages: [{ slug: 'home', label: 'Home', path: '/', visible: true }] },
      summary: { orders: 0, products: 0, jobs: 0, candidates: 0, partners: 0, customers: 0, reviews: 0, pages: [], hiddenDatasets: [] },
    };
    const collection = collections[path];
    return collection ? route.fulfill({ json: collection }) : route.continue();
  });

  await page.route('**/api/admin/settings', (route) => route.fulfill({
    json: {
      settings: {
        profile: {
          storeName: 'Glow & Grace',
          tagline: 'Kajal, colour and care',
          email: 'hello@glowngrace.in',
          phone: '+91 98765 43210',
          address: '12 Linking Road, Bandra West, Mumbai 400050',
        },
        delivery: { freeAbove: 1299, deliveryFee: 99, gst: 18, returns: 14 },
        notifications: { orders: true, lowStock: true, partners: false, reviews: true },
        preview: { livePreview: false },
      },
      updatedAt: '2026-02-01T10:00:00.000Z',
    },
  }));

  await page.route('**/api/admin/demo-data', (route) => route.fulfill({
    json: {
      datasets: [
        { key: 'products', label: 'Products', table: 'products', visible: true, seeded: true, rowCount: 12 },
      ],
    },
  }));

  await page.route('**/api/admin/local-db/sync', (route: Route) => {
    syncs.push(route.request().postDataJSON() as Record<string, unknown>);
    const override = options.onSync?.(syncs.at(-1)!);
    return override
      ? route.fulfill({ status: override.status, json: override.json })
      : route.fulfill({ json: syncResult });
  });

  return { syncs };
}

/**
 * Signs in and opens the settings page.
 *
 * The session response carries the role as well as the token, because that is
 * where the console reads the signed-in account from - so a test that signs in a
 * Store Administrator has to say so here and not only on `me`.
 */
async function openSettings(page: Page, user: typeof owner = owner) {
  await page.route('**/api/admin/session', (route: Route) => {
    if (route.request().method() === 'DELETE') return route.fulfill({ json: { message: 'Signed out of the console.' } });
    return route.fulfill({
      json: {
        token: 'e2e-session-token',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        user,
      },
    });
  });

  await page.goto('/login');
  await page.locator('#login-email').fill(user.email);
  await page.locator('#login-password').fill('a-password-the-owner-chose');
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await expect(page.getByTestId('admin-loader')).toHaveCount(0, { timeout: 20_000 });
  if (test.info().project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  }
  await page.getByRole('navigation', { name: 'Dashboard sections' })
    .getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
}

function panel(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Local database' }) });
}

/** One row of the "what was copied" list. */
function copiedRow(page: Page, table: string) {
  return panel(page).locator('li', { has: page.getByText(table, { exact: true }) });
}

test.describe('the local database panel', () => {
  test('names both databases and prints no password', async ({ page }) => {
    await stubConsole(page);
    await openSettings(page);

    await expect(panel(page).getByText('Local Docker PostgreSQL')).toBeVisible();
    await expect(panel(page).getByText('localhost:5435/glow_grace')).toBeVisible();
    await expect(panel(page).getByText(/neon-glowngraceproddb at e\*+\.aws-ap-southeast-2\.neon\.tech/)).toBeVisible();
    // The host is masked in the panel itself, so a screenshot of it in a bug
    // report gives nothing away.
    expect(await panel(page).innerText()).not.toContain('p-cool-pooler');
  });

  test('is not mounted for anybody but the owner', async ({ page }) => {
    await stubConsole(page, { user: administrator });
    await openSettings(page, administrator);

    // The role check is in the page, so a Store Administrator never even asks
    // for the report. The endpoint would refuse it anyway.
    await expect(panel(page)).toHaveCount(0);
  });

  test('is not mounted when the server says there is no such endpoint', async ({ page }) => {
    // What a deployment with SYNC_FROM_PRODUCTION off answers. The panel renders
    // nothing at all rather than showing a button that would fail.
    await stubConsole(page, { reportStatus: 404 });
    await openSettings(page);

    await expect(panel(page)).toHaveCount(0);
  });

  test('explains an unconfigured Neon instead of offering the button', async ({ page }) => {
    await stubConsole(page, {
      report: {
        ...report,
        neon: {
          configured: false,
          project: 'neon-glowngraceproddb',
          reason: 'No production database connection string is configured. Set PRODUCTION_DATABASE_URL or NEON_DATABASE_URL in .env.',
        },
      },
    });
    await openSettings(page);

    await expect(panel(page).getByText('Not configured')).toBeVisible();
    await expect(panel(page).getByRole('note')).toContainText('No production database connection string is configured');
    await expect(panel(page).getByRole('button', { name: 'Sync from Neon' })).toHaveCount(0);
  });

  test('will not copy anything without a confirmation', async ({ page }) => {
    const { syncs } = await stubConsole(page);
    await openSettings(page);

    await panel(page).getByRole('button', { name: 'Sync from Neon' }).click();

    // The dialog is up and nothing has been sent yet: this is the whole reason it
    // exists, because the sync empties every local table it touches.
    const dialog = panel(page).getByRole('dialog', { name: 'Replace the local data?' });
    await expect(dialog).toBeVisible();
    expect(syncs).toHaveLength(0);
    // Focus lands on the safe action, so a keyboard user can leave immediately.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(syncs).toHaveLength(0);
    // And focus comes back to the button that opened it, not to the top of the page.
    await expect(panel(page).getByRole('button', { name: 'Sync from Neon' })).toBeFocused();
  });

  test('cancels without copying, and says what cancelling would have cost', async ({ page }) => {
    const { syncs } = await stubConsole(page);
    await openSettings(page);

    await panel(page).getByRole('checkbox', { name: 'Skip product images' }).check();
    await panel(page).getByRole('button', { name: 'Sync from Neon' }).click();

    const dialog = panel(page).getByRole('dialog', { name: 'Replace the local data?' });
    await expect(dialog).toContainText('Anything saved locally that is not in production will be lost.');
    // The switch is named in the warning, so the two cannot disagree.
    await expect(dialog).toContainText('Product images are being skipped, so existing ones stay.');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(syncs).toHaveLength(0);
  });

  test('copies on confirmation and reports every table', async ({ page }) => {
    const { syncs } = await stubConsole(page);
    await openSettings(page);

    await panel(page).getByRole('checkbox', { name: 'Skip product images' }).check();
    await panel(page).getByRole('button', { name: 'Sync from Neon' }).click();
    await panel(page).getByRole('dialog').getByRole('button', { name: 'Replace local data' }).click();

    // The switches go over the wire as booleans, not as strings.
    expect(syncs).toEqual([{ skipImages: true, force: false }]);
    await expect(panel(page).getByRole('status')).toContainText('Copied 97 rows');
    await expect(copiedRow(page, 'products')).toContainText('9 rows copied');
    // A table skipped on purpose says what was left behind rather than claiming
    // nothing was in Neon.
    await expect(copiedRow(page, 'product_images')).toContainText('0 rows copied of 2 in Neon');
    // And the message says what happens next, because the sync drops local sessions.
    await expect(panel(page).getByRole('status')).toContainText('sign in again');
  });

  test('offers the override when the two already match, and it forces', async ({ page }) => {
    const { syncs } = await stubConsole(page, {
      onSync: () => ({
        status: 200,
        json: {
          ...syncResult,
          status: 'unchanged',
          copied: {},
          message: 'The local database already matches Neon, so nothing was copied. Use "Sync anyway" to overwrite it regardless.',
        },
      }),
    });
    await openSettings(page);

    await panel(page).getByRole('button', { name: 'Sync from Neon' }).click();
    await panel(page).getByRole('dialog').getByRole('button', { name: 'Replace local data' }).click();

    await expect(panel(page).getByText('already matches Neon')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Sync anyway' }).click();

    // The override is not a second confirmation: the destructive step already
    // happened once and the same consent covers this click.
    expect(syncs).toEqual([
      { skipImages: false, force: false },
      { skipImages: false, force: true },
    ]);
  });

  test('keeps the panel usable and explains a refused sync', async ({ page }) => {
    const { syncs } = await stubConsole(page, {
      onSync: () => ({
        status: 503,
        json: { error: 'database_not_configured', message: 'No production database connection string is configured.' },
      }),
    });
    await openSettings(page);

    await panel(page).getByRole('button', { name: 'Sync from Neon' }).click();
    await panel(page).getByRole('dialog').getByRole('button', { name: 'Replace local data' }).click();

    // A refused sync goes to the page's toast, not to the panel's own status line:
// the panel has no result to show, and saying so would be a lie.
    await expect(page.getByRole('status').getByText('No production database connection string is configured.', { exact: true })).toBeVisible();
    // The button comes back rather than staying stuck on "Syncing…".
    await expect(panel(page).getByRole('button', { name: 'Sync from Neon' })).toBeEnabled();
    expect(syncs).toHaveLength(1);
  });
});