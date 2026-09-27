import { createHandlers } from '../src/server/handlers.js';
import { database } from '../src/server/database.js';

const handlers = createHandlers(database);

type ApiRequest = { method?: string; body: unknown };
type ApiResponse = { status(code: number): ApiResponse; json(body: object): void };

export default async function products(request: ApiRequest, response: ApiResponse) {
  const result = await handlers.products(request.method, request.body);
  return response.status(result.status).json(result.body);
}
