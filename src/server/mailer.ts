import nodemailer from 'nodemailer';
import { superAdminEmail } from '../auth/roles.js';
import type { Database } from './handlers.js';

/**
 * The one kind of message this module will send.
 *
 * Every other row in the outbox is either a notification with no secret in it or a
 * reset link that a person asked for on an address they already control. The owner
 * credential is the only message whose body is a password that works right now, so
 * it is the only kind that is allowed to leave the machine. That is enforced here
 * rather than at the call sites, so a future caller cannot widen it by accident.
 */
export const deliverableKind = 'owner-credentials';

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export type OutboxMessage = {
  id: string;
  kind: string;
  recipient: string;
  subject: string;
  body: string;
};

export type DeliveryOutcome =
  | { delivered: true; id: string }
  | { delivered: false; id: string; reason: 'not_configured' | 'wrong_kind' | 'wrong_recipient' | 'send_failed' };

/**
 * Reads the SMTP settings, or `null` when the deployment has none.
 *
 * A missing configuration is not an error: a local checkout, a test run and a
 * preview deployment all legitimately have no mail server, and the outbox row is
 * the record in every one of them. What must never happen is the rotation failing
 * because mail is unavailable, so an unconfigured transport reports that it had
 * nothing to do rather than throwing.
 *
 * `SMTP_PORT` 465 implies implicit TLS, which is what every hosted relay uses;
 * anything else negotiates STARTTLS, so port 587 works without a second flag.
 */
export function mailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const host = (env.SMTP_HOST ?? '').trim();
  const user = (env.SMTP_USER ?? '').trim();
  const password = env.SMTP_PASSWORD ?? '';
  if (!host || !user || !password) return null;
  const port = Number(env.SMTP_PORT ?? 587) || 587;
  return {
    host,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    user,
    password,
    from: (env.MAIL_FROM ?? user).trim(),
  };
}

export function isDeliverable(message: Pick<OutboxMessage, 'kind' | 'recipient'>) {
  return message.kind === deliverableKind
    && message.recipient.trim().toLowerCase() === superAdminEmail;
}

/**
 * Sends one message, and reports what happened instead of throwing.
 *
 * The caller has already changed a password by the time this runs, so a transport
 * error cannot be allowed to propagate: it would either roll the rotation back or
 * take the server down with it. The row stays unsent and the next pass tries
 * again, which is the only thing that can actually recover a lost credential.
 */
export async function deliverOutboxMessage(
  message: OutboxMessage,
  config: MailConfig | null,
  transport: { sendMail: (options: { from: string; to: string; subject: string; text: string }) => Promise<unknown> } = defaultTransport(config),
): Promise<DeliveryOutcome> {
  if (!config) return { delivered: false, id: message.id, reason: 'not_configured' };
  if (message.kind !== deliverableKind) return { delivered: false, id: message.id, reason: 'wrong_kind' };
  if (!isDeliverable(message)) return { delivered: false, id: message.id, reason: 'wrong_recipient' };

  try {
    await transport.sendMail({
      from: config.from,
      to: message.recipient,
      subject: message.subject,
      text: message.body,
    });
    return { delivered: true, id: message.id };
  } catch (error) {
    console.error(`Unable to send the owner credential to ${message.recipient}. It stays in the outbox and will be retried.`, error);
    return { delivered: false, id: message.id, reason: 'send_failed' };
  }
}

function defaultTransport(config: MailConfig | null) {
  if (!config) return { sendMail: async () => undefined };
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
  });
  return { sendMail: (options: { from: string; to: string; subject: string; text: string }) => transporter.sendMail(options) };
}

/**
 * Sends everything in the outbox that is still owed a delivery attempt.
 *
 * Only the newest owner credential is ever a candidate, and that is deliberate.
 * A password supersedes the one before it the moment it is generated, so an older
 * pending message holds a password that no longer opens anything. If the transport
 * were down across two rotations, sending both would deliver a dead password first
 * and the working one second, and the person reading the mailbox would try the
 * first and conclude the account is broken. The `NOT EXISTS` keeps every superseded
 * message permanently out of the queue: a newer row exists whether or not it has
 * been sent, so an old password can never be picked up later.
 *
 * The pending rows that are eligible are attempted and marked individually, so one
 * failure does not hold up the message behind it and a restart resumes where it
 * left off. Only the owner credential is ever a candidate, which is the same rule
 * `deliverOutboxMessage` applies again at the point of sending.
 */
export async function deliverPendingMail(
  database: Database,
  options: { config?: MailConfig | null; transport?: Parameters<typeof deliverOutboxMessage>[2]; now?: () => Date } = {},
) {
  const config = options.config === undefined ? mailConfigFromEnv() : options.config;
  const pending = await database.query(
    `SELECT id, kind, recipient, subject, body FROM email_outbox AS candidate
     WHERE candidate.sent_at IS NULL AND candidate.kind = $1
       AND NOT EXISTS (
         SELECT 1 FROM email_outbox AS newer
         WHERE newer.kind = candidate.kind
           AND (newer.created_at, newer.id) > (candidate.created_at, candidate.id)
       )
     ORDER BY candidate.created_at`,
    [deliverableKind],
  );
  const messages = pending.rows as OutboxMessage[];
  const stamp = options.now?.() ?? new Date();
  const results: DeliveryOutcome[] = [];
  for (const message of messages) {
    const outcome = await deliverOutboxMessage(message, config, options.transport);
    // Only a real attempt marks the row. An unconfigured or refused message keeps
    // its place in the queue, because it is still the only copy of a password that
    // works.
    if (outcome.delivered) {
      await database.query('UPDATE email_outbox SET sent_at = $1 WHERE id = $2', [stamp, message.id]);
    }
    results.push(outcome);
  }
  return {
    attempted: messages.length,
    delivered: results.filter((result) => result.delivered).length,
    results,
  };
}

/**
 * Runs a delivery pass and swallows anything it throws.
 *
 * This is the form the password writers call. The row is already written by the
 * time either of them runs, and a password cannot be regenerated, so a failure
 * here has to be survivable: the message stays queued and the next pass tries
 * again. It also means a database that has not been migrated yet - `sent_at` only
 * exists from db/migrations/011 - cannot stop the console from seeding, which is
 * the more important job this code is sitting in the middle of.
 */
export async function tryDeliverPendingMail(database: Database) {
  try {
    return await deliverPendingMail(database);
  } catch (error) {
    console.error('Unable to deliver pending mail. Anything still queued will be sent on the next pass.', error);
    return { attempted: 0, delivered: 0, results: [] as DeliveryOutcome[] };
  }
}

/**
 * Starts the delivery pass and returns a way to stop it.
 *
 * The interval is unref'd so importing the server from a script or a test is never
 * held open by it, and a failure is logged rather than thrown: mail being down is
 * an outage of one feature, not a reason to stop rotating passwords.
 */
export function startMailDelivery(
  database: Database,
  options: {
    intervalMs?: number;
    config?: MailConfig | null;
    transport?: Parameters<typeof deliverOutboxMessage>[2];
  } = {},
) {
  const intervalMs = options.intervalMs ?? 5 * 60 * 1000;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const { attempted, delivered } = await deliverPendingMail(database, { config: options.config, transport: options.transport });
      if (attempted > 0) console.log(`Owner credentials waiting to be sent: ${attempted}, sent: ${delivered}.`);
    } catch (error) {
      console.error('Unable to deliver pending mail', error);
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  void tick();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
