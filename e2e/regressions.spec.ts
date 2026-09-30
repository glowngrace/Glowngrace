import { expect, test } from '@playwright/test';
import { consoleAccount, signInWithStubbedConsole } from './support/accounts';

/**
 * Regression coverage for the three bugs fixed on this branch:
 *
 *  1. A slow page request rendered a blank screen instead of a loader.
 *  2. Settings exposed show/hide toggles for pages that have no such switch.
 *  3. Bulk upload templates never downloaded, because the workbook builder
 *     wrote to `CompressionStream` before anything drained the readable side.
 *
 * Every request is stubbed so these tests never touch the database.
 */

const storePage = {
  slug: 'shop',
  label: 'Shop',
  path: '/shop',
  visible: true,
  content: '#000000',
};

const e2eAdmin = consoleAccount;

/**
 * Every read the console store loads on mount. Without these the store's single
 * parallel load rejects, the console never finishes loading, and a test that
 * only cares about one panel fails for an unrelated reason.
 */
async function stubAdminReads(page: import('@playwright/test').Page) {
  const reads: Record<string, unknown> = {
    me: { user: e2eAdmin },
    products: { products: [] },
    orders: { orders: [] },
    jobs: { records: [] },
    candidates: { records: [] },
    partners: { records: [] },
    customers: { records: [] },
    reviews: { records: [] },
    users: { users: [], roles: ['Store Administrator'] },
    pages: { pages: [] },
    'demo-data': { datasets: [] },
    summary: { orders: 0, products: 0, jobs: 0, candidates: 0, partners: 0, customers: 0, reviews: 0, pages: [], hiddenDatasets: [] },
    settings: {
      settings: {
        profile: { storeName: 'Glow & Grace', tagline: '', email: '', phone: '', address: '' },
        delivery: { freeAbove: 0, deliveryFee: 0, gst: 0, returns: 0 },
        notifications: {},
        preview: { livePreview: false },
      },
      updatedAt: null,
    },
  };

  await page.route('**/api/admin/**', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const path = route.request().url().replace(/^.*\/api\/admin\//, '').split('?')[0] ?? '';
    const payload = reads[path];
    return payload ? route.fulfill({ json: payload }) : route.continue();
  });
}

/**
 * `extra` runs after the base stubs and before navigating, so a test can
 * override a single endpoint and still have that override win.
 */
async function signInAsAdmin(page: import('@playwright/test').Page, extra?: () => Promise<unknown>) {
  await stubAdminReads(page);
  await extra?.();
  await signInWithStubbedConsole(page);
}

/**
 * Hold a request open until the returned function is called. Racing a fixed
 * delay is flaky on slower emulated devices, and a stalled request is the more
 * faithful reproduction of the bug: the loader must appear whenever the payload
 * is late, no matter how late.
 */
function holdRequest() {
  let markOpened: (() => void) | null = null;
  let unblock: (() => void) | null = null;
  const opened = new Promise<void>((resolve) => { markOpened = resolve; });
  const blocked = new Promise<void>((resolve) => { unblock = resolve; });
  return {
    // Resolves the moment the app issues the request.
    waitForRequest: () => opened,
    // Call this inside the route handler, then await it to keep the request open.
    hold: () => { markOpened?.(); return blocked; },
    // Let the held request complete.
    release: () => unblock?.(),
  };
}

test.describe('application loading feedback', () => {
  test('a slow page request shows a loader instead of a blank screen', async ({ page }) => {
    // Hold the page-visibility request that gates every storefront route.
    const gate = holdRequest();
    await page.route('**/api/site/pages', async (route) => {
      await gate.hold();
      await route.fulfill({
        json: { pages: [storePage], settings: { brandName: 'Glow & Grace' } },
      });
    });

    // `commit` returns as soon as the response starts, so the test can observe
    // the page while its data is still outstanding.
    const navigation = page.goto('/shop', { waitUntil: 'commit' });
    await gate.waitForRequest();

    // The loader is visible while the gate is still waiting.
    await expect(page.getByTestId('page-loader')).toBeVisible();
    await expect(page.getByRole('progressbar').first()).toBeVisible();
    // And it is announced, not decorative.
    await expect(page.getByTestId('page-loader')).toHaveAttribute('aria-live', 'polite');
    await expect(page.getByTestId('page-loader')).toHaveAttribute('aria-busy', 'true');

    gate.release();
    await navigation;
    await expect(page.getByTestId('page-loader')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'The Collection' })).toBeVisible();
  });

  test('the loader clears when the page request fails', async ({ page }) => {
    await page.route('**/api/site/pages', (route) => route.fulfill({ status: 500, body: 'boom' }));

    await page.goto('/shop');

    // A failure must not leave a spinner running forever.
    await expect(page.getByTestId('page-loader')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'The Collection' })).toBeVisible();
  });

  test('the catalogue shows a loader while its first payload is in flight', async ({ page }) => {
    await page.route('**/api/site/pages', (route) => route.fulfill({
      json: { pages: [storePage], settings: { brandName: 'Glow & Grace' } },
    }));

    // Hold the catalogue request. The page gate resolves first, so by the time
    // this fires the app is waiting on products specifically.
    const gate = holdRequest();
    await page.route('**/api/products', async (route) => {
      await gate.hold();
      await route.fulfill({ json: { products: [], catalogueManaged: true } });
    });

    // `commit` returns as soon as the response starts, so the test can observe
    // the page while its data is still outstanding.
    const navigation = page.goto('/shop', { waitUntil: 'commit' });
    await gate.waitForRequest();
    // The catalogue loader replaces the page gate once the gate has cleared.
    await expect(page.getByTestId('loader')).toBeVisible();
    await expect(page.getByTestId('loader')).toContainText(/gathering/i);
    // The empty grid is never rendered while the payload is outstanding.
    await expect(page.getByRole('link', { name: /Add to bag/i })).toHaveCount(0);

    gate.release();
    await navigation;
    await expect(page.getByTestId('loader')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'The Collection' })).toBeVisible();
  });
});

