import { describe, expect, it, vi } from 'vitest';
import {
  deliverOutboxMessage,
  deliverPendingMail,
  isDeliverable,
  mailConfigFromEnv,
  startMailDelivery,
  tryDeliverPendingMail,
  type MailConfig,
  type OutboxMessage,
} from './mailer';
import { retiredSuperAdminEmail, superAdminEmail } from '../auth/roles';
import type { Database } from './handlers';

const config: MailConfig = {
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'postmaster@example.com',
  password: 'a-secret',
  from: 'postmaster@example.com',
};

const ownerMessage: OutboxMessage = {
  id: 'm1',
  kind: 'owner-credentials',
  recipient: superAdminEmail,
  subject: 'Your new Glow & Grace owner password',
  body: 'Password: a-generated-password',
};

function outboxDatabase(rows: Array<Partial<OutboxMessage> & { id: string }>) {
  const marked: string[] = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    if (text.includes('FROM email_outbox')) {
      return { rows: rows.filter((row) => row.kind === values[0]), rowCount: rows.length };
    }
    if (text.includes('UPDATE email_outbox SET sent_at')) {
      marked.push(String(values[1]));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return { database: { query } satisfies Database, query, marked };
}

describe('smtp configuration', () => {
  it('needs a host, a user and a password before it will send anything', () => {
    expect(mailConfigFromEnv({})).toBeNull();
    expect(mailConfigFromEnv({ SMTP_HOST: 'smtp.example.com' })).toBeNull();
    expect(mailConfigFromEnv({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@b.c' })).toBeNull();
    expect(mailConfigFromEnv({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@b.c', SMTP_PASSWORD: 'x' })).not.toBeNull();
  });

  it('treats port 465 as implicit TLS and negotiates STARTTLS everywhere else', () => {
    const base = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'a@b.c', SMTP_PASSWORD: 'x' };
    expect(mailConfigFromEnv({ ...base, SMTP_PORT: '465' })?.secure).toBe(true);
    expect(mailConfigFromEnv({ ...base, SMTP_PORT: '587' })?.secure).toBe(false);
    expect(mailConfigFromEnv({ ...base })?.port).toBe(587);
    expect(mailConfigFromEnv({ ...base, SMTP_SECURE: 'true', SMTP_PORT: '587' })?.secure).toBe(true);
  });

  it('sends as the authenticated mailbox unless a sender is named', () => {
    const base = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'postmaster@example.com', SMTP_PASSWORD: 'x' };
    expect(mailConfigFromEnv(base)?.from).toBe('postmaster@example.com');
    expect(mailConfigFromEnv({ ...base, MAIL_FROM: 'no-reply@glowandgrace.in' })?.from).toBe('no-reply@glowandgrace.in');
  });
});

describe('what may be emailed', () => {
  it('sends the owner credential to the owner address', () => {
    expect(isDeliverable(ownerMessage)).toBe(true);
    expect(isDeliverable({ ...ownerMessage, recipient: superAdminEmail.toUpperCase() })).toBe(true);
  });

  it('refuses the address the owner account used to be spelled with', () => {
    // The owner address was misspelled until this branch and the row was renamed
    // to match. A credential addressed to the old spelling would reach a mailbox
    // that is not the one holding the console, and would arrive looking exactly
    // like a delivery that worked - so it has to be refused rather than sent.
    expect(retiredSuperAdminEmail).not.toBe(superAdminEmail);
    expect(isDeliverable({ ...ownerMessage, recipient: retiredSuperAdminEmail })).toBe(false);
  });

  it('refuses a password addressed to anybody else', () => {
    // The whole point of the scope: one address may receive a working password,
    // and a message that went elsewhere would be a credential in the wrong hands.
    expect(isDeliverable({ ...ownerMessage, recipient: 'someone.else@example.com' })).toBe(false);
    expect(isDeliverable({ ...ownerMessage, recipient: 'attacker@evil.example' })).toBe(false);
  });

  it('refuses every other kind of message, whatever it contains', () => {
    expect(isDeliverable({ kind: 'password-reset', recipient: superAdminEmail } as never)).toBe(false);
    expect(isDeliverable({ kind: 'signup', recipient: superAdminEmail } as never)).toBe(false);
  });
});

describe('delivering a message', () => {
  it('sends the owner credential over the transport', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '1' }));
    const outcome = await deliverOutboxMessage(ownerMessage, config, { sendMail });

    expect(outcome).toEqual({ delivered: true, id: 'm1' });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'postmaster@example.com',
      to: superAdminEmail,
      subject: ownerMessage.subject,
      text: ownerMessage.body,
    });
  });

  it('does nothing when no transport is configured, and says so', async () => {
    // A local checkout has no SMTP settings, and the rotation must not fail over it.
    const sendMail = vi.fn(async () => ({ messageId: '1' }));
    const outcome = await deliverOutboxMessage(ownerMessage, null, { sendMail });

    expect(outcome).toEqual({ delivered: false, id: 'm1', reason: 'not_configured' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('refuses to send a message of another kind even when a transport is available', async () => {
    const sendMail = vi.fn(async () => ({ messageId: '1' }));
    const reset = { ...ownerMessage, id: 'm2', kind: 'password-reset', recipient: 'reha@example.com' };

    expect(await deliverOutboxMessage(reset, config, { sendMail })).toEqual({ delivered: false, id: 'm2', reason: 'wrong_kind' });
    expect(await deliverOutboxMessage({ ...ownerMessage, id: 'm3', recipient: 'attacker@evil.example' }, config, { sendMail }))
      .toEqual({ delivered: false, id: 'm3', reason: 'wrong_recipient' });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('reports a transport failure instead of throwing, so the rotation survives it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const sendMail = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
      const outcome = await deliverOutboxMessage(ownerMessage, config, { sendMail });

      expect(outcome).toEqual({ delivered: false, id: 'm1', reason: 'send_failed' });
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('the delivery pass', () => {
  it('only ever picks up the owner credential', async () => {
    const { database, query } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
      { id: 'm2', kind: 'signup', recipient: 'reha@example.com', subject: 's', body: 'b' },
      { id: 'm3', kind: 'password-reset', recipient: 'deepak@glowngrace.in', subject: 's', body: 'b' },
    ]);
    const sendMail = vi.fn(async (options: { to: string }) => ({ messageId: options.to }));

    const result = await deliverPendingMail(database, { config, transport: { sendMail } });

    expect(result.attempted).toBe(1);
    expect(result.delivered).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0].to).toBe(superAdminEmail);
    // The kind is a parameter rather than an interpolation, so the query cannot
    // carry one in.
    expect(String(query.mock.calls[0][0])).toContain('$1');
  });

  it('never considers a superseded credential, because its password no longer works', async () => {
    // The queue is asked for only the newest message of the kind. If the transport
    // was down across two rotations, both rows would otherwise be pending, and the
    // older one holds a password that has already been replaced.
    const { database, query } = outboxDatabase([
      { id: 'older', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'stale' },
      { id: 'newer', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'live' },
    ]);
    const sendMail = vi.fn(async () => ({ messageId: '1' }));

    await deliverPendingMail(database, { config, transport: { sendMail } });

    const sql = String(query.mock.calls[0][0]);
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toMatch(/newer\.created_at/);
  });

  it('marks a sent message so it is never sent twice', async () => {
    const { database, marked } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
    ]);
    const sendMail = vi.fn(async () => ({ messageId: '1' }));

    await deliverPendingMail(database, { config, transport: { sendMail } });

    expect(marked).toEqual(['m1']);
  });

  it('leaves a failed message queued, because it is the only copy of the password', async () => {
    const { database, marked } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
    ]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const sendMail = vi.fn(async () => { throw new Error('mailbox unavailable'); });
      const result = await deliverPendingMail(database, { config, transport: { sendMail } });

      expect(result.delivered).toBe(0);
      // Not marked, so the next pass tries it again rather than losing the password.
      expect(marked).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('leaves the message queued when there is no transport, so nothing is lost', async () => {
    const { database, marked } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
    ]);

    const result = await deliverPendingMail(database, { config: null });

    expect(result.attempted).toBe(1);
    expect(result.delivered).toBe(0);
    expect(marked).toEqual([]);
  });

  it('keeps going past a failure so one bad message cannot block the rest', async () => {
    const { database } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
      { id: 'm2', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
    ]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const sendMail = vi.fn(async () => { throw new Error('down'); });
      const result = await deliverPendingMail(database, { config, transport: { sendMail } });

      expect(result.attempted).toBe(2);
      expect(sendMail).toHaveBeenCalledTimes(2);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('the form the password writers call', () => {
  it('reports a failure instead of throwing, so seeding cannot be broken by it', async () => {
    // A row the store cannot update, which is the same failure this guards against:
    // an outbox whose delivery cannot record itself.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const database: Database = { query: vi.fn(async () => { throw Object.assign(new Error('column "sent_at" does not exist'), { code: '42703' }); }) };

      const result = await tryDeliverPendingMail(database);

      expect(result.attempted).toBe(0);
      expect(result.delivered).toBe(0);
      expect(consoleError).toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('the delivery schedule', () => {
  it('can be started and stopped without holding the process open', async () => {
    const { database, marked } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
    ]);
    const sendMail = vi.fn(async () => ({ messageId: '1' }));

    const schedule = startMailDelivery(database, { config, transport: { sendMail } });
    // The first pass runs immediately, so a boot with something already queued
    // does not wait out the interval.
    await vi.waitFor(() => expect(marked).toEqual(['m1']));
    schedule.stop();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('survives a pass that throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const database: Database = { query: vi.fn(async () => { throw new Error('database gone'); }) };
      const schedule = startMailDelivery(database, { config, intervalMs: 10 });
      schedule.stop();
      await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
    } finally {
      consoleError.mockRestore();
      log.mockRestore();
    }
  });
});
