import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CartProvider } from './components/Cart';
import { Header } from './components/Layout';
import { ProductGrid } from './components/ProductCard';
import { ProductCatalogProvider } from './components/ProductCatalog';
import { products } from './data/catalog';
import { signInDemo } from './auth/demo-auth';
import { AdminPortal } from './pages/PortalPages';
import { ProductPage } from './pages/Pages';

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
  afterEach(() => vi.unstubAllGlobals());

  it('opens the admin add-product form without redirecting and returns to inventory on cancel', () => {
    signInDemo('admin@glowngrace.in', 'demo123');
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminPortal />
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(navigation).getByRole('button', { name: /^Products/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a product' }));
    expect(screen.getByRole('heading', { name: 'Add a product' })).toBeVisible();
    expect(screen.getByLabelText('Product name')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Get in Touch' })).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('form', { name: 'Add a product' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Products' })).toBeVisible();
  });

  it('saves an uploaded product to the catalogue', async () => {
    const user = userEvent.setup();
    const createdProduct = {
      id: 9,
      name: 'Test product',
      category: 'Makeup',
      price: 100,
      mrp: 120,
      stock: 5,
      rating: 0,
      reviews: 0,
      image: '/api/products/9/images/0',
      images: ['/api/products/9/images/0'],
      description: 'A test product description.',
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => ({
      ok: true,
      json: async () => init?.method === 'POST' ? { product: createdProduct } : { products: [] },
    }) as Response);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 600, close: () => undefined }));

    signInDemo('admin@glowngrace.in', 'demo123');
    render(
      <MemoryRouter>
        <ProductCatalogProvider><AdminPortal /></ProductCatalogProvider>
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Test product' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Makeup' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Original price (₹)'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Stock quantity'), { target: { value: '5' } });
    await user.upload(screen.getByLabelText('Product images'), new File(['image'], 'test-product.png', { type: 'image/png' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A test product description.' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save product' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/products', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('Test product')).toBeVisible();
    const request = JSON.parse(String(fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body)) as {
      images: Array<{ filename: string; mimeType: string; data: string; width: number; height: number }>;
    };
    expect(request.images).toHaveLength(1);
    expect(request.images[0]).toMatchObject({ filename: 'test-product.png', mimeType: 'image/png', width: 800, height: 600 });
    expect(request.images[0].data).toBeTruthy();
  });

  it('shows the product detail layout with expandable description, image zoom, and quantity', async () => {
    const user = userEvent.setup();
    const description = 'A thoughtful beauty-house favourite. '.repeat(16);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ products: [{
        id: 901,
        name: 'Product detail test',
        category: 'Skincare',
        price: 500,
        mrp: 650,
        stock: 8,
        rating: 4.6,
        reviews: 12,
        image: 'p_serum.jpg',
        images: ['/images/p_serum.jpg'],
        description,
      }] }),
    }) as Response));

    render(
      <MemoryRouter initialEntries={['/product/901']}>
        <ProductCatalogProvider>
          <CartProvider>
            <Header />
            <Routes><Route path="/product/:productId" element={<ProductPage favorites={[]} toggleFavorite={() => undefined} />} /></Routes>
          </CartProvider>
        </ProductCatalogProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Product detail test' })).toBeVisible();
    const readMore = await screen.findByRole('button', { name: 'Read more' });
    expect(readMore).toHaveAttribute('aria-expanded', 'false');
    await user.click(readMore);
    expect(screen.getByRole('button', { name: 'Read less' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await user.click(screen.getByRole('button', { name: 'Add to bag · ₹500' }));
    const bag = screen.getByRole('dialog', { name: /your bag/i });
    expect(bag).toHaveTextContent('₹1,000');
    await user.click(within(bag).getByRole('button', { name: 'Close your bag' }));
    await user.click(screen.getByRole('button', { name: 'View larger image of Product detail test' }));
    expect(screen.getByRole('dialog', { name: 'Product image: Product detail test' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close enlarged image' }));
    expect(screen.queryByRole('dialog', { name: 'Product image: Product detail test' })).not.toBeInTheDocument();
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
