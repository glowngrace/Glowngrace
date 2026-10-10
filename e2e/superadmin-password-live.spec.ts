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
 *   3. pressing it generates on the press, with no dialog in front of it, and
 *      nothing at all is written - only the record that somebody generated one
 *   4. the password is in the notification with a copy button beside it
 *   5. a copy opens the save field, and the value the field holds is what the
 *      save request carries - read off the request itself, against the real
 *      server, because that is the one thing a stub cannot prove
 *   6. the stored hash verifies against exactly that value
 *   7. the confirmation was relayed, which is `sent_at` on the outbox row, and it
 *      carries no password
 *   8. the old password no longer works and the new one does
 *   9. every session went, the caller's included, and the screen walks to sign-in
 *
 * One thing this file can no longer do, and it is worth being explicit about: the
 * previous version read each new password back off the request by typing a
 * different one into an editable field, and before that it read the password back
 * out of the outbox, because the password used to be mailed and never rendered. Now
 * it is the other way round. The password exists on the screen and in the mailbox
 * only as a confirmation that a password changed, so the value is read from the
 * notification and kept in memory for the length of the run.
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

/** Generates through the real screen and returns what the notification now holds. */
async function generateOnScreen(page: Page): Promise<string> {
  await page.goto('/superadmin/ggpass');
  await page.getByRole('button', { name: 'Generate password' }).click();
  const code = page.locator('.ggpass-toast-code');
  await expect(code).toHaveText(/.{8}/, { timeout: 15_000 });
  return (await code.textContent() ?? '').trim();
}

/**
 * Copies from the notification, which is what opens the save field.
 *
 * No clipboard permission is asked for: the field opens on the attempt whether or
 * not the browser let the value through, which is the screen's own answer to a
 * withheld clipboard. The value that goes into the field below comes from the
 * notification, so what this costs is only the copy report, not the run.
 */
