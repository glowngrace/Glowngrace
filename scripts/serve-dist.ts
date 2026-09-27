import { createReadStream, existsSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { createDeploymentRouter } from '../src/lib/vercel-routing.js';

const router = createDeploymentRouter();
const port = Number(process.env.PREVIEW_PORT ?? 4173);

if (!existsSync(join(router.staticRoot, 'index.html'))) {
  console.error(`No build found in ${router.staticRoot}. Run npm run build first.`);
  process.exit(1);
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(response: ServerResponse, status: number, body: object) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

function sendNotFound(response: ServerResponse, message: string) {
  sendJson(response, 404, { error: 'not_found', message });
}

function sendFunction(response: ServerResponse, pathname: string) {
  if (pathname === '/api/health') return sendJson(response, 200, { status: 'ok' });
  if (pathname === '/api/products') return sendJson(response, 200, { products: [] });
  return sendNotFound(response, `No preview function handles ${pathname}.`);
}

function contentTypeFor(file: string) {
  return contentTypes[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

createServer((request, response) => {
  const method = request.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD');
    return sendJson(response, 405, { error: 'method_not_allowed', message: `${method} is not supported by the preview server.` });
  }
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
  const resolution = router.resolveRequest(pathname);
  if (resolution.kind === 'function') return sendFunction(response, pathname);
  if (resolution.kind === 'not-found') return sendNotFound(response, `No route or file matches ${pathname}.`);
  const file = resolution.kind === 'rewrite' ? router.staticFilePath(resolution.target) : resolution.target;
  if (!file) return sendNotFound(response, `Rewrite target ${resolution.target} is missing from ${router.staticRoot}.`);
  response.writeHead(200, { 'content-type': contentTypeFor(file) });
  if (method === 'HEAD') return response.end();
  return createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Deployment preview for ${router.staticRoot} listening on http://127.0.0.1:${port}`);
  console.log(`Rewrites: ${(router.config.rewrites ?? []).map((rewrite) => `${rewrite.source} -> ${rewrite.destination}`).join(', ') || 'none'}`);
});
