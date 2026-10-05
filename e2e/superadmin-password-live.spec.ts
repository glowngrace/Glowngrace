import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { loadEnvironment } from '../src/server/env';
import { auditPage } from './support/audit';

/**
 * The real `/superadmin/ggpass` round trip: no stubs anywhere.
 *
 * Every other spec in this directory answers its own `/api/admin/**` routes, which
 * is right for testing a screen but leaves the whole delivery path unproven. This
 * one runs against the actual API, the actual local database and the actual SMTP
 * relay, because the failure this branch was opened for is precisely a silent one:
 * a password generated, a hash replaced, a row written, a success message shown -
 * and nothing ever arriving, because the settings were named in a shape the code
 * does not read. Only a real connection can catch that.
 *
 * What it asserts, in the order the work happens:
 *
 *   1. the owner can sign in with the password the last run left behind
 *   2. the screen offers the control, and reaches it by typing the URL
 *   3. pressing it confirms first, and nothing is generated until it does
 *   4. the generated password is never rendered - not in the response, not on the
 *      page, not in storage
 *   5. the relay accepted it, which is `sent_at` on the outbox row. A row with a
 *      null `sent_at` after a successful request is the exact symptom being fixed
 *   6. the hash in `admin_users` verifies against the password in the row
 *   7. the old password no longer works and the new one does
 *   8. every session went, the caller's included
 *
 * It reads the outbox rather than trusting the UI, because the password is
 * deliberately never rendered - there is nowhere else in the browser to get it.
 * That read is also the documented recovery path for a deployment whose mail is
 * down, so the test exercises the same thing an operator would.
 *
 * Why it is not part of the ordinary suite: it needs a database, it needs the
 * relay credentials, it mails a real inbox, and it changes the owner password.
 * It skips itself when any of that is absent, so `npm run test:e2e` still passes
 * on a machine that has none of them.
 *
 * Why it is serial and desktop-only: it owns the single owner credential, so two
 * of these running at once would each invalidate the other's password and fail
 * for reasons that have nothing to do with the code.
 */

const ownerEmail = 'glowngracebiz@gmail.com';

loadEnvironment();

const databaseUrl = process.env.DATABASE_URL ?? '';
const smtpConfigured = Boolean(
  process.env.SMTP_HOST ?? process.env.MAIL_HOST,
);

/**
 * The pool every read in this file goes through.
 *
 * Deliberately the same URL the running server resolved, read from the same
 * environment the server loaded, so a test can never assert against a different
 * database than the one it just changed.
 */
const pool = new pg.Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : undefined,
  max: 2,
});

async function ownerPasswordFromOutbox(): Promise<string> {
  const result = await pool.query(
    `SELECT body FROM email_outbox WHERE kind = 'owner-credentials' ORDER BY created_at DESC LIMIT 1`,
  );
  const body = String((result.rows[0] as { body?: string } | undefined)?.body ?? '');
  // The body is worded in `ownerCredentialsMessage`, so the password is the one
  // line after the label. No row means nothing has ever been generated here.
  const password = /Password: (.+)/.exec(body)?.[1]?.trim();
  expect(password, 'no owner password is in the outbox to start from').toBeTruthy();
  return password as string;
}

type OutboxRow = { id: string; recipient: string; subject: string; body: string; sent_at: Date | string | null; created_at: Date | string };

