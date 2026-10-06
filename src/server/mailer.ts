import nodemailer from 'nodemailer';
import { superAdminEmail } from '../auth/roles.js';
import type { Database } from './handlers.js';

/**
 * The two kinds of message this module will send.
 *
 * Every other row in the outbox is either a notification with no secret in it or a
 * reset link that a person asked for on an address they already control. These two
 * are the exceptions, and they are exceptions for opposite reasons:
 *
 *   owner-credentials  the body is a password that works right now. Written only by
 *                      the seed, which runs with nobody at the keyboard and has no
 *                      other way to hand over a working credential.
 *   owner-password-saved  a confirmation that a password was changed. Carries no
 *                      password at all, so it is safe to keep, forward and read
 *                      years later - which is the point of an audit record.
 *
 * A list rather than a single name, enforced here rather than at the call sites, so
 * a future caller cannot widen it by accident. Note what is *not* in it: the
 * password generated on `/superadmin/ggpass` never reaches the outbox at all,
 * because that password is shown on a screen and saved by hand.
 */
export const deliverableKinds = ['owner-credentials', 'owner-password-saved'] as const;

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

/**
 * Reads the first value that is actually set, in the order given.
 *
 * The order is the precedence. `SMTP_*` is what this project has always used, and
 * `MAIL_*` is the other spelling these settings turn up in - a hosting provider's
 * mail variables, a framework's own `.env.example`, a settings screen somebody
 * copied in. Both shapes are in the wild for the same four facts about a relay,
 * so both are accepted here rather than asking whoever deploys this to know which
 * one the code happens to read. The first name in each list is the one that wins,
 * so an existing `SMTP_*` deployment is not changed by this at all.
 */
function firstSet(env: NodeJS.ProcessEnv, names: string[]): string {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return '';
}

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
 * Turns a host setting into the bare hostname a relay expects.
 *
 * Three shapes turn up for the same host and only one of them works: `smtp.x.com`,
 * `smtps://smtp.x.com` copied out of a provider's settings page, and `://gmail.com`
 * from a hand-written config that lost the word after the scheme. A scheme is
 * dropped, because nodemailer connects to a host and port and not to a URL, and
 * anything left with no dot before the first label is assumed to be a bare domain
 * and gets the `smtp.` prefix - `gmail.com` and `outlook.com` both mean their
 * submission relay that way, and getting it wrong fails at connect time with an
 * error that does not mention the host at all.
 */
function normaliseHost(raw: string): string {
  // A scheme copied out of a provider's settings page, then the bare `://` left
  // behind by a config that lost the word after it. Both are stripped because
  // nodemailer connects to a host and a port and not to a URL, and both fail at
  // connect time with an error that never mentions the host.
  const host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^:?\/\//, '')
    .replace(/\/+$/, '')
    .trim();
  // Only Google's, and only because it is the one this project's own settings
  // name. Guessing for everybody else would be worse than the problem: providers
  // do not all put their relay under `smtp.` (Yahoo's is `smtp.mail.`), so a rule
  // that looked general would silently break the next one after Gmail.
  return bareProviderHosts.has(host.toLowerCase()) ? `smtp.${host}` : host;
}

const bareProviderHosts = new Set(['gmail.com', 'googlemail.com']);

/** Whether the connection is encrypted up front, or negotiated after connecting. */
type EncryptionStyle = 'implicit' | 'starttls';

/**
 * Reads an encryption setting as a style of encryption, or `null` to defer.
 *
 * The two spellings do not mean the same thing and must not be collapsed. `SMTP_SECURE`
 * is a plain boolean about the connection mode, and `false` has always meant "not
 * implicit TLS" here, which for every relay that matters is STARTTLS. `MAIL_ENCRYPTION`
 * is the word people reach for, and it names the protocol rather than the mode: `ssl`
 * is encryption up front, while `tls` and `starttls` are encryption negotiated after
 * connecting. Reading `MAIL_ENCRYPTION=tls` as "implicit TLS" would be the single
 * most damaging thing this function could do, because port 587 expects the opposite
 * and the connection fails with a protocol error that names neither.
 *
 * `none` is answered as STARTTLS rather than as plain text on purpose. There is no
 * setting here that ships a password in the clear, and a relay that advertises no
 * STARTTLS would refuse the login anyway, so the worst case is identical and the
 * best case is a working connection.
 *
 * An unrecognised word is `null` rather than a refusal, because losing a deployment's
 * mail over a spelling is worse than falling back to the port's own convention.
 */
function encryptionStyle(env: NodeJS.ProcessEnv): EncryptionStyle | null {
  const secure = firstSet(env, ['SMTP_SECURE']).toLowerCase();
  if (secure) {
    if (secure === 'true' || secure === '1' || secure === 'yes') return 'implicit';
    if (secure === 'false' || secure === '0' || secure === 'no') return 'starttls';
  }
  const encryption = firstSet(env, ['MAIL_ENCRYPTION']).toLowerCase();
  if (encryption) {
    if (encryption === 'ssl' || encryption === 'smtps' || encryption === 'tls_implicit') return 'implicit';
    if (encryption === 'tls' || encryption === 'starttls' || encryption === 'none' || encryption === 'off' || encryption === 'null') {
      return 'starttls';
    }
  }
  return null;
}

