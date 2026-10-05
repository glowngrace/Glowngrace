import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Every bulk-upload file input has to announce itself.
 *
 * All seven inputs are `sr-only`: hidden from the eye but still in the tab
 * order, so a keyboard or screen-reader user reaches them directly instead of
 * going through the button that normally opens them. That is only a benefit if
 * they announce something. Without a name each one is announced as an
 * unlabelled file control, which is worse than the button - the user is told
 * there is a file control and not what it is for.
 *
 * The names come from the bulk templates rather than from the button's own
 * wording, so a dataset added later is covered by the same assertion.
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
  updatedAt: '2026-02-01T10:00:00.000Z',
};

/**
 * A console with every read stubbed, so the run never depends on what the local
 * database holds. Anything not listed is passed through rather than answered
 * with an empty object, because an empty object is not a shape the console can
 * render.
 */
async function stubConsole(page: Page) {
  const collections: Record<string, unknown> = {
    me: { user: owner },
    products: { products: [] },
    orders: { orders: [] },
    jobs: { records: [] },
    candidates: { records: [] },
    partners: { records: [] },
    customers: { records: [] },
    reviews: { records: [] },
    users: { users: [owner], roles: ['Super Admin', 'Store Administrator'] },
    pages: { pages: [{ slug: 'home', label: 'Home', path: '/', visible: true }] },
    summary: { orders: 0, products: 0, jobs: 0, candidates: 0, partners: 0, customers: 0, reviews: 0, pages: [], hiddenDatasets: [] },
  };

  await page.route('**/api/admin/**', (route) => {
    const path = route.request().url().replace(/^.*\/api\/admin\//, '').split('?')[0].replace(/\/$/, '');
    const collection = collections[path];
    if (collection && route.request().method() === 'GET') return route.fulfill({ json: collection });
    return route.continue();
  });

  await page.route('**/api/admin/settings', (route) => route.fulfill({ json: { settings, updatedAt: settings.updatedAt } }));

  await page.route('**/api/admin/demo-data', (route) => route.fulfill({ json: { datasets: [] } }));

  // The settings page's local-database panel. Left alone it reaches the real API
  // with a session that does not exist, and the 401 that returns ends the
  // session - which replaces the page this test is here to look at.
  await page.route('**/api/admin/local-db', (route) => route.fulfill({
    json: {
      store: 'postgres',
      local: { connection: 'DATABASE_URL localhost:5435/glow_grace (provider=local, ssl=disable)' },
      neon: { configured: false },
      syncEnabled: false,
    },
  }));

  // Registered last so it is preferred over the wider stub above. The token is a
  // UUID because `admin_sessions.token` is a `uuid` column.
  await page.route('**/api/admin/session', (route: Route) => route.fulfill({
    json: {
      token: '3f1c9a52-8d47-4e6b-9a10-2c5b7e8d4f31',
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      user: owner,
    },
  }));
}

async function openSection(page: Page, nav: RegExp, heading: string) {
  if (test.info().project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  }
  await page.getByRole('navigation', { name: 'Dashboard sections' })
    .getByRole('button', { name: nav }).click();
  await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
}

test('every bulk-upload file input announces what it uploads', async ({ page }) => {
  await stubConsole(page);
  await page.goto('/login');
  await page.locator('#login-email').fill(owner.email);
  await page.locator('#login-password').fill('a-password-the-owner-chose');
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });

  // One section per dataset: products, vacancies, candidates, partner salons,
  // customers, reviews and the team list on settings.
  const sections: Array<[RegExp, string]> = [
    [/^Products/, 'Products'],
    [/^Job vacancies/, 'Job vacancies'],
    [/^Candidates/, 'Candidates'],
    [/^Partner salons/, 'Partner salons'],
    [/^Customers/, 'Customers'],
    [/^Reviews/, 'Reviews'],
    [/^Settings/, 'Settings'],
  ];

  const names: string[] = [];
  for (const [nav, heading] of sections) {
    await openSection(page, nav, heading);

    const inputs = page.locator('input[type="file"]');
    const count = await inputs.count();
    expect(count, `${heading} has no file input`).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const input = inputs.nth(index);
      // The name, not the presence of an attribute: an empty label is as
      // unnamed as no label at all.
      const label = (await input.getAttribute('aria-label'))?.trim();
      expect(label, `${heading}: file input ${index + 1} has no name`).toBeTruthy();
      names.push(label!);
    }
  }

  // Seven datasets, seven distinct names. A template copied from the wrong
  // dataset would otherwise leave two sections claiming to be the same thing.
  expect(names).toHaveLength(7);
  expect(new Set(names).size).toBe(7);
});