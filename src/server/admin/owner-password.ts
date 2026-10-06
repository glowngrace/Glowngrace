import { hashPassword, passwordPolicyError } from './passwords.js';
import { superAdminEmail } from '../../auth/roles.js';
import { tryDeliverPendingMail } from '../mailer.js';
import type { Database } from '../handlers.js';

/**
 * The owner account's password, generated on screen and saved by hand.
 *
 * There is no schedule and no automatic replacement. The password that is saved is
 * the password that keeps working until somebody saves another one, which is what
 * makes the flow on `/superadmin/ggpass` honest: the person who can see the new
 * password is the person who typed it in, and nobody else ever receives it.
 *
 * That is a deliberate change from the rotation this replaced. A weekly rotation
 * had no operator watching when it happened, so it had to deliver the new
 * password by mail to an unattended mailbox - a live credential written to a
 * table, sent over SMTP, and regenerated whether or not anybody was there to
 * receive it. Sending it to the screen instead puts it in the hands of the one
 * person allowed to have it and takes the credential out of the mail path
 * entirely. The confirmation that follows is not a credential: it says a password
 * was saved and when, which is audit information, not a secret.
 */

export type SavedOwnerPassword = {
  saved: true;
  userId: string;
  email: string;
  sessionsRevoked: number;
};

/**
 * The message that confirms a saved password.
 *
 * Carries no password, on purpose. This is the one mail in the project that is
 * safe to leave lying around in a mailbox for years: it records that the owner
 * credential changed and when, and it cannot be replayed to sign in. The old
 * design put the live password in the same slot, which meant a forwarded
 * confirmation mail was a working login.
 */
export function ownerPasswordSavedMessage(input: { role: string; now: Date }) {
  return {
    subject: 'Your Glow & Grace owner password was saved',
    body: [
      'Hello,',
      '',
      `A new password for the ${input.role} account was saved on ${input.now.toISOString()}.`,
      '',
      `Sign in at /login as ${superAdminEmail} using the password you generated and saved on this screen.`,
      'Every session signed in with the previous password was ended, including the one that saved the new one.',
      '',
      'If you did not do this, treat it as a warning: the address is the way into the console, so check who holds access to the mailbox.',
    ].join('\n'),
  };
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
 * Stores the password and tells the owner it was stored.
 *
 * The value arrives from the screen rather than from here, because the point of
 * the flow is that the operator can edit what was generated before keeping it.
 * That makes this the one place in the project where a password is chosen by a
 * request body, so it is held to the same policy as every other password, and it
 * is hashed with the same scrypt parameters - the input is never stored, logged
 * or echoed.
 *
 * Every session is revoked at the same moment: the previous password has stopped
 * working, so a session opened with it should stop working too. The caller's is
 * included, which is why the response is the last thing that session sees.
 *
 * A password hold used to be cleared on the way through. There is no hold and no
 * rotation left, so there is nothing to clear and the columns are gone.
 */
export async function saveOwnerPassword(database: Database, password: string, now: Date = new Date()): Promise<SavedOwnerPassword | { saved: false; reason: 'missing' }> {
  const refused = passwordPolicyError(password);
  if (refused) throw new Error(refused);

  const found = await database.query(
    'SELECT id, email, role FROM admin_users WHERE email = $1',
    [superAdminEmail],
  );
  const account = found.rows[0] as { id: string; email: string; role: string } | undefined;
  // A deployment that has not been seeded yet, or whose owner row was deleted on
  // purpose, has nothing to give a password to. The caller re-seeds; not an error.
  if (!account) return { saved: false, reason: 'missing' };

  await database.query(
    'UPDATE admin_users SET password_hash = $1, updated_at = $2 WHERE id = $3',
    [await hashPassword(password), now, account.id],
  );
  const revoked = await database.query('DELETE FROM admin_sessions WHERE user_id = $1', [account.id]);

  const message = ownerPasswordSavedMessage({ role: account.role, now });
  await database.query(
    `INSERT INTO email_outbox (kind, recipient, subject, body)
     VALUES ('owner-password-saved', $1, $2, $3)`,
    [superAdminEmail, message.subject, message.body],
  );
  // The outbox row is the record; this is the attempt to put it in the owner's
  // mailbox. A failure here is reported and left to the delivery pass, because the
  // hash has already been replaced and there is no second chance to send this
  // particular confirmation - though unlike a credential, losing it costs an audit
  // line rather than an account.
  await tryDeliverPendingMail(database);

  return {
    saved: true,
    userId: String(account.id),
    email: account.email,
    sessionsRevoked: revoked.rowCount ?? 0,
  };
}