import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createHandlers } from '../src/server/handlers.js';
import { database } from '../src/server/database.js';
import { checkDatabaseHealth } from '../src/server/health.js';
import { assertLocalRuntimeUsesLocalDatabase, resolveRuntimeDatabase } from '../src/server/config.js';
import { createApiRouter } from '../src/server/router.js';

assertLocalRuntimeUsesLocalDatabase(resolveRuntimeDatabase());

const app = express();
const handlers = createHandlers(database);
const api = createApiRouter(database);
app.disable('x-powered-by');
app.use(express.json({ limit: '4.5mb' }));

function respond(
  handler: (method: string | undefined, body: unknown) => Promise<{ status: number; body: object }>,
) {
  return async (request: Request, response: Response) => {
    const result = await handler(request.method, request.body);
    response.status(result.status).json(result.body);
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
  const result = await api.handle({
    method: request.method,
    path: request.path,
    body: request.body,
    headers: request.headers as Record<string, string | string[] | undefined>,
  });
  if (!result) return response.status(404).json({ error: 'not_found', message: 'That endpoint does not exist.' });
  return response.status(result.status).json(result.body);
});
app.get('/api/site/pages', async (_request, response) => {
  const result = await api.handle({ method: 'GET', path: '/api/site/pages' });
  return response.status(result?.status ?? 500).json(result?.body ?? { error: 'server_error' });
});
app.get('/api/health', async (_request, response) => {
  const report = await checkDatabaseHealth();
  return response.status(report.status === 'ok' ? 200 : 503).json(report);
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, '0.0.0.0', () => {
  console.log(`Glow & Grace API listening on port ${port}`);
});
