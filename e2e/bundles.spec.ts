import { expect, test } from '@playwright/test';
import { stubBundledCatalogue } from './support/accounts';

test('the shop sells curated bundles alongside the products they gather', async ({ page, isMobile }) => {
  await stubBundledCatalogue(page);
  await page.goto('/shop');

  // The default view mixes products with the curated edits.
  const mixed = page.locator('.product-grid.is-mixed');
  await expect(mixed.locator('.product-card').first()).toBeVisible();
  await expect(mixed.locator('.bundle-card').first()).toBeVisible();

  // Choosing Bundles narrows the grid to the edits alone.
  await page.getByRole('button', { name: 'Bundles', exact: true }).click();
  await expect(page).toHaveURL(/edit=curated/);
  const bundles = page.locator('.product-grid.is-bundles .bundle-card');
  await expect(bundles).toHaveCount(4);
  await expect(page.locator('.product-card')).toHaveCount(0);
  await expect(page.locator('.shop-count')).toHaveText('4 curated bundles');

  // The Bundles view keeps the wide cards two-up where there is room, and
  // stacks them edge to edge on a narrow screen.
  const first = await bundles.nth(0).boundingBox();
  const second = await bundles.nth(1).boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  if (isMobile) {
    expect(second!.x).toBeCloseTo(first!.x, 0);
    expect(second!.y).toBeGreaterThan(first!.y);
  } else {
    expect(second!.y).toBeCloseTo(first!.y, 0);
    expect(second!.x).toBeGreaterThan(first!.x);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  // A category chip offers that category's products plus its matching edit.
  await page.getByRole('button', { name: 'Makeup', exact: true }).click();
  await expect(page.locator('.product-card').first()).toBeVisible();
  await expect(page.locator('.bundle-card')).toHaveCount(1);
});

test('a bundle page presents the edit, its members, and its discounted price', async ({ page, isMobile }) => {
  await stubBundledCatalogue(page);
  await page.goto('/bundle/BND-1');

  await expect(page.getByRole('heading', { name: 'The Bridal Glow Edit' })).toBeVisible();
  await expect(page.locator('.bundle-detail-photo img')).toHaveCount(3);
  await expect(page.locator('.bundle-detail-members li')).toHaveCount(3);
  await expect(page.locator('.detail-price')).toContainText('₹1,799');
  await expect(page.locator('.detail-price')).toContainText('You save ₹448');

  // The collage leads; the copy follows it. Side by side on a wide screen,
  // stacked on a narrow one.
  const gallery = await page.locator('.bundle-detail-gallery').boundingBox();
  const copy = await page.locator('.bundle-detail-copy').boundingBox();
  expect(gallery).not.toBeNull();
  expect(copy).not.toBeNull();
  if (isMobile) expect(gallery!.y).toBeLessThan(copy!.y);
  else expect(gallery!.x).toBeLessThan(copy!.x);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a bundle is added to the bag and checked out as one discounted line', async ({ page }) => {
  await stubBundledCatalogue(page);
  let savedOrder: { items: Array<{ bundleId?: string; productId?: number; quantity: number }> } | undefined;
  await page.route('**/api/checkout', async (route) => {
    savedOrder = route.request().postDataJSON() as typeof savedOrder;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ orderNumber: 'GG-BUNDLE000001', total: 1888.95, message: 'Order confirmed.' }),
    });
  });

  await page.goto('/bundle/BND-1');
  await page.getByRole('button', { name: 'Add bundle to bag · ₹1,799' }).click();

  const bag = page.getByRole('dialog', { name: /your bag/i });
  await expect(bag.getByText('The Bridal Glow Edit')).toBeVisible();
  await expect(bag.locator('.drawer-summary')).toContainText('₹1,799');
  await bag.getByRole('link', { name: 'Proceed to checkout' }).click();

  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await expect(page.getByText('The Bridal Glow Edit')).toBeVisible();
  await page.getByLabel('First name').fill('Priya');
  await page.getByLabel('Last name').fill('Sharma');
  await page.locator('.checkout-form-panels').getByLabel('Email address').fill('priya@example.com');
  await page.getByLabel('Phone number').fill('+91 98765 43210');
  await page.getByLabel('Street address').fill('10 Rose Garden Road');
  await page.getByLabel('Locality or area').fill('Gomti Nagar');
  await page.getByLabel('PIN code').fill('226010');
  await page.getByRole('button', { name: /^Place order/ }).click();

  await expect(page.getByRole('heading', { name: 'Thank you for your order.' })).toBeVisible();
  await expect(page.getByText('GG-BUNDLE000001')).toBeVisible();
  expect(savedOrder).toMatchObject({ items: [{ bundleId: 'BND-1', quantity: 1 }] });
  expect(await page.evaluate(() => localStorage.getItem('glow-grace-cart'))).toBe('[]');
});

test('a retired bundle link explains itself and offers the way back', async ({ page }) => {
  await stubBundledCatalogue(page);
  await page.goto('/bundle/BND-999');
  await expect(page.getByRole('heading', { name: 'That bundle has been retired.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the collection' })).toBeVisible();
});
