import { database } from '../../src/server/database.js';
import { createApiRouter } from '../../src/server/router.js';

const api = createApiRouter(database);

type ApiRequest = { method?: string; url?: string };
type ApiResponse = { status(code: number): ApiResponse; json(body: object): void };

export default async function pages(request: ApiRequest, response: ApiResponse) {
  const path = new URL(request.url ?? '/api/site/pages', 'http://localhost').pathname;
  const result = await api.handle({ method: request.method, path });
  return response.status(result?.status ?? 500).json(result?.body ?? { error: 'server_error', message: 'The page list could not be loaded.' });
}