/**
 * Builds the `From` header, with a display name when one was given.
 *
 * A mailbox on its own reads as a bare address in the recipient's inbox, which is
 * not what a sender name is for. The name is quoted and the address put in angle
 * brackets because a display name containing a space, a comma or a quote would
 * otherwise produce a header that parses as two addresses.
 */
function formatFrom(address: string, name: string): string {
  if (!name) return address;
  return `"${name.replace(/["\\]/g, '')}" <${address}>`;
}

/**
 * Reads the mail settings, or `null` when the deployment has none.
 *
 * A missing configuration is not an error: a local checkout, a test run and a
 * preview deployment all legitimately have no mail server, and the outbox row is
 * the record in every one of them. What must never happen is a save failing
 * because mail is unavailable, so an unconfigured transport reports that it had
 * nothing to do rather than throwing.
 *
 * Both spellings of each setting are read, `SMTP_*` first - see `firstSet`. A host,
 * a user and a password are all required; the rest have defaults that are right for
 * Gmail and for most hosted relays.
 *
 * `SMTP_PORT` 465 implies implicit TLS, which is what every hosted relay uses;
 * anything else negotiates STARTTLS, so port 587 works without a second flag.
 */
export function mailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const host = normaliseHost(firstSet(env, ['SMTP_HOST', 'MAIL_HOST']));
  const user = firstSet(env, ['SMTP_USER', 'MAIL_USERNAME', 'MAIL_USER']);
  const password = firstSet(env, ['SMTP_PASSWORD', 'MAIL_PASSWORD']);
  if (!host || !user || !password) return null;
  const port = Number(firstSet(env, ['SMTP_PORT', 'MAIL_PORT'])) || 587;
  const style = encryptionStyle(env);
  const from = firstSet(env, ['MAIL_FROM', 'MAIL_FROM_ADDRESS']) || user;
  return {
    host,
    port,
    // Port 465 always means implicit TLS, because no relay offers STARTTLS on it and
    // asking for STARTTLS there fails at connect time. An explicit `implicit`
    // elsewhere is honoured, so a provider that does TLS up front on its own port
    // still works. Everything else negotiates after connecting.
    secure: port === 465 || style === 'implicit',
    user,
    password,
    from: formatFrom(from, firstSet(env, ['MAIL_FROM_NAME'])),
  };
}

export function isDeliverable(message: Pick<OutboxMessage, 'kind' | 'recipient'>) {
  return (deliverableKinds as readonly string[]).includes(message.kind)
    && message.recipient.trim().toLowerCase() === superAdminEmail;
}

/**
 * Sends one message, and reports what happened instead of throwing.
 *
 * The caller has already changed a password by the time this runs, so a transport
 * error cannot be allowed to propagate: it would either undo that change or take
 * the server down with it. The row stays unsent and the next pass tries again,
 * which is how a credential that exists only in the outbox still reaches an inbox.
 */
