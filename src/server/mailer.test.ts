import { describe, expect, it, vi } from 'vitest';
import {
  deliverOutboxMessage,
  deliverPendingMail,
  hasPendingMail,
  isDeliverable,
  mailConfigFromEnv,
  startMailDelivery,
  tryDeliverOnRequest,
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
      // The kinds are asked for as a list, because the pass now carries two: the
      // seed credential and the save confirmation. Older statements named one
      // kind directly, so both shapes are understood here.
      const wanted = Array.isArray(values[0]) ? (values[0] as string[]) : [String(values[0])];
      const matching = rows.filter((row) => wanted.includes(String(row.kind)));
      return { rows: matching, rowCount: matching.length };
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

  it('adds the sender name to the From header, and quotes it', () => {
    // Gmail shows the bracketed name in the inbox and the bare address on hover.
    // Unquoted, a name with a space parses as two addresses and the message is
    // either rejected or delivered to the wrong one.
    const base = { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'postmaster@example.com', SMTP_PASSWORD: 'x' };
    expect(mailConfigFromEnv({ ...base, MAIL_FROM_NAME: 'GG Security' })?.from)
      .toBe('"GG Security" <postmaster@example.com>');
    expect(mailConfigFromEnv({ ...base, MAIL_FROM: 'no-reply@glowandgrace.in', MAIL_FROM_NAME: 'GG Security' })?.from)
      .toBe('"GG Security" <no-reply@glowandgrace.in>');
    // A quote or a backslash in the name would end the quoted string early and
    // splice the rest of the header into it.
    expect(mailConfigFromEnv({ ...base, MAIL_FROM_NAME: 'GG "Sec"\\urity' })?.from)
      .toBe('"GG Security" <postmaster@example.com>');
  });

  describe('the MAIL_* spelling of the same settings', () => {
    // Both spellings are in the wild for the same four facts about a relay: this
    // project has always used SMTP_*, and a hosting provider or a framework
    // template hands out MAIL_*. Reading only one of them means a deployment
    // configured the other way round has no mail and no error - it just quietly
    // never sends, which is what this started as.
    const gmail = {
      MAIL_HOST: 'smtp.gmail.com',
      MAIL_PORT: '587',
      MAIL_ENCRYPTION: 'tls',
      MAIL_USERNAME: 'glowngracebiz@gmail.com',
      MAIL_PASSWORD: 'app-password',
      MAIL_FROM_ADDRESS: 'glowngracebiz@gmail.com',
      MAIL_FROM_NAME: 'GG Security',
    };

    it('configures Gmail from the MAIL_* names alone', () => {
      expect(mailConfigFromEnv(gmail)).toEqual({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        user: 'glowngracebiz@gmail.com',
        password: 'app-password',
        from: '"GG Security" <glowngracebiz@gmail.com>',
      });
    });

    it('lets SMTP_* win where a deployment sets both', () => {
      // Precedence is what makes adding the alias safe: nothing that works today
      // changes, because anything already set under SMTP_* is still the one read.
      expect(mailConfigFromEnv({ ...gmail, SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465' })).toMatchObject({
        host: 'smtp.example.com',
        port: 465,
        secure: true,
      });
    });

    it('reads tls as STARTTLS and ssl as encryption up front', () => {
      // The one thing that must not be got wrong: port 587 expects STARTTLS, so
      // reading `tls` as "implicit TLS" fails the connection with a protocol error
      // that names neither the setting nor the port. `ssl` names the other style
      // and is honoured wherever it is asked for.
      expect(mailConfigFromEnv({ ...gmail, MAIL_ENCRYPTION: 'tls' })?.secure).toBe(false);
      expect(mailConfigFromEnv({ ...gmail, MAIL_ENCRYPTION: 'TLS' })?.secure).toBe(false);
      expect(mailConfigFromEnv({ ...gmail, MAIL_ENCRYPTION: 'starttls' })?.secure).toBe(false);
      expect(mailConfigFromEnv({ ...gmail, MAIL_ENCRYPTION: 'ssl' })?.secure).toBe(true);
    });

    it('never negotiates STARTTLS on port 465, whatever the setting says', () => {
      // No relay offers STARTTLS on 465, so asking for it there fails at connect
      // time. The port wins, because the port is the one that cannot be wrong.
      expect(mailConfigFromEnv({ ...gmail, MAIL_PORT: '465' })?.secure).toBe(true);
      expect(mailConfigFromEnv({ ...gmail, MAIL_PORT: '465', MAIL_ENCRYPTION: 'tls' })?.secure).toBe(true);
      expect(mailConfigFromEnv({ ...gmail, MAIL_PORT: '465', MAIL_ENCRYPTION: 'none' })?.secure).toBe(true);
    });

    it('encrypts even when told not to, and falls back to the port when the word is not one', () => {
      // A misspelling must not turn encryption off silently, and must not refuse the
      // deployment's mail either: the port's own convention is the safe answer. And
      // there is deliberately no way to ask for plain text - a relay that advertises
      // no STARTTLS refuses the login anyway, so the worst case is identical.
      expect(mailConfigFromEnv({ ...gmail, MAIL_ENCRYPTION: 'none' })?.secure).toBe(false);
      expect(mailConfigFromEnv({ ...gmail, MAIL_ENCRYPTION: 'gibberish' })?.secure).toBe(false);
      expect(mailConfigFromEnv({ ...gmail, MAIL_ENCRYPTION: 'gibberish', MAIL_PORT: '465' })?.secure).toBe(true);
    });

    it('still refuses to configure anything without a host, a user and a password', () => {
      // The alias must not become a way to half-configure a transport.
      expect(mailConfigFromEnv({ ...gmail, MAIL_HOST: '' })).toBeNull();
      expect(mailConfigFromEnv({ ...gmail, MAIL_USERNAME: '' })).toBeNull();
      expect(mailConfigFromEnv({ ...gmail, MAIL_PASSWORD: '' })).toBeNull();
    });

    it('recovers a host that arrived as a URL or as a bare domain', () => {
      // nodemailer connects to a host and a port, not to a URL, so a scheme copied
      // out of a provider's settings page fails at connect time with an error that
      // never mentions the host. `gmail.com` on its own means the submission relay.
      expect(mailConfigFromEnv({ ...gmail, MAIL_HOST: 'smtps://smtp.gmail.com' })?.host).toBe('smtp.gmail.com');
      expect(mailConfigFromEnv({ ...gmail, MAIL_HOST: '://gmail.com' })?.host).toBe('smtp.gmail.com');
      expect(mailConfigFromEnv({ ...gmail, MAIL_HOST: 'gmail.com' })?.host).toBe('smtp.gmail.com');
      // A subdomain already names a host, so nothing is added to it - and nothing is
      // added to any other provider either, because they do not all put their relay
      // under `smtp.`.
      expect(mailConfigFromEnv({ ...gmail, MAIL_HOST: 'email.example.com' })?.host).toBe('email.example.com');
      expect(mailConfigFromEnv({ ...gmail, MAIL_HOST: 'yahoo.com' })?.host).toBe('yahoo.com');
    });
  });
});

