import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Browser coverage for the admin settings bugs fixed on this branch.
 *
 * Every console endpoint is stubbed, so these tests never read or write the
 * database and always start from the same known state. What they cover is the
 * part jsdom cannot: real focus management, real `input[type=number]` behaviour,
 * and the exact bytes each control sends to the API.
 */

const stored = {
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
};

const adminUser = {
  id: 'admin-1',
  name: 'Rehana Kapoor',
  email: 'rehana@glowngrace.in',
  role: 'Store Administrator',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-01',
};

const editor = {
  id: 'admin-2',
  name: 'Karan Mehra',
  email: 'karan@glowngrace.in',
  role: 'Content & Reviews',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-04',
};

const pages = [
  { slug: 'home', label: 'Home', path: '/', visible: true },
  { slug: 'shop', label: 'Shop', path: '/shop', visible: true },
  { slug: 'about', label: 'About', path: '/about', visible: true },
  { slug: 'careers', label: 'Careers', path: '/careers', visible: false },
];

type SaveOverride = (body: Record<string, unknown>) => { status: number; json: unknown } | null;

/** Stubs the whole console and records every settings write. */
async function stubConsole(page: Page, options: { onSave?: SaveOverride } = {}) {
  const saves: Record<string, unknown>[] = [];

  // The catch-all goes first: Playwright tries the most recently registered
  // route first, so registering it last would swallow the specific handlers
  // below along with the sign-in request the console needs to load at all.
  const collections: Record<string, unknown> = {
    me: { user: adminUser },
    products: { products: [] },
    orders: { orders: [] },
    jobs: { records: [] },
    candidates: { records: [] },
    partners: { records: [] },
    customers: { records: [] },
    reviews: { records: [] },
    users: { users: [adminUser, editor], roles: ['Store Administrator', 'Content & Reviews', 'Store Manager'] },
    pages: { pages },
    summary: { orders: 4, products: 12, jobs: 2, candidates: 0, partners: 3, customers: 9, reviews: 4, pages: ['/', '/shop'], hiddenDatasets: [] },
  };

  // Only the listed reads are intercepted; everything else, including the
  // sign-in request the console needs before it can load at all, is passed
  // through to the real API.
  await page.route('**/api/admin/**', (route) => {
    const path = route.request().url().replace(/^.*\/api\/admin\//, '');
    const collection = collections[path];
    if (collection && route.request().method() === 'GET') {
      return route.fulfill({ json: collection });
    }
    return route.continue();
  });

  await page.route('**/api/admin/demo-data', (route) => route.fulfill({
    json: {
      datasets: [
        { key: 'products', label: 'Products', table: 'products', visible: true, seeded: true, rowCount: 12 },
        { key: 'reviews', label: 'Sample reviews', table: 'reviews', visible: true, seeded: true, rowCount: 4 },
      ],
    },
  }));

  await page.route('**/api/admin/settings', async (route: Route) => {
    if (route.request().method() !== 'PUT') {
      await route.fulfill({ json: { settings: stored.settings, updatedAt: stored.updatedAt } });
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    saves.push(body);
    const override = options.onSave?.(body);
    if (override) {
      await route.fulfill({ status: override.status, json: override.json });
      return;
    }
    await route.fulfill({ json: { settings: stored.settings, updatedAt: '2026-02-02T10:00:00.000Z', message: 'Settings saved.' } });
  });

  return { saves };
}

/**
 * A console message is repeated in three places on purpose — the banner, the
 * toast and the field itself — so assertions have to say which one they mean.
 */
function toast(page: Page, message: string) {
  return page.getByRole('status').getByText(message, { exact: true });
}

async function openSettings(page: Page) {
  // The console needs a server-issued session. Registering this last means
  // Playwright prefers it over the wider admin stub above, and it keeps the
  // suite independent of whatever password the local database actually holds.
  await page.route('**/api/admin/session', async (route: Route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ json: { message: 'Signed out of the console.' } });
    }
    return route.fulfill({
      json: {
        token: 'e2e-session-token',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        user: adminUser,
      },
    });
  });

  await page.goto('/login');
  // There is no demo picker to lean on any more, so this signs in the way an
  // operator does: an address and a password, with the session route answering.
  await page.locator('#login-email').fill(adminUser.email);
  await page.locator('#login-password').fill('a-password-the-admin-chose');
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await expect(page.getByTestId('admin-loader')).toHaveCount(0, { timeout: 20_000 });
  if (test.info().project.name === 'mobile-chromium') {
    await page.getByRole('button', { name: 'Toggle navigation' }).click();
  }
  await page.getByRole('navigation', { name: 'Dashboard sections' })
    .getByRole('button', { name: /^Settings/ }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  // The form is only usable once the store has loaded; the inputs are the proof.
  await expect(page.getByLabel('Store name')).toHaveValue('Glow & Grace');
}

