import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  ownerCredentialsMessage,
  ownerPasswordSavedMessage,
  saveOwnerPassword,
} from './owner-password';
import { generateOwnerPassword, generateStrongPassword, passwordPolicy, verifyPassword } from './passwords';
import { superAdminEmail, superAdminRole } from '../../auth/roles';
import type { Database, QueryResult } from '../handlers';

const now = new Date('2026-03-10T09:00:00.000Z');

type OwnerRow = {
  id: string;
  email: string;
  role: string;
  password_hash: string;
  updated_at: Date | null;
};

const ownerId = '00000000-0000-4000-8000-0000000000f1';

/**
 * A database holding one owner row, some sessions and the outbox.
 *
 * The point of these tests is what a save writes, so the fake keeps the values it
 * is given rather than answering with shapes alone. Rows are copied out rather
 * than handed over, because a real result set is a snapshot: without that the save
 * would read back the same object its own UPDATE has just mutated.
 */
function ownerDatabase(options: { owner?: OwnerRow | null; sessions?: number } = {}) {
  const rows: OwnerRow[] = options.owner === null
    ? []
    : [options.owner ?? {
        id: ownerId,
        email: superAdminEmail,
        role: superAdminRole,
        password_hash: 'scrypt$old$hash',
        updated_at: null,
      }];
  const outbox: Array<{ kind: string; recipient: string; subject: string; body: string }> = [];
  const queries: string[] = [];
  let sessions = options.sessions ?? 2;
  const database = {
    query: vi.fn(async (text: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(text);
      if (text.includes('INSERT INTO email_outbox')) {
        outbox.push({ kind: 'owner-credentials', recipient: String(values[0]), subject: String(values[1]), body: String(values[2]) });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM email_outbox')) {
        return { rows: outbox.map((message) => ({ body: message.body })), rowCount: outbox.length };
      }
      if (text.includes('DELETE FROM admin_sessions')) {
        const before = sessions;
        sessions = 0;
        return { rows: [], rowCount: before };
      }
      if (text.includes('UPDATE admin_users SET password_hash')) {
        rows[0].password_hash = String(values[0]);
        rows[0].updated_at = values[1] as Date;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM admin_users')) {
        return rows.length > 0
          ? { rows: rows.map((row) => ({ ...row })), rowCount: rows.length }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
  } satisfies Database;
  return { database, rows, outbox, queries, sessionsLeft: () => sessions };
}

describe('the generated owner password', () => {
  it('is the length the screen promises', () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      expect(generateOwnerPassword()).toHaveLength(8);
    }
  });

  it('satisfies the policy it will be stored under', () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const password = generateOwnerPassword();
      expect(password.length).toBeGreaterThanOrEqual(passwordPolicy.minLength);
      expect(password.length).toBeLessThanOrEqual(passwordPolicy.maxLength);
    }
  });

  it('always carries at least one letter and one digit', () => {
    // Eight characters is short enough that an all-letter result is a much smaller
    // space than the nominal one, and the field is editable, so somebody is likely
    // to add a digit by hand rather than start again.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const password = generateOwnerPassword();
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
    }
  });

  it('leaves out characters that are easy to misread', () => {
    // This one is read off a screen and typed back in by hand.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect(generateOwnerPassword()).not.toMatch(/[Il1O0]/);
    }
  });

  it('is different every time it is called', () => {
    const generated = new Set(Array.from({ length: 200 }, () => generateOwnerPassword()));
    expect(generated.size).toBe(200);
  });

  it('honours a longer length but never falls under the policy floor', () => {
    expect(generateOwnerPassword(20)).toHaveLength(20);
    expect(generateOwnerPassword(4)).toHaveLength(passwordPolicy.minLength);
  });
});

describe('the seed password, which is the only one that still travels by mail', () => {
  it('carries the password, the address and where to use it', () => {
    const message = ownerCredentialsMessage({ password: 'K7mQ2xRt', role: superAdminRole, now });
    expect(message.body).toContain('Password: K7mQ2xRt');
    expect(message.body).toContain(superAdminEmail);
    expect(message.body).toContain('/login');
  });

  it('says the password does not expire on its own, which is the change that replaced rotation', () => {
    const message = ownerCredentialsMessage({ password: 'K7mQ2xRt', role: superAdminRole, now });
    expect(message.body).toMatch(/does not change on its own/);
    // The old wording promised a date the password would be replaced on. Leaving a
    // stale promise in a mail somebody keeps would be worse than saying nothing.
    expect(message.body).not.toMatch(/next rotation|rotat/i);
  });
});

