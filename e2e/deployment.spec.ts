import { expect, test } from '@playwright/test';

const deploymentRoutes: Array<{ path: string; heading: string | RegExp }> = [
  { path: '/', heading: /beauty that feels/i },
  { path: '/shop', heading: 'The Collection' },
  { path: '/product/4', heading: 'Glow Ritual Vitamin C Face Serum' },
  { path: '/checkout', heading: 'Your bag is empty.' },
  { path: '/order-confirmation', heading: 'Looking for your order?' },
  { path: '/partners', heading: 'Partner Parlours' },
  { path: '/careers', heading: 'Beauty Careers' },
  { path: '/about', heading: 'Our Story' },
  { path: '/contact', heading: 'Get in Touch' },
  { path: '/login', heading: 'Sign in' },
  { path: '/reset-password', heading: 'Set a new password' },
  { path: '/wishlist', heading: 'Your Wishlist' },
  { path: '/candidate', heading: 'Sign in to continue.' },
  { path: '/partner', heading: 'Sign in to continue.' },
  { path: '/admin', heading: 'Sign in to continue.' },
];

test('deep links to every storefront route load the built app instead of a 404 page', async ({ page }) => {
  for (const route of deploymentRoutes) {
    const response = await page.goto(route.path);
    expect(response?.status(), route.path).toBe(200);
    expect(response?.headers()['content-type'], route.path).toContain('text/html');
    expect(await response?.text(), route.path).toContain('<div id="root">');
    await expect(page.getByRole('heading', { name: route.heading }).first(), route.path).toBeVisible();
    await expect(page.getByText(/This page doesn’t exist/i), route.path).toHaveCount(0);
  }
});

test('an unknown in-app route shows the app not-found page rather than the hosting 404 page', async ({ page }) => {
  const response = await page.goto('/not-a-real-page');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /this page isn’t in our edit/i })).toBeVisible();
  await expect(page.getByText(/404 NOT_FOUND/i)).toHaveCount(0);
});

test('a hard refresh on a client-side route keeps working', async ({ page }) => {
  await page.goto('/shop');
  await page.getByRole('link', { name: 'View Glow Ritual Vitamin C Face Serum' }).click();
  await expect(page).toHaveURL('/product/4');
  const response = await page.reload();
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Glow Ritual Vitamin C Face Serum' })).toBeVisible();
});

test('no request on a built page returns 404 or 500', async ({ page }) => {
  const failures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  for (const path of ['/', '/shop', '/product/4', '/admin', '/contact', '/careers']) {
    await page.goto(path);
    await expect(page.locator('#root')).not.toBeEmpty();
  }
  expect(failures).toEqual([]);
});

test('a Vercel deployment without a database reports itself as an error, not as healthy', async ({ request }) => {
  // The regression this exists for: production was serving from the in-memory store
  // for a week because the database variable was missing from the project settings,
  // and /api/health answered `status: ok` the whole time. Every request succeeded, so
  // nothing alerted and nothing failed a check, while every write was discarded on the
  // next cold start.
  //
  // The status is still 200 - a body that says `error` is a successful answer to the
  // question - so this asserts the payload rather than the code.
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const report = await response.json() as { status?: string; store?: string; reason?: string };
  if (process.env.VERCEL) {
    expect(report.status, report.reason).toBe('error');
    expect(report.store).toBe('memory');
    expect(report.reason).toContain('NEON_DATABASE_URL');
  }
});

test('API requests still reach the API layer and are never rewritten to the single-page app', async ({ request }) => {
  const products = await request.get('/api/products');
  expect(products.status()).toBe(200);
  expect(products.headers()['content-type']).toContain('application/json');
  expect(await products.json()).toEqual({ products: [] });

  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  expect(health.headers()['cache-control']).toContain('no-store');
  // `ok` because this test suite runs the in-memory store outside Vercel, which is
  // the legitimate case. The Vercel case is asserted separately below, because it is
  // the one that silently ships and the whole reason the distinction exists.
  expect(await health.json()).toMatchObject({ status: 'ok', store: 'memory', productCount: 0, mailPending: 0 });

  // /api/admin/products/11 is the path the old `[...path]` function could not
  // match. It belongs here so a nested console route can never fall through to
  // the single-page-app rewrite again.
  for (const path of ['/api/contact', '/api/newsletter', '/api/checkout', '/api/products/9/images/0', '/api/admin/me', '/api/admin/products/11', '/api/not-a-function']) {
    const response = await request.get(path);
    expect(response.headers()['content-type'], path).toContain('application/json');
    expect(await response.text(), path).not.toContain('<div id="root">');
  }
});

test('built assets and images are served as files', async ({ request }) => {
  const script = await request.get('/');
  const bundle = /src="(\/assets\/[^"]+\.js)"/.exec(await script.text());
  expect(bundle?.[1]).toBeTruthy();
  const asset = await request.get(bundle![1]);
  expect(asset.status()).toBe(200);
  expect(asset.headers()['content-type']).toContain('javascript');

  const image = await request.get('/images/hero1.jpg');
  expect(image.status()).toBe(200);
  expect(image.headers()['content-type']).toBe('image/jpeg');
});

test('a path traversal request cannot read files outside the build output', async ({ request }) => {
  const response = await request.get('/images/../../vercel.json');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('<div id="root">');
});
