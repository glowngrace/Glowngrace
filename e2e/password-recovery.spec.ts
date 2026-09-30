import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Browser coverage for the password-recovery flows added on this branch.
 *
 * Like the settings suite, every console endpoint here is stubbed so the tests
 * never read or write the database. The unit and server suites already prove the
 * SQL and the policy; this suite proves the browser wiring: the login page shows
 * the server's reason instead of blaming the sample accounts, a reset can be
 * requested and redeemed, and the console can recover a member or reset
 * everyone.
 */

const adminUser = {
  id: 'admin-1',
  name: 'Rehana Kapoor',
  email: 'rehana@glowngrace.in',
  role: 'Store Administrator',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-01',
};

const member = {
  id: 'admin-2',
  name: 'Karan Mehra',
  email: 'karan@glowngrace.in',
  role: 'Content & Reviews',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-04',
};

const storedSettings = {
  profile: { storeName: 'Glow & Grace', tagline: 'Kajal, colour and care', email: 'hello@glowngrace.in', phone: '+91 98765 43210', address: '12 Linking Road, Bandra West, Mumbai 400050' },
  delivery: { freeAbove: 1299, deliveryFee: 99, gst: 18, returns: 14 },
  notifications: { orders: true, lowStock: true, partners: false, reviews: true },
  preview: { livePreview: false },
};

async function stubConsole(page: Page) {
  const writes: Array<{ method: string; url: string; body: unknown }> = [];
  const collections: Record<string, unknown> = {
    me: { user: adminUser },
    products: { products: [] },
    orders: { orders: [] },
    jobs: { records: [] },
    candidates: { records: [] },
    partners: { records: [] },
    customers: { records: [] },
    reviews: { records: [] },
    users: { users: [adminUser, member], roles: ['Store Administrator', 'Content & Reviews', 'Store Manager'] },
    pages: { pages: [] },
    datasets: { datasets: [] },
    summary: { orders: 0, products: 0, jobs: 0, candidates: 0, partners: 0, customers: 0, reviews: 0, pages: [], hiddenDatasets: [] },
  };

  // The catch-all goes first: Playwright tries the most recently registered
  // route first, so registering the specific ones later lets them win. Request
  // paths with query strings are matched on their base path alone.
  // Only the listed reads are intercepted; everything else the console needs on
  // load — sign-in included — is answered by the dedicated routes below.
  await page.route('**/api/admin/**', (route) => {
    const path = route.request().url().replace(/^.*\/api\/admin\//, '').split('?')[0].replace(/\/$/, '');
    const collection = collections[path];
    if (collection && route.request().method() === 'GET') {
      return route.fulfill({ json: collection });
    }
    return route.continue();
  });

  await page.route('**/api/admin/demo-data', (route) => route.fulfill({
    json: { datasets: [{ key: 'products', label: 'Products', table: 'products', visible: true, seeded: true, rowCount: 0 }] },
  }));

  await page.route('**/api/admin/settings', async (route: Route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ method: 'PUT', url: 'settings', body });
      return route.fulfill({ json: { settings: storedSettings, updatedAt: '2026-02-02T10:00:00.000Z', message: 'Settings saved.' } });
    }
    return route.fulfill({ json: { settings: storedSettings, updatedAt: '2026-02-01T10:00:00.000Z' } });
  });

  await page.route('**/api/admin/password-reset/messages', (route) => route.fulfill({
    json: {
      messages: [
        { id: 'message-1', kind: 'password-reset', recipient: 'karan@glowngrace.in', subject: 'Your Glow & Grace console password', body: 'Open /reset-password?token=' + 'a'.repeat(64), createdAt: '2026-03-01T10:00:00.000Z', readAt: null },
        { id: 'message-2', kind: 'password-reset', recipient: 'rehana@glowngrace.in', subject: 'Your Glow & Grace console password', body: 'Open /reset-password?token=' + 'b'.repeat(64), createdAt: '2026-03-01T09:00:00.000Z', readAt: null },
      ],
    },
  }));

  await page.route('**/api/admin/users/*/recover', async (route: Route) => {
    const body = route.request().postDataJSON();
    writes.push({ method: 'POST', url: 'users/recover', body });
    const newPassword = String((body as { newPassword: string }).newPassword ?? '');
    // Mirrors the server's recovery policy. There is no published sample password
    // to make an exception for any more, so the ordinary minimum applies here as
    // it does on every other form.
    if (newPassword.length < 8) {
      return route.fulfill({ status: 400, json: { error: 'invalid_password', message: 'Use at least 8 characters.' } });
    }
    return route.fulfill({ json: { message: 'Password reset for Karan Mehra. Their other sessions were signed out.' } });
  });

  await page.route('**/api/admin/users/recover-all', async (route: Route) => {
    const body = route.request().postDataJSON();
    writes.push({ method: 'POST', url: 'users/recover-all', body });
    return route.fulfill({ json: { message: 'Password reset for all 2 console accounts. Everyone has been signed out.' } });
  });

  return { writes };
}

async function openSettings(page: Page) {
  // The console needs a server-issued session to load at all. Registering this
  // after the catch-all means Playwright prefers it over the wider admin stub.
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
  await expect(page.getByText('People helping run the beauty house')).toBeVisible();
}

