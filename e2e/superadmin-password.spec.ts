import { expect, test, type Page, type Route } from '@playwright/test';
import { auditPage } from './support/audit';

/**
 * Browser coverage for `/superadmin/ggpass`.
 *
 * Both endpoints are stubbed throughout, so no test here generates a real password
 * or sends a real mail. What is under test is the part jsdom does not settle: that
 * the screen asks the server who is signed in rather than trusting storage, that
 * generating writes nothing until the save, that the password is offered once and
 * can be copied, that the save field only opens for the value that was copied, and
 * that the card is the design's own in every state, with the generate control never
 * a route away from the page.
 *
 * The load-bearing assertions are the middle ones: the value in the notification,
 * the value on the clipboard and the value the save sends must be the same one,
 * because the screen asks for it to be pasted back and the owner never sees it
 * again.
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
 * The success notification, by its own class rather than by role.
 *
 * Two things make a role query wrong here. The mail warning is also a `status`
 * region, so a role query would match both on the one test that has both on
 * screen; and the failure notification is a toast too, so a bare `.ggpass-toast`
 * would match it on the tests that assert no success is showing.
 */
function toast(page: Page) {
  return page.locator('.ggpass-toast:not(.is-error)');
}

/** The failure notification, likewise. */
function failure(page: Page) {
  return page.locator('.ggpass-toast.is-error');
}

/**
 * A console whose `me`, `owner-password/generate` and `owner-password/save` routes
 * answer as instructed.
 *
 * Both calls are recorded, so a test can assert that generating wrote nothing, and
 * that saving sent the value that was pasted back rather than something else.
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

/** Generates, and waits for the password to be sitting in the notification. */
async function generateOne(page: Page) {
  await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();
  await page.getByRole('button', { name: 'Generate password' }).click();
  await expect(page.locator('.ggpass-toast-code')).toHaveText(generated.password, { timeout: 15_000 });
}

/**
 * Copies from the notification, which is what opens the save field.
 *
 * The field starts closed and empty: the screen is asking for the value it just
 * showed, pasted, rather than for one somebody had time to think about while it
 * sat on screen.
 */
async function copyOne(page: Page) {
  await page.getByRole('button', { name: 'Copy password' }).click();
  await expect(page.getByLabel('Save new password')).toBeVisible();
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
  // The token is only in storage once the console has accepted the sign-in and
  // moved on to the console itself. Checking for "no alert" can pass while the
  // request is still in flight, and the visit below would then load before the
  // session was ever stored - which is exactly how this screen could render the
  // signed-out card for a role the server had accepted. The redirect is the
  // console's own signal that the session exists.
  await page.waitForURL('**/admin**');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.goto('/superadmin/ggpass');
}

