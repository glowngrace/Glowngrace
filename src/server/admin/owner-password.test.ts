import { describe, expect, it, vi } from 'vitest';
import {
  ownerRotationCheckMs,
  rotateOwnerPassword,
  rotateOwnerPasswordIfDue,
  startOwnerPasswordRotation,
} from './owner-password';
import { generateStrongPassword, passwordPolicy, superAdminRotationDays, verifyPassword } from './passwords';
import { superAdminEmail, superAdminRole } from '../../auth/roles';
import type { Database, QueryResult } from '../handlers';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-03-10T09:00:00.000Z');

type OwnerRow = {
  id: string;
  email: string;
  role: string;
  password_hash: string;
  password_rotated_at: Date | null;
};

const ownerId = '00000000-0000-4000-8000-0000000000f1';

/**
 * A database holding one owner row, one session and the outbox.
 *
 * The point of these tests is what the rotation writes, so the fake keeps the
 * values it is given rather than answering with shapes alone.
 */
function ownerDatabase(rotatedAt: Date | null) {
  const rows: OwnerRow[] = [{ id: ownerId, email: superAdminEmail, role: superAdminRole, password_hash: 'scrypt$old$hash', password_rotated_at: rotatedAt }];
  const outbox: Array<{ kind: string; recipient: string; subject: string; body: string }> = [];
  const queries: string[] = [];
  let sessions = 2;
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
        rows[0].password_rotated_at = values[1] as Date;
        return { rows: [], rowCount: 1 };
      }
      // The due check and the existence check share this shape.
      if (text.includes('password_rotated_at <= $2')) {
        const cutoff = values[1] as Date;
        const due = rows[0].password_rotated_at === null || rows[0].password_rotated_at.getTime() <= cutoff.getTime();
        return { rows: due ? [{ id: ownerId }] : [], rowCount: due ? 1 : 0 };
      }
      if (text.includes('FROM admin_users')) {
        return rows.length > 0 ? { rows, rowCount: rows.length } : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
  } satisfies Database;
  return { database, rows, outbox, queries, sessionsLeft: () => sessions };
}

describe('generated owner password', () => {
  it('satisfies the policy it will be stored under', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const password = generateStrongPassword();
      expect(password.length).toBeGreaterThanOrEqual(passwordPolicy.minLength);
      expect(password.length).toBeLessThanOrEqual(passwordPolicy.maxLength);
      // A mix of classes, so a glance at the outbox message is not a giveaway
      // about how the next one will look.
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
    }
  });

  it('is different every time it is called', () => {
    const generated = new Set(Array.from({ length: 50 }, () => generateStrongPassword()));
    expect(generated.size).toBe(50);
  });

  it('leaves out characters that are easy to misread', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      // This one is read off a screen and typed back in by hand.
      expect(generateStrongPassword()).not.toMatch(/[Il1O0]/);
    }
  });

  it('honours a longer length but never falls under a sane floor', () => {
    expect(generateStrongPassword(40)).toHaveLength(40);
    expect(generateStrongPassword(4)).toHaveLength(12);
  });
});

