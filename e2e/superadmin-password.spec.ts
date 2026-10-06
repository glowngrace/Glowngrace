import { expect, test, type Page, type Route } from '@playwright/test';
import { auditPage } from './support/audit';

/**
 * Browser coverage for `/superadmin/ggpass`.
 *
 * Both endpoints are stubbed throughout, so no test here generates a real password
 * or sends a real mail. What is under test is the part jsdom does not settle: that
 * the screen asks the server who is signed in rather than trusting storage, that
 * generating writes nothing until the save, that the password is readable and
 * copyable, that the save ends the session and walks back to sign-in, and that the
 * role decides whether any of it is rendered at all.
 *
 * The load-bearing assertions are the middle ones: the value shown in the field and
 * the value the toast offers to copy must be the same one the save sends, because
 * the operator types the field back in later and never sees this screen again.
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

/** What the server hands back from `generate`, in the shape it really sends. */
const generated = {
  generated: true,
  password: 'K7RM2WQX',
  email: 'glowngracebiz@gmail.com',
};

const saved = {
  saved: true,
  email: 'glowngracebiz@gmail.com',
  sessionsRevoked: 3,
  message: 'Your Super Admin password was saved and a confirmation was sent to glowngracebiz@gmail.com.',
};

/**
 * The countdown between a saved password and the bounce to sign-in. Long enough to
 * read the confirmation, and separate from the toast's own schedule.
 */
const SIGN_IN_REDIRECT_MS = 2500;

/**
 * A console whose `me`, `owner-password/generate` and `owner-password/save` routes
 * answer as instructed.
 *
 * Both calls are recorded, so a test can assert that generating wrote nothing, and
 * that saving sent the value in the field rather than the one that came back.
 */