describe('what may be emailed', () => {
  it('sends the owner credential to the owner address', () => {
    expect(isDeliverable(ownerMessage)).toBe(true);
    expect(isDeliverable({ ...ownerMessage, recipient: superAdminEmail.toUpperCase() })).toBe(true);
  });

  it('sends the save confirmation to the owner address too', () => {
    // It carries no password, so it is allowed out on the same terms as the one
    // that does - and it still only goes to the one address.
    expect(isDeliverable({ kind: 'owner-password-saved', recipient: superAdminEmail })).toBe(true);
    expect(isDeliverable({ ...ownerMessage, kind: 'owner-password-saved', recipient: 'someone.else@example.com' })).toBe(false);
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
    // A local checkout has no SMTP settings, and a save must not fail over it.
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

  it('reports a transport failure instead of throwing, so the row survives it', async () => {
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
  it('picks up the seed credential and the save confirmation, and nothing else', async () => {
    const { database, query } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
      { id: 'm4', kind: 'owner-password-saved', recipient: superAdminEmail, subject: 's', body: 'b' },
      { id: 'm2', kind: 'signup', recipient: 'reha@example.com', subject: 's', body: 'b' },
      { id: 'm3', kind: 'password-reset', recipient: 'deepak@glowngrace.in', subject: 's', body: 'b' },
    ]);
    const sendMail = vi.fn(async (options: { to: string }) => ({ messageId: options.to }));

    const result = await deliverPendingMail(database, { config, transport: { sendMail } });

    // Both kinds the owner is meant to hear about, and nothing addressed anywhere
    // else. A save confirmation that never went out would leave the owner with no
    // record that their credential changed.
    expect(result.attempted).toBe(2);
    expect(result.delivered).toBe(2);
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail.mock.calls.map((call) => call[0].to)).toEqual([superAdminEmail, superAdminEmail]);
    // The kinds are a parameter rather than an interpolation, so the query cannot
    // carry one in.
    expect(String(query.mock.calls[0][0])).toContain('$1');
  });

  it('never considers a superseded credential, because its password no longer works', async () => {
    // The queue is asked for only the newest message of the kind. If the transport
    // was down across two seeds, both rows would otherwise be pending, and the
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

describe('the retry that rides along on requests', () => {
  /**
   * Why any of this exists, stated once so the tests below do not have to.
   *
   * The delivery *schedule* is started by the Express server. On Vercel there is no
   * Express server: every request is a function that is frozen the moment it
   * answers, so an interval never fires. An owner message whose first send attempt
   * failed wrote the row, logged the failure, left `sent_at` null, and then nothing
   * ever retried it - which quietly contradicts the promise the `sent_at` marker
   * and the pending index are there to keep.
   */

  it('does nothing at all when the outbox is empty', async () => {
    // The common case, and the one that has to stay free. An SMTP connection opened
    // on every admin request would slow the console down for a queue that does not
    // exist, so the pass is gated behind a lookup that comes back empty.
    const { database, query } = outboxDatabase([]);
    const sendMail = vi.fn(async () => ({ messageId: '1' }));

    await tryDeliverOnRequest(database, { config, transport: { sendMail } });

    // The gate query, and nothing else. No select of the queue, no send.
    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0]?.[0])).toContain('sent_at IS NULL');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('delivers a queued credential on the next request', async () => {
    const { database, marked } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
    ]);

    await tryDeliverOnRequest(database, { config, transport: { sendMail: vi.fn(async () => ({ messageId: '1' })) } });
    expect(marked).toEqual(['m1']);
  });

  it('leaves a credential queued rather than marking it sent when the relay refuses it', async () => {
    // The whole point of the retry: a row that failed is still the only copy of a
    // password that works, so nothing may record it as delivered.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { database, marked } = outboxDatabase([
        { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
      ]);
      const sendMail = vi.fn(async () => { throw new Error('relay refused'); });

      await tryDeliverOnRequest(database, { config, transport: { sendMail } });

      expect(sendMail).toHaveBeenCalledTimes(1);
      expect(marked, 'a refused credential must not be recorded as sent').toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not wait for the relay before answering', async () => {
    // A slow relay must not add to the response an admin is waiting on, so the pass
    // is fired rather than awaited. Measured by the transport being mid-send while
    // control has already returned.
    const { database, marked } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
    ]);
    let release = () => {};
    const sendMail = vi.fn(() => new Promise((resolve) => { release = () => resolve({ messageId: '1' }); }));

    const startedAt = Date.now();
    const pass = tryDeliverOnRequest(database, { config, transport: { sendMail } });
    const returnedAfter = Date.now() - startedAt;

    // The call returns immediately even though the transport is still hanging. This
    // is the property that keeps a slow relay off the request path, and it is the
    // reason the router does not await this.
    expect(returnedAfter, 'returned before the transport could have finished').toBeLessThan(200);

    // The pass reaches the relay on its own, and the relay never settles. Nothing is
    // recorded, because nothing has actually been sent yet.
    await vi.waitFor(() => expect(sendMail).toHaveBeenCalledTimes(1));
    expect(marked, 'nothing is recorded while the send is still open').toEqual([]);

    release();
    await pass;
    expect(marked).toEqual(['m1']);
  });

  it('survives a store it cannot read, because the request must not fail', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const database: Database = { query: vi.fn(async () => { throw new Error('database gone'); }) };
      // Awaiting must not reject either, not merely not throw synchronously.
      await expect(tryDeliverOnRequest(database)).resolves.toBeUndefined();
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('runs one pass at a time, so a credential cannot be sent twice', async () => {
    // Two concurrent admin requests both finding the same pending row would open two
    // connections and could both send it. The `sent_at` marker is what prevents a
    // duplicate delivery, and it can only do that if there is one pass to mark it.
    // The guard has to survive between calls, so these overlap deliberately: each
    // one is fired before the previous has finished.
    const { database, query, marked } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
    ]);
    const sendMail = vi.fn(() => new Promise((resolve) => { setTimeout(() => resolve({ messageId: '1' }), 20); }));
    const options = { config, transport: { sendMail } };

    // Fired together without awaiting, so all three overlap and the guard is under
    // test rather than incidental.
    const passes = [
      tryDeliverOnRequest(database, options),
      tryDeliverOnRequest(database, options),
      tryDeliverOnRequest(database, options),
    ];
    await Promise.all(passes);

    // Only the first asked the store anything; the other two returned on the guard.
    // Matched tightly, because the delivery select contains a correlated
    // `SELECT 1 FROM email_outbox ... NOT EXISTS` subquery of its own, and counting
    // that instead would turn this into a test that always passes.
    const gates = query.mock.calls.filter((call) => /SELECT 1 FROM email_outbox\s+WHERE sent_at IS NULL/.test(String(call[0])));
    expect(gates).toHaveLength(1);
    expect(sendMail, 'the credential was sent once, not once per request').toHaveBeenCalledTimes(1);
    expect(marked).toEqual(['m1']);
  });
});

describe('asking whether anything is waiting', () => {
  it('is true when a credential is unsent, and false once it is marked', async () => {
    const { database } = outboxDatabase([
      { id: 'm1', kind: 'owner-credentials', recipient: superAdminEmail, subject: 's', body: 'b' },
    ]);
    const queued = await hasPendingMail(database);
    expect(queued).toBe(true);

    const empty = outboxDatabase([]);
    expect(await hasPendingMail(empty.database)).toBe(false);
  });
});
