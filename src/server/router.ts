import { createHandlers as createStorefrontHandlers, type Database } from './handlers.js';
import { createAdminHandlers } from './admin.js';
import { tryDeliverOnRequest } from './mailer.js';

export type RawRequest = {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

export type RouteResult = { status: number; body: Record<string, unknown> };

function bearerToken(headers: RawRequest['headers']) {
  const raw = headers?.authorization ?? headers?.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const [scheme, token] = value.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : null;
}

function segmentsAfter(path: string, prefix: string) {
  const withoutPrefix = path.slice(prefix.length);
  return withoutPrefix.split('/').map((segment) => decodeURIComponent(segment)).filter(Boolean);
}

/**
 * Single entry point for the admin API and the public page-visibility feed so
 * the Express server and the Vercel function stay in step.
 */
export function createApiRouter(database: Database) {
  const admin = createAdminHandlers(database);
  const storefront = createStorefrontHandlers(database);

  async function handle(request: RawRequest): Promise<RouteResult | null> {
    const path = request.path.split('?')[0] ?? '';
    const method = (request.method ?? 'GET').toUpperCase();

    if (path === '/api/admin' || path.startsWith('/api/admin/')) {
      const result = await admin.handle({
        method,
        segments: segmentsAfter(path, '/api/admin'),
        body: request.body,
        token: bearerToken(request.headers),
      });
      // Not awaited, and after the handler rather than before it: the response goes
      // back as soon as the router has its own answer, and a queued owner credential
      // rides out on this request rather than on a timer that does not exist on a
      // serverless deployment. Fired on every admin request including the failures,
      // because a retry that only ran on success would skip exactly the requests
      // that follow a bad moment. It checks the queue first, so an empty outbox
      // costs one indexed lookup and opens no connection.
      tryDeliverOnRequest(database);
      return result;
    }

    if (path === '/api/site/pages') {
      if (method !== 'GET') return { status: 405, body: { error: 'method_not_allowed', message: 'Page visibility is read-only.' } };
      try {
        return { status: 200, body: { pages: await admin.publicPages() } };
      } catch (error) {
        // An empty store already falls back to the bundled page list, so
        // reaching here means the store could not be read at all.
        console.error('Unable to load storefront pages', error);
        return { status: 500, body: { error: 'server_error', message: 'The page list could not be loaded.' } };
      }
    }

    return null;
  }

  return { handle, storefront, admin };
}