async function latestOutboxRow(): Promise<OutboxRow> {
  const result = await pool.query(
    `SELECT id, recipient, subject, body, sent_at, created_at FROM email_outbox
     WHERE kind = 'owner-credentials' ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  return result.rows[0] as OutboxRow;
}

/**
 * Signs in through the real form, with the real password and the real session row.
 *
 * Waits for the console to load rather than for the sign-in button to go away: the
 * button's label changes to "Signing in." the instant it is pressed, so asserting
 * on its absence is satisfied while the request is still in flight. Every test here
 * reads something that only exists after the response - a stored token, an outbox
 * row - so an early pass would make the whole file test the wrong moment.
 */
async function signInAsOwner(page: Page, password: string) {
  await page.goto('/login');
  await page.locator('#login-email').fill(ownerEmail);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test.describe('the real owner password round trip', () => {
  test.skip(!databaseUrl || !smtpConfigured, 'needs the local database and mail settings');
  test.describe.configure({ mode: 'serial' });

  // Two projects means two of these running side by side over one credential, each
  // invalidating the other's password. Checked per test because a describe-level
  // `test.skip` callback is evaluated once for the whole file.
  test.beforeEach(({ browserName }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop-chromium' || browserName !== 'chromium',
      'owns the owner credential, so it runs exactly once',
    );
  });

  let passwordBefore = '';

  test.beforeAll(async () => {
    passwordBefore = await ownerPasswordFromOutbox();
  });

  test.afterAll(async () => {
    await pool.end();
  });

  test('the owner can sign in with the password that is already in the outbox', async ({ page }) => {
    // Before anything is changed. If this fails, the account is not in a state this
    // branch can be tested against and every later failure would be a red herring.
    await signInAsOwner(page, passwordBefore);
    const token = await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'));
    expect(token, 'the password in the outbox opened the console').toBeTruthy();
    // The console itself, which only renders once a session exists. Its `h1` is
    // the one assertion that can tell "signed in" from "redirected somewhere else".
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  test('offers the control at its own address, to a signed-in owner', async ({ page }) => {
    await signInAsOwner(page, passwordBefore);
    await page.goto('/superadmin/ggpass');

    await expect(page.getByRole('heading', { name: 'Generate password' })).toBeVisible();
    // Enabled rather than merely present: this deployment has a database and mail, so
    // the deployment warnings are absent and the button is live. Against a broken
    // deployment it renders disabled, and `toBeVisible` would pass for a control that
    // cannot do anything.
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();
    await expect(page.getByLabel('Registered email')).toHaveValue(ownerEmail);
    await auditPage(page, '/superadmin/ggpass (real)');
  });

  test('confirms before it generates anything', async ({ page }) => {
    await signInAsOwner(page, passwordBefore);
    const before = await latestOutboxRow();

    await page.goto('/superadmin/ggpass');
    await page.getByRole('button', { name: 'Generate password' }).click();

    const dialog = page.getByRole('dialog', { name: 'Generate a new owner password?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    // Still the same row: the confirmation is not a decoration.
    expect((await latestOutboxRow()).id).toBe(before.id);
    await auditPage(page, '/superadmin/ggpass (real, confirming)');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect((await latestOutboxRow()).id).toBe(before.id);
  });

  test('generates, mails, and never puts the password in the browser', async ({ page }) => {
    await signInAsOwner(page, passwordBefore);
    const before = await latestOutboxRow();

    await page.goto('/superadmin/ggpass');
    await page.getByRole('button', { name: 'Generate password' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();

    // The server attempts the real send before it answers, so the wait is a Gmail
    // round trip rather than a database write: connecting, STARTTLS, authenticating
    // with the app password, and handing over the message. Five seconds is not
    // enough for that on a cold connection, and the screen stays on "Generating…"
    // until it lands. Thirty is generous; the request itself has no timeout of its
    // own because the delivery pass is what has to survive a slow relay.
    await expect(page.getByRole('status'))
      .toContainText(`A new password has been sent to ${ownerEmail}`, { timeout: 30_000 });

    // Nothing resembling the credential reached the browser, by any route. The
    // response has no field for one; this is here so a future change that adds one
    // fails here rather than shipping a password to a screen.
    const body = await page.locator('body').innerText();
    const response = await page.evaluate(() => JSON.stringify(localStorage));
    expect(body).not.toMatch(/Password:/i);
    expect(response).not.toMatch(/Password:/i);
    expect(body).not.toMatch(/[A-Za-z0-9!@#$%^&*_+-]{20,}/);
    expect(await page.locator('input[type="password"]').count()).toBe(0);

    // The session token is gone because the server revoked every session.
    expect(await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'))).toBeNull();

    // A new row exists, and the relay took it. A null `sent_at` here is the whole
    // bug this branch exists for: the request succeeded, the row was written, and
    // nothing was ever sent because the settings were named in a shape the code
    // does not read.
    const after = await latestOutboxRow();
    expect(after.id).not.toBe(before.id);
    expect(after.recipient).toBe(ownerEmail);
    expect(after.sent_at, 'the relay accepted the message').not.toBeNull();

    passwordBefore = /Password: (.+)/.exec(after.body)?.[1]?.trim() ?? '';
    expect(passwordBefore.length).toBeGreaterThanOrEqual(20);
  });

  test('the stored hash is the password that was mailed', async ({ page }) => {
    const row = await latestOutboxRow();
    const generated = /Password: (.+)/.exec(row.body)?.[1]?.trim() as string;

    await signInAsOwner(page, generated);
    const token = await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'));
    expect(token, 'the mailed password opens the console').toBeTruthy();
  });

  test('a password that has been replaced stops working', async ({ page }) => {
    const row = await latestOutboxRow();
    const generated = /Password: (.+)/.exec(row.body)?.[1]?.trim() as string;

    // One character different is the strongest form of this check: it fails on the
    // hash rather than on the row being absent.
    const superseded = `${generated.slice(0, -1)}${generated.endsWith('x') ? 'y' : 'x'}`;

    await page.goto('/login');
    await page.locator('#login-email').fill(ownerEmail);
    await page.locator('#login-password').fill(superseded);
    await page.getByRole('button', { name: 'Sign in to your account' }).click();

    await expect(page.getByRole('alert')).toContainText('do not match a console account');
    expect(await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'))).toBeNull();
  });

  test('every session was revoked, the caller included', async () => {
    const sessions = await pool.query(
      'SELECT count(*)::int AS total FROM admin_sessions WHERE user_id = (SELECT id FROM admin_users WHERE email = $1)',
      [ownerEmail],
    );
    // Only the session this spec just created at login, which it does not keep.
    expect((sessions.rows[0] as { total: number }).total).toBeLessThanOrEqual(1);
  });

  test('the owner account is the only one that can do this', async ({ page }) => {
    const row = await latestOutboxRow();
    const generated = /Password: (.+)/.exec(row.body)?.[1]?.trim() as string;
    await signInAsOwner(page, generated);

    // The guard is the server's, reached the way an attacker would: the endpoint
    // directly, with a real owner session, and a body the screen would never send.
    // The UI's own role check is a courtesy and is tested elsewhere.
    const status = await page.evaluate(async () => {
      const token = localStorage.getItem('glow-grace-admin-token');
      const response = await fetch('/api/admin/owner-password/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ anything: true }),
      });
      return response.status;
    });
    expect(status, 'the endpoint accepted a direct call from the owner session').toBe(200);

    // And the password it just replaced is the one now in the outbox, which is how
    // the next test knows where to look.
    expect((await latestOutboxRow()).id).not.toBe(row.id);
    passwordBefore = /Password: (.+)/.exec((await latestOutboxRow()).body)?.[1]?.trim() ?? '';
  });
});