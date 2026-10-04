import { expect, test } from '@playwright/test';

/**
 * Product deep links, against the database rather than a stub.
 *
 * Every other product test in the suite pins the storefront to the bundled
 * catalogue, because asserting on shipped product names needs a fixture with
 * known prices. That is the right call for those tests and the wrong one for
 * this: the bundled catalogue numbers its products `1..8`, while `products.id` is
 * an `IDENTITY` column declared `START WITH 9`. So `/product/4` - hardcoded in
 * `storefront`, `rebuilt-pages-ui` and `deployment` - is a real product in every
 * stub and has never existed in any database. Nothing here would have noticed.
 *
 * So nothing is stubbed. The id is read out of the API and navigated to, which is
 * also the only version of this assertion that keeps working: `db:seed --reset`
 * deletes and reinserts the catalogue without rewinding the identity sequence, so
 * the ids after a reseed are not the ids before it, and any literal written here
 * would be wrong again by the next seed.
 */
test.describe('deep links into real, seeded products', () => {
  test('a product id from the database opens that product', async ({ page, request }) => {
    const response = await request.get('/api/products');
    expect(response.ok()).toBe(true);
    const body = await response.json() as { catalogueManaged: boolean; products: Array<{ id: number; name: string }> };

    // A seeded database. Without this the test would quietly pass against an
    // empty shop and prove nothing.
    expect(body.catalogueManaged).toBe(true);
    expect(body.products.length).toBeGreaterThan(0);

    const product = body.products[0]!;
    await page.goto(`/product/${product.id}`);

    // The heading is the assertion that matters: the right id resolved to the
    // right product. The document title is deliberately not asserted - a seeded
    // row has no `meta_title`, so the site default is the correct answer.
    await expect(page.getByRole('heading', { name: product.name, exact: true })).toBeVisible();
  });

  test('every seeded product opens, not just the first', async ({ page, request }) => {
    // Eight full page loads in a row, against a real database, while the rest of
    // the suite runs in parallel. The default 30s is not a budget for that, and
    // raising it here is preferable to asserting on only the first product, which
    // is what let the drift through in the first place.
    test.setTimeout(120_000);

    const response = await request.get('/api/products');
    const body = await response.json() as { products: Array<{ id: number; name: string }> };
    expect(body.products.length).toBeGreaterThan(1);

    for (const product of body.products) {
      await page.goto(`/product/${product.id}`);
      await expect(page.getByRole('heading', { name: product.name, exact: true })).toBeVisible();
    }
  });

  test('an id that was never issued lands on the missing-product page', async ({ page, request }) => {
    // The other half of the contract, and the assertion that makes the rest of
    // this file mean something: a deep link to a product that does not exist has
    // to say so. Before the ids were read out of the API, `/product/4` rendered
    // this same page in every run and still counted as a pass.
    const response = await request.get('/api/products');
    const body = await response.json() as { products: Array<{ id: number }> };
    const highest = Math.max(...body.products.map((product) => product.id));

    await page.goto(`/product/${highest + 1000}`);
    await expect(page.getByRole('heading', { name: 'That beauty has gone missing.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to the collection' })).toBeVisible();
  });
});