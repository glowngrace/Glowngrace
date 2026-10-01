import 'dotenv/config';
import { createInterface } from 'node:readline';
import { Client } from 'pg';
import { hashPassword, passwordHoldError, passwordPolicyError } from '../src/server/admin/passwords.js';
import { superAdminEmail } from '../src/auth/roles.js';
import {
  clientConfig,
  describeResolvedDatabase,
  isLocalHost,
  resolveLocalDatabase,
  resolveProductionDatabase,
  type ResolvedDatabase,
} from '../src/server/config.js';

/**
 * Sets a new password for console accounts straight in the database, for when
 * nobody can get in through the console to do it themselves.
 *
 * The password is never accepted as a command-line argument, never printed and
 * never written to disk: it comes from OWNER_PINNED_PASSWORD or
 * ADMIN_RESET_PASSWORD, or from a masked prompt. Every live session for the
 * accounts is destroyed, because the point of a reset is usually that the old
 * password is no longer trustworthy. Resetting the owner account also restarts its
 * weekly rotation, so the password set here stays good for a week rather than
 * being replaced on the next scheduled check - or, with --hold-until, for the
 * length of the hold.
 *
 * Production, one account:
 *   npx tsx scripts/reset-admin-password.ts --email admin@glowngrace.in
 *
 * Production, the owner account, held until a known date:
 *   OWNER_PINNED_PASSWORD=... npx tsx scripts/reset-admin-password.ts \
 *     --email glowngracebiz@gmail.com --hold-until 2026-10-10T23:59:59Z
 *
 * Production, every account:
 *   ADMIN_RESET_PASSWORD=... npx tsx scripts/reset-admin-password.ts --all
 *
 * Local development:
 *   npx tsx scripts/reset-admin-password.ts --all --allow-local
 *
 * A fresh database has one account, admin@glowngrace.in, seeded with a random
 * password nobody holds. This script is how that account is first claimed, and
 * how any locked-out account is recovered afterwards.
 *
 * Add --yes to skip the confirmation. The password is held to the same
 * standard as every other form, because there is no demo credential left to
 * make an exception for.
 */

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

/**
 * Reads a line from stdin without echoing it. readline owns the terminal, so the
 * only way to stop the keystrokes appearing on screen is to intercept what it
 * would have written and discard everything except our own prompts.
 */
function askHidden(prompt: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise<string>((resolve) => {
    let muted = false;
    const echo = rl as unknown as { _writeToOutput: (chunk: string) => void };
    const writeToOutput = echo._writeToOutput.bind(echo);
    echo._writeToOutput = (chunk: string) => {
      if (!muted) return writeToOutput(chunk);
      // A bare newline still has to get through so the cursor resets.
      if (chunk.includes('\n')) writeToOutput('\n');
    };
    rl.question(prompt, (answer) => {
      muted = false;
      writeToOutput('\n');
      rl.close();
      resolve(answer);
    });
  });
}

