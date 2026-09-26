import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CartProvider } from './components/Cart';
import { Header } from './components/Layout';
import { ProductGrid } from './components/ProductCard';
import { products } from './data/catalog';
import { signInDemo } from './auth/demo-auth';
import { AdminPortal } from './pages/PortalPages';

function FavoriteCardHarness() {
  const [favorites, setFavorites] = useState<number[]>([]);
  return (
    <ProductGrid
      items={products.slice(0, 1)}
      favorites={favorites}
      toggleFavorite={(productId) => {
        setFavorites((current) => current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]);
      }}
    />
  );
}

describe('storefront interface', () => {
  it('opens the admin add-product form without redirecting and returns to inventory on cancel', () => {
    signInDemo('admin@glowngrace.in', 'demo123');
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminPortal />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Catalogue & inventory' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Add a product' }));
    expect(screen.getByRole('heading', { name: 'Add a product' })).toBeVisible();
    expect(screen.getByLabelText('Product name')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Get in Touch' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Catalogue & inventory' })).toBeVisible();
  });

  it('shows the preview-only notice when the admin product form is submitted', () => {
    signInDemo('admin@glowngrace.in', 'demo123');
    render(
      <MemoryRouter>
        <AdminPortal />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Add a product' }));
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Test product' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Makeup' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Original price (₹)'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Stock quantity'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Image filename'), { target: { value: 'test-product.jpg' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A test product description.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview product' }));

    expect(screen.getByRole('status')).toHaveTextContent('Product creation is not connected to a catalogue service yet.');
  });

  it('renders accessible site navigation and the full product catalogue', () => {
    render(
      <MemoryRouter>
        <CartProvider>
          <Header />
          <ProductGrid items={products} favorites={[]} toggleFavorite={() => undefined} />
        </CartProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/shop');
    expect(screen.getByText('Glow Ritual Vitamin C Face Serum')).toBeVisible();
    expect(screen.getAllByRole('button', { name: 'Add to bag' })).toHaveLength(products.length);
  });

  it('opens the shopping bag with the chosen product and allows quantity changes', async () => {
    render(
      <MemoryRouter>
        <CartProvider>
          <Header />
          <ProductGrid items={products.slice(0, 1)} favorites={[]} toggleFavorite={() => undefined} />
        </CartProvider>
      </MemoryRouter>,
    );

    const card = screen.getByRole('link', { name: 'View Velvet Matte Luxe Liquid Lipstick' }).closest('article');
    if (!card) throw new Error('Product card not found.');
    fireEvent.click(within(card).getByRole('button', { name: 'Add to bag' }));
    const dialog = screen.getByRole('dialog', { name: /your bag/i });
    expect(within(dialog).getByText('Velvet Matte Luxe Liquid Lipstick')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: /increase velvet matte/i }));
    expect(within(dialog).getByLabelText('Quantity 2')).toBeVisible();
    const summary = within(dialog).getByText('Subtotal').parentElement;
    if (!summary) throw new Error('Cart subtotal summary not found.');
    expect(within(summary).getByText('₹1,198')).toBeVisible();
  });

  it('saves a product to the wishlist without adding it to the bag', () => {
    render(
      <MemoryRouter>
        <CartProvider>
          <Header />
          <FavoriteCardHarness />
        </CartProvider>
      </MemoryRouter>,
    );

    const card = screen.getByRole('link', { name: 'View Velvet Matte Luxe Liquid Lipstick' }).closest('article');
    if (!card) throw new Error('Product card not found.');
    fireEvent.click(within(card).getByRole('button', { name: /add velvet matte.*wishlist/i }));
    expect(screen.getByRole('button', { name: /remove velvet matte.*wishlist/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Open shopping bag, 0 items' })).toBeVisible();
  });
});