describe('owner password rotation', () => {
  it('replaces the stored hash with a password that actually works', async () => {
    const { database, rows } = ownerDatabase(now);
    const result = await rotateOwnerPassword(database, now);

    expect(result.rotated).toBe(true);
    const stored = rows[0].password_hash;
    expect(stored).not.toBe('scrypt$old$hash');
    // The new password is the one the owner was told, which is the only way the
    // message in the outbox can be of any use.
    const mailed = result.rotated ? /Password: (\S+)/.exec(await readOutbox(database)) : null;
    expect(mailed).not.toBeNull();
    expect(await verifyPassword(mailed![1], stored)).toBe(true);
    expect(await verifyPassword('scrypt$old$hash', stored)).toBe(false);
  });

  it('stamps the moment of the rotation, so the next one is a week away', async () => {
    const { database, rows } = ownerDatabase(new Date('2026-01-01T00:00:00.000Z'));
    await rotateOwnerPassword(database, now);
    expect(rows[0].password_rotated_at?.toISOString()).toBe(now.toISOString());
  });

  it('signs every session out, because the old password has stopped working', async () => {
    const { database, sessionsLeft } = ownerDatabase(now);
    const result = await rotateOwnerPassword(database, now);
    expect(result.rotated && result.sessionsRevoked).toBe(2);
    expect(sessionsLeft()).toBe(0);
  });

  it('mails the new password to the owner address and nowhere else', async () => {
    const { database, outbox } = ownerDatabase(now);
    await rotateOwnerPassword(database, now);

    expect(outbox).toHaveLength(1);
    expect(outbox[0].recipient).toBe(superAdminEmail);
    // A credential is in here, so it is filed as one and not as a reset link.
    expect(outbox[0].kind).toBe('owner-credentials');
    expect(outbox[0].body).toContain(superAdminEmail);
    expect(outbox[0].body).toContain('/login');
    // The date the next rotation happens is stated, so a stale copy is obvious.
    expect(outbox[0].body).toContain(new Date(now.getTime() + superAdminRotationDays * DAY_MS).toISOString());
  });

  it('rotates again only once a week has passed', async () => {
    const yesterday = new Date(now.getTime() - DAY_MS);
    const { database, queries } = ownerDatabase(yesterday);

    const result = await rotateOwnerPasswordIfDue(database, now);

    expect(result).toEqual({ rotated: false, reason: 'not-due' });
    expect(queries.some((query) => query.includes('UPDATE admin_users SET password_hash'))).toBe(false);
  });

  it('rotates as soon as the week is up', async () => {
    const justOverdue = new Date(now.getTime() - superAdminRotationDays * DAY_MS - 60_000);
    const { database, rows } = ownerDatabase(justOverdue);

    const result = await rotateOwnerPasswordIfDue(database, now);

    expect(result.rotated).toBe(true);
    expect(rows[0].password_rotated_at?.toISOString()).toBe(now.toISOString());
  });

  it('rotates an account that has never been rotated, rather than treating it as new', async () => {
    const { database, rows } = ownerDatabase(null);

    const result = await rotateOwnerPasswordIfDue(database, now);

    expect(result.rotated).toBe(true);
    expect(rows[0].password_rotated_at?.toISOString()).toBe(now.toISOString());
  });

  it('does nothing at all when the owner row is absent', async () => {
    const { database, outbox } = ownerDatabase(now);
    const asked: string[] = [];
    const withoutOwner = { query: vi.fn(async (text: string) => {
      asked.push(text);
      if (text.includes('FROM admin_users')) return { rows: [], rowCount: 0 };
      return database.query(text);
    }) } satisfies Database;

    const result = await rotateOwnerPasswordIfDue(withoutOwner, now);

    // A deployment mid-migration has no owner row yet, and that is not a failure
    // to report: the next tick after the seed will find it.
    expect(result).toEqual({ rotated: false, reason: 'missing' });
    expect(outbox).toHaveLength(0);
    // It still looked, rather than deciding from an assumption.
    expect(asked.some((query) => query.includes('password_rotated_at <= $2'))).toBe(true);
  });

  it('checks once a day so a server that was down catches up on its first tick', () => {
    expect(ownerRotationCheckMs).toBeLessThan(superAdminRotationDays * DAY_MS);
  });

  it('rotates on start and keeps checking, and can be stopped', async () => {
    vi.useFakeTimers();
    try {
      const { database, outbox } = ownerDatabase(new Date(now.getTime() - 30 * DAY_MS));
      const schedule = startOwnerPasswordRotation(database, { now: () => now });

      // The first tick is not left for tomorrow.
      await vi.waitFor(() => expect(outbox).toHaveLength(1));

      await vi.advanceTimersByTimeAsync(ownerRotationCheckMs);
      expect(outbox).toHaveLength(1);

      schedule.stop();
      await vi.advanceTimersByTimeAsync(ownerRotationCheckMs * 3);
      expect(outbox).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the schedule alive when one rotation fails', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      let attempts = 0;
      const database = {
        query: vi.fn(async (): Promise<QueryResult> => {
          attempts += 1;
          throw new Error('the database is not ready');
        }),
      } satisfies Database;
      const schedule = startOwnerPasswordRotation(database, { now: () => now });

      await vi.waitFor(() => expect(attempts).toBe(1));
      // A transient failure must not stop tomorrow's attempt.
      await vi.advanceTimersByTimeAsync(ownerRotationCheckMs);
      expect(attempts).toBe(2);
      schedule.stop();
    } finally {
      logged.mockRestore();
      vi.useRealTimers();
    }
  });
});

/** Reads the message back out of the fake, the way an operator would. */
async function readOutbox(database: Database) {
  const result = await database.query("SELECT body FROM email_outbox WHERE kind = 'owner-credentials'");
  return String(result.rows[0]?.body ?? '');
}
