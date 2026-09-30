import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { demoPassword } from '../../lib/demo-credentials.js';

const KEY_LENGTH = 64;
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISATION = 1;
const SALT_BYTES = 16;
const PREFIX = 'scrypt';

export type PasswordPolicy = {
  minLength: number;
  maxLength: number;
};

export const passwordPolicy: PasswordPolicy = { minLength: 8, maxLength: 128 };

/**
 * The credential every sample account and every seeded console account uses.
 *
 * It is deliberately the same value the storefront demo sign-in uses, so one
 * password opens both. At 7 characters it is shorter than
 * `passwordPolicy.minLength`, which is why no form may choose it: it is only
 * ever written by a recovery action, and `recoverablePasswordError` is the
 * single check that permits it.
 */
export { demoPassword };

/**
 * The salted scrypt hash of `demoPassword`, for the rows that have to exist
 * before anybody can sign in. A hash rather than the value itself, so the
 * migration files never contain a usable password.
 */
export const demoPasswordHash =
  'scrypt$16384$8$1$8ad60c22a397f20a36e452887332fea3$b91fbd9edb011c0c620edfc8638f3b18c9128e24492126f98a960e81a3f003280c3ba4e74e2deb31e51f3004ba8c5aaf2dda974cd40e54c376a307f3842f6fae';

/** Why the policy rejects this password, or `null` when it accepts it. */
export function passwordPolicyError(password: string) {
  if (password.length < passwordPolicy.minLength) return `Use at least ${passwordPolicy.minLength} characters.`;
  if (password.length > passwordPolicy.maxLength) return `Use at most ${passwordPolicy.maxLength} characters.`;
  return null;
}

/**
 * The policy check for a recovery action.
 *
 * Recovery is how a locked-out administrator or the demo state is put back, so
 * it additionally accepts the published demo password. Without this the demo
 * credential could never be restored: every password-setting path enforces
 * `minLength`, and `demo123` is 7 characters.
 */
export function recoverablePasswordError(password: string) {
  if (password === demoPassword) return null;
  return passwordPolicyError(password);
}

type DeriveOptions = { N: number; r: number; p: number };

function derive(password: string, salt: string, options: DeriveOptions = { N: COST, r: BLOCK_SIZE, p: PARALLELISATION }) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}


export async function hashPassword(password: string) {
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derived = await derive(password, salt);
  return [PREFIX, COST, BLOCK_SIZE, PARALLELISATION, salt, derived.toString('hex')].join('$');
}

export async function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;
  const [, cost, blockSize, parallelisation, salt, expected] = parts;
  const expectedBytes = Buffer.from(expected, 'hex');
  if (expectedBytes.length !== KEY_LENGTH) return false;
  const derived = await derive(password, salt, {
    N: Number(cost) || COST,
    r: Number(blockSize) || BLOCK_SIZE,
    p: Number(parallelisation) || PARALLELISATION,
  });
  const sameLength = derived.length === expectedBytes.length;
  return sameLength && timingSafeEqual(derived, expectedBytes);
}

/**
 * The console session is deliberately short. An unattended browser should not
 * stay signed into the back office for the length of a working day, so the
 * session simply ends and the operator signs in again.
 */
export const sessionDurationMinutes = 5;

export function newSessionToken() {
  return randomUUID();
}

export function sessionExpiry(now: Date = new Date()) {
  return new Date(now.getTime() + sessionDurationMinutes * 60 * 1000);
}

const RESET_TOKEN_BYTES = 32;

/** A reset link is a bearer secret, so it lives for minutes rather than hours. */
export const resetTokenMinutes = 60;

export function newResetToken() {
  return randomBytes(RESET_TOKEN_BYTES).toString('hex');
}

export function resetTokenExpiry(now: Date = new Date()) {
  return new Date(now.getTime() + resetTokenMinutes * 60 * 1000);
}

/**
 * A reset token is hashed with the same scrypt parameters as a password, so a
 * database leak cannot be replayed as a working reset link.
 *
 * The digest is salted, which means it cannot be used to find the row. The
 * `token_lookup` column added by db/migrations/009 holds a plain SHA-256 of the
 * same token purely to locate the candidate row, and the scrypt hash beside it
 * is what actually decides whether the token is correct. SHA-256 is safe here
 * because the input is 32 bytes of `randomBytes`, not a guessable password.
 */
export async function hashResetToken(token: string) {
  return { tokenHash: await hashPassword(token), tokenLookup: resetTokenLookup(token) };
}

/**
 * The cheap half of `hashResetToken`, for the side that only has to find the
 * row.
 *
 * Redeeming a token is an unauthenticated route, so it must not run scrypt on
 * every request just to discover that a token was not found. Verification still
 * happens, against the scrypt hash, once a row has been located.
 */
export function resetTokenLookup(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
