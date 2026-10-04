import { loadEnvironment } from '../src/server/env.js';

loadEnvironment();

const { checkHealth } = await import('../src/server/health.js');

type ApiResponse = { status(code: number): ApiResponse; json(body: object): void; setHeader(name: string, value: string): void };

export default async function health(_request: unknown, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store');
  const report = await checkHealth();
  return response.status(report.status === 'ok' ? 200 : 503).json(report);
}