test.describe('/superadmin/ggpass', () => {
  test('offers the owner the generate step, and the way to keep what it makes', async ({ page }) => {
    await stubConsole(page);
    await openScreen(page);

    await expect(page.getByRole('heading', { name: 'Generate password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeVisible();
    // The save half is not on the page yet. It opens for a copy, because before
    // that there is nothing to paste and the field would be an invitation to invent
    // a password rather than a record of the one that was made.
    await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
    // What the password will be made of, and what to do with it, before anything
    // is pressed rather than only after.
    await expect(page.getByText('Copy it from the notification, then paste it above to save.')).toBeVisible();
    // The destination is on screen before anything is pressed, so nobody
    // discovers at the last moment that they cannot reach the mailbox.
    await expect(page.getByLabel('Registered email')).toHaveValue('glowngracebiz@gmail.com');
  });

  test('has nowhere to save until a copy has put something worth saving on the page', async ({ page }) => {
    const { saveCalls } = await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    // Generating is not enough: the value exists in the notification, and the save
    // field is opened by taking it from there.
    await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Regenerate password' })).toBeEnabled();
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

  test('saves the value that was copied and pasted back', async ({ page }) => {
    const { generateCalls, saveCalls } = await stubConsole(page);
    await openScreen(page);
    await generateOne(page);
    await copyOne(page);

    expect(generateCalls).toHaveLength(1);
    const field = page.getByLabel('Save new password');
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', 'Paste the copied password');
    await expect(field).toHaveAttribute('maxlength', '8');
    await expect(field).toHaveAttribute('type', 'password');

    // Pasting is the only way in, and what arrives is what the server was handed.
    await field.fill(generated.password);
    await page.getByRole('button', { name: 'Save password' }).click();

    await expect.poll(() => saveCalls).toHaveLength(1);
    expect(saveCalls[0]).toEqual({ password: generated.password });
  });

  test('offers the password in the notification with a way to copy it', async ({ page }) => {
    // "Generated" followed by a value nobody can select is the thing the copy
    // button exists to remove.
    await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    await expect(toast(page)).toContainText('Password generated');
    await expect(toast(page)).toContainText('New password for glowngracebiz@gmail.com');
    await expect(page.locator('.ggpass-toast-code')).toHaveText(generated.password);
    await expect(toast(page).getByRole('button', { name: 'Copy password' })).toBeVisible();
    // No countdown yet: while it is up it is the only place the password exists in
    // the clear, so it stays until it is copied or dismissed by hand.
    await expect(toast(page)).not.toHaveClass(/is-timed/);
  });

  test('copies the password and opens the save field for it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    await copyOne(page);

    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(generated.password);
    await expect(toast(page)).toContainText('Copied to clipboard. Paste it below to save.');
    // The button reports the state it is in rather than offering to do it again.
    await expect(toast(page).getByRole('button', { name: 'Copied' })).toBeVisible();
    // And the countdown starts from the copy, because the value is now in two
    // places - the clipboard and the field - and neither needs holding open.
    await expect(toast(page)).toHaveClass(/is-timed/);
    // The value is still on the page in the notification, so a clipboard that did
    // not take it leaves the owner somewhere to read it from.
    await expect(page.locator('.ggpass-toast-code')).toHaveText(generated.password);
  });

  test('reports a clipboard it was refused, rather than pretending it worked', async ({ page }) => {
    // A copy button that silently does nothing is worse than no button, because it
    // looks like the password is safely somewhere. Both halves of the design's own
    // fallback are closed off here so the failure path is the one under test: the
    // async API refuses, and so does the older copy command behind it.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
      Object.defineProperty(document, 'execCommand', {
        configurable: true,
        value: () => false,
      });
    });
    await stubConsole(page);
    await openScreen(page);
    await generateOne(page);

    await page.getByRole('button', { name: 'Copy password' }).click();

    await expect(toast(page)).toContainText('Copy failed');
    await expect(toast(page)).toContainText('select the password and copy manually.');
    // The save field still opens: refusing to show the way forward would leave the
    // only route to a saved password behind a browser setting the owner cannot
    // change from here.
    await expect(page.getByLabel('Save new password')).toBeVisible();
    // And the value is still on the page to be selected and copied by hand.
    await expect(page.locator('.ggpass-toast-code')).toHaveText(generated.password);
    // A failure has no countdown: it is the only account of what happened.
    await expect(toast(page)).not.toHaveClass(/is-timed/);
  });

  test('will not save a value that was not the one that was generated', async ({ page }) => {
    // Held to exactly what the screen showed, because the server never sees the
    // generated value and the screen is the only thing that can compare the two.
    const { saveCalls } = await stubConsole(page);
    await openScreen(page);
    await generateOne(page);
    await copyOne(page);

    const field = page.getByLabel('Save new password');

    // Nothing at all.
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('Please paste the generated password.')).toBeVisible();
    expect(saveCalls).toHaveLength(0);

    // The right length, but not letters and numbers: the words under the field.
    await field.fill('Mango!T9');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText('Password must be exactly 8 letters or numbers.')).toBeVisible();
    expect(saveCalls).toHaveLength(0);

    // Eight letters and numbers, and still not the value that was made.
    await field.fill('ZZZZ9999');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByText("This doesn't match the generated password.")).toBeVisible();
    expect(saveCalls).toHaveLength(0);

    // Typing clears the refusal rather than leaving a stale one under a corrected
    // field, which reads as the correction not having been noticed.
    await field.fill(generated.password);
    await expect(page.getByText("This doesn't match the generated password.")).toHaveCount(0);
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect.poll(() => saveCalls).toHaveLength(1);
  });

  test('shows the value in the field when the eye is pressed', async ({ page }) => {
    await stubConsole(page);
    await openScreen(page);
    await generateOne(page);
    await copyOne(page);

    const field = page.getByLabel('Save new password');
    await expect(field).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(field).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide password' })).toBeVisible();

    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(field).toHaveAttribute('type', 'password');
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
    await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
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
    await copyOne(page);
    await page.getByLabel('Save new password').fill(generated.password);
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

  test('generates on the press, with no dialog in front of it', async ({ page }) => {
    // The confirmation this replaced was the answer to a rotation that wrote as it
    // went. Nothing is written until the save now, so a dialog in front of a step
    // that changes nothing only trains people to press through dialogs.
    const { generateCalls } = await stubConsole(page);
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate password' }).click();

    await expect(page.locator('.ggpass-toast-code')).toHaveText(generated.password, { timeout: 15_000 });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(generateCalls).toHaveLength(1);
    // And the label says what the same control does next time.
    await expect(page.getByRole('button', { name: 'Regenerate password' })).toBeEnabled();
  });

  test('regenerating starts the save over rather than leaving the old value in the field', async ({ page }) => {
    const { saveCalls } = await stubConsole(page);
    await openScreen(page);
    await generateOne(page);
    await copyOne(page);
    await page.getByLabel('Save new password').fill('ZZZZ9999');

    await page.getByRole('button', { name: 'Regenerate password' }).click();
    await expect(page.locator('.ggpass-toast-code')).toHaveText(generated.password, { timeout: 15_000 });

    // What was pasted belonged to the password that has just been replaced, so it
    // is cleared rather than left there to be refused as a mismatch.
    await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Regenerate password' }).click();
    await copyOne(page);
    await expect(page.getByLabel('Save new password')).toHaveValue('');
    expect(saveCalls).toHaveLength(0);
  });

  test("refuses the other roles on the same card, in the server's own words", async ({ page }) => {
    // The page's own role check is a courtesy that names the refused role; the
    // endpoint answers 403 regardless, which is asserted in src/server/admin.test.ts.
    // The card is the design's card for everybody - the button is never swapped for a
    // route - so the refusal arrives as the server's message rather than by hiding.
    const { generateCalls } = await stubConsole(page, {
      user: administrator,
      onGenerate: () => ({
        status: 403,
        json: { error: 'forbidden', message: 'Only the Super Admin account can generate a new owner password.' },
      }),
    });
    await openScreen(page, administrator);

    await expect(page.getByText('This screen is for the Super Admin account only.')).toBeVisible();
    await expect(page.getByText('Store Administrator')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Generate password' }).click();
    await expect(failure(page)).toContainText('Only the Super Admin account can generate a new owner password.');
    expect(generateCalls).toHaveLength(1);
  });

  test('keeps the design card for somebody with no session, and never navigates', async ({ page }) => {
    const { generateCalls } = await stubConsole(page, {
      onGenerate: () => ({
        status: 401,
        json: { error: 'unauthenticated', message: 'Sign in to the console to continue.' },
      }),
    });
    // `me` answers 401 for a lapsed or absent session.
    await page.route('**/api/admin/me', (route) => route.fulfill({
      status: 401,
      json: { error: 'unauthenticated', message: 'Sign in to continue.' },
    }));

    await page.goto('/superadmin/ggpass');

    await expect(page.getByText('This screen is for the Super Admin account. Sign in to continue.')).toBeVisible();
    // The one control the design puts on this screen keeps its label and its shape
    // in every state: a button that reaches for the server, not a route to sign-in.
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();
    await expect(page.getByRole('link', { name: 'Generate Password' })).toHaveCount(0);

    // Pressing it with no session stays on this screen and answers in place with
    // the card's own soft line rather than a red failure or a route away. The
    // button is a button whatever it is sent with.
    await page.getByRole('button', { name: 'Generate password' }).click();
    await expect(page).toHaveURL(/\/superadmin\/ggpass$/);
    await expect(failure(page)).toHaveCount(0);
    await expect(page.locator('.ggpass-note').filter({ hasText: 'Sign in to the console to continue.' })).toBeVisible();
    // The way in is the design's own, at the bottom of the card.
    await expect(page.locator('a[href="/login"]').first()).toBeVisible();
    // The answer is the screen's own rather than a 401 torn out of the server:
    // without a session nothing was asked.
    expect(generateCalls).toHaveLength(0);
  });

  test('says the console could not be reached rather than sending the owner to sign in', async ({ page }) => {
    // The session check failing is not an answer about the session. A database
    // that timed out for somebody who is already signed in must not be shown as
    // "sign in to continue" - that sends them to type credentials that were never
    // the problem, and the check still fails when they come back.
    await stubConsole(page);
    await openScreen(page);

    // Signed in first, so the token is there to be checked. The failure is laid
    // over the session check afterwards, for the visit that is under test.
    await page.route('**/api/admin/me', (route) => route.fulfill({
      status: 500,
      json: { error: 'server_error', message: 'The console could not complete that request. Please try again shortly.' },
    }));
    await page.goto('/superadmin/ggpass');

    // Announced as the card's own alert rather than as a notification: nothing has
    // been attempted, so there is no request outcome to report - what is being said
    // is that the check itself never happened.
    await expect(page.getByRole('alert')).toContainText('did not answer the session check');
    // Not the sign-in card: nothing here has established that anybody is signed out,
    // so the card's own way in to the sign-in form must not be on screen. The way
    // out at the bottom of the page still leads there, as it does in every state.
    await expect(page.getByRole('link', { name: 'Generate Password' })).toHaveCount(0);

    // The console answers again, which is the case the retry exists for.
    await page.unroute('**/api/admin/me');
    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('asks nobody when there is no session to ask about', async ({ page }) => {
    // A token that is not there cannot be revoked, so the request can only come
    // back 401. Firing it anyway is what put a red line in the console on every
    // visit to this screen and read as the screen being broken.
    const { generateCalls } = await stubConsole(page);
    let meCalls = 0;
    await page.route('**/api/admin/me', (route) => {
      meCalls += 1;
      return route.fulfill({ status: 401, json: { error: 'unauthenticated', message: 'Sign in to continue.' } });
    });

    await page.goto('/superadmin/ggpass');

    await expect(page.getByText('This screen is for the Super Admin account. Sign in to continue.')).toBeVisible();
    expect(meCalls).toBe(0);
    expect(generateCalls).toHaveLength(0);
  });

  test('treats a session whose own countdown has run out as no session', async ({ page }) => {
    // The token is still in storage, but its expiry is behind us, so the server
    // would answer 401 to anything sent with it. The console drops such a session
    // on its countdown; this screen has to do the same rather than ask and be
    // told what it already knows.
    await stubConsole(page);
    let meCalls = 0;
    await page.route('**/api/admin/me', (route) => {
      meCalls += 1;
      return route.fulfill({ status: 401, json: { error: 'unauthenticated', message: 'Sign in to continue.' } });
    });
    await page.addInitScript(() => {
      localStorage.setItem('glow-grace-admin-token', 'a-token-the-server-no-longer-has');
      localStorage.setItem('glow-grace-admin-session-expires-at', new Date(Date.now() - 1000).toISOString());
    });

    await page.goto('/superadmin/ggpass');

    await expect(page.getByText('This screen is for the Super Admin account. Sign in to continue.')).toBeVisible();
    expect(meCalls).toBe(0);
    // And the dead token is swept up on the way, so the next visit starts clean.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('glow-grace-admin-token'))).toBeNull();
  });

  test('keeps the card and does not leave when the session dies mid-press', async ({ page }) => {
    const { generateCalls } = await stubConsole(page, {
      onGenerate: () => ({
        status: 401,
        json: { error: 'unauthenticated', message: 'Sign in to the console to continue.' },
      }),
    });
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate password' }).click();

    // The refusal is announced in the usual place, and then the card stops
    // pretending it has a session: it stays on this screen, now naming the sign-in
    // as the step ahead rather than throwing the owner at the sign-in page. The
    // control is left in place - a further press can only answer in place now,
    // never draw a second 401 out of the server.
    await expect(failure(page)).toContainText('Sign in to the console to continue.');
    await expect(page).toHaveURL(/\/superadmin\/ggpass$/);
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();
    await page.getByRole('button', { name: 'Generate password' }).click();
    await expect(page.locator('.ggpass-note').filter({ hasText: 'Sign in to the console to continue.' })).toBeVisible();
    await expect(page).toHaveURL(/\/superadmin\/ggpass$/);
    await expect(page.getByText('This screen is for the Super Admin account. Sign in to continue.')).toBeVisible();
    await expect(page.locator('a[href="/login"]').first()).toBeVisible();
    expect(generateCalls).toHaveLength(1);
  });

  test('reports a refused generate as a notification and stays usable', async ({ page }) => {
    const { generateCalls } = await stubConsole(page, {
      onGenerate: () => ({
        status: 403,
        json: { error: 'forbidden', message: 'Only the Super Admin account can generate a new owner password.' },
      }),
    });
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate password' }).click();

    // A failure is announced the same way a success is: same corner, same shape.
    // Text under the button is invisible to somebody watching the button light up
    // and start working, and this is the outcome they most need to notice.
    await expect(failure(page)).toBeVisible();
    await expect(failure(page)).toContainText('Password not generated');
    // The server's own message, not a generic failure: the page does not get to
    // decide that this was a permissions problem.
    await expect(failure(page)).toContainText('Only the Super Admin account can generate a new owner password.');
    // Not the success notification, at the same time.
    await expect(toast(page)).toHaveCount(0);
    // Nothing was generated, so there is no save field to send a stale value from.
    await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
    // The button comes back rather than staying stuck on "Generating…".
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();
    expect(generateCalls).toHaveLength(1);
  });

  test('reports a refused save and keeps the pasted value on the screen', async ({ page }) => {
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
    await copyOne(page);
    await page.getByLabel('Save new password').fill(generated.password);

    await page.getByRole('button', { name: 'Save password' }).click();

    await expect(failure(page)).toContainText('Password not saved');
    await expect(failure(page)).toContainText('There is no owner account to save a password for.');
    await expect(page.getByLabel('Save new password')).toHaveValue(generated.password);
    // Still on this screen, and still signed in: the save never happened.
    await expect(page).toHaveURL(/\/superadmin\/ggpass$/);
    expect(saveCalls).toHaveLength(1);
  });

  test('retires the failure notification on its own', async ({ page }) => {
    await stubConsole(page, {
      onGenerate: () => ({ status: 500, json: { error: 'smtp_failed', message: 'The mail relay refused the message.' } }),
    });
    await openScreen(page);

    await page.getByRole('button', { name: 'Generate password' }).click();
    await expect(failure(page)).toBeVisible();

    // And it can be dismissed by hand, for somebody who wants the screen back
    // now rather than in seven seconds.
    await failure(page).getByRole('button', { name: 'Close' }).click();
    await expect(failure(page)).toHaveCount(0);
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
    const shown = page.getByText('Copy it from the notification, then paste it above to save.');
    await expect(shown).toBeVisible();

    await page.getByRole('button', { name: 'Generate password' }).click();
    await expect(failure(page)).toBeVisible();
    await expect(shown).toBeVisible();
  });

  test('confirms the save, ends the session and walks back to sign-in', async ({ page }) => {
    await page.clock.install();
    const { saveCalls } = await stubConsole(page);
    await openScreen(page);
    await generateOne(page);
    await copyOne(page);
    await page.getByLabel('Save new password').fill(generated.password);

    // An installed clock keeps ticking with the wall clock, so the two and a half
    // seconds of redirect can run out while the assertions below are still being
    // checked - which is what made this test fail on a loaded machine with nothing
    // at all wrong with the page. Pausing hands the countdown to the fast-forward
    // at the bottom of the test and to nothing else. Pausing at the current moment
    // would race the ticking clock it was read from, so the pause is parked a
    // moment ahead of it, clear of the copy's focus timer on the way.
    await page.clock.pauseAt(new Date(Date.now() + 5000));
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(toast(page)).toContainText('Password saved');
    // The design's own words, which name the address whose password it was.
    await expect(toast(page)).toContainText('The password for glowngracebiz@gmail.com has been updated.');
    await expect.poll(() => saveCalls).toHaveLength(1);

    // The save section closes the way the design closes it: what was pasted has
    // been kept, and it belongs to the credential that has just been replaced.
    await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
    // The token that would have sent it is already gone, so the button that remains
    // in place for the moment before the bounce can only answer in place with the
    // sign-in line rather than draw a 401 out of the server.
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();

    // The stored token is gone, so a refresh does not leave a stale session that
    // the server will reject on the next click.
    const token = await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'));
    expect(token).toBeNull();

    // The confirmation stays up for the whole grace period, and is taken away by
    // the bounce rather than by its own timer. The page can no longer do anything
    // having revoked its own session, so what matters is that the owner had time to
    // read the one line that says what just happened.
    await page.clock.fastForward(SIGN_IN_REDIRECT_MS - 1000);
    await expect(toast(page)).toContainText('Password saved');
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
    await expect(toast(page)).toBeVisible();
    await auditPage(page, '/superadmin/ggpass (generated)');

    // And with the save field open, which is a second block in the card rather
    // than a layer over it.
    await copyOne(page);
    await expect(page.getByLabel('Save new password')).toBeVisible();
    await auditPage(page, '/superadmin/ggpass (saving)');
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
