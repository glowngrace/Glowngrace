import { expect, test, type Locator } from '@playwright/test';
import { signInWithStubbedConsole, stubBundledCatalogue, stubEmptyConsoleReads } from './support/accounts';
import { auditPage } from './support/audit';

/**
 * The layout and accessibility pass over the pages this branch rebuilt.
 *
 * `e2e/ui-review.spec.ts` audits sign-in and the console lock, which is the
 * correct set for that branch. These are the surfaces changed here, and they had
 * no coverage of their own: the product page's new sections, the partner
 * profile, and the product form's rich text fields. The form in particular grew
 * seven contenteditable fields, and a contenteditable that is not announced is
 * unusable with a screen reader - a fault no assertion in the old list could see.
 */

/** Whether a control is genuinely reachable, which a closed drawer is not. */
async function reachable(page: import('@playwright/test').Page, target: Locator) {
  const box = await target.boundingBox();
  const size = page.viewportSize();
  if (!box || !size) return false;
  return box.x < size.width && box.x + box.width > 0 && box.y < size.height && box.y + box.height > 0;
}

/**
 * Pins which storefront pages are visible.
 *
 * The response shape is the API's own, because `PageGate` renders nothing but a
 * loader - a heading-less page - for as long as this request is in flight, and
 * treats a page missing from the list as hidden.
 */
async function stubVisibleStorefrontPages(page: import('@playwright/test').Page, paths: string[]) {
  await page.route('**/api/site/pages', (route) => route.fulfill({
    json: {
      pages: paths.map((path, position) => ({
        slug: path.replace('/', ''), label: path, path, visible: true, position,
      })),
    },
  }));
}

test.describe('the rebuilt pages hold together', () => {
  test('/product/4 passes the layout and accessibility audit', async ({ page }) => {
    await stubBundledCatalogue(page);
    await page.goto('/product/4');
    await page.waitForLoadState('networkidle');
    await auditPage(page, '/product/4');
  });

  test('/partners/:slug passes the layout and accessibility audit', async ({ page }) => {
    await stubBundledCatalogue(page);
    // The profile is gated on the directory being visible, and the gate renders
    // a loader with no heading at all while the page list is in flight. The list
    // is pinned rather than read from whatever the local database happens to
    // hold, for the same reason the catalogue is.
    await stubVisibleStorefrontPages(page, ['/partners']);
    await page.goto('/partners/elegance-bridal-house');
    await page.getByRole('heading', { level: 1, name: 'Elegance Bridal House' }).waitFor();
    await auditPage(page, '/partners/elegance-bridal-house');
  });

  test('the product page shows the information section even when the extra sections are empty', async ({ page }) => {
    await stubBundledCatalogue(page);
    await page.goto('/product/4');
    await page.getByRole('heading', { name: 'Product Information' }).waitFor();
    // The bundled sample products predate the optional sections, so this is the
    // shape that used to leave the page with nothing to read: the parent section
    // has to survive even when every optional card is omitted.
    await expect(page.getByRole('heading', { name: 'Description' })).toBeVisible();
  });

  test('the add product form passes the audit, rich text fields included', async ({ page }) => {
    await page.route('**/api/**', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ json: {} })
      : route.continue()));
    await stubEmptyConsoleReads(page);
    await stubBundledCatalogue(page);
    await signInWithStubbedConsole(page);

    await page.goto('/admin');
    const navigation = page.getByRole('navigation', { name: 'Dashboard sections' });
    await navigation.waitFor();
    const addProduct = navigation.getByRole('button', { name: 'Add product' });
    if (!(await reachable(page, addProduct))) {
      const burger = page.locator('.admin-burger');
      await expect(async () => {
        if ((await burger.getAttribute('aria-expanded')) !== 'true') await burger.click();
        await expect(burger).toHaveAttribute('aria-expanded', 'true');
      }).toPass();
    }
    await expect.poll(() => reachable(page, addProduct)).toBe(true);
    await addProduct.click();
    await page.getByRole('heading', { name: 'Add a product' }).waitFor();

    await auditPage(page, '/admin (add product)');
  });

  test('the rich text editor submits what it shows', async ({ page }) => {
    await page.route('**/api/**', (route) => (route.request().method() === 'GET'
      ? route.fulfill({ json: {} })
      : route.continue()));
    await stubEmptyConsoleReads(page);
    await signInWithStubbedConsole(page);

    await page.goto('/admin');
    const navigation = page.getByRole('navigation', { name: 'Dashboard sections' });
    await navigation.waitFor();
    const addProduct = navigation.getByRole('button', { name: 'Add product' });
    if (!(await reachable(page, addProduct))) {
      const burger = page.locator('.admin-burger');
      await expect(async () => {
        if ((await burger.getAttribute('aria-expanded')) !== 'true') await burger.click();
        await expect(burger).toHaveAttribute('aria-expanded', 'true');
      }).toPass();
    }
    await expect.poll(() => reachable(page, addProduct)).toBe(true);
    await addProduct.click();
    await page.getByRole('heading', { name: 'Add a product' }).waitFor();

    // The visible surface is a contenteditable div, so the value that actually
    // travels is the hidden textarea carrying the field's name. Typing has to
    // reach it, or the product saves with an empty description.
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.type('A brightening daily serum.');
    await expect(page.locator('.admin-rte-source').first()).toHaveValue('A brightening daily serum.');
  });
});