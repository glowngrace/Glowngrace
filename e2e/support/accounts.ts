import { expect, type Page, type Route } from '@playwright/test';

/**
 * Signing in for a test, the way a person does.
 *
 * There is no demo account to lean on any more, so every console test fills the
 * form and presses the button. The session route is stubbed so the suite never
 * depends on whatever password the local database happens to hold, and so a
 * pending signup can never be mistaken for a usable account.
 *
 * Playwright checks the most recently registered route first, so a caller may
 * register its own session route after this one to override it.
 */
export async function signInWithStubbedConsole(page: Page, user: StubbedAccount = consoleAccount) {
  await page.route('**/api/admin/session', async (route: Route) => {
    if (route.request().method() === 'DELETE') {
      return route.fulfill({ json: { message: 'Signed out of the console.' } });
    }
    return route.fulfill({
      json: {
        token: 'e2e-session-token',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        user,
      },
    });
  });

  await page.goto('/login');
  // The login page renders inside the storefront layout, whose footer has its own
  // "Email address" label, so the fields are targeted by id.
  await page.locator('#login-email').fill(user.email);
  await page.locator('#login-password').fill('a-password-the-person-chose');
  await page.getByRole('button', { name: 'Sign in to your account' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
}

export type StubbedAccount = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string;
  status: string;
  createdAt: string;
};

export const consoleAccount: StubbedAccount = {
  id: 'e2e-console',
  name: 'Kanchan Rao',
  email: 'kanchan@glowngrace.in',
  role: 'Store Administrator',
  avatar: '',
  status: 'Active',
  createdAt: '2026-01-01',
};

export const candidateAccount: StubbedAccount = {
  id: 'e2e-candidate',
  name: 'Anjali Verma',
  email: 'anjali@example.com',
  role: 'Candidate',
  // The candidate portal shows this image when the account has no avatar of its
  // own, so the test can tell which role is signed in.
  avatar: '/images/partner2.jpg',
  status: 'Active',
  createdAt: '2026-01-01',
};

export const customerAccount: StubbedAccount = {
  id: 'e2e-customer',
  name: 'Ritika Srivastava',
  email: 'ritika@example.com',
  role: 'Customer',
  avatar: '/images/partner1.jpg',
  status: 'Active',
  createdAt: '2026-01-01',
};

/**
 * Pins the storefront to the bundled sample catalogue.
 *
 * The tests in this file assert on shipped product names - Glow Ritual Vitamin C
 * Face Serum, Velvet Matte Luxe Liquid Lipstick - because those are stable
 * fixtures with known prices, and a test that reads its expectations out of
 * whatever the database holds cannot assert anything.
 *
 * That means these tests must not be at the mercy of the local database. Once
 * `npm run db:sync` copies production in, `products` is no longer empty, the API
 * answers `catalogueManaged: true`, and the browser correctly throws the bundled
 * samples away - so every product-name assertion below fails on data, not on
 * code. Stubbing the catalogue is the same trick the console stubs already use,
 * and it makes the suite answer to the same catalogue whether or not a local
 * database is running.
 *
 * `catalogueManaged: false` is the honest value: it is what the API returns for a
 * shop that has never been stocked, and it is the only setting under which
 * ProductCatalog keeps the bundled products.
 */
export async function stubBundledCatalogue(page: Page) {
  await page.route('**/api/products', (route) => route.fulfill({
    json: { catalogueManaged: false, products: [] },
  }));
}

/**
 * Answers every console read with an empty collection.
 *
 * The console loads thirteen endpoints before it will show a section, and one
 * refused read is enough to leave it on the loader. The response key has to be
 * the one the console destructures, or it crashes on `undefined.filter`: the
 * product and order reads are named collections, while placements, candidates,
 * partners, customers and reviews all arrive as `records`.
 *
 * Tests that care about a collection register their own route afterwards to
 * override this one.
 */
export async function stubEmptyConsoleReads(page: Page) {
  // The key the console reads that collection out of.
  const responseKey: Record<string, string> = {
    products: 'products',
    orders: 'orders',
    jobs: 'records',
    candidates: 'records',
    partners: 'records',
    customers: 'records',
    reviews: 'records',
  };

  await page.route('**/api/admin/**', (route) => {
    const path = route.request().url().replace(/^.*\/api\/admin\//, '').split('?')[0].replace(/\/$/, '');
    if (route.request().method() !== 'GET') return route.continue();
    if (path === 'me') return route.fulfill({ json: { user: consoleAccount } });
    if (path === 'users') return route.fulfill({ json: { users: [], roles: [] } });
    if (path === 'pages') return route.fulfill({ json: { pages: [] } });
    if (path === 'datasets' || path === 'demo-data') return route.fulfill({ json: { datasets: [] } });
    if (path === 'settings') return route.fulfill({ json: { settings: {}, updatedAt: '2026-02-01T10:00:00.000Z' } });
    if (path === 'summary') {
      return route.fulfill({ json: { summary: { revenue: 0, orders: 0, products: 0, candidates: 0, partners: 0, jobs: 0 } } });
    }
    const key = responseKey[path];
    if (key) return route.fulfill({ json: { [key]: [] } });
    return route.fulfill({ json: {} });
  });
}
