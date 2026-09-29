import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDestination, compileSource, createDeploymentRouter, loadVercelConfig, matchRewrite, projectRoot } from './vercel-routing';

const storeRoutes = [
  '/',
  '/shop',
  '/product/4',
  '/checkout',
  '/order-confirmation',
  '/partners',
  '/careers',
  '/about',
  '/contact',
  '/login',
  '/wishlist',
  '/candidate',
  '/partner',
  '/admin',
];

describe('Vercel deployment routing', () => {
  const config = loadVercelConfig();
  const router = createDeploymentRouter({ staticRoot: join(projectRoot, 'public') });

  it('keeps the Vite build settings and function duration used by the deployment', () => {
    expect(config).toMatchObject({
      framework: 'vite',
      buildCommand: 'npm run build',
      installCommand: 'npm install',
      outputDirectory: 'dist',
      cleanUrls: false,
    });
    expect(config.functions?.['api/*.ts']?.maxDuration).toBe(10);
  });

  it('serves every storefront route from index.html instead of returning 404 NOT_FOUND', () => {
    expect(config.rewrites?.length).toBeGreaterThan(0);
    for (const route of storeRoutes) {
      expect(router.resolveRequest(route), route).toEqual({ kind: 'rewrite', target: '/index.html' });
    }
  });

  it('serves unknown in-app routes from index.html so the app can show its own not-found page', () => {
    expect(router.resolveRequest('/not-a-real-page')).toEqual({ kind: 'rewrite', target: '/index.html' });
  });

  it('ignores query strings and fragments when matching a route', () => {
    expect(router.resolveRequest('/contact?topic=Salon%20partnership')).toEqual({ kind: 'rewrite', target: '/index.html' });
    expect(router.resolveRequest('/shop#bestsellers')).toEqual({ kind: 'rewrite', target: '/index.html' });
  });

  it('never rewrites API requests to the single-page app', () => {
    for (const route of ['/api/products', '/api/contact', '/api/newsletter', '/api/checkout', '/api/health', '/api/site/pages', '/api/products/9/images/0']) {
      expect(router.resolveRequest(route).kind, route).toBe('function');
    }
    expect(router.resolveRequest('/api/products').target).toContain(join('api', 'products.ts'));
    expect(router.resolveRequest('/api/products/9/images/0').target).toContain('[imageIndex].ts');
    expect(router.resolveRequest('/api/health').target).toContain(join('api', 'health.ts'));
    expect(router.resolveRequest('/api/unknown-endpoint')).toEqual({ kind: 'not-found', target: '/api/unknown-endpoint' });
  });

  /**
   * The console is the only API that nests a path segment, so it is the only one
   * that cannot rely on a `[...path]` file. Vercel matches that catch-all for a
   * single segment and answers `x-vercel-error: NOT_FOUND` for anything deeper,
   * which took every save, publish and page toggle offline in production while
   * `app.all('/api/admin/*')` kept the same URLs working in local development.
   * The rewrite below is what carries the nested paths to the admin function.
   */
  it('routes every console path, nested ones included, to the admin function', () => {
    for (const route of [
      '/api/admin',
      '/api/admin/me',
      '/api/admin/products',
      '/api/admin/products/11',
      '/api/admin/pages/careers',
      '/api/admin/orders/GG-2046',
      '/api/admin/team/00000000-0000-4000-8000-000000000001',
      '/api/admin/products/11/images/0',
    ]) {
      const resolution = router.resolveRequest(route);
      expect(resolution.kind, route).toBe('function');
      expect(resolution.target, route).toContain(join('api', 'admin', 'index.ts'));
    }
  });

  it('serves built assets and images as files', () => {
    expect(router.resolveRequest('/images/hero1.jpg').kind).toBe('static');
    expect(router.resolveRequest('/images/hero1.jpg').target).toBe(join(router.staticRoot, 'images', 'hero1.jpg'));
    expect(router.resolveRequest('/images/favicon.png').target).toBe(join(router.staticRoot, 'images', 'favicon.png'));
  });

  it('rewrites every storefront route to the Vite entry document that the build copies into the output directory', () => {
    expect(config.rewrites?.at(-1)).toEqual({ source: '/:path((?!api/).*)', destination: '/index.html' });
    expect(existsSync(join(projectRoot, 'index.html'))).toBe(true);
  });

  it('keeps traversal attempts inside the single-page app instead of escaping the output directory', () => {
    expect(router.resolveRequest('/../vercel.json').target).toBe('/index.html');
    expect(router.resolveRequest('/images/../../vercel.json').target).toBe('/index.html');
    expect(router.resolveRequest('/images/%2e%2e/%2e%2e/vercel.json').target).toBe('/index.html');
    expect(router.staticFilePath('/../vercel.json')).toBeNull();
    expect(router.staticFilePath('/images/../vercel.json')).toBeNull();
    expect(router.staticFilePath('/../package.json')).toBeNull();
  });
});

describe('Vercel path patterns', () => {
  it('compiles the documented negative-lookahead source pattern', () => {
    const rewrite = { source: '/:path((?!api/).*)', destination: '/index.html' };
    expect(matchRewrite(rewrite, '/shop')).toEqual({ path: 'shop' });
    expect(matchRewrite(rewrite, '/product/4')).toEqual({ path: 'product/4' });
    expect(matchRewrite(rewrite, '/api/products')).toBeNull();
    expect(matchRewrite(rewrite, '/api/contact')).toBeNull();
  });

  it('substitutes captured parameters into a destination', () => {
    expect(applyDestination('/index.html', { path: 'shop' })).toBe('/index.html');
    expect(applyDestination('/:path', { path: 'shop' })).toBe('/shop');
    expect(applyDestination('/docs/:slug', {})).toBe('/docs/:slug');
  });

  it('escapes literal characters and supports named wildcards', () => {
    const compiled = compileSource('/blog/:slug*');
    expect(compiled.pattern.test('/blog/a/b')).toBe(true);
    expect(compiled.pattern.test('/blog')).toBe(false);
    expect(compileSource('/a.b').pattern.test('/a.b')).toBe(true);
    expect(compileSource('/a.b').pattern.test('/axb')).toBe(false);
  });
});
