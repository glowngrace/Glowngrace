import { database } from '../../src/server/database.js';
import { createApiRouter } from '../../src/server/router.js';

const api = createApiRouter(database);

type ApiRequest = {
  method?: string;
  url?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};
type ApiResponse = { status(code: number): ApiResponse; json(body: object): void };

export default async function admin(request: ApiRequest, response: ApiResponse) {
  const path = new URL(request.url ?? '/api/admin', 'http://localhost').pathname;
  const result = await api.handle({
    method: request.method,
    path,
    body: request.body,
    headers: request.headers,
  });
  if (!result) return response.status(404).json({ error: 'not_found', message: 'That endpoint does not exist.' });
  return response.status(result.status).json(result.body);
}
