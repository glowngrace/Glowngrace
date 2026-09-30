import 'dotenv/config';
import { createInterface } from 'node:readline';
import { Client } from 'pg';
import { demoPassword, hashPassword, recoverablePasswordError } from '../src/server/admin/passwords.js';
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
 * never written to disk: it comes from ADMIN_RESET_PASSWORD or from a masked
 * prompt. Every live session for the accounts is destroyed, because the point of
 * a reset is usually that the old password is no longer trustworthy.
 *
 * Production, one account:
 *   npx tsx scripts/reset-admin-password.ts --email admin@glowngrace.in
 *
 * Production, every account:
 *   ADMIN_RESET_PASSWORD=demo123 npx tsx scripts/reset-admin-password.ts --all
 *
 * Local development:
 *   npx tsx scripts/reset-admin-password.ts --all --allow-local
 *
 * Add --yes to skip the confirmation. The password is held to the same
 * standard as the console's recovery action, which is what lets the published
 * sample password be restored without weakening every other form.
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
  const fromEnv = process.env.ADMIN_RESET_PASSWORD;
  if (fromEnv !== undefined) {
    console.log('Password read from ADMIN_RESET_PASSWORD.');
    return fromEnv;
  }
  const first = await askHidden('New password (input hidden): ');
  const second = await askHidden('Confirm new password (input hidden): ');
  if (first !== second) throw new Error('The two entries did not match. Nothing was changed.');
  return first;
}

function checkPasswordPolicy(password: string) {
  // Deliberately the recovery rule, not the ordinary one. This script exists for
  // the case where the console is unreachable, and refusing the published
  // sample password here would make it impossible to put a demo deployment back
  // the way it was documented.
  const problem = recoverablePasswordError(password);
  if (problem) throw new Error(`${problem} Nothing was changed.`);
  if (password === demoPassword) {
    console.log('\nWarning: this is the published sample password. Anyone who has read the README can sign in.');
  }
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

    await client.query(
      'UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])',
      [passwordHash, accounts.map((account) => account.id)],
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
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nFailed: ${message}`);
  process.exitCode = 1;
});
