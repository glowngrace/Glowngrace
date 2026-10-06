import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

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

/** Why the policy rejects this password, or `null` when it accepts it. */
export function passwordPolicyError(password: string) {
  if (password.length < passwordPolicy.minLength) return `Use at least ${passwordPolicy.minLength} characters.`;
  if (password.length > passwordPolicy.maxLength) return `Use at most ${passwordPolicy.maxLength} characters.`;
  return null;
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
 * The password the console used to be seeded with, and the only thing it is
 * still allowed to be used for.
 *
 * It never authenticates anything. It exists so the seed can recognise a row
 * that is still sitting on the published credential and replace it, which is the
 * one thing a migration cannot do: `hashPassword` salts every value, so "is this
 * row still the demo one?" cannot be answered by comparing hash strings. The salt
 * differs on every row in every database, so a hardcoded hash would only ever
 * match the single row it was copied from.
 */
export const removedDemoPassword = 'demo123';

/**
 * The console session is deliberately short. An unattended browser should not
 * stay signed into the back office for the length of a working day, so the
 * session simply ends and the operator signs in again.
 */
export const sessionDurationMinutes = 10;

const GENERATED_PASSWORD_LENGTH = 24;
const GENERATED_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?';

/**
 * A password nobody chose, for an account nobody signs into by remembering.
 *
 * Two of each character class are dealt unconditionally and the rest come from
 * the CSPRNG, so the result cannot be all one kind of character no matter how
 * the bytes fall. Ambiguous glyphs are left out of the alphabet: this is read off
 * a screen and typed back in by hand.
 */
export function generateStrongPassword(length: number = GENERATED_PASSWORD_LENGTH): string {
  const size = Math.max(length, 12);
  const required = 'ABCDEFGHJKLMNPQRSTUVWXYZ'.slice(0, 2) + 'abcdefghijkmnopqrstuvwxyz'.slice(0, 2) + '23456789'.slice(0, 2);
  const characters = [...required];
  while (characters.length < size) {
    characters.push(GENERATED_ALPHABET[randomBytes(1)[0] % GENERATED_ALPHABET.length]);
  }
  // Fisher-Yates with the CSPRNG, so the dealt characters are not always first.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomBytes(1)[0] % (index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  const password = characters.join('');
  return passwordPolicyError(password) === null ? password : generateStrongPassword(size);
}

/**
 * The owner's password: eight characters a person reads off a screen and types
 * back in.
 *
 * Eight characters is a deliberate trade, and it is why this is not the
 * digits-only code the screen asks for in words. Eight numbers is 10^8 - a range
 * an online attempt walks through in hours - while eight characters drawn from
 * this alphabet is about 2.8e14. Both are short enough to read aloud, and only
 * one of them is worth putting on an account that cannot be locked out of its own
 * deployment.
 *
 * The alphabet leaves out every glyph that is hard to tell from another at a
 * glance or in a screenshot - `0`/`O`, `1`/`I`/`l` - because the whole point of a
 * short password is that it survives the trip through a human being. One letter
 * and one digit are dealt unconditionally so the result cannot come out as eight
 * letters, and the deal is then shuffled with a CSPRNG Fisher-Yates, so the
 * guaranteed characters are not always in the same two places.
 */
const OWNER_PASSWORD_LENGTH = 8;
const OWNER_PASSWORD_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const OWNER_PASSWORD_DIGITS = '23456789';
const OWNER_PASSWORD_ALPHABET = OWNER_PASSWORD_LETTERS + OWNER_PASSWORD_DIGITS;

export function generateOwnerPassword(length: number = OWNER_PASSWORD_LENGTH): string {
  const size = Math.max(length, passwordPolicy.minLength);
  const characters = [
    OWNER_PASSWORD_LETTERS[randomBytes(1)[0] % OWNER_PASSWORD_LETTERS.length],
    OWNER_PASSWORD_DIGITS[randomBytes(1)[0] % OWNER_PASSWORD_DIGITS.length],
  ];
  while (characters.length < size) {
    characters.push(OWNER_PASSWORD_ALPHABET[randomBytes(1)[0] % OWNER_PASSWORD_ALPHABET.length]);
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomBytes(1)[0] % (index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }
  return characters.join('');
}

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
 * `token_lookup` column holds a plain SHA-256 of the
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
