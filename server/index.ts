import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createHandlers } from '../src/server/handlers.js';
import { database } from '../src/server/database.js';
import { checkHealth } from '../src/server/health.js';
import { createApiRouter } from '../src/server/router.js';
import { startOwnerPasswordRotation } from '../src/server/admin/owner-password.js';
import { mailConfigFromEnv, startMailDelivery } from '../src/server/mailer.js';

const app = express();
const handlers = createHandlers(database);
const api = createApiRouter(database);
app.disable('x-powered-by');
app.use(express.json({ limit: '4.5mb' }));

function respond(
  handler: (method: string | undefined, body: unknown) => Promise<{ status: number; body: object }>,
) {
  return async (request: Request, response: Response) => {
    try {
      const result = await handler(request.method, request.body);
      response.status(result.status).json(result.body);
    } catch (error) {
      // Express 4 does not catch a rejected async handler, so an escaping
      // rejection would become an unhandledRejection and take the whole API
      // process down. Every request has to answer with something.
      console.error(`${request.method} ${request.originalUrl} failed`, error);
      if (!response.headersSent) {
        response.status(500).json({ error: 'server_error', message: 'The request could not be completed. Please try again shortly.' });
      }
    }
  };
}

app.all('/api/contact', respond(handlers.contact));
app.all('/api/newsletter', respond(handlers.newsletter));
app.all('/api/checkout', respond(handlers.checkout));
app.all('/api/products', respond(handlers.products));
app.get('/api/products/:productId/images/:imageIndex', async (request, response) => {
  const result = await handlers.productImage(Number(request.params.productId), Number(request.params.imageIndex));
  if (!result.data || !result.mimeType) return response.status(result.status).end();
  return response.status(result.status).type(result.mimeType).send(result.data);
});
app.all('/api/admin/*', async (request, response) => {
  try {
    const result = await api.handle({
      method: request.method,
      path: request.path,
      body: request.body,
      headers: request.headers as Record<string, string | string[] | undefined>,
    });
    if (!result) return response.status(404).json({ error: 'not_found', message: 'That endpoint does not exist.' });
    return response.status(result.status).json(result.body);
  } catch (error) {
    console.error(`${request.method} ${request.originalUrl} failed`, error);
    return response.status(500).json({ error: 'server_error', message: 'The request could not be completed. Please try again shortly.' });
  }
});
app.get('/api/site/pages', async (_request, response) => {
  try {
    const result = await api.handle({ method: 'GET', path: '/api/site/pages' });
    return response.status(result?.status ?? 500).json(result?.body ?? { error: 'server_error' });
  } catch (error) {
    console.error('GET /api/site/pages failed', error);
    return response.status(500).json({ error: 'server_error', message: 'The page list could not be loaded.' });
  }
});
app.get('/api/health', (_request, response) => {
  const report = checkHealth();
  return response.status(report.status === 'ok' ? 200 : 503).json(report);
});

/**
 * A late pool or socket failure must not end the process: the deployment would
 * return connection errors for every request until it was replaced, and the
 * health endpoint is exactly what is needed to diagnose that.
 */
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection', reason);
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, '0.0.0.0', () => {
  console.log(`Glow & Grace API listening on port ${port}`);
});

/**
 * The owner account's password is generated on a schedule rather than chosen,
 * because nobody sits down to set it. Started after the listener so a database
 * that is still coming up cannot delay the port from opening; the rotation logs
 * its own failures and tries again the next day.
 */
startOwnerPasswordRotation(database);

/**
 * Carries any owner credential that is still waiting in the outbox into the
 * mailbox it was addressed to.
 *
 * A rotation writes the message and then tries to send it, so this normally has
 * nothing to do. It is here for the case that matters: a transport that was down
 * when the password was generated. That row is the only copy of a working
 * password, so it stays queued until a send actually succeeds. Without SMTP
 * settings the pass does nothing and the outbox keeps being the record, which is
 * what a local checkout and a preview deployment rely on.
 */
startMailDelivery(database);

// Said once at boot, because a deployment that believes it is sending owner
// credentials and is not is the kind of mistake that is only discovered a week
// later, when a password nobody received stops working.
const mail = mailConfigFromEnv();
console.log(mail
  ? `Owner credentials will be emailed through ${mail.host}:${mail.port} as ${mail.from}.`
  : 'No SMTP settings found, so owner credentials stay in the outbox instead of being emailed. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD to send them.');
