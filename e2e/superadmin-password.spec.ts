import { expect, test, type Page, type Route } from '@playwright/test';
import { auditPage } from './support/audit';

/**
 * Browser coverage for `/superadmin/ggpass`.
 *
 * The endpoint is stubbed throughout, so no test here generates a real password
 * or sends a real mail. What is under test is the part jsdom does not settle:
 * that the screen asks the server who is signed in rather than trusting storage,
 * that the generate button cannot be reached without a confirmation, that Escape
 * and Cancel both leave without sending anything, that focus returns to the
 * button that opened the dialog, and that the role decides whether the button is
 * rendered at all.
 *
 * The load-bearing assertion is the last one: the generated password must never
 * appear anywhere in the response or on the page.
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

const administrator = {
  id: 'admin-1',
  name: 'Rehana Kapoor',
  email: 'rehana@glowngrace.in',
  role: 'Store Administrator',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-01',
};

const generated = {
  rotated: true,
  email: 'glowngracebiz@gmail.com',
  sessionsRevoked: 3,
  nextRotationDays: 7,
};

/**
 * A console whose `me` and `owner-password/generate` routes answer as instructed.
 *
 * `generate` records every call and answers whatever `onGenerate` says, so a
 * test can assert that nothing was sent.
 */
async function stubConsole(page: Page, options: {
  user?: typeof owner;
  onGenerate?: () => { status: number; json: unknown } | null;
  /**
   * What `/api/health` answers. Defaults to a healthy deployment, because that is
   * the case every other test is about. A deployment with no database or no mail is
   * the thing the new warnings exist for, and a test that leaves this at the default
   * would silently stop covering them the moment somebody tightened the page.
   */
  health?: Record<string, unknown> | null;
} = {}) {
  const user = options.user ?? owner;
  const generateCalls: Array<Record<string, unknown> | null> = [];

  // Registered first, so it is checked last. Playwright matches the most recently
  // registered route first, and this one answers every console read - if it were
  // added after the `owner-password` route it would swallow the POST and let it
  // reach the real server.
  await page.route('**/api/admin/**', (route) => {
    const path = route.request().url().replace(/^.*\/api\/admin\//, '').split('?')[0].replace(/\/$/, '');
    if (route.request().method() !== 'GET') return route.continue();
    if (path === 'me') return route.fulfill({ json: { user } });
    return route.fulfill({ json: {} });
  });

  await page.route('**/api/admin/owner-password/**', (route: Route) => {
    generateCalls.push(route.request().postDataJSON() as Record<string, unknown> | null);
    const override = options.onGenerate?.();
    return override
      ? route.fulfill({ status: override.status, json: override.json })
      : route.fulfill({ json: generated });
  });

  // Public health route, not an admin one. `null` means unreachable, which the page
  // has to treat as unknown rather than as a fault.
  const health = options.health === undefined
    ? { status: 'ok', store: 'postgres', mail: 'configured', mailPending: 0 }
    : options.health;
  await page.route('**/api/health', (route: Route) => (
    health === null ? route.abort() : route.fulfill({ json: health })
  ));

  return { generateCalls };
}

/**
 * Signs in and opens `/superadmin/ggpass` directly.
 *
 * Navigating by URL rather than through the console is deliberate: the screen has
 * its own address and is not linked from the navigation, so typing it is the way
 * somebody reaches it. That has to work, and it has to be refused for the wrong
 * role.
 */
async function openScreen(page: Page, user: typeof owner = owner) {
  await page.route('**/api/admin/session', (route: Route) => {
    if (route.request().method() === 'DELETE') return route.fulfill({ json: { message: 'Signed out of the console.' } });
    return route.fulfill({
      json: {
        token: '3f1c9a52-8d47-4e6b-9a10-2c5b7e8d4f31',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        user,
      },
    });
  });

  await page.goto('/login');
  await page.locator('#login-email').fill(user.email);
  await page.locator('#login-password').fill('a-password-the-owner-chose');
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.goto('/superadmin/ggpass');
}

test.describe('/superadmin/ggpass', () => {
  test('offers the owner a way to generate a new password', async ({ page }) => {
    await stubConsole(page);
    await openScreen(page);

    await expect(page.getByRole('heading', { name: 'Owner password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate a new password' })).toBeVisible();
    // The destination is on screen before anything is pressed, so nobody
    // discovers at the last moment that they cannot reach the mailbox.
    await expect(page.getByLabel('Send the new password to')).toHaveValue('glowngracebiz@gmail.com');
  });

  test('shows the destination as a fixed field rather than something to type', async ({ page }) => {
    await stubConsole(page);
    await openScreen(page);

    const field = page.getByLabel('Send the new password to');
    await expect(field).toHaveValue('glowngracebiz@gmail.com');
    // Readonly as well as disabled: the value is the owner address by construction,
    // not an editable default, and a browser autofill must not be able to change it.
    await expect(field).toHaveAttribute('readonly', '');
    await expect(field).toBeDisabled();
    await expect(page.getByText('Fixed to the Super Admin account.')).toBeVisible();
  });

  test('refuses to generate on a deployment with no database, and says why', async ({ page }) => {
    const { generateCalls } = await stubConsole(page, {
      health: {
        status: 'error',
        store: 'memory',
        mail: 'configured',
        mailPending: 0,
        reason: 'This deployment has no database configured.',
      },
    });
    await openScreen(page);

    // Without this the page reports a successful rotation and the password exists
    // only until the next cold start, with nothing on screen to say so.
    await expect(page.getByRole('heading', { name: 'This deployment has no database.' })).toBeVisible();
    await expect(page.getByText('NEON_DATABASE_URL').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate a new password' })).toBeDisabled();
    expect(generateCalls).toHaveLength(0);
  });

  test('refuses to generate when mail is not configured, and says why', async ({ page }) => {
    const { generateCalls } = await stubConsole(page, {
      health: { status: 'ok', store: 'postgres', mail: 'absent', mailPending: 0 },
    });
    await openScreen(page);

    await expect(page.getByRole('heading', { name: 'Mail is not configured on this deployment.' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate a new password' })).toBeDisabled();
    expect(generateCalls).toHaveLength(0);
  });

  test('tells a signed-out owner to fix the deployment rather than to sign in again', async ({ page }) => {
    // With no database there is no account to sign in as, so the usual "sign in and
    // come back" would send the owner round in a circle.
    await stubConsole(page, {
      health: {
        status: 'error',
        store: 'memory',
        mail: 'configured',
        mailPending: 0,
        reason: 'This deployment has no database configured.',
      },
    });
    await page.route('**/api/admin/me', (route) => route.fulfill({
      status: 401,
      json: { error: 'unauthenticated', message: 'Sign in to continue.' },
    }));

    await page.goto('/superadmin/ggpass');

    await expect(page.getByRole('heading', { name: 'This deployment has no database, so signing in is impossible.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toHaveCount(0);
  });

  test('still offers the button when the health route cannot be reached', async ({ page }) => {
    // Unreachable is not the same as broken. Blocking on a network hiccup would take
    // away a working feature on the strength of a signal that never arrived.
    const { generateCalls } = await stubConsole(page, { health: null });
    await openScreen(page);

    await expect(page.getByRole('heading', { name: 'This deployment has no database.' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate a new password' })).toBeEnabled();

    await page.getByRole('button', { name: 'Generate a new password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();
    await expect(page.getByRole('status')).toContainText('A new password has been sent to');
    expect(generateCalls).toHaveLength(1);
  });

  test('never renders the password it generated', async ({ page }) => {
    const { generateCalls } = await stubConsole(page);
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate a new password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();

    await expect(page.getByRole('status')).toContainText('A new password has been sent to glowngracebiz@gmail.com');
    expect(generateCalls).toHaveLength(1);

    // The response body is the only thing that could leak one, and it carries no
    // password field at all. Checked against the whole document, so a stray
    // input, a data attribute or a hidden panel would fail here too.
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(/password:/i);
    expect(text).not.toMatch(/[A-Za-z0-9!@#$%^&*_+-]{20,}/);
    expect(await page.locator('input[type="password"]').count()).toBe(0);
  });

  test('will not generate anything without a confirmation', async ({ page }) => {
    const { generateCalls } = await stubConsole(page);
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate a new password' }).click();

    const dialog = page.getByRole('dialog', { name: 'Generate a new owner password?' });
    await expect(dialog).toBeVisible();
    // The dialog names what is about to be lost, because the caller's own session
    // is one of the things that goes.
    await expect(dialog).toContainText('Every session ends, including this one');
    expect(generateCalls).toHaveLength(0);
    // Focus lands on the safe action, so a keyboard user can leave immediately.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(generateCalls).toHaveLength(0);
    // And focus comes back to the button that opened it, not the top of the page.
    await expect(page.getByRole('button', { name: 'Generate a new password' })).toBeFocused();
  });

  test('cancels without generating', async ({ page }) => {
    const { generateCalls } = await stubConsole(page);
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate a new password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(generateCalls).toHaveLength(0);
  });

  test('shows no button to anybody but the owner account', async ({ page }) => {
    // The page's own role check. It is a courtesy, not the guard: the endpoint
    // answers 403 regardless, which is asserted in src/server/admin.test.ts.
    const { generateCalls } = await stubConsole(page, { user: administrator });
    await openScreen(page, administrator);

    await expect(page.getByRole('heading', { name: 'This screen is for the owner account only.' })).toBeVisible();
    await expect(page.getByText('Store Administrator')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate a new password' })).toHaveCount(0);
    expect(generateCalls).toHaveLength(0);
  });

  test('sends somebody with no session to sign in', async ({ page }) => {
    await stubConsole(page);
    // `me` answers 401 for a lapsed or absent session.
    await page.route('**/api/admin/me', (route) => route.fulfill({
      status: 401,
      json: { error: 'unauthenticated', message: 'Sign in to continue.' },
    }));

    await page.goto('/superadmin/ggpass');

    await expect(page.getByRole('heading', { name: 'This screen needs a signed-in owner.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate a new password' })).toHaveCount(0);
  });

  test('reports a refused request and stays usable', async ({ page }) => {
    const { generateCalls } = await stubConsole(page, {
      onGenerate: () => ({
        status: 403,
        json: { error: 'forbidden', message: 'Only the Super Admin account can generate a new owner password.' },
      }),
    });
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate a new password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();

    // The server's own message, not a generic failure: the page does not get to
    // decide that this was a permissions problem.
    await expect(page.getByRole('alert')).toHaveText('Only the Super Admin account can generate a new owner password.');
    // The button comes back rather than staying stuck on "Generating…".
    await expect(page.getByRole('button', { name: 'Generate a new password' })).toBeEnabled();
    expect(generateCalls).toHaveLength(1);
  });

  test('ends the session in the browser, because the server ended every one', async ({ page }) => {
    await stubConsole(page);
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate a new password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();
    await expect(page.getByRole('status')).toContainText('A new password has been sent to');

    // The stored token is gone, so a refresh does not leave a stale session that
    // the server will reject on the next click.
    const token = await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'));
    expect(token).toBeNull();
  });

  test('holds together on this screen in every state it can be in', async ({ page }) => {
    // The page is a full page rather than a panel in the console, so it carries
    // the page's own heading - one `h1` - and has to survive the same layout
    // pass as the storefront pages. The states are separate visits because each
    // one is a different page as far as the audit is concerned.
    await stubConsole(page);
    await openScreen(page);

    await auditPage(page, '/superadmin/ggpass');

    // With the confirmation open: the dialog is a second layer over the page, so
    // it is audited on its own terms rather than trusted to inherit anything.
    await page.getByRole('button', { name: 'Generate a new password' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await auditPage(page, '/superadmin/ggpass (confirming)');
  });

  test('holds together for somebody it refuses', async ({ page }) => {
    await stubConsole(page, { user: administrator });
    await openScreen(page, administrator);

    await auditPage(page, '/superadmin/ggpass (not the owner)');
  });

  test('holds together for somebody with no session', async ({ page }) => {
    await stubConsole(page);
    await page.route('**/api/admin/me', (route) => route.fulfill({
      status: 401,
      json: { error: 'unauthenticated', message: 'Sign in to continue.' },
    }));

    await page.goto('/superadmin/ggpass');
    await expect(page.getByRole('heading', { name: 'This screen needs a signed-in owner.' })).toBeVisible();

    await auditPage(page, '/superadmin/ggpass (signed out)');
  });
});