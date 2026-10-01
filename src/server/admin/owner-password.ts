import { generateStrongPassword, hashPassword, superAdminRotationDays } from './passwords.js';
import { superAdminEmail, superAdminRole } from '../../auth/roles.js';
import { tryDeliverPendingMail } from '../mailer.js';
import type { Database } from '../handlers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How often the schedule wakes up.
 *
 * A day, so a server that is restarted after a long gap still rotates promptly
 * rather than waiting a whole week from the moment it came back. The check
 * inside `rotateOwnerPasswordIfDue` is what decides whether a wake-up does
 * anything, so waking more often than the rotation period is harmless.
 */
export const ownerRotationCheckMs = 24 * 60 * 60 * 1000;

export type OwnerRotationResult =
  | { rotated: false; reason: 'missing' | 'not-due' }
  | { rotated: true; userId: string; email: string; sessionsRevoked: number; holdSpentUntil: string | null };

/**
 * The outbox message that carries a generated password to its owner.
 *
 * Both the first password and every later rotation are worded here, so the
 * person holding the mailbox reads the same thing whichever one arrives.
 */
export function ownerCredentialsMessage(input: { password: string; role: string; now: Date }) {
  const nextRotationAt = new Date(input.now.getTime() + superAdminRotationDays * DAY_MS);
  return {
    subject: 'Your new Glow & Grace owner password',
    body: [
      `Hello,`,
      '',
      `A new password for the ${input.role} account was generated on ${input.now.toISOString()}.`,
      'It is valid until the next rotation, and until then it is the only one that works.',
      '',
      `Sign in at /login as ${superAdminEmail}`,
      `Password: ${input.password}`,
      '',
      `The next password is generated on ${nextRotationAt.toISOString()}, and every session signed in with this one is signed out when that happens.`,
      '',
      'If you did not expect this, treat it as a warning: the address is the way into the console, so check who holds access to the mailbox.',
    ].join('\n'),
  };
}

/**
 * Replaces the owner account's password, and tells the owner what it is now.
 *
 * This account exists because a deployment has to have somebody who can always
 * get in. Nobody chooses its password, so it is generated here, stored hashed,
 * and written to the outbox, which is where this project keeps mail it has no
 * server to send. Every session is revoked at the same moment: the old password
 * has stopped working, so a session opened with it should stop working too.
 *
 * Any password hold is cleared on the way through. The hold is what let a
 * hand-chosen password survive the weekly rotation, and it has just run out, so
 * leaving it behind would either hold the *next* generated password for another
 * window - which nobody asked for - or, worse, keep a past date that made every
 * later tick look overdue.
 */
export async function rotateOwnerPassword(database: Database, now: Date = new Date()): Promise<OwnerRotationResult> {
  const found = await database.query(
    'SELECT id, email, role, password_hold_until FROM admin_users WHERE email = $1',
    [superAdminEmail],
  );
  const account = found.rows[0] as
    | { id: string; email: string; role: string; password_hold_until: Date | string | null }
    | undefined;
  // A deployment that has not been seeded yet, or whose owner row was deleted on
  // purpose, has nothing to rotate. The caller re-seeds; this is not an error.
  if (!account) return { rotated: false, reason: 'missing' };

  const password = generateStrongPassword();
  await database.query(
    'UPDATE admin_users SET password_hash = $1, password_rotated_at = $2, password_hold_until = NULL WHERE id = $3',
    [await hashPassword(password), now, account.id],
  );
  const revoked = await database.query('DELETE FROM admin_sessions WHERE user_id = $1', [account.id]);

  const message = ownerCredentialsMessage({ password, role: account.role, now });
  await database.query(
    `INSERT INTO email_outbox (kind, recipient, subject, body)
     VALUES ('owner-credentials', $1, $2, $3)`,
    [superAdminEmail, message.subject, message.body],
  );
  // The outbox row is the record; this is the attempt to put it in the owner's
  // mailbox. A failure here is reported and left to the delivery pass, because the
  // hash has already been replaced and there is no second chance to generate this
  // particular password.
  await tryDeliverPendingMail(database);

  return {
    rotated: true,
    userId: String(account.id),
    email: account.email,
    sessionsRevoked: revoked.rowCount ?? 0,
    holdSpentUntil: account.password_hold_until === null ? null : new Date(account.password_hold_until).toISOString(),
  };
}

/**
 * Rotates when the weekly clock is up, and when a password hold has run out.
 *
 * The two are mutually exclusive, which is the whole point of the hold: while it
 * is in the future the account is not due however long ago `password_rotated_at`
 * was stamped, so a password somebody chose by hand is not replaced a day later.
 * Once the date is in the past the account is due immediately, whatever the
 * rotation stamp says - the hold was granted instead of the rotation, so the
 * moment it expires the normal schedule takes over rather than starting a fresh
 * week of grace.
 *
 * A row with no hold behaves exactly as it did before the column existed.
 *
 * The comparison stays in the query rather than in JavaScript so a clock skew
 * between the application host and the database cannot cause a rotation on every
 * single request.
 */
export async function rotateOwnerPasswordIfDue(database: Database, now: Date = new Date()) {
  const found = await database.query(
    `SELECT id FROM admin_users
     WHERE email = $1
       AND (
         (password_hold_until IS NOT NULL AND password_hold_until <= $2)
         OR (password_hold_until IS NULL AND (password_rotated_at IS NULL OR password_rotated_at <= $3))
       )`,
    [superAdminEmail, now, new Date(now.getTime() - superAdminRotationDays * DAY_MS)],
  );
  if (found.rows.length === 0) {
    const exists = await database.query('SELECT id FROM admin_users WHERE email = $1', [superAdminEmail]);
    return exists.rows.length === 0
      ? ({ rotated: false, reason: 'missing' } as const)
      : ({ rotated: false, reason: 'not-due' } as const);
  }
  return rotateOwnerPassword(database, now);
}

/**
 * Starts the rotation schedule and returns a way to stop it.
 *
 * The timer is unref'd so a test, or a script that imports the server, is never
 * held open by it. A failure is logged and the schedule carries on: the next
 * wake-up is a day away, and an outage that stops the process is a different
 * problem from one that stops a rotation.
 */
export function startOwnerPasswordRotation(database: Database, options: { now?: () => Date; intervalMs?: number } = {}) {
  const now = options.now ?? (() => new Date());
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await rotateOwnerPasswordIfDue(database, now());
      if (result.rotated) {
        // Worth distinguishing in the log: a hold running out is the operator's
        // own deadline arriving, where a plain rotation is just the week turning
        // over. Only the first one is ever a surprise.
        const because = result.holdSpentUntil ? `a password hold that ended ${result.holdSpentUntil}` : 'the weekly rotation';
        console.log(`Rotated the ${superAdminRole} password after ${because} and mailed the new one to ${result.email}.`);
      }
    } catch (error) {
      console.error('Unable to rotate the owner password', error);
    }
  };

  const timer = setInterval(() => void tick(), options.intervalMs ?? ownerRotationCheckMs);
  timer.unref?.();
  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
