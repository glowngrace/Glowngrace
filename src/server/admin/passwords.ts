import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';

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

export function newSessionToken() {
  return randomUUID();
}

export function sessionExpiry(now: Date = new Date()) {
  return new Date(now.getTime() + 12 * 60 * 60 * 1000);
}