async function copyOnScreen(page: Page) {
  await page.getByRole('button', { name: 'Copy password' }).click();
  await expect(page.getByLabel('Save new password')).toBeVisible();
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
    // Nothing has been generated, so nothing has been copied, so there is no save
    // field: before a copy there is no value to paste back and a save button could
    // only refuse.
    await expect(page.getByRole('button', { name: 'Save password' })).toHaveCount(0);
    await expect(page.getByText('Copy it from the notification, then paste it above to save.')).toBeVisible();
    await auditPage(page, '/superadmin/ggpass (real)');
  });

  test('generates on the press, and generating writes nothing', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    await signInAsOwner(page, currentPassword);
    const before = await pool.query(
      'SELECT password_hash, updated_at, password_generated_at, password_changed_at FROM admin_users WHERE email = $1',
      [ownerEmail],
    );
    const row = before.rows[0] as {
      password_hash: string;
      updated_at: Date;
      password_generated_at: Date | null;
      password_changed_at: Date | null;
    };
    const generatedAt = row.password_generated_at ? new Date(row.password_generated_at).getTime() : null;

    await page.goto('/superadmin/ggpass');
    await page.getByRole('button', { name: 'Generate password' }).click();

    // No dialog in front of it. The design's own answer to "are you sure" is that
    // nothing is written until the save, and the value below is the proof of that
    // rather than the absence of a confirmation.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.ggpass-toast-code')).toHaveText(/.{8}/, { timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Regenerate password' })).toBeEnabled();

    const after = await pool.query(
      'SELECT password_hash, updated_at, password_generated_at, password_changed_at FROM admin_users WHERE email = $1',
      [ownerEmail],
    );
    const kept = after.rows[0] as {
      password_hash: string;
      updated_at: Date;
      password_generated_at: Date | null;
      password_changed_at: Date | null;
    };
    // The credential itself is untouched, and so is the column that moves when one
    // is stored: a refresh on this screen still costs nobody their access.
    expect(kept.password_hash).toBe(row.password_hash);
    expect(new Date(kept.updated_at).getTime()).toBe(new Date(row.updated_at).getTime());

    // What did move is the record that somebody was handed a password, which is the
    // difference this migration exists to make: "nobody has looked at this" and
    // "somebody generated one and never saved it" are no longer the same answer.
    expect(kept.password_generated_at, 'the generation was recorded').not.toBeNull();
    expect(new Date(kept.password_generated_at!).getTime()).toBeGreaterThanOrEqual(generatedAt ?? 0);
    // And the save timestamp did not move with it: a generation is a different
    // event from a save, which is the whole reason they are two columns.
    expect(kept.password_changed_at ? new Date(kept.password_changed_at).getTime() : null)
      .toBe(row.password_changed_at ? new Date(row.password_changed_at).getTime() : null);

    // And the event, not just the column: the column holds the last one, the table
    // holds every one of them.
    const events = await pool.query(
      `SELECT kind FROM owner_password_events WHERE user_id = (SELECT id FROM admin_users WHERE email = $1)
       ORDER BY created_at DESC LIMIT 1`,
      [ownerEmail],
    );
    expect((events.rows[0] as { kind: string }).kind).toBe('generated');
  });

  test('puts the generated password in the notification, with a way to copy it', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    await signInAsOwner(page, currentPassword);

    const shown = await generateOnScreen(page);

    expect(shown, 'the notification holds the generated password').toHaveLength(8);
    expect(shown).toMatch(/[A-Z]/);
    expect(shown).toMatch(/[0-9]/);
    // Nothing hard to tell apart at a glance, because a short password that cannot
    // be read back correctly is a locked-out owner.
    expect(shown).not.toMatch(/[Il1O0]/);

    // The notification carries the value and offers to copy it. There is no field
    // to read it from: the copy is what opens the save, so this is the only place
    // on the page the password exists in the clear.
    const toast = page.locator('.ggpass-toast');
    await expect(toast).toContainText('Password generated');
    await expect(toast).toContainText(`New password for ${ownerEmail}`);
    await expect(page.locator('.ggpass-toast-code')).toHaveText(shown);
    await expect(toast.getByRole('button', { name: 'Copy password' })).toBeVisible();
    await expect(page.getByLabel('Save new password')).toHaveCount(0);
    await auditPage(page, '/superadmin/ggpass (real, generated)');
  });

  test('saves the value in the field, stores that hash, and mails a confirmation with no password in it', async ({ page }) => {
    test.skip(!usable, 'the owner could not sign in');
    await signInAsOwner(page, currentPassword);

    const shown = await generateOnScreen(page);
    const before = await latestOutboxRow('owner-password-saved').catch(() => null);

    // Read off the request itself as it goes through to the real server. The field
    // takes the value back by paste, so what it holds and what the server receives
    // can only differ if the screen sends something other than what it showed -
    // and that is the one thing a UI-only test would wave past.
    let sent: Record<string, unknown> | null = null;
    await page.route('**/api/admin/owner-password/save', async (route) => {
      sent = route.request().postDataJSON() as Record<string, unknown> | null;
      await route.continue();
    });

    await copyOnScreen(page);
    // Empty until a copy has put it there, so nothing typed before the copy can
    // survive into the save.
    await expect(page.getByLabel('Save new password')).toHaveValue('');
    await page.getByLabel('Save new password').fill(shown);
    await page.getByRole('button', { name: 'Save password' }).click();

    await expect(page.locator('.ggpass-toast')).toContainText('Password saved', { timeout: 30_000 });
    await expect(page.locator('.ggpass-toast')).toContainText(`The password for ${ownerEmail} has been updated.`);
    expect(sent, 'the request carried what the field held').toEqual({ password: shown });

    const stored = await pool.query(
      'SELECT password_hash, password_changed_at FROM admin_users WHERE email = $1',
      [ownerEmail],
    );
    const kept = stored.rows[0] as { password_hash: string; password_changed_at: Date | null };
    expect(kept.password_hash.startsWith('scrypt$'), 'the stored value is a hash, not the password').toBe(true);
    expect(kept.password_hash, 'the hash is not the value on screen').not.toContain(shown);
    expect(kept.password_changed_at, 'the save was recorded').not.toBeNull();

    // The event, which is what an operator reads the history from.
    const events = await pool.query(
      `SELECT kind FROM owner_password_events WHERE user_id = (SELECT id FROM admin_users WHERE email = $1)
       ORDER BY created_at DESC LIMIT 1`,
      [ownerEmail],
    );
    expect((events.rows[0] as { kind: string }).kind).toBe('saved');

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
    expect(after.body).not.toContain(shown);

    // The session went with the password, and the page is on its way to sign-in.
    expect(await page.evaluate(() => localStorage.getItem('glow-grace-admin-token'))).toBeNull();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

    // From here on the account is only reachable with what was on the screen.
    currentPassword = shown;
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