test.describe('password recovery', () => {
  test('shows the server message for a wrong console password', async ({ page }) => {
    // The page used to catch every error and blame the sample account, and it
    // added a hint naming a published password. Both are gone with the demo
    // state, so the server's answer travels to the alert unaltered.
    await page.route('**/api/admin/session', (route) => route.fulfill({
      status: 401,
      json: { error: 'invalid_credentials', message: 'That email address and password do not match a console account.' },
    }));

    await page.goto('/login');
    // The login page renders inside the storefront layout, whose footer has its
    // own "Email address" label, so the form fields are targeted by id.
    await page.locator('#login-email').fill('karan@glowngrace.in');
    await page.locator('#login-password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in to your account' }).click();

    await expect(page.getByRole('alert')).toHaveText('That email address and password do not match a console account.');
  });

  test('offers a reset link for an address and confirms without revealing it', async ({ page }) => {
    // The login disclosure asks for a console address. The server answers the
    // same way whether the address exists, so this page never learns either.
    await page.route('**/api/admin/password-reset', (route) => route.fulfill({
      json: { message: 'If that address has a console account, a reset link is waiting for it.' },
    }));

    await page.goto('/login');
    await page.getByText('Forgotten your password?').click();
    await page.locator('#reset-email').fill('karan@glowngrace.in');
    await page.getByRole('button', { name: 'Send me a reset link' }).click();

    // The login form carries an empty aria-live slot used for sign-in errors, so
    // the reset confirmation is matched by its own notice class.
    await expect(page.locator('.login-reset-notice')).toHaveText('If that address has a console account, a reset link is waiting for it.');
  });

  test('redeems a reset code through the public page', async ({ page }) => {
    let sent: Record<string, unknown> | undefined;
    await page.route('**/api/admin/password-reset/confirm', async (route: Route) => {
      sent = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: { message: 'Password updated. You can sign in with it now.' } });
    });

    await page.goto('/reset-password');
    await page.locator('#reset-token').fill('a'.repeat(64));
    await page.locator('#reset-new-password').fill('brand-new-password');
    await page.locator('#reset-confirm-password').fill('brand-new-password');
    await page.getByRole('button', { name: 'Set my new password' }).click();

    await expect(page.locator('.login-reset-notice')).toHaveText('Password updated. You can sign in with it now.');
    await page.getByRole('button', { name: 'Go to sign in' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(sent).toEqual({ token: 'a'.repeat(64), newPassword: 'brand-new-password' });
  });

  test('refuses redemption when the two new passwords differ', async ({ page }) => {
    let hitTheApi = false;
    await page.route('**/api/admin/password-reset/confirm', (route) => {
      hitTheApi = true;
      return route.fulfill({ json: { message: 'never reached' } });
    });

    await page.goto('/reset-password');
    await page.locator('#reset-token').fill('a'.repeat(64));
    await page.locator('#reset-new-password').fill('brand-new-password');
    await page.locator('#reset-confirm-password').fill('brand-new-password-2');
    await page.getByRole('button', { name: 'Set my new password' }).click();

    await expect(page.getByRole('alert')).toContainText('do not match');
    expect(hitTheApi).toBe(false);
  });

  test('recovers a member without asking for their current password', async ({ page }) => {
    const { writes } = await stubConsole(page);
    await openSettings(page);

    const team = page.locator('section', { has: page.getByText('People helping run the beauty house') });
    await team.getByText('Karan Mehra').locator('..').getByRole('button', { name: 'Recover' }).click();

    const form = team.getByLabel('New password');
    await form.fill('recovered-2026');
    await page.getByRole('button', { name: 'Reset password' }).click();

    await expect(page.getByRole('status').getByText('Password reset. Karan Mehra has to sign in again with it.')).toBeVisible();
    expect(writes).toEqual([{ method: 'POST', url: 'users/recover', body: { newPassword: 'recovered-2026' } }]);
  });

  test('explains why a short password is rejected during recovery', async ({ page }) => {
    const { writes } = await stubConsole(page);
    await openSettings(page);

    const team = page.locator('section', { has: page.getByText('People helping run the beauty house') });
    await team.getByText('Karan Mehra').locator('..').getByRole('button', { name: 'Recover' }).click();
    await team.getByLabel('New password').fill('short');
    await page.getByRole('button', { name: 'Reset password' }).click();

    await expect(team.getByText('Use at least 8 characters.')).toBeVisible();
    expect(writes.length).toBe(1);
  });

  test('resets every console account from the settings page', async ({ page }) => {
    const { writes } = await stubConsole(page);
    await openSettings(page);

    const forms = page.locator('section', { has: page.getByRole('heading', { name: 'Reset console passwords' }) });
    await forms.getByLabel('Password for every account').fill('every-console-2026');
    await page.getByRole('button', { name: 'Reset all 2 passwords' }).click();

    await expect(page.getByRole('status').getByText('Every console password was reset. Sign in again with the new one.')).toBeVisible();
    expect(writes.some((write) => write.url === 'users/recover-all' && (write.body as { newPassword: string }).newPassword === 'every-console-2026')).toBe(true);
  });

  test('lists the waiting reset links and offers to copy a code', async ({ page }) => {
    await stubConsole(page);
    await openSettings(page);

    await page.getByRole('button', { name: 'Show reset links' }).click();

    await expect(page.getByRole('status').getByText('2 reset links waiting.')).toBeVisible();
    // The recipient also appears in the team list, so the link row is scoped to
    // the reset-links panel.
    const inbox = page.locator('section', { has: page.getByText('Where a forgotten-password link is waiting') });
    await expect(inbox.getByText('karan@glowngrace.in')).toBeVisible();
    await expect(inbox.getByRole('button', { name: 'Copy code' }).first()).toBeVisible();
  });
});