describe('saving the owner password', () => {
  it('stores the value that was handed back, so the field and the login agree', async () => {
    const { database, rows } = ownerDatabase();

    const result = await saveOwnerPassword(database, 'K7mQ2xRt', now);

    expect(result).toMatchObject({ saved: true, userId: ownerId, email: superAdminEmail });
    expect(await verifyPassword('K7mQ2xRt', rows[0].password_hash)).toBe(true);
    expect(await verifyPassword('scrypt$old$hash', rows[0].password_hash)).toBe(false);
  });

  it('hashes rather than storing, and never echoes the value back', async () => {
    const { database, rows } = ownerDatabase();

    await saveOwnerPassword(database, 'K7mQ2xRt', now);

    expect(rows[0].password_hash).not.toContain('K7mQ2xRt');
    expect(rows[0].password_hash.startsWith('scrypt$')).toBe(true);
  });

  it('refuses a password the sign-in form would refuse, before touching the row', async () => {
    const { database, rows, queries } = ownerDatabase();

    await expect(saveOwnerPassword(database, 'short')).rejects.toThrow(/at least 8 characters/);
    // Nothing written, no session ended: a rejected save has to leave the account
    // exactly as it was, or the owner is locked out by a typo.
    expect(rows[0].password_hash).toBe('scrypt$old$hash');
    expect(queries.some((query) => query.includes('UPDATE admin_users'))).toBe(false);
    expect(queries.some((query) => query.includes('DELETE FROM admin_sessions'))).toBe(false);
  });

  it('signs every session out, because the old password has stopped working', async () => {
    const { database, sessionsLeft } = ownerDatabase({ sessions: 4 });

    const result = await saveOwnerPassword(database, 'K7mQ2xRt', now);

    expect(result).toMatchObject({ saved: true, sessionsRevoked: 4 });
    expect(sessionsLeft()).toBe(0);
  });

  it('queues a confirmation for the owner address and nowhere else', async () => {
    const { database, outbox } = ownerDatabase();

    await saveOwnerPassword(database, 'K7mQ2xRt', now);

    expect(outbox).toHaveLength(1);
    expect(outbox[0].recipient).toBe(superAdminEmail);
    expect(outbox[0].subject).toMatch(/saved/i);
  });

  it('keeps the password out of the confirmation entirely', async () => {
    // The whole reason this can be forwarded, kept and read years later. A
    // confirmation that carried the credential would be a working login sitting in
    // a mailbox, which is what the mail it replaced used to be.
    const { database, outbox } = ownerDatabase();

    await saveOwnerPassword(database, 'K7mQ2xRt', now);

    expect(outbox[0].body).not.toContain('K7mQ2xRt');
    expect(outbox[0].body).not.toMatch(/Password:/);
    expect(outbox[0].body).toContain(now.toISOString());
    expect(outbox[0].body).toMatch(/Every session/);
  });

  it('reports a deployment with no owner row rather than inventing one', async () => {
    const { database, outbox, queries } = ownerDatabase({ owner: null });

    expect(await saveOwnerPassword(database, 'K7mQ2xRt', now)).toEqual({ saved: false, reason: 'missing' });
    expect(outbox).toHaveLength(0);
    // It still looked, rather than deciding from an assumption.
    expect(queries.some((query) => query.includes('FROM admin_users'))).toBe(true);
  });

  it('is stamped with the moment it was saved', async () => {
    const { database, rows } = ownerDatabase();
    await saveOwnerPassword(database, 'K7mQ2xRt', now);
    expect(rows[0].updated_at?.toISOString()).toBe(now.toISOString());
  });
});

describe('the saved-password confirmation', () => {
  it('names the role, the date and the way in, and no password', () => {
    const message = ownerPasswordSavedMessage({ role: superAdminRole, now });
    expect(message.body).toContain(superAdminRole);
    expect(message.body).toContain(now.toISOString());
    expect(message.body).toContain(superAdminEmail);
    expect(message.body).toContain('/login');
    expect(message.body).not.toMatch(/Password:\s*\S/);
  });

  it('tells the reader what to do if it was not them', () => {
    // The address is the way into the console, so an unexplained change to it is
    // the one thing in this mail worth acting on.
    const message = ownerPasswordSavedMessage({ role: superAdminRole, now });
    expect(message.body).toMatch(/did not do this/i);
  });
});

describe('the stronger password the rest of the project uses', () => {
  it('is unchanged - this flow did not touch it', () => {
    // The owner password is short on purpose. Everything else - team members,
    // signups, resets - still gets the long generated one, and the two must not
    // have been merged by accident.
    expect(generateStrongPassword()).toHaveLength(24);
  });
});