async function stubConsole(page: Page, options: {
  user?: typeof owner;
  onGenerate?: () => { status: number; json: unknown } | null;
  onSave?: (body: Record<string, unknown>) => { status: number; json: unknown } | null;
  /**
   * What `/api/health` answers. Defaults to a healthy deployment, because that is
   * the case every other test is about. A deployment with no database or no mail is
   * the thing the warnings exist for, and a test that leaves this at the default
   * would silently stop covering them the moment somebody tightened the page.
   */
  health?: Record<string, unknown> | null;
} = {}) {
  const user = options.user ?? owner;
  const generateCalls: Array<Record<string, unknown> | null> = [];
  const saveCalls: Array<Record<string, unknown>> = [];

  // Registered first, so it is checked last. Playwright matches the most recently
  // registered route first, and this one answers every console read - if it were
  // added after the `owner-password` routes it would swallow the POSTs and let
  // them reach the real server.
  await page.route('**/api/admin/**', (route) => {
    const path = route.request().url().replace(/^.*\/api\/admin\//, '').split('?')[0].replace(/\/$/, '');
    if (route.request().method() !== 'GET') return route.continue();
    if (path === 'me') return route.fulfill({ json: { user } });
    return route.fulfill({ json: {} });
  });

  await page.route('**/api/admin/owner-password/save', (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    saveCalls.push(body);
    const override = options.onSave?.(body);
    return override
      ? route.fulfill({ status: override.status, json: override.json })
      : route.fulfill({ json: saved });
  });

  await page.route('**/api/admin/owner-password/generate', (route: Route) => {
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

  return { generateCalls, saveCalls };
}

/** Opens the confirmation and goes through it, leaving the password on screen. */
async function generateOne(page: Page) {
  await page.getByRole('button', { name: 'Generate password' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();
  await expect(page.getByLabel('New password')).toHaveValue(generated.password);
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
  test('offers the owner both halves of the flow', async ({ page }) => {
    await stubConsole(page);
    await openScreen(page);

    await expect(page.getByRole('heading', { name: 'Generate password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeVisible();
    // Save is there from the start, so the shape of the screen does not change once
    // a password exists.
    await expect(page.getByRole('button', { name: 'Save password' })).toBeVisible();
    // The destination is on screen before anything is pressed, so nobody
    // discovers at the last moment that they cannot reach the mailbox.
    await expect(page.getByLabel('Registered email')).toHaveValue('glowngracebiz@gmail.com');
  });

  test('cannot save anything before a password exists', async ({ page }) => {
    // Otherwise the button would offer a save that can only be refused, and the
    // field would look like somewhere to type a password before one was wanted.
    const { saveCalls } = await stubConsole(page);
    await openScreen(page);

    const field = page.getByLabel('New password');
    await expect(field).toHaveValue('');
    // Readonly until generated: the field is not an invitation to invent a
    // password, it is a record of the one that was made.
    await expect(field).toHaveAttribute('readonly', '');
    await expect(field).toHaveAttribute('placeholder', 'Generate a password to fill this in');
    await expect(page.getByRole('button', { name: 'Save password' })).toBeDisabled();
    await expect(page.getByText('Nothing is kept until this is saved.')).toBeVisible();
    expect(saveCalls).toHaveLength(0);
  });

  test('shows the destination as a fixed field rather than something to type', async ({ page }) => {
    await stubConsole(page);
    await openScreen(page);

    const field = page.getByLabel('Registered email');
    await expect(field).toHaveValue('glowngracebiz@gmail.com');
    // Readonly as well as disabled: the value is the owner address by construction,
    // not an editable default, and a browser autofill must not be able to change it.
    await expect(field).toHaveAttribute('readonly', '');
    await expect(field).toBeDisabled();
    await expect(page.getByText('This email is linked to the business account and cannot be changed.')).toBeVisible();
  });

  test('puts the password where the owner can read it, edit it and keep it', async ({ page }) => {
    const { generateCalls, saveCalls } = await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    expect(generateCalls).toHaveLength(1);
    // The field is the value that gets saved, and it is editable so an operator who
    // would rather choose something memorable can.
    const field = page.getByLabel('New password');
    await expect(field).not.toHaveAttribute('readonly', '');
    await expect(page.getByText('Keep it as generated, or change it to something you will remember.')).toBeVisible();

    await field.fill('Mango!Tree9');
    await page.getByRole('button', { name: 'Save password' }).click();

    // What was saved is what is in the field, not what the server handed out.
    await expect.poll(() => saveCalls).toHaveLength(1);
    expect(saveCalls[0]).toEqual({ password: 'Mango!Tree9' });
  });

  test('offers the password in the toast with a way to copy it', async ({ page }) => {
    // "Generated" followed by a value nobody can select is the thing the copy
    // button exists to remove.
    await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    const toast = page.getByRole('status');
    await expect(toast).toContainText('Password generated');
    await expect(toast).toContainText('Nothing is kept until you save.');
    await expect(page.locator('.ggpass-toast-code')).toHaveText(generated.password);
    await expect(toast.getByRole('button', { name: 'Copy password' })).toBeVisible();
  });

  test('copies the password that will be saved, not the one that was generated', async ({ page, context }) => {
    // The whole point of the editable field. If the toast copied the original, an
    // owner who changed it would put a dead password on their clipboard and only
    // find out at the sign-in screen.
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    await page.getByLabel('New password').fill('Mango!Tree9');
    await page.getByRole('status').getByRole('button', { name: 'Copy password' }).click();

    await expect(page.getByRole('status')).toContainText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Mango!Tree9');
    // And the toast agrees with the field afterwards, rather than showing a second
    // value beside it.
    await expect(page.getByRole('status').getByRole('button', { name: 'Copied' })).toBeVisible();
    await expect(page.locator('.ggpass-toast-code')).toHaveCount(0);
  });

  test('reports a clipboard it was refused, rather than pretending it worked', async ({ page, context }) => {
    // A copy button that silently does nothing is worse than no button, because it
    // looks like the password is safely somewhere.
    await context.clearPermissions();
    await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    await page.getByRole('status').getByRole('button', { name: 'Copy password' }).click();

    await expect(page.getByRole('status')).toContainText('Could not copy');
    // The field is still there, and still holds the value, so the hand-copy it
    // points at is possible.
    await expect(page.getByLabel('New password')).toHaveValue(generated.password);
    await expect(page.getByText('Select the field and copy it by hand.')).toBeVisible();
  });

  test('will not save a password too short to be accepted', async ({ page }) => {
    // Held to the same policy as every other password in the project, so an owner
    // cannot lock themselves out of the one account that cannot be recovered.
    const { saveCalls } = await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    const field = page.getByLabel('New password');
    await field.fill('short');
    await expect(page.getByText('A password needs at least 8 characters.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save password' })).toBeDisabled();
    expect(saveCalls).toHaveLength(0);

    await field.fill('Mango!Tree9');
    await expect(page.getByRole('button', { name: 'Save password' })).toBeEnabled();
  });

  test('refuses to generate on a deployment with no database, and says why', async ({ page }) => {
    const { generateCalls, saveCalls } = await stubConsole(page, {
      health: {
        status: 'error',
        store: 'memory',
        mail: 'configured',
        mailPending: 0,
        reason: 'This deployment has no database configured.',
      },
    });
    await openScreen(page);

    // Without this the page reports a successful save and the only copy of the
    // password dies with the next cold start, with nothing on screen to say so.
    await expect(page.getByText('This deployment has no database configured.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save password' })).toBeDisabled();
    expect(generateCalls).toHaveLength(0);
    expect(saveCalls).toHaveLength(0);
  });

  test('reports a missing database in the server\'s own words', async ({ page }) => {
    // The old wording named one variable. Somebody whose deployment is set up for a
    // different one was told to set a variable that was already set, which reads as
    // the page not knowing what is wrong with it.
    const { generateCalls } = await stubConsole(page, {
      health: {
        status: 'error',
        store: 'memory',
        mail: 'configured',
        mailPending: 0,
        reason: 'No database connection is configured. Set one of DATABASE_URL, NEON_DATABASE_URL, POSTGRES_URL, PRODUCTION_DATABASE_URL.',
      },
    });
    await openScreen(page);

    await expect(page.getByText('NEON_DATABASE_URL, POSTGRES_URL, PRODUCTION_DATABASE_URL')).toBeVisible();
    await expect(page.getByText('The server is running on an in-memory store')).toHaveCount(0);
    expect(generateCalls).toHaveLength(0);
  });

  test('warns about missing mail without blocking the save', async ({ page }) => {
    // The password is on this screen, so a relay that is down costs the owner a
    // confirmation and nothing else. Blocking here would mean a deployment with no
    // SMTP could not change its owner password at all, which is precisely when
    // somebody needs to.
    const { saveCalls } = await stubConsole(page, {
      health: { status: 'ok', store: 'postgres', mail: 'absent', mailPending: 1 },
    });
    await openScreen(page);

    await expect(page.getByText('Mail is not configured here')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();

    await generateOne(page);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect.poll(() => saveCalls).toHaveLength(1);
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

    await expect(page.getByText('This deployment has no database, so signing in is impossible.')).toBeVisible();
    // Not just the obvious call to action: nothing on this state may point at the
    // sign-in page, including the way out at the bottom of the card.
    await expect(page.locator('a[href="/login"]')).toHaveCount(0);
  });

  test('still offers the button when the health route cannot be reached', async ({ page }) => {
    // Unreachable is not the same as broken. Blocking on a network hiccup would take
    // away a working feature on the strength of a signal that never arrived.
    const { generateCalls } = await stubConsole(page, { health: null });
    await openScreen(page);

    await expect(page.getByText('nothing saved here can be kept')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();

    await generateOne(page);
    expect(generateCalls).toHaveLength(1);
  });

  test('will not generate anything without a confirmation', async ({ page }) => {
    const { generateCalls } = await stubConsole(page);
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate password' }).click();

    const dialog = page.getByRole('dialog', { name: 'Generate a new owner password?' });
    await expect(dialog).toBeVisible();
    // The dialog is honest about both halves: nothing changes until the save, and
    // the save ends every session, the caller's included.
    await expect(dialog).toContainText('Your current password keeps working until you press');
    await expect(dialog).toContainText('saving ends every session, including this one');
    expect(generateCalls).toHaveLength(0);
    // Focus lands on the safe action, so a keyboard user can leave immediately.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(generateCalls).toHaveLength(0);
    // And focus comes back to the button that opened it, not the top of the page.
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeFocused();
  });

  test('cancels without generating', async ({ page }) => {
    const { generateCalls } = await stubConsole(page);
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(generateCalls).toHaveLength(0);
  });

  test('shows no controls to anybody but the owner account', async ({ page }) => {
    // The page's own role check. It is a courtesy, not the guard: the endpoint
    // answers 403 regardless, which is asserted in src/server/admin.test.ts.
    const { generateCalls } = await stubConsole(page, { user: administrator });
    await openScreen(page, administrator);

    await expect(page.getByText('This screen is for the Super Admin account only.')).toBeVisible();
    await expect(page.getByText('Store Administrator')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate password' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
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

    await expect(page.getByText('This screen is for the Super Admin account. Sign in to continue.')).toBeVisible();
    // The one control the design puts on this screen keeps its label in every
    // state. Rewording it to name the next step made the card read as a different
    // page the moment somebody arrived from a different route.
    await expect(page.getByRole('link', { name: 'Generate Password' })).toBeVisible();
    // Nothing to press here: no session, so there is no owner to generate for.
    await expect(page.getByRole('button', { name: 'Generate Password' })).toHaveCount(0);
    await expect(page.locator('a[href="/login"]').first()).toBeVisible();
  });

  test('reports a refused generate as a toast and stays usable', async ({ page }) => {
    const { generateCalls } = await stubConsole(page, {
      onGenerate: () => ({
        status: 403,
        json: { error: 'forbidden', message: 'Only the Super Admin account can generate a new owner password.' },
      }),
    });
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();

    // A failure is announced the same way a success is: same corner, same shape.
    // Text under the button is invisible to somebody watching the button light up
    // and start working, and this is the outcome they most need to notice.
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Password not generated');
    // The server's own message, not a generic failure: the page does not get to
    // decide that this was a permissions problem.
    await expect(toast).toContainText('Only the Super Admin account can generate a new owner password.');
    // Not the success toast, at the same time.
    await expect(page.getByRole('status')).toHaveCount(0);
    // Nothing was put in the field, so a refused generate cannot be saved by
    // mistake a second later.
    await expect(page.getByLabel('New password')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Save password' })).toBeDisabled();
    // The button comes back rather than staying stuck on "Generating…".
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();
    expect(generateCalls).toHaveLength(1);
  });

  test('reports a refused save as a toast and keeps the password on screen', async ({ page }) => {
    // Nothing has changed server-side, so the value the owner was about to use must
    // still be there to retry with. Clearing it would turn a transient failure into
    // a lost password.
    const { saveCalls } = await stubConsole(page, {
      onSave: () => ({
        status: 409,
        json: { error: 'owner_missing', message: 'There is no owner account to save a password for. Seed the console first.' },
      }),
    });
    await openScreen(page);
    await generateOne(page);

    await page.getByRole('button', { name: 'Save password' }).click();

    const toast = page.getByRole('alert');
    await expect(toast).toContainText('Password not saved');
    await expect(toast).toContainText('There is no owner account to save a password for.');
    await expect(page.getByLabel('New password')).toHaveValue(generated.password);
    // Still on this screen, and still signed in: the save never happened.
    await expect(page).toHaveURL(/\/superadmin\/ggpass$/);
    expect(saveCalls).toHaveLength(1);
  });

  test('retires the failure toast on its own', async ({ page }) => {
    await stubConsole(page, {
      onGenerate: () => ({ status: 500, json: { error: 'smtp_failed', message: 'The mail relay refused the message.' } }),
    });
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();
    await expect(page.getByRole('alert')).toBeVisible();

    // And it can be dismissed by hand, for somebody who wants the screen back
    // now rather than in seven seconds.
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();
  });

  test('answers "where is it" under the button in every state', async ({ page }) => {
    await stubConsole(page, {
      onGenerate: () => ({ status: 500, json: { error: 'smtp_failed', message: 'The mail relay refused the message.' } }),
    });
    await openScreen(page);

    // The design puts this directly under the button. It is the only thing on the
    // page that says what happens next, and it has to survive a failure - somebody
    // whose generation just failed needs to know a retry is safe.
    const shown = page.getByText('The password is shown once, here.');
    await expect(shown).toBeVisible();

    await page.getByRole('button', { name: 'Generate password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(shown).toBeVisible();
  });

  test('confirms the save, ends the session and walks back to sign-in', async ({ page }) => {
    await page.clock.install();
    const { saveCalls } = await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByRole('status')).toContainText('Password saved');
    // The server's own wording, which names the address the confirmation went to.
    await expect(page.getByRole('status')).toContainText('a confirmation was sent to glowngracebiz@gmail.com');
    await expect.poll(() => saveCalls).toHaveLength(1);

    // The password stays readable right up to the bounce, because the confirmation
    // is an audit line and the field is the only copy of the credential.
    await expect(page.getByLabel('New password')).toHaveValue(generated.password);

    // The stored token is gone, so a refresh does not leave a stale session that
    // the server will reject on the next click.
    const token = await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'));
    expect(token).toBeNull();

    // The confirmation stays up for the whole grace period, and is taken away by
    // the bounce rather than by its own timer. The page can no longer do anything
    // having revoked its own session, so what matters is that the owner had time to
    // read the one line that says what just happened.
    await page.clock.fastForward(SIGN_IN_REDIRECT_MS - 1000);
    await expect(page.getByRole('status')).toContainText('Password saved');
    await expect(page).toHaveURL(/\/superadmin\/ggpass$/);

    await page.clock.fastForward(1000);
    await expect(page).toHaveURL(/\/login$/);
    // And the page it left is the real sign-in screen, not a dead route.
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    // The toast went with the page rather than being left floating over the sign-in
    // form, which would be the one screen it must never outlive. Scoped to this
    // screen's own class, because the sign-in page has a live region of its own.
    await expect(page.locator('.ggpass-toast')).toHaveCount(0);
  });

  test('holds together on this screen in every state it can be in', async ({ page }) => {
    // The page is a full page rather than a panel in the console, so it carries
    // the page's own heading - one `h1` - and has to survive the same layout
    // pass as the storefront pages. The states are separate visits because each
    // one is a different page as far as the audit is concerned.
    await stubConsole(page);
    await openScreen(page);

    await auditPage(page, '/superadmin/ggpass');

    // With a password on screen: the value and its copy button are the whole point
    // of the added state, so the layout is checked with them present.
    await generateOne(page);
    await expect(page.getByRole('status')).toBeVisible();
    await auditPage(page, '/superadmin/ggpass (generated)');

    // With the confirmation open: the dialog is a second layer over the page, so
    // it is audited on its own terms rather than trusted to inherit anything.
    await page.getByRole('button', { name: 'Generate password' }).click();
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
    await expect(page.getByText('This screen is for the Super Admin account. Sign in to continue.')).toBeVisible();

    await auditPage(page, '/superadmin/ggpass (signed out)');
  });
});
