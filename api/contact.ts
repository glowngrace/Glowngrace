import { createHandlers } from '../src/server/handlers.js';
import { database } from '../src/server/database.js';

const handlers = createHandlers(database);

type ApiRequest = { method?: string; body: unknown };
type ApiResponse = { status(code: number): ApiResponse; json(body: object): void };

export default async function contact(request: ApiRequest, response: ApiResponse) {
  const result = await handlers.contact(request.method, request.body);
  return response.status(result.status).json(result.body);
}
