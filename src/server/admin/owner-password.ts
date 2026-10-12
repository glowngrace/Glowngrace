import { hashPassword, ownerPasswordPolicyError } from './passwords.js';
import { superAdminEmail } from '../../auth/roles.js';
import { tryDeliverPendingMail } from '../mailer.js';
import type { Database } from '../handlers.js';

/**
 * The owner account's password, generated on screen and saved by hand.
 *
 * There is no schedule and no automatic replacement. The password that is saved is
 * the password that keeps working until somebody saves another one. The screen on
 * `/superadmin/ggpass` shows the new password and, by request, it is also mailed to
 * the owner address `glowngracebiz@gmail.com` on both steps: once when it is
 * generated and once when it is saved. The address is fixed - it is the owner
 * account's own - so a generated password always goes to the same mailbox, and
 * nothing from a request can redirect it.
 *
 * The screen stays the first place the value appears, so a closed tab or a refresh
 * costs nobody their access, while the mail leaves the owner a durable copy that
 * survives losing the tab. The saved-password mail doubles as the audit line: it
 * records that the credential changed and when.
 */

export type SavedOwnerPassword = {
  saved: true;
  userId: string;
  email: string;
  sessionsRevoked: number;
};

/**
 * The message that carries a saved password to the owner address.
 *
 * It includes the value that was just stored, so the owner keeps a copy that
 * survives closing the tab. It is also the audit line: it records that the owner
 * credential changed and when. Because it carries a working credential, it must be
 * treated the same way as any other password mail - the mailbox it lands in is
 * part of the way into the console.
 */
export function ownerPasswordSavedMessage(input: { role: string; password: string; now: Date }) {
  return {
    subject: 'Your Glow & Grace owner password was saved',
    body: [
      'Hello,',
      '',
      `A new password for the ${input.role} account was saved on ${input.now.toISOString()}.`,
      '',
      `Sign in at /login as ${superAdminEmail}`,
      `Password: ${input.password}`,
      '',
      'Every session signed in with the previous password was ended, including the one that saved the new one.',
      '',
      'If you did not do this, treat it as a warning: the address is the way into the console, so check who holds access to the mailbox.',
    ].join('\n'),
  };
}

/**
 * The message that carries a freshly generated password to the owner address.
 *
 * Generated on the screen before anything is saved, so the value is mailed while
 * the previous password is still the one that works. Included unconditionally, so
 * the owner has a copy even if the tab that showed it is closed before the save.
 */
export function ownerPasswordGeneratedMessage(input: { role: string; password: string; now: Date }) {
  return {
    subject: 'Your Glow & Grace owner password was generated',
    body: [
      'Hello,',
      '',
      `A new password for the ${input.role} account was generated on ${input.now.toISOString()}.`,
      'It is not active until it is saved on the password screen; the previous password keeps working until then.',
      '',
      `Sign in at /login as ${superAdminEmail}`,
      `Password: ${input.password}`,
      '',
      'If you did not generate this, ignore it and change the owner password from the console.',
    ].join('\n'),
  };
}

/**
 * Queues the generated password for the owner address and attempts delivery.
 *
 * The recipient is the owner address and never a value from a request, so nothing
 * a caller sends can redirect a credential to another mailbox. A failed send is
 * left in the outbox and retried by the delivery pass, exactly like the save
 * message.
 */
export async function emailGeneratedOwnerPassword(
  database: Database,
  password: string,
  role: string,
  now: Date = new Date(),
) {
  const message = ownerPasswordGeneratedMessage({ role, password, now });
  await database.query(
    `INSERT INTO email_outbox (kind, recipient, subject, body)
     VALUES ('owner-password-generated', $1, $2, $3)`,
    [superAdminEmail, message.subject, message.body],
  );
  await tryDeliverPendingMail(database);
}

/**
 * The outbox message that carries a generated password to its owner.
 *
 * Only the seed writes this one. It is the single case where the password cannot
 * be shown to anybody: seeding happens with nobody at the keyboard, so the
 * password has to travel by mail or the deployment comes up with an owner account
 * that cannot be signed into. `/superadmin/ggpass` no longer does this, because
 * there is a person on the other end of it.
 */
export function ownerCredentialsMessage(input: { password: string; role: string; now: Date }) {
  return {
    subject: 'Your Glow & Grace owner password',
    body: [
      'Hello,',
      '',
      `A password for the ${input.role} account was generated on ${input.now.toISOString()} when this deployment was seeded.`,
      'It does not change on its own, so keep it somewhere safe.',
      '',
      `Sign in at /login as ${superAdminEmail}`,
      `Password: ${input.password}`,
      '',
      'If you would rather choose it yourself, sign in and use /superadmin/ggpass to generate and save a new one.',
    ].join('\n'),
  };
}

