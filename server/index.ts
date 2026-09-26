import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import { createHandlers } from '../src/server/handlers.js';
import { database } from '../src/server/database.js';

const app = express();
const handlers = createHandlers(database);
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

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
app.get('/api/health', (_request, response) => response.status(200).json({ status: 'ok' }));

const port = Number(process.env.PORT ?? 3001);
app.listen(port, '0.0.0.0', () => {
  console.log(`Glow & Grace API listening on port ${port}`);
});