export async function deliverOutboxMessage(
  message: OutboxMessage,
  config: MailConfig | null,
  transport: { sendMail: (options: { from: string; to: string; subject: string; text: string }) => Promise<unknown> } = defaultTransport(config),
): Promise<DeliveryOutcome> {
  if (!config) return { delivered: false, id: message.id, reason: 'not_configured' };
  if (!(deliverableKinds as readonly string[]).includes(message.kind)) return { delivered: false, id: message.id, reason: 'wrong_kind' };
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
    console.error(`Unable to send ${message.kind} mail to ${message.recipient}. It stays in the outbox and will be retried.`, error);
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
 * Only the newest message of each kind is ever a candidate, and that is
 * deliberate. A credential supersedes the one before it the moment it is
 * generated, so an older pending message holds a password that no longer opens
 * anything; if the transport were down across two of them, sending both would
 * deliver a dead password first and the working one second, and the person
 * reading the mailbox would try the first and conclude the account is broken. The
 * `NOT EXISTS` keeps every superseded message permanently out of the queue: a
 * newer row exists whether or not it has been sent, so an old password can never
 * be picked up later. Confirmations are grouped the same way, so a burst of
 * password changes leaves one mail rather than all of them.
 *
 * The pending rows that are eligible are attempted and marked individually, so one
 * failure does not hold up the message behind it and a restart resumes where it
 * left off. Only the deliverable kinds are ever a candidate, which is the same
 * rule `deliverOutboxMessage` applies again at the point of sending.
 */
export async function deliverPendingMail(
  database: Database,
  options: { config?: MailConfig | null; transport?: Parameters<typeof deliverOutboxMessage>[2]; now?: () => Date } = {},
) {
  const config = options.config === undefined ? mailConfigFromEnv() : options.config;
  const pending = await database.query(
    `SELECT id, kind, recipient, subject, body FROM email_outbox AS candidate
     WHERE candidate.sent_at IS NULL AND candidate.kind = ANY($1::text[])
       AND NOT EXISTS (
         SELECT 1 FROM email_outbox AS newer
         WHERE newer.kind = candidate.kind
           AND (newer.created_at, newer.id) > (candidate.created_at, candidate.id)
       )
     ORDER BY candidate.created_at`,
    [[...deliverableKinds]],
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
 * again. It also means an unconfigured mail host cannot stop the console from
 * seeding, which is the more important job this code is sitting in the middle of.
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
 * Whether anything is still owed a delivery attempt.
 *
 * Separate from `deliverPendingMail` because the caller on the request path needs
 * to know the answer without paying for a send. This is one indexed lookup against
 * the partial index on pending owner credentials, which on a store that is not
 * Neon is a fraction of a millisecond and on Neon is a query the pooler already
 * has warm.
 */
export async function hasPendingMail(database: Database): Promise<boolean> {
  const pending = await database.query(
    `SELECT 1 FROM email_outbox
     WHERE sent_at IS NULL AND kind = ANY($1::text[])
     LIMIT 1`,
    [[...deliverableKinds]],
  );
  return pending.rows.length > 0;
}

/**
 * One delivery pass at a time, per process.
 *
 * Module scope rather than function scope, and that is the whole point. Two
 * concurrent admin requests both finding the same pending row would open two
 * connections and could send the same credential twice, which is the one outcome
 * the `sent_at` marker exists to prevent. A local variable inside the function
 * would be fresh on every call and guard nothing.
 *
 * Reset in a `finally`, so a pass that throws or a transport that hangs cannot
 * wedge the console's mail off permanently - which would trade a duplicate send
 * for a silent one, and the silent one is worse.
 */
let passInFlight = false;

/**
 * Hands any queued owner mail to the relay, on whatever request happens to
 * arrive next.
 *
 * The reason this exists: `startMailDelivery` owns the retry, and it is started by
 * the Express server only. On Vercel there is no Express server — every request is
 * a fresh function that freezes the moment it answers — so an interval never runs
 * there. A save whose first send attempt failed wrote the row, logged the
 * failure and left `sent_at` null, and then nothing ever picked it up. The design
 * assumes "the next pass tries again", and on serverless there is no next pass.
 *
 * Rather than a background timer, the retry rides along on requests. An admin
 * request is a good clock: it only happens when somebody is using the console, and
 * the console is where a person who needs the password already is. So the first
 * admin request after a failed send retries it, which is exactly the moment the
 * password is wanted.
 *
 * Two rules keep this from costing anything in the ordinary case:
 *
 *   The queue is checked first and the pass only runs if something is waiting. An
 *   empty outbox - which is almost always - costs one indexed lookup and no
 *   network at all, so there is no SMTP connection opened on the request path
 *   unless a password genuinely needs delivering.
 *
 *   The pass is not awaited. It is fired and reported on, so a slow relay adds
 *   nothing to the response the admin is waiting on. The response goes back as
 *   soon as the router has its own answer. A send that outlives the function is
 *   lost, but the row stays unsent and the next request tries again, which is the
 *   same guarantee the Express schedule gives - and unlike a fire-and-forget send
 *   it never marks a row sent without having sent it.
 *
 * A throw is logged and swallowed, for the reason every other call here swallows
 * one: the password cannot be regenerated, and nothing about the request that
 * happened to trigger the retry should fail because mail is down.
 *
 * The returned promise resolves when the pass settles. Nothing on the request path
 * awaits it - `void tryDeliverOnRequest(...)` is the whole point - but it is
 * returned so that a caller which genuinely needs to know the pass finished can
 * wait, rather than the guard above being a lock that only a timeout can clear.
 */
export function tryDeliverOnRequest(
  database: Database,
  options: {
    config?: MailConfig | null;
    transport?: Parameters<typeof deliverOutboxMessage>[2];
  } = {},
): Promise<void> {
  if (passInFlight) return Promise.resolve();
  passInFlight = true;

  return (async () => {
    try {
      if (!(await hasPendingMail(database))) return;
      const { attempted, delivered } = await deliverPendingMail(database, options);
      if (delivered > 0) console.log(`Owner credentials waiting to be sent: ${attempted}, sent: ${delivered}.`);
    } catch (error) {
      console.error('Unable to deliver pending mail. Anything still queued will be sent on the next request.', error);
    } finally {
      passInFlight = false;
    }
  })();
}

/**
 * Starts the delivery pass and returns a way to stop it.
 *
 * Only meaningful for the Express server. On Vercel this never runs — the function
 * is frozen between requests — so `tryDeliverOnRequest` is what carries the retry
 * there. Both are kept: the schedule is the one that works without anybody using
 * the console, and the request path is the one that works without a long-running
 * process.
 *
 * The interval is unref'd so importing the server from a script or a test is never
 * held open by it, and a failure is logged rather than thrown: mail being down is
 * an outage of one feature, not a reason to stop sending the owner mail that is
 * queued for them.
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
