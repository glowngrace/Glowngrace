import { expect, test, type Locator } from '@playwright/test';
import { signInWithStubbedConsole, stubBundledCatalogue, stubEmptyConsoleReads } from './support/accounts';

/**
 * The product form has to lay out inside the console's own frame.
 *
 * Two things used to go wrong here and both are invisible to unit tests, so they
 * are measured in a real browser instead:
 *
 * - The rich text editor keeps a hidden textarea that carries the submitted
 *   value. Absolutely positioned with no positioned ancestor it was laid out
 *   against the page rather than its field, and dragged a horizontal scrollbar
 *   the width of the console across the whole app.
 * - The right column was capped in height and made to scroll inside the page,
 *   which put a second vertical scrollbar next to the page's own.
 */
test('the add product form fits the console without extra scrollbars', async ({ page }) => {
  // Lowest priority, so the console stubs registered after it still take over.
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

  // Below the console's nav breakpoint the drawer starts translated off-screen,
  // and a translated element is still reported as visible. So the button cannot
  // simply be waited for: that resolves while it sits unreachable outside the
  // viewport, and the click then hangs until the test times out. Whether it can
  // actually be reached is a geometry question, so it is asked as one.
  const reachable = async (target: Locator) => {
    const box = await target.boundingBox();
    const size = page.viewportSize();
    if (!box || !size) return false;
    return box.x < size.width && box.x + box.width > 0 && box.y < size.height && box.y + box.height > 0;
  };

  if (!(await reachable(addProduct))) {
    // The burger is display:none above the breakpoint, which also drops it out
    // of the accessibility tree, so it has to be addressed by class rather than
    // by role. `aria-expanded` reflects React's own `navOpen`, so waiting for it
    // is waiting for the drawer to genuinely be open - and re-clicking inside
    // `toPass` covers a click that lands before the console has hydrated and is
    // undone when the first payload re-renders the shell.
    const burger = page.locator('.admin-burger');
    await expect(async () => {
      if ((await burger.getAttribute('aria-expanded')) !== 'true') await burger.click();
      await expect(burger).toHaveAttribute('aria-expanded', 'true');
    }).toPass();
  }
  await expect.poll(() => reachable(addProduct)).toBe(true);
  await addProduct.click();
  await page.getByRole('heading', { name: 'Add a product' }).waitFor();

  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const layout = document.querySelector('.admin-product-layout');
    // The console's own left nav scrolls on its own and always has. Only a
    // scrollbar the form introduces counts here.
    const scrollers = [...(layout?.querySelectorAll<HTMLElement>('*') ?? [])]
      .filter((el) => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    const overflowing = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > doc.clientWidth + 1)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, scrollers, overflowing };
  });

  expect(report.overflowing).toEqual([]);
  expect(report.scrollWidth).toBeLessThanOrEqual(report.clientWidth + 1);
  expect(report.scrollers).toEqual([]);

  // The save bar is what must not scroll away, so it is checked at the foot of the
  // form rather than by measuring the column, which is allowed to be tall.
  await page.mouse.wheel(0, 4000);
  const save = await page.getByRole('button', { name: 'Save product' }).boundingBox();
  const viewport = page.viewportSize();
  expect(save).not.toBeNull();
  expect(save!.y).toBeGreaterThanOrEqual(0);
  expect(save!.y + save!.height).toBeLessThanOrEqual(viewport!.height);
});