import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCart } from '../components/CartContext';
import { deliveryOptions, checkoutTaxRate, formatRupees } from '../data/checkout';
import { products } from '../data/catalog';
import { placeCheckoutOrder } from '../lib/api';

type OrderConfirmation = {
  orderNumber: string;
  total: number;
};

function CheckoutSteps({ complete = false }: { complete?: boolean }) {
  return (
    <ol className="checkout-steps" aria-label="Order progress">
      <li className="complete"><span>✓</span>Bag</li>
      <li className={complete ? 'complete' : 'active'}><span>{complete ? '✓' : '2'}</span>Delivery &amp; payment</li>
      <li className={complete ? 'active' : ''}><span>{complete ? '✓' : '3'}</span>Confirmation</li>
    </ol>
  );
}

function CheckoutSummary({
  subtotal,
  shipping,
  tax,
  itemCount,
  total,
}: {
  subtotal: number;
  shipping: number;
  tax: number;
  itemCount: number;
  total: number;
}) {
  const cart = useCart();
  const orderLines = products.filter((product) => cart.lines.some((line) => line.productId === product.id));
  return (
    <aside className="checkout-summary">
      <span className="eyebrow">A little beauty, on its way</span>
      <h2>Your order</h2>
      <div className="checkout-summary-items">
        {orderLines.map((product) => {
          const line = cart.lines.find((item) => item.productId === product.id);
          return (
            <div className="checkout-summary-item" key={product.id}>
              <img src={`/images/${product.image}`} alt="" />
              <span><strong>{product.name}</strong><small>Qty {line?.quantity}</small></span>
              <b>{formatRupees(product.price * (line?.quantity ?? 0))}</b>
            </div>
          );
        })}
      </div>
      <div className="checkout-total-row"><span>Subtotal <small>({itemCount} {itemCount === 1 ? 'item' : 'items'})</small></span><strong>{formatRupees(subtotal)}</strong></div>
      <div className="checkout-total-row"><span>Delivery</span><strong>{shipping === 0 ? 'Complimentary' : formatRupees(shipping)}</strong></div>
      <div className="checkout-total-row"><span>GST <small>(5%)</small></span><strong>{formatRupees(tax)}</strong></div>
      <div className="checkout-total-row checkout-total-final"><span>Total</span><strong>{formatRupees(total)}</strong></div>
      <p className="checkout-secure-note"><span aria-hidden="true">✦</span> No payment details required for cash on delivery.</p>
    </aside>
  );
}