function ask(question: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function resolvePassword() {
  // Two names for the same thing, because the owner password has a second,
  // time-boxed job and `OWNER_PINNED_PASSWORD` says what it is for. The
  // password itself is only ever read from the environment or typed at a masked
  // prompt: it is never an argument, so it cannot land in a shell history, a
  // process listing, or a CI log.
  const fromEnv = process.env.OWNER_PINNED_PASSWORD ?? process.env.ADMIN_RESET_PASSWORD;
  if (fromEnv !== undefined) {
    console.log(
      process.env.OWNER_PINNED_PASSWORD !== undefined
        ? 'Password read from OWNER_PINNED_PASSWORD.'
        : 'Password read from ADMIN_RESET_PASSWORD.',
    );
    return fromEnv;
  }
  const first = await askHidden('New password (input hidden): ');
  const second = await askHidden('Confirm new password (input hidden): ');
  if (first !== second) throw new Error('The two entries did not match. Nothing was changed.');
  return first;
}

function checkPasswordPolicy(password: string) {
  // The ordinary policy, the same one every form in the product is held to.
  // There is no published sample password to allow any more, which is the point
  // of removing the demo accounts.
  const problem = passwordPolicyError(password);
  if (problem) throw new Error(`${problem} Nothing was changed.`);
}

/**
 * Works out the moment a hold should end, or refuses the request.
 *
 * Only the owner account is eligible, and that restriction is the point rather
 * than a limitation: `password_hold_until` is read by the owner's rotation and
 * by nothing else, so a hold set on any other row would be a column that says
 * "do not touch this" to a schedule that never looks at it. Silently accepting
 * that would hand back a password everybody believes is pinned and that is in
 * fact rotated away a week later with nobody told.
 */
function resolveHold(email: string, every: boolean, now: Date) {
  const requested = argument('hold-until');
  if (requested === undefined) return null;

  if (every) {
    throw new Error('--hold-until is for a single account. The rotation that would honour it only ever watches the owner.');
  }
  if (email !== superAdminEmail) {
    throw new Error(
      `--hold-until only applies to the owner account ${superAdminEmail}, because that is the only password the rotation schedule replaces. `
      + `Nothing was changed.`,
    );
  }

  const until = new Date(requested);
  const problem = passwordHoldError(until, now);
  if (problem) throw new Error(`${problem} Nothing was changed.`);
  return until;
}

async function main() {
  const every = hasFlag('all');
  const email = (argument('email') ?? '').trim().toLowerCase();
  if (!every && !email) {
    throw new Error('Say which account to reset: --email <address>, or --all for every console account.');
  }
  if (every && email) {
    throw new Error('Pass either --email or --all, not both.');
  }

  // Resolved before the connection is opened, so a mistyped date fails on the
  // command line rather than after a prompt and a confirmation.
  const holdUntil = resolveHold(email, every, new Date());

  // A local run has to be asked for by name. Without the flag, a development
  // shell whose connection string has gone missing would silently fall back to
  // DATABASE_URL and reset the developer's local data while claiming to have
  // touched production.
  const allowLocal = hasFlag('allow-local');
  const resolved: ResolvedDatabase = allowLocal ? resolveLocalDatabase() : resolveProductionDatabase();

  if (isLocalHost(resolved.description.host) && !allowLocal) {
    throw new Error(
      `Refusing to run: that connection string resolves to the local host ${resolved.description.host}. `
      + 'Pass --allow-local if local is genuinely what you mean.',
    );
  }
  if (!isLocalHost(resolved.description.host) && allowLocal) {
    throw new Error(
      `Refusing to run: --allow-local was passed but ${resolved.description.host} is not a local host. `
      + 'Drop the flag to reset a remote database.',
    );
  }

  const target = every ? 'every console account' : email;
  console.log(`Target: ${describeResolvedDatabase(resolved)}`);
  console.log(`Accounts: ${target}\n`);

  const client = new Client(clientConfig(resolved));
  await client.connect();

  try {
    const found = every
      ? await client.query(
        `SELECT id, name, email, role, status FROM admin_users ORDER BY role, email`,
      )
      : await client.query(
        `SELECT id, name, email, role, status FROM admin_users WHERE email = $1`,
        [email],
      );

    const accounts = found.rows;
    if (accounts.length === 0) {
      throw new Error(
        every
          ? 'That database has no console accounts, so there is nothing to reset.'
          : `No account uses ${email}. Nothing was changed.`,
      );
    }

    // A signed-in account that is not Active cannot have its password changed
    // through the console either, so it is listed rather than silently skipped.
    for (const account of accounts) {
      console.log(`  ${String(account.name)} <${String(account.email)}> — ${String(account.role)}, ${String(account.status)}`);
    }

    const liveSessions = await client.query(
      every
        ? 'SELECT count(*)::int AS total FROM admin_sessions WHERE expires_at > NOW()'
        : `SELECT count(*)::int AS total FROM admin_sessions
             WHERE user_id = $1 AND expires_at > NOW()`,
      every ? [] : [accounts[0].id],
    );
    console.log(`\nLive sessions that will be signed out: ${liveSessions.rows[0]?.total ?? 0}`);

    if (holdUntil) {
      // Stated before the confirmation, because this is the one decision that
      // silently disables a safety net: the password below is not rotated for the
      // rest of this window, and whoever confirms has to know that.
      console.log(`\nPassword hold: the rotation will leave this password alone until ${holdUntil.toISOString()}.`);
      console.log('After that moment the normal 7-day rotation resumes and a new password is generated and mailed to the owner.');
    }

    if (!hasFlag('yes')) {
      const answer = await ask(`\nReset the password for ${accounts.length} account${accounts.length === 1 ? '' : 's'}? Type "reset" to continue: `);
      if (answer !== 'reset') {
        console.log('Cancelled. Nothing was changed.');
        return;
      }
    }

    const password = await resolvePassword();
    checkPasswordPolicy(password);

    // Same hashing the sign-in path uses, so the new value is indistinguishable
    // from one set through the console.
    const passwordHash = await hashPassword(password);

    // The rotation clock restarts with the password. The owner account is
    // replaced every 7 days by a schedule, so a reset that left the old stamp in
    // place could see a password chosen by hand replaced by a generated one the
    // next day, before anybody had read it.
    //
    // `password_hold_until` is written in the same statement so the two cannot
    // disagree. With a hold in place the rotation ignores the stamp entirely and
    // waits for the date; without one the stamp is what governs, and a hold left
    // over from a previous run is cleared rather than allowed to keep exempting a
    // password nobody is watching for.
    await client.query(
      'UPDATE admin_users SET password_hash = $1, password_rotated_at = NOW(), password_hold_until = $3, updated_at = NOW() WHERE id = ANY($2::uuid[])',
      [passwordHash, accounts.map((account) => account.id), holdUntil],
    );

    // Every session, including any this reset was made from.
    await client.query(
      every
        ? 'DELETE FROM admin_sessions'
        : 'DELETE FROM admin_sessions WHERE user_id = $1',
      every ? [] : [accounts[0].id],
    );

    // A password reset must not leave a usable reset link behind, or whoever
    // asked for one could walk straight back in with it.
    await client.query(
      'UPDATE password_resets SET used_at = NOW() WHERE user_id = ANY($1::uuid[]) AND used_at IS NULL',
      [accounts.map((account) => account.id)],
    );

    const remaining = every
      ? await client.query('SELECT count(*)::int AS total FROM admin_sessions')
      : await client.query('SELECT count(*)::int AS total FROM admin_sessions WHERE user_id = $1', [accounts[0].id]);

    console.log(`\nPassword updated for ${accounts.length} account${accounts.length === 1 ? '' : 's'}.`);
    console.log(`Sessions signed out: ${liveSessions.rows[0]?.total ?? 0} (remaining: ${remaining.rows[0]?.total ?? 0}).`);
    console.log('Unused reset links for these accounts have been cancelled.');
    if (holdUntil) {
      // The operator has to leave knowing this password has an end date and a
      // replacement they did not choose, because from then on they do not have
      // the owner password at all.
      console.log(`\nHeld until ${holdUntil.toISOString()}. The rotation checks once a day, so the reset lands`);
      console.log('on the first check after that moment rather than at that moment exactly.');
      console.log('The replacement is written to email_outbox, which is where the console reads it from.');
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFailed: ${message}`);
  process.exitCode = 1;
});