test.describe('settings page visibility controls', () => {
  test('only the switchable pages are offered', async ({ page }) => {
    const pageRoutes: string[] = [];
    // Registered through `extra` so it outranks the base read stub below.
    await signInAsAdmin(page, () => page.route('**/api/admin/pages', async (route) => {
      pageRoutes.push(route.request().method());
      await route.fulfill({
        json: {
          pages: [
            { slug: 'partners', label: 'Partners', path: '/partners', visible: true },
            { slug: 'shop', label: 'Shop', path: '/shop', visible: true },
            { slug: 'careers', label: 'Careers', path: '/careers', visible: false },
          ],
        },
      });
    }));

    if (test.info().project.name === 'mobile-chromium') {
      await page.getByRole('button', { name: 'Toggle navigation' }).click();
    }
    await page.getByRole('navigation', { name: 'Dashboard sections' })
      .getByRole('button', { name: /^Settings/ }).click();

    // The Pages panel holds the only page-visibility switches. Notifications and
    // dataset rows render their own switches, so the panel is the scope.
    const pagePanel = page.locator('section', { has: page.getByText('Show or hide a storefront page') });

    await expect(pagePanel.getByRole('switch')).toHaveCount(3);
    await expect(pagePanel.getByRole('switch', { name: 'Show Partners' })).toBeVisible();
    await expect(pagePanel.getByRole('switch', { name: 'Show Shop' })).toBeVisible();
    await expect(pagePanel.getByRole('switch', { name: 'Show Careers' })).toBeVisible();

    // Pages with no visibility switch must not appear in this list.
    for (const structural of ['About', 'Contact', 'FAQ']) {
      await expect(pagePanel.getByRole('switch', { name: `Show ${structural}` })).toHaveCount(0);
    }
  });
});

test.describe('bulk upload templates', () => {
  test('the products template downloads as a real xlsx workbook', async ({ page }) => {
    await signInAsAdmin(page, () => page.route('**/api/admin/bulk/**', (route) => route.fulfill({ json: { ok: true, imported: 0 } })));
    if (test.info().project.name === 'mobile-chromium') {
      await page.getByRole('button', { name: 'Toggle navigation' }).click();
    }
    await page.getByRole('navigation', { name: 'Dashboard sections' })
      .getByRole('button', { name: /^Products/ }).click();

    const download = page.waitForEvent('download', { timeout: 20_000 });
    await page.getByTestId('bulk-template-products').click();

    // The old code deadlocked here, so the event is the assertion.
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/products.*\.xlsx$/i);

    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const bytes = Buffer.concat(chunks);

    // A ZIP local file header proves it is a real archive, not an empty blob.
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(bytes.length).toBeGreaterThan(500);
  });

  test('the template button reports progress while the workbook is built', async ({ page }) => {
    await signInAsAdmin(page, () => page.route('**/api/admin/bulk/**', (route) => route.fulfill({ json: { ok: true, imported: 0 } })));
    if (test.info().project.name === 'mobile-chromium') {
      await page.getByRole('button', { name: 'Toggle navigation' }).click();
    }
    await page.getByRole('navigation', { name: 'Dashboard sections' })
      .getByRole('button', { name: /^Products/ }).click();

    // The workbook is built in a few milliseconds, which is faster than any
    // poll can observe. Record every state the button passes through instead.
    await page.evaluate(() => {
      const states: string[] = [];
      (window as unknown as { __states: string[] }).__states = states;
      const target = document.querySelector('[data-testid="bulk-template-products"]');
      if (!target) throw new Error('The products template button was not rendered.');
      const record = () => {
        states.push(`${target.textContent?.trim()}|${(target as HTMLButtonElement).disabled}`);
      };
      record();
      new MutationObserver(record).observe(target, { childList: true, subtree: true, attributes: true });
    });

    await page.getByTestId('bulk-template-products').click();
    await expect(page.getByText(/template downloaded/i)).toBeVisible();

    const states: string[] = await page.evaluate(() => (window as unknown as { __states: string[] }).__states);
    // The button announced the work and locked itself while it was pending.
    expect(states).toContain('Preparing…|true');
    // And it was released again once the file was handed to the browser.
    expect(states[states.length - 1]).toBe('Template|false');
  });
});
