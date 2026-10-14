import type { Bundle, Product } from '../data/catalog';

export function bundleMembers(bundle: Bundle, products: Product[]) {
  return bundle.productIds
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is Product => Boolean(product));
}

export type CatalogueItem = { kind: 'bundle'; bundle: Bundle } | { kind: 'product'; product: Product };

/**
 * The balanced home/edit layout from the design: a row of four products, then
 * alternating rows of [bundle + two products] and [two products + bundle], so
 * the wide bundle cards never leave a gap in the four-column grid.
 */
export function mixCatalogue(products: Product[], bundles: Bundle[]): CatalogueItem[] {
  const out: CatalogueItem[] = [];
  const remainingProducts = [...products];
  const remainingBundles = [...bundles];
  out.push(...remainingProducts.splice(0, 4).map((product) => ({ kind: 'product' as const, product })));
  let bundleLeft = true;
  while (remainingBundles.length) {
    const two = remainingProducts.splice(0, 2).map((product) => ({ kind: 'product' as const, product }));
    const card = { kind: 'bundle' as const, bundle: remainingBundles.shift() as Bundle };
    if (two.length === 2) {
      if (bundleLeft) out.push(card, ...two);
      else out.push(...two, card);
      bundleLeft = !bundleLeft;
    } else {
      out.push(card);
    }
  }
  out.push(...remainingProducts.map((product) => ({ kind: 'product' as const, product })));
  return out;
}