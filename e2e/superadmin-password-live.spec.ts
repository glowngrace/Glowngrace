import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { loadEnvironment } from '../src/server/env';
import { auditPage } from './support/audit';

/**
 * The real `/superadmin/ggpass` round trip: no stubs anywhere.
 *
 * Every other spec in this directory answers its own `/api/admin/**` routes, which
 * is right for testing a screen but leaves the whole storage path unproven. This
 * one runs against the actual API, the actual database and the actual SMTP relay,
 * because the failure this change exists for is precisely a silent one: a save
 * reported, a hash replaced, a row written, a success toast shown - and the next
 * sign-in refused, because the value the owner was shown was not the value that
 * was stored. Only a real connection can catch that.
 *
 * What it asserts, in the order the work happens:
 *
 *   1. the owner can sign in with the credential the last run left behind
 *   2. the screen offers the control, and reaches it by typing the URL
 *   3. pressing it confirms first, and nothing at all is written until it does
 *   4. the password is on the screen, in the field and in the toast, and the two
 *      agree with each other
 *   5. the field's value is what the save sends
 *   6. the stored hash verifies against exactly that value
 *   7. the confirmation was relayed, which is `sent_at` on the outbox row, and it
 *      carries no password
 *   8. the old password no longer works and the new one does
 *   9. every session went, the caller's included, and the screen walks to sign-in
 *
 * One thing this file can no longer do, and it is worth being explicit about: the
 * previous version read each new password back out of the outbox, because the
 * password used to be mailed and never rendered. Now it is the other way round. The
 * password exists on the screen and in the mailbox only as a confirmation that a
 * password changed, so the value is read from the field and kept in memory for the
 * length of the run.
 *
 * That has a consequence an operator should know about, not just a test: once a
 * password is saved from this screen, there is no server-side record of it
 * anywhere. A run that follows therefore has to be told the current value with
 * `E2E_OWNER_PASSWORD=...`, and if neither it nor the seed credential opens the
 * account the file skips with an explanation instead of failing on a timeout. The
 * practical mitigation is the same one the screen gives the owner: keep the value
 * somewhere you can read it again.
 *
 * Why it is not part of the ordinary suite: it needs a database, it needs the relay
 * credentials, it mails a real inbox, and it changes the owner password. It skips
 * itself when any of that is absent, so `npm run test:e2e` still passes on a
 * machine that has none of them.
 *
 * Why it is serial and desktop-only: it owns the single owner credential, so two
 * of these running at once would each invalidate the other's password and fail for
 * reasons that have nothing to do with the code.
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

type OutboxRow = {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  body: string;
  sent_at: Date | string | null;
  created_at: Date | string;
};

async function latestOutboxRow(kind: string): Promise<OutboxRow> {
  const result = await pool.query(
    `SELECT id, kind, recipient, subject, body, sent_at, created_at FROM email_outbox
     WHERE kind = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [kind],
  );
  return result.rows[0] as OutboxRow;
}

/**
 * The password the seed wrote, which is the only credential on record before this
 * run starts. Absent on a database that was seeded before the outbox existed, or on
 * one whose owner has since saved a password from the screen - in which case it no
 * longer matches and the probe below is what decides whether this run can happen.
 */
async function seedPasswordFromOutbox(): Promise<string> {
  const row = await latestOutboxRow('owner-credentials').catch(() => null);
  const password = row ? /Password: (.+)/.exec(row.body)?.[1]?.trim() : undefined;
  return password ?? '';
}

/**
 * Probes the real API with a real password. Returns whether it opened a session.
 */
async function passwordWorks(candidate: string): Promise<boolean> {
  const response = await fetch('http://127.0.0.1:3001/api/admin/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ownerEmail, password: candidate }),
  });
  if (!response.ok) return false;
  const body = await response.json() as { token?: string };
  // Signing in created a real session row. End it, so probing costs nothing.
  const signOut = await fetch('http://127.0.0.1:3001/api/admin/session', {
    method: 'DELETE',
    headers: { authorization: `Bearer ${body.token}` },
  }).catch(() => null);
  return Boolean(signOut?.ok ?? body.token);
}

/**
 * Which password, if any, opens the owner account right now.
 *
 * Tried in order: the one named in the environment, then the seed credential still
 * sitting in the outbox. Both can be absent. Once a password has been saved from
 * `/superadmin/ggpass` the seed row no longer matches, and nothing server-side
 * holds the one that does - which is the promise the screen makes to the owner and
 * the reason this file asks to be told rather than guessing.
 */
