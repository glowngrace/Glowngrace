import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { products } from '../data/catalog';
import { CartContext, type CartLine, type CartValue, useCart } from './CartContext';
const CART_STORAGE_KEY = 'glow-grace-cart';
const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

function loadCart(): CartLine[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(
      (line): line is CartLine =>
        typeof line?.productId === 'number' &&
        products.some((product) => product.id === line.productId) &&
        Number.isInteger(line.quantity) &&
        line.quantity > 0 &&
        line.quantity <= 99,
    );
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(loadCart);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  const value = useMemo<CartValue>(() => {
    const count = lines.reduce((sum, line) => sum + line.quantity, 0);
    const total = lines.reduce((sum, line) => {
      const product = products.find((item) => item.id === line.productId);
      return sum + (product ? product.price * line.quantity : 0);
    }, 0);
    return {
      lines,
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      add: (product) => {
        setLines((current) => {
          const existing = current.find((line) => line.productId === product.id);
          return existing
            ? current.map((line) =>
                line.productId === product.id ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line,
              )
            : [...current, { productId: product.id, quantity: 1 }];
        });
        setIsOpen(true);
      },
      remove: (productId) => setLines((current) => current.filter((line) => line.productId !== productId)),
      changeQuantity: (productId, quantity) => {
        if (quantity < 1) {
          setLines((current) => current.filter((line) => line.productId !== productId));
          return;
        }
        setLines((current) =>
          current.map((line) => (line.productId === productId ? { ...line, quantity: Math.min(99, quantity) } : line)),
        );
      },
      clear: () => setLines([]),
      count,
      total,
    };
  }, [isOpen, lines]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function CartDrawer() {
  const { lines, isOpen, close, remove, changeQuantity, count, total } = useCart();
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
                const product = products.find((item) => item.id === line.productId);
                if (!product) return null;
                return (
                  <article className="cart-line" key={product.id}>
                    <Link to={`/product/${product.id}`} onClick={close} className="cart-image">
                      <img src={`/images/${product.image}`} alt="" />
                    </Link>
                    <div className="cart-line-info">
                      <Link to={`/product/${product.id}`} onClick={close}>{product.name}</Link>
                      <span>{money(product.price)}</span>
                      <div className="quantity-control">
                        <button type="button" aria-label={`Decrease ${product.name} quantity`} onClick={() => changeQuantity(product.id, line.quantity - 1)}>−</button>
                        <span aria-label={`Quantity ${line.quantity}`}>{line.quantity}</span>
                        <button type="button" aria-label={`Increase ${product.name} quantity`} onClick={() => changeQuantity(product.id, line.quantity + 1)}>+</button>
                      </div>
                      <button className="remove-link" type="button" onClick={() => remove(product.id)}>Remove</button>
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