export function CheckoutPage() {
  const { lines, clear } = useCart();
  const navigate = useNavigate();
  const subtotal = lines.reduce((sum, line) => {
    const product = products.find((item) => item.id === line.productId);
    return sum + (product?.price ?? 0) * line.quantity;
  }, 0);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const tax = Math.round(subtotal * checkoutTaxRate * 100) / 100;
  const [delivery, setDelivery] = useState<(typeof deliveryOptions)[number]['id']>('standard');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const selectedDelivery = deliveryOptions.find((option) => option.id === delivery) ?? deliveryOptions[0];
  const shipping = selectedDelivery.fee;
  const total = subtotal + shipping + tax;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lines.length) return;
    const values = new FormData(event.currentTarget);
    setError('');
    setSubmitting(true);
    try {
      const result = await placeCheckoutOrder({
        firstName: String(values.get('firstName') ?? ''),
        lastName: String(values.get('lastName') ?? ''),
        email: String(values.get('email') ?? ''),
        phone: String(values.get('phone') ?? ''),
        address: String(values.get('address') ?? ''),
        locality: String(values.get('locality') ?? ''),
        city: String(values.get('city') ?? ''),
        state: String(values.get('state') ?? ''),
        postalCode: String(values.get('postalCode') ?? ''),
        landmark: String(values.get('landmark') ?? ''),
        deliveryMethod: delivery,
        paymentMethod: 'cod',
        items: lines.map(({ productId, quantity }) => ({ productId, quantity })),
      });
      if (!result.orderNumber || result.total === undefined) {
        throw new Error('Your order response could not be verified. Your bag is safe—please try again.');
      }
      const confirmation: OrderConfirmation = { orderNumber: result.orderNumber, total: result.total };
      clear();
      navigate('/order-confirmation', { replace: true, state: confirmation });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'We could not place your order. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (lines.length === 0) {
    return <section className="section"><div className="page-container checkout-empty"><span className="eyebrow">Something lovely belongs here</span><h1>Your bag is empty.</h1><p>Add a beauty-house favourite, and you can arrange delivery from here.</p><Link className="button button-dark" to="/shop">Explore the collection</Link></div></section>;
  }

  return (
    <section className="checkout-page">
      <div className="page-container">
        <div className="checkout-heading"><Link className="checkout-back" to="/shop">← Continue shopping</Link><span className="eyebrow">Almost there</span><h1>Checkout</h1><p>Just a few details, then these little luxuries will be on their way.</p></div>
        <CheckoutSteps />
        <form className="checkout-layout" onSubmit={submit}>
          <div className="checkout-form-panels">
            <section className="checkout-panel">
              <h2><span className="checkout-section-icon">01</span>Contact information</h2>
              <p>Who should we get in touch with about your order?</p>
              <div className="checkout-fields">
                <label>First name<input name="firstName" autoComplete="given-name" maxLength={80} placeholder="Priya" required /></label>
                <label>Last name<input name="lastName" autoComplete="family-name" maxLength={80} placeholder="Sharma" required /></label>
                <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} placeholder="priya@email.com" required /></label>
                <label>Phone number<input name="phone" type="tel" autoComplete="tel" minLength={10} maxLength={20} placeholder="+91 98765 43210" required /></label>
              </div>
            </section>

            <section className="checkout-panel">
              <h2><span className="checkout-section-icon">02</span>Delivery address</h2>
              <p>We currently deliver to addresses across India.</p>
              <div className="checkout-fields">
                <label className="checkout-field-full">Street address<input name="address" autoComplete="street-address" minLength={5} maxLength={240} placeholder="House number, building and street" required /></label>
                <label className="checkout-field-full">Locality or area<input name="locality" autoComplete="address-level3" minLength={2} maxLength={120} placeholder="Gomti Nagar" required /></label>
                <label>City<input name="city" autoComplete="address-level2" defaultValue="Lucknow" maxLength={100} required /></label>
                <label>State<input name="state" autoComplete="address-level1" defaultValue="Uttar Pradesh" maxLength={100} required /></label>
                <label>PIN code<input name="postalCode" autoComplete="postal-code" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} placeholder="226010" title="Enter a valid six-digit Indian PIN code." required /></label>
                <label>Landmark <span className="checkout-optional">(optional)</span><input name="landmark" maxLength={120} placeholder="Near City Mall" /></label>
              </div>
            </section>

            <fieldset className="checkout-panel checkout-choice-panel">
              <legend><span className="checkout-section-icon">03</span>Delivery method</legend>
              <p>Choose when you’d like your order to arrive.</p>
              <div className="checkout-choice-list">
                {deliveryOptions.map((option) => (
                  <label className={`checkout-choice${delivery === option.id ? ' selected' : ''}`} key={option.id}>
                    <input type="radio" name="deliveryMethod" value={option.id} checked={delivery === option.id} onChange={() => setDelivery(option.id)} />
                    <span className="checkout-choice-copy"><strong>{option.title}</strong><small>{option.detail}</small></span>
                    <b>{option.fee === 0 ? 'Free' : formatRupees(option.fee)}</b>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="checkout-panel checkout-choice-panel">
              <legend><span className="checkout-section-icon">04</span>Payment method</legend>
              <p>Online payments are coming soon. Your order will be collected on delivery.</p>
              <label className="checkout-choice payment-choice selected">
                <input type="radio" name="paymentMethod" value="cod" defaultChecked />
                <span className="checkout-choice-copy"><strong>Cash on delivery</strong><small>Pay in cash when your order arrives.</small></span>
                <b>Available</b>
              </label>
              <div className="checkout-coming-soon"><span>UPI · Cards · Net banking</span><small>Online payments coming soon</small></div>
            </fieldset>

            {error && <p className="checkout-error" role="alert">{error}</p>}
            <button className="button button-dark checkout-submit-mobile" type="submit" disabled={submitting}>{submitting ? 'Placing your order…' : `Place order · ${formatRupees(total)}`}</button>
            <p className="checkout-terms">By placing your order, you confirm your delivery details are correct. This demo checkout supports cash on delivery.</p>
          </div>
          <div className="checkout-aside">
            <CheckoutSummary subtotal={subtotal} shipping={shipping} tax={tax} total={total} itemCount={itemCount} />
            <button className="button button-dark checkout-submit-desktop" type="submit" disabled={submitting}>{submitting ? 'Placing your order…' : 'Place order'}</button>
            <p className="checkout-aside-note">Your bag stays safe if anything needs another look.</p>
          </div>
        </form>
      </div>
    </section>
  );
}

export function OrderConfirmationPage() {
  const location = useLocation();
  const order = location.state as OrderConfirmation | null;
  if (!order?.orderNumber || order.total === undefined) {
    return <section className="section"><div className="page-container checkout-empty"><span className="eyebrow">Your order details</span><h1>Looking for your order?</h1><p>Open your confirmation link after checkout, or get in touch and we’ll be happy to help.</p><Link className="button button-dark" to="/shop">Continue shopping</Link></div></section>;
  }

  return (
    <section className="order-confirmation-page">
      <div className="page-container">
        <CheckoutSteps complete />
        <article className="order-confirmation-card">
          <span className="order-confirmation-check" aria-hidden="true">✓</span>
          <span className="eyebrow">Made a lovely choice</span>
          <h1>Thank you for your order.</h1>
          <p>Your order is placed and our team will get it ready with care.</p>
          <div className="order-confirmation-number"><span>Order number</span><strong>{order.orderNumber}</strong></div>
          <div className="order-confirmation-number"><span>Cash on delivery</span><strong>{formatRupees(order.total)}</strong></div>
          <p className="confirmation-message">We’ll be in touch with delivery updates. If you have any questions, <Link to="/contact">just let us know</Link>.</p>
          <Link className="button button-dark" to="/shop">Continue exploring</Link>
        </article>
      </div>
    </section>
  );
}