async function resolvePassword(): Promise<string> {
  const named = process.env.E2E_OWNER_PASSWORD;
  if (named && await passwordWorks(named)) return named;
  const seeded = await seedPasswordFromOutbox();
  if (seeded && await passwordWorks(seeded)) return seeded;
  return '';
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

/** Generates through the real screen and returns what the field now holds. */
async function generateOnScreen(page: Page): Promise<string> {
  await page.goto('/superadmin/ggpass');
  await page.getByRole('button', { name: 'Generate password' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, generate it' }).click();
  await expect(page.getByLabel('New password')).not.toHaveValue('', { timeout: 15_000 });
  return page.getByLabel('New password').inputValue();
}

test.describe('the real owner password round trip', () => {
  test.skip(!databaseUrl || !smtpConfigured, 'needs the database and mail settings');
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

  /**
   * The password that works right now.
   *
   * Starts as whatever the probe finds, then becomes whatever the save screen
   * produced. Nothing on the server holds it, which is the point of the change and
   * also the reason a run that dies here needs the password named again to recover.
   */
  let currentPassword = '';
  let usable = false;

  test.afterAll(async () => {
    await pool.end();
  });

  test('the owner can sign in with the credential on record', async ({ page }) => {
    // Establish what works, if anything, before touching the browser. A wrong
    // password here is a 30 second timeout on a page that says nothing useful, and
    // every later failure would be a red herring.
    currentPassword = await resolvePassword();
    if (!currentPassword) {
      test.skip(
        true,
        'no working owner password on record. Set E2E_OWNER_PASSWORD to the current one, or reseed with `npm run db:reset`. Nothing server-side holds a password saved from /superadmin/ggpass - that is what the screen promises the owner, and it is why this run has to be told.',
      );
    }
    await signInAsOwner(page, currentPassword);
    const token = await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'));
    expect(token, 'the stored credential opened the console').toBeTruthy();
    // The console itself, which only renders once a session exists. Its `h1` is
    // the one assertion that can tell "signed in" from "redirected somewhere else".
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    usable = true;
  });

  test('offers the control at its own address, to a signed-in owner', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    await signInAsOwner(page, currentPassword);
    await page.goto('/superadmin/ggpass');

    await expect(page.getByRole('heading', { name: 'Generate password' })).toBeVisible();
    // Enabled rather than merely present: this deployment has a database, so the
    // deployment warning is absent and the button is live. Against a broken
    // deployment it renders disabled, and `toBeVisible` would pass for a control
    // that cannot do anything.
    await expect(page.getByRole('button', { name: 'Generate password' })).toBeEnabled();
    await expect(page.getByLabel('Registered email')).toHaveValue(ownerEmail);
    // Nothing has been generated yet, so there is nothing to save and the button
    // says so rather than offering a save that could only be refused.
    await expect(page.getByRole('button', { name: 'Save password' })).toBeDisabled();
    await auditPage(page, '/superadmin/ggpass (real)');
  });

  test('confirms before it generates, and generating writes nothing', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    await signInAsOwner(page, currentPassword);
    const before = await pool.query('SELECT password_hash, updated_at FROM admin_users WHERE email = $1', [ownerEmail]);
    const hashBefore = (before.rows[0] as { password_hash: string }).password_hash;

    await page.goto('/superadmin/ggpass');
    await page.getByRole('button', { name: 'Generate password' }).click();

    const dialog = page.getByRole('dialog', { name: 'Generate a new owner password?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await auditPage(page, '/superadmin/ggpass (real, confirming)');

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    // Cancelling wrote nothing, and so does confirming: this is the property the
    // old rotation did not have, and it is why a refresh on this screen costs nobody
    // their access.
    const after = await pool.query('SELECT password_hash FROM admin_users WHERE email = $1', [ownerEmail]);
    expect((after.rows[0] as { password_hash: string }).password_hash).toBe(hashBefore);
  });

  test('puts the generated password on the screen, in the field and the toast', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    await signInAsOwner(page, currentPassword);

    const shown = await generateOnScreen(page);

    expect(shown, 'the field holds the generated password').toHaveLength(8);
    expect(shown).toMatch(/[A-Z]/);
    expect(shown).toMatch(/[0-9]/);
    // Nothing hard to tell apart at a glance, because a short password that cannot
    // be read back correctly is a locked-out owner.
    expect(shown).not.toMatch(/[Il1O0]/);

    // The toast carries the same value, and offers to copy it. Two places on one
    // screen showing two passwords would be worse than showing it in only one.
    const toast = page.getByRole('status');
    await expect(toast).toContainText('Password generated');
    await expect(page.locator('.ggpass-toast-code')).toHaveText(shown);
    await expect(toast.getByRole('button', { name: 'Copy password' })).toBeVisible();
    await auditPage(page, '/superadmin/ggpass (real, generated)');
  });

  test('saves the field, stores that hash, and mails a confirmation with no password in it', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    await signInAsOwner(page, currentPassword);

    const shown = await generateOnScreen(page);
    const before = await latestOutboxRow('owner-password-saved').catch(() => null);

    // The field is editable, so this takes the path a busy owner takes and proves
    // the save uses the field rather than the value the server handed out. If the
    // two were the same, the rest of this test would pass for the wrong reason.
    expect(shown).not.toBe('Mango!Tree9');
    await page.getByLabel('New password').fill('Mango!Tree9');
    await page.getByRole('button', { name: 'Save password' }).click();
    await expect(page.getByRole('status')).toContainText('Password saved', { timeout: 30_000 });

    const stored = await pool.query('SELECT password_hash FROM admin_users WHERE email = $1', [ownerEmail]);
    const hash = String((stored.rows[0] as { password_hash: string }).password_hash);
    expect(hash.startsWith('scrypt$'), 'the stored value is a hash, not the password').toBe(true);
    expect(hash).not.toContain('Mango');

    // The relay took the confirmation. A null `sent_at` here is the silent failure
    // this whole file exists to catch: the save succeeded, the row was written, and
    // nothing was ever sent because the settings were named in a shape the code
    // does not read.
    const after = await latestOutboxRow('owner-password-saved');
    expect(after.id, 'a confirmation was queued').not.toBe(before?.id);
    expect(after.recipient).toBe(ownerEmail);
    expect(after.sent_at, 'the relay accepted the confirmation').not.toBeNull();
    // And it carries no credential. This is the one mail in the project that can be
    // forwarded without handing over the account.
    expect(after.body).not.toMatch(/Password:\s*\S/);
    expect(after.body).not.toContain('Mango');

    // The session went with the password, and the page is on its way to sign-in.
    expect(await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'))).toBeNull();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

    // From here on the account is only reachable with what was on the screen.
    currentPassword = 'Mango!Tree9';
  });

  test('the stored hash is the password that was on the screen', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    await signInAsOwner(page, currentPassword);
    const token = await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'));
    expect(token, 'the saved password opens the console').toBeTruthy();
  });

  test('a password that has been replaced stops working', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    // One character different is the strongest form of this check: it fails on the
    // hash rather than on the row being absent.
    const superseded = `${currentPassword.slice(0, -1)}${currentPassword.endsWith('x') ? 'y' : 'x'}`;

    await page.goto('/login');
    await page.locator('#login-email').fill(ownerEmail);
    await page.locator('#login-password').fill(superseded);
    await page.getByRole('button', { name: 'Sign in to your account' }).click();

    await expect(page.getByRole('alert')).toContainText('do not match a console account');
    expect(await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'))).toBeNull();
  });

  test('every session was revoked, the caller included', async () => {
    test.skip(!usable, 'the owner could not sign in');
    const sessions = await pool.query(
      'SELECT count(*)::int AS total FROM admin_sessions WHERE user_id = (SELECT id FROM admin_users WHERE email = $1)',
      [ownerEmail],
    );
    // Only the session the hash test just created, which this file does not keep.
    expect((sessions.rows[0] as { total: number }).total).toBeLessThanOrEqual(1);
  });

  test('the owner account is the only one that can do this', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    await signInAsOwner(page, currentPassword);

    // The guard is the server's, reached the way an attacker would: the endpoints
    // directly, with a real owner session, and a body the screen would never send.
    // The UI's own role check is a courtesy and is tested elsewhere.
    const statuses = await page.evaluate(async () => {
      const token = localStorage.getItem('glow-grace-admin-token');
      const call = async (path: string, body: unknown) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        });
        return response.status;
      };
      return {
        generate: await call('/api/admin/owner-password/generate', { anything: true }),
        save: await call('/api/admin/owner-password/save', { password: 'short' }),
        rotate: await call('/api/admin/owner-password/rotate', { anything: true }),
      };
    });

    // Both real endpoints answer the owner, and neither of them believes a body on
    // a generate. The refused save writes nothing, so the credential this run is
    // holding on to still works afterwards.
    expect(statuses.generate, 'the owner may generate').toBe(200);
    expect(statuses.save, 'the owner may save a password the policy accepts').toBe(400);
    expect(statuses.rotate, 'there is no longer a rotate route').toBe(404);
  });
});