/**
 * One line in the owner password's audit trail.
 *
 * The kind is interpolated rather than bound, because Postgres will not accept a
 * value where a column name or a keyword belongs - and it is safe to do so only
 * because the caller passes one of two literals defined here. Nothing from a
 * request body reaches this statement.
 */
async function recordOwnerPasswordEvent(database: Database, userId: string, kind: 'generated' | 'saved', now: Date) {
  await database.query(
    `INSERT INTO owner_password_events (user_id, kind, created_at) VALUES ($1, '${kind}', $2)`,
    [userId, now],
  );
}

/**
 * Remembers that a password was generated, without remembering the password.
 *
 * Generating still writes no credential, ends no session and leaves the previous
 * password working - a closed tab costs nobody their access, exactly as the
 * screen promises. What it does now record is the moment, so a deployment can
 * tell an untouched account from one where somebody generated a password and
 * never saved it.
 *
 * Called for the signed-in caller, who is the owner: the route has already
 * refused anybody else, and hanging the event off the caller's own row means the
 * record exists even on a deployment whose owner row is somehow missing.
 *
 * The caller maps a missing column or table to the migration hint rather than
 * letting this turn into a 500: a deployment that has not run 016 yet is a
 * deployment that is behind, and it should be told which file fixes it.
 */
export async function recordOwnerPasswordGenerated(database: Database, userId: string, now: Date = new Date()) {
  await database.query('UPDATE admin_users SET password_generated_at = $1 WHERE id = $2', [now, userId]);
  await recordOwnerPasswordEvent(database, userId, 'generated', now);
}

/**
 * Stores the password and tells the owner it was stored.
 *
 * The value arrives from the screen rather than from here. The screen will only
 * save the password it generated, pasted back, but the server cannot know that -
 * it never sees the generated value - so this is the one place in the project
 * where a password arrives in a request body, and it is held to the owner policy
 * rather than to whatever the screen was prepared to send. It is hashed with the
 * same scrypt parameters as every other password: the input is never stored,
 * logged or echoed.
 *
 * Every session is revoked at the same moment: the previous password has stopped
 * working, so a session opened with it should stop working too. The caller's is
 * included, which is why the response is the last thing that session sees.
 *
 * A password hold used to be cleared on the way through. There is no hold and no
 * rotation left, so there is nothing to clear and the columns are gone.
 */
export async function saveOwnerPassword(database: Database, password: string, now: Date = new Date()): Promise<SavedOwnerPassword | { saved: false; reason: 'missing' }> {
  const refused = ownerPasswordPolicyError(password);
  if (refused) throw new Error(refused);

  const found = await database.query(
    'SELECT id, email, role FROM admin_users WHERE email = $1',
    [superAdminEmail],
  );
  const account = found.rows[0] as { id: string; email: string; role: string } | undefined;
  // A deployment that has not been seeded yet, or whose owner row was deleted on
  // purpose, has nothing to give a password to. The caller re-seeds; not an error.
  if (!account) return { saved: false, reason: 'missing' };

  // `password_changed_at` is stamped with the same instant as `updated_at`, and
  // both are separate from `password_generated_at`: one is when a password was
  // offered, this one is when one was kept. Only the kept one is a credential
  // change, which is why only it is recorded as such.
  await database.query(
    'UPDATE admin_users SET password_hash = $1, updated_at = $2, password_changed_at = $2 WHERE id = $3',
    [await hashPassword(password), now, account.id],
  );
  const revoked = await database.query('DELETE FROM admin_sessions WHERE user_id = $1', [account.id]);
  await recordOwnerPasswordEvent(database, account.id, 'saved', now);

  const message = ownerPasswordSavedMessage({ role: account.role, password, now });
  await database.query(
    `INSERT INTO email_outbox (kind, recipient, subject, body)
     VALUES ('owner-password-saved', $1, $2, $3)`,
    [superAdminEmail, message.subject, message.body],
  );
  // The outbox row is the record; this is the attempt to put it in the owner's
  // mailbox. A failure here is reported and left to the delivery pass, because the
  // hash has already been replaced and there is no second chance to send this
  // particular message. The row carries the credential, so leaving it queued
  // matters: it is the owner's only durable copy.
  await tryDeliverPendingMail(database);

  return {
    saved: true,
    userId: String(account.id),
    email: account.email,
    sessionsRevoked: revoked.rowCount ?? 0,
  };
}