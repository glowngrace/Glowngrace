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
  | { rotated: true; userId: string; email: string; sessionsRevoked: number };

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
 */
export async function rotateOwnerPassword(database: Database, now: Date = new Date()): Promise<OwnerRotationResult> {
  const found = await database.query(
    'SELECT id, email, role, password_rotated_at FROM admin_users WHERE email = $1',
    [superAdminEmail],
  );
  const account = found.rows[0] as { id: string; email: string; role: string; password_rotated_at: Date | string | null } | undefined;
  // A deployment that has not been seeded yet, or whose owner row was deleted on
  // purpose, has nothing to rotate. The caller re-seeds; this is not an error.
  if (!account) return { rotated: false, reason: 'missing' };

  const password = generateStrongPassword();
  await database.query(
    'UPDATE admin_users SET password_hash = $1, password_rotated_at = $2 WHERE id = $3',
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

  return { rotated: true, userId: String(account.id), email: account.email, sessionsRevoked: revoked.rowCount ?? 0 };
}

/**
 * Rotates only when the last one is at least a week old.
 *
 * The age is compared in the query rather than in JavaScript so a clock skew
 * between the application host and the database cannot cause a rotation on every
 * single request.
 */
export async function rotateOwnerPasswordIfDue(database: Database, now: Date = new Date()) {
  const found = await database.query(
    `SELECT id FROM admin_users
     WHERE email = $1
       AND (password_rotated_at IS NULL OR password_rotated_at <= $2)`,
    [superAdminEmail, new Date(now.getTime() - superAdminRotationDays * DAY_MS)],
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
        console.log(`Rotated the ${superAdminRole} password and mailed the new one to ${result.email}.`);
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