test.describe('admin settings', () => {
  test('shows a row count for every demo dataset', async ({ page }) => {
    await stubConsole(page);
    await openSettings(page);

    const danger = page.locator('section', { has: page.getByRole('heading', { name: 'Danger zone' }) });
    // The count used to arrive as an empty string, rendering a bare "rows".
    await expect(danger.getByText('12 rows · visible to shoppers')).toBeVisible();
    await expect(danger.getByText('4 rows · visible to shoppers')).toBeVisible();
  });

  test('sends only the section that was edited', async ({ page }) => {
    const { saves } = await stubConsole(page);
    await openSettings(page);

    await page.getByLabel('Tagline').fill('Kajal, colour and calm');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(toast(page, 'Store profile saved.')).toBeVisible();

    expect(saves).toHaveLength(1);
    // The delivery and notification blocks are not dragged along with it.
    expect(Object.keys(saves[0])).toEqual(['profile']);
    expect((saves[0].profile as { tagline: string }).tagline).toBe('Kajal, colour and calm');
  });

  test('keeps the typed value and explains a rejected save', async ({ page }) => {
    await stubConsole(page, {
      onSave: () => ({
        status: 400,
        json: { error: 'invalid_settings', message: 'Please check the highlighted settings and try again.', errors: { 'profile.email': 'Enter a valid email address.' } },
      }),
    });
    await openSettings(page);

    const email = page.getByLabel('Contact email');
    await email.fill('not-an-email');
    await page.getByRole('button', { name: 'Save profile' }).click();

    // The message is announced, the field is marked invalid, and nothing is lost.
    await expect(toast(page, 'Please check the highlighted settings and try again.')).toBeVisible();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(email).toHaveValue('not-an-email');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(toast(page, 'Store profile saved.')).toHaveCount(0);
  });

  test('refuses a fractional delivery fee before contacting the API', async ({ page }) => {
    const { saves } = await stubConsole(page);
    await openSettings(page);

    await page.getByLabel('Standard delivery fee (₹)').fill('49.5');
    await page.getByRole('button', { name: 'Save delivery settings' }).click();

    await expect(page.getByText('Enter a whole number, without a decimal point.')).toBeVisible();
    expect(saves).toHaveLength(0);
  });

  test('treats a cleared number field as empty rather than as zero', async ({ page }) => {
    const { saves } = await stubConsole(page);
    await openSettings(page);

    await page.getByLabel('Free delivery above (₹)').fill('');
    await page.getByRole('button', { name: 'Save delivery settings' }).click();

    // A silent 0 here would have rewritten the store's free-delivery threshold.
    await expect(page.getByText('Enter the free delivery above.')).toBeVisible();
    expect(saves).toHaveLength(0);
  });

  test('persists the live preview switch', async ({ page }) => {
    const { saves } = await stubConsole(page);
    await openSettings(page);

    const toggle = page.getByRole('switch', { name: 'Live preview mode' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();

    await expect(toast(page, 'Live preview mode enabled.')).toBeVisible();
    expect(saves).toEqual([{ preview: { livePreview: true } }]);
  });

  test('returns a rejected notification switch to its stored position', async ({ page }) => {
    const { saves } = await stubConsole(page, {
      onSave: () => ({ status: 400, json: { error: 'invalid_settings', message: 'That switch could not be saved.' } }),
    });
    await openSettings(page);

    const orders = page.getByRole('switch', { name: 'New order placed' });
    await expect(orders).toHaveAttribute('aria-checked', 'true');
    await orders.click();

    await expect(toast(page, 'That switch could not be saved.')).toBeVisible();
    // The switch must not sit in a position the database never accepted.
    await expect(orders).toHaveAttribute('aria-checked', 'true');
    expect(saves).toEqual([{ notifications: { orders: false, lowStock: true, partners: false, reviews: true } }]);
  });

  test('keeps the password form open when the current password is wrong', async ({ page }) => {
    await stubConsole(page);
    await page.route('**/api/admin/users/*/password', (route) => route.fulfill({
      status: 400,
      json: { error: 'wrong_password', message: 'That current password is not correct.' },
    }));
    await openSettings(page);

    const team = page.locator('section', { has: page.getByText('People helping run the beauty house') });
    await team.getByText('Karan Mehra').locator('..').getByRole('button', { name: 'Password' }).click();

    await page.getByLabel('Current password').fill('wrong-one');
    await page.getByLabel('New password').fill('brand-new-password');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText('That current password is not correct.')).toHaveCount(3);
    // The reason lands on the field that caused it.
    await expect(page.getByLabel('Current password')).toHaveAttribute('aria-invalid', 'true');
    // The form used to close, discarding everything that had been typed.
    await expect(page.getByLabel('New password')).toHaveValue('brand-new-password');
    await expect(page.getByRole('button', { name: 'Update password' })).toBeVisible();
  });

  test('confirms a destructive action and can be dismissed with Escape', async ({ page }) => {
    await stubConsole(page);
    await openSettings(page);

    const danger = page.locator('section', { has: page.getByRole('heading', { name: 'Danger zone' }) });
    await danger.getByRole('button', { name: 'Hide' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Confirm this action' });
    await expect(dialog).toBeVisible();
    // Focus starts on the safe action, so Escape is a working way out.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('does not claim a copy when the browser blocks the clipboard', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    await stubConsole(page);
    await openSettings(page);

    await page.getByRole('button', { name: 'Copy preview link' }).click();

    await expect(page.getByText('Your browser blocked the clipboard. Copy the address bar instead.')).toBeVisible();
    await expect(page.getByText('Storefront link copied to your clipboard.')).toHaveCount(0);
  });
});
