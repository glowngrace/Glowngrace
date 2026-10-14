import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { productImageUrl, type Bundle } from '../data/catalog';
import { CartContext, isBundleLine, lineKey, type CartLine, type CartValue, useCart } from './CartContext';
import { useBundleCatalog } from './BundleCatalogContext';
import { bundleMembers } from '../lib/bundle-grid';
import { useProductCatalog } from './ProductCatalogContext';
const CART_STORAGE_KEY = 'glow-grace-cart';
const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

function validQuantity(quantity: unknown): quantity is number {
  return typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0 && quantity <= 99;
}

function loadCart(): CartLine[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (line): line is CartLine =>
        typeof line === 'object' && line !== null && validQuantity(line.quantity) &&
        (('productId' in line && typeof line.productId === 'number' && Number.isInteger(line.productId) && line.productId > 0) ||
          ('bundleId' in line && typeof line.bundleId === 'string' && line.bundleId.length > 0)),
    );
  } catch {
    return [];
  }
}

const clampQuantity = (quantity: number) => (Number.isInteger(quantity) && quantity > 0 ? Math.min(99, quantity) : 1);

export function CartProvider({ children }: { children: ReactNode }) {
  const { products } = useProductCatalog();
  const { bundles } = useBundleCatalog();
  const [lines, setLines] = useState<CartLine[]>(loadCart);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  const value = useMemo<CartValue>(() => {
    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    const total = lines.reduce((sum, line) => {
      if (isBundleLine(line)) {
        const bundle = bundles.find((item) => item.id === line.bundleId);
        return sum + (bundle ? bundle.price * line.quantity : 0);
      }
      const product = products.find((item) => item.id === line.productId);
      return sum + (product ? product.price * line.quantity : 0);
    }, 0);
    return {
      lines,
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      add: (product, quantity = 1) => {
        setLines((current) => {
          const existing = current.find((line) => lineKey(line) === `product:${product.id}`);
          return existing
            ? current.map((line) =>
                lineKey(line) === `product:${product.id}` ? { ...line, quantity: Math.min(99, line.quantity + clampQuantity(quantity)) } : line,
              )
            : [...current, { productId: product.id, quantity: clampQuantity(quantity) }];
        });
        setIsOpen(true);
      },
      addBundle: (bundle: Bundle, quantity = 1) => {
        setLines((current) => {
          const existing = current.find((line) => lineKey(line) === `bundle:${bundle.id}`);
          return existing
            ? current.map((line) =>
                lineKey(line) === `bundle:${bundle.id}` ? { ...line, quantity: Math.min(99, line.quantity + clampQuantity(quantity)) } : line,
              )
            : [...current, { bundleId: bundle.id, quantity: clampQuantity(quantity) }];
        });
        setIsOpen(true);
      },
      removeLine: (key) => setLines((current) => current.filter((line) => lineKey(line) !== key)),
      changeQuantity: (key, quantity) => {
        if (quantity < 1) {
          setLines((current) => current.filter((line) => lineKey(line) !== key));
          return;
        }
        setLines((current) =>
          current.map((line) => (lineKey(line) === key ? { ...line, quantity: Math.min(99, quantity) } : line)),
        );
      },
      clear: () => setLines([]),
      count,
      total,
    };
  }, [bundles, isOpen, lines, products]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function CartDrawer() {
  const { lines, isOpen, close, removeLine, changeQuantity, count, total } = useCart();
  const { products } = useProductCatalog();
  const { bundles } = useBundleCatalog();
  if (!isOpen) return null;

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <aside className="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-heading">
        <div className="drawer-heading">
          <div>
            <span className="eyebrow">Your edit</span>
            <h2 id="cart-heading">Your bag <span className="cart-count">({count})</span></h2>
          </div>
          <button className="icon-button" type="button" onClick={close} aria-label="Close your bag">×</button>
        </div>
        {lines.length ? (
          <>
            <div className="cart-lines">
              {lines.map((line) => {
                const key = lineKey(line);
                if (isBundleLine(line)) {
                  const bundle = bundles.find((item) => item.id === line.bundleId);
                  if (!bundle) return null;
                  const members = bundleMembers(bundle, products);
                  const thumb = members[0] ? productImageUrl(members[0].image) : '';
                  return (
                    <article className="cart-line" key={key}>
                      <Link to={`/bundle/${bundle.id}`} onClick={close} className="cart-image">
                        {thumb && <img src={thumb} alt="" />}
                      </Link>
                      <div className="cart-line-info">
                        <span className="cart-line-tag">Bundle · {members.length} products</span>
                        <Link to={`/bundle/${bundle.id}`} onClick={close}>{bundle.name}</Link>
                        <span>{money(bundle.price)}</span>
                        <div className="quantity-control">
                          <button type="button" aria-label={`Decrease ${bundle.name} quantity`} onClick={() => changeQuantity(key, line.quantity - 1)}>−</button>
                          <span aria-label={`Quantity ${line.quantity}`}>{line.quantity}</span>
                          <button type="button" aria-label={`Increase ${bundle.name} quantity`} onClick={() => changeQuantity(key, line.quantity + 1)}>+</button>
                        </div>
                        <button className="remove-link" type="button" onClick={() => removeLine(key)}>Remove</button>
                      </div>
                      <strong>{money(bundle.price * line.quantity)}</strong>
                    </article>
                  );
                }
                const product = products.find((item) => item.id === line.productId);
                if (!product) return null;
                return (
                  <article className="cart-line" key={key}>
                    <Link to={`/product/${product.id}`} onClick={close} className="cart-image">
                      <img src={productImageUrl(product.image)} alt="" />
                    </Link>
                    <div className="cart-line-info">
                      <Link to={`/product/${product.id}`} onClick={close}>{product.name}</Link>
                      <span>{money(product.price)}</span>
                      <div className="quantity-control">
                        <button type="button" aria-label={`Decrease ${product.name} quantity`} onClick={() => changeQuantity(key, line.quantity - 1)}>−</button>
                        <span aria-label={`Quantity ${line.quantity}`}>{line.quantity}</span>
                        <button type="button" aria-label={`Increase ${product.name} quantity`} onClick={() => changeQuantity(key, line.quantity + 1)}>+</button>
                      </div>
                      <button className="remove-link" type="button" onClick={() => removeLine(key)}>Remove</button>
                    </div>
                    <strong>{money(product.price * line.quantity)}</strong>
                  </article>
                );
              })}
            </div>
            <div className="drawer-summary">
              <div><span>Subtotal</span><strong>{money(total)}</strong></div>
              <p>Shipping and any applicable taxes are calculated at checkout.</p>
              <Link className="button button-dark button-full" to="/checkout" onClick={close}>Proceed to checkout</Link>
              <button className="text-button" type="button" onClick={close}>Continue exploring</button>
            </div>
          </>
        ) : (
          <div className="empty-bag">
            <p>Your bag is waiting for something lovely.</p>
            <Link className="button button-dark" to="/shop" onClick={close}>Explore the collection</Link>
          </div>
        )}
      </aside>
    </div>
  );
}