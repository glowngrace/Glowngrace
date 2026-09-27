import { createHandlers } from '../../../../src/server/handlers.js';
import { database } from '../../../../src/server/database.js';

const handlers = createHandlers(database);

type ApiRequest = { query: { productId?: string; imageIndex?: string } };
type ApiResponse = { status(code: number): ApiResponse; setHeader(name: string, value: string): void; send(body?: Buffer): void };

export default async function productImage(request: ApiRequest, response: ApiResponse) {
  const result = await handlers.productImage(Number(request.query.productId), Number(request.query.imageIndex));
  if (!result.data || !result.mimeType) return response.status(result.status).send();
  response.setHeader('Content-Type', result.mimeType);
  response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return response.status(result.status).send(result.data);
}
