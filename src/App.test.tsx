import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CartProvider } from './components/Cart';
import { Header } from './components/Layout';
import { ProductGrid } from './components/ProductCard';
import { ProductCatalogProvider } from './components/ProductCatalog';
import { PageGate, StorefrontPagesProvider } from './components/StorefrontPages';
import { products } from './data/catalog';
import { signInDemo } from './auth/demo-auth';
import { AdminPortal } from './pages/PortalPages';
import { LoginPage } from './pages/AuthPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
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

function stubAdminApi() {
  const user = { id: '1', name: 'Gauri Khanna', email: 'admin@glowngrace.in', role: 'admin', avatar: '', status: 'Active', createdAt: '2026-01-01' };
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const payload = url.endsWith('/admin/session') ? { user }
      : url.endsWith('/admin/settings') ? { settings: { profile: { storeName: 'Glow & Grace', tagline: '', email: '', phone: '', address: '' }, delivery: { freeAbove: 0, deliveryFee: 0, gst: 0, returns: 0 }, notifications: {} } }
        : url.endsWith('/admin/summary') ? { summary: { orders: 0, products: 0, jobs: 0, candidates: 0, partners: 0, customers: 0, reviews: 0, pages: [], hiddenDatasets: [] } }
          : url.endsWith('/admin/users') ? { users: [user], roles: ['admin'] }
            : url.endsWith('/admin/pages') ? { pages: [] }
              : url.endsWith('/admin/demo-data') ? { datasets: [] }
                : url.endsWith('/admin/orders') ? { orders: [] }
                  : { products: [], records: [] };
    return { ok: true, json: async () => payload } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.setItem('glow-grace-admin-token', 'test-token');
  return fetchMock;
}

describe('console sign-in and session lifetime', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function LoginHarness() {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<p>Console landing</p>} />
        <Route path="/candidate" element={<p>Sample portal landing</p>} />
        <Route path="/" element={<p>Storefront landing</p>} />
      </Routes>
    );
  }

  it('signs an administrator in with their own password even when it is not the sample one', async () => {
    const user = { id: '9', name: 'Kanchan Iyer', email: 'kanchan@glowngrace.in', role: 'Store Administrator', avatar: '', status: 'Active', createdAt: '2026-01-01' };
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: 'server-issued-token', expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), user }),
    }) as unknown as Response));

    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginHarness />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText('Email address'), 'kanchan@glowngrace.in');
    await userEvent.type(screen.getByLabelText('Password'), 'a-password-the-admin-chose');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to your account' }));

    // A real server sign-in is the authority. It must not then be second-guessed
    // against the four sample accounts, which is what produced the misleading
    // "did not match a demo account" error for anyone whose password is not
    // the sample password.
    expect(await screen.findByText('Console landing')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(localStorage.getItem('glow-grace-admin-token')).toBe('server-issued-token');
  });

  it('falls back to the sample accounts when the address has no console account', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_credentials', message: 'no console account' }),
    }) as unknown as Response));

    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginHarness />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText('Email address'), 'candidate@glowngrace.in');
    await userEvent.type(screen.getByLabelText('Password'), 'demo123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to your account' }));

    // The portal sample accounts are not console accounts, so they still sign in.
    expect(await screen.findByText('Sample portal landing')).toBeVisible();
    expect(localStorage.getItem('glow-grace-demo-account')).toContain('candidate');
  });

  it('signs the operator out on its own when the session runs out', async () => {
    stubAdminApi();
    // An expiry just around the corner: the console must react to the countdown
    // rather than wait for a request to come back 401.
    localStorage.setItem('glow-grace-admin-session-expires-at', new Date(Date.now() + 80).toISOString());
    signInDemo('admin@glowngrace.in', 'demo123');

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminPortal />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Your session has ended.')).toBeVisible();
    expect(localStorage.getItem('glow-grace-admin-token')).toBeNull();
    expect(localStorage.getItem('glow-grace-admin-session-expires-at')).toBeNull();
  });

  it('ends the stored session when the server rejects the token', async () => {
    stubAdminApi();
    signInDemo('admin@glowngrace.in', 'demo123');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthenticated', message: 'Sign in to the console to continue.' }),
    }) as unknown as Response));

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminPortal />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Your session has ended.')).toBeVisible();
    expect(localStorage.getItem('glow-grace-admin-token')).toBeNull();
  });
});

describe('storefront interface', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem('glow-grace-admin-token');
  });

  it('opens the admin add-product form without redirecting and returns to inventory on cancel', async () => {
    stubAdminApi();
    signInDemo('admin@glowngrace.in', 'demo123');
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminPortal />
      </MemoryRouter>,
    );

    const navigation = await screen.findByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(navigation).getByRole('button', { name: /^Products/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a product' }));
    expect(screen.getByRole('heading', { name: 'Add a product' })).toBeVisible();
    expect(screen.getByLabelText('Product name')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Get in Touch' })).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('form', { name: 'Add a product' })).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Products' })).toBeVisible();
  });

  it('saves an uploaded product to the catalogue through the admin API', async () => {
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
      image: '/api/admin/products/9/images/0',
      images: ['/api/admin/products/9/images/0'],
      description: 'A test product description.',
      published: true,
      featured: false,
    };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const payload = url.endsWith('/admin/session') ? { user: { id: '1', name: 'Gauri Khanna', email: 'admin@glowngrace.in', role: 'admin', avatar: '', status: 'Active', createdAt: '2026-01-01' } }
        : url.endsWith('/admin/products') && init?.method === 'POST' ? { product: createdProduct }
          : { products: [], orders: [], records: [], users: [], roles: [], pages: [], datasets: [], settings: null, summary: null };
      return { ok: true, json: async () => payload } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 600, close: () => undefined }));
    localStorage.setItem('glow-grace-admin-token', 'test-token');

    signInDemo('admin@glowngrace.in', 'demo123');
    render(
      <MemoryRouter>
        <ProductCatalogProvider><AdminPortal /></ProductCatalogProvider>
      </MemoryRouter>,
    );

    const navigation = await screen.findByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(navigation).getByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Test product' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Makeup' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Original price (₹)'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Stock quantity'), { target: { value: '5' } });
    await user.upload(screen.getByLabelText('Product images'), new File(['image'], 'test-product.png', { type: 'image/png' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A test product description.' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save product' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/products', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByText('Test product')).toBeVisible();
    const request = JSON.parse(String(fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/admin/products') && call[1]?.method === 'POST')?.[1]?.body)) as {
      images: Array<{ filename: string; mimeType: string; data: string; width: number; height: number }>;
    };
    expect(request.images).toHaveLength(1);
    expect(request.images[0]).toMatchObject({ filename: 'test-product.png', mimeType: 'image/png', width: 800, height: 600 });
    expect(request.images[0].data).toBeTruthy();
  });

  it('edits an existing product through the admin API and returns to inventory', async () => {
    const existing = {
      id: 42,
      name: 'Rose Quartz Cleanser',
      category: 'Skincare',
      brand: 'Glow & Grace',
      sku: 'RQC-42',
      price: 700,
      mrp: 900,
      stock: 12,
      rating: 4.4,
      reviews: 31,
      badge: 'Bestseller',
      image: '/api/admin/products/42/images/0',
      images: ['/api/admin/products/42/images/0'],
      description: 'A gentle daily cleanse.',
      published: true,
      featured: false,
    };
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const payload = url.endsWith('/admin/session')
        ? { user: { id: '1', name: 'Gauri Khanna', email: 'admin@glowngrace.in', role: 'admin', avatar: '', status: 'Active', createdAt: '2026-01-01' } }
        : url.includes('/admin/products/42') && init?.method === 'PATCH'
          ? { product: { ...existing, name: 'Rose Quartz Cleanser v2' }, message: 'Product updated.' }
          : url.endsWith('/admin/products')
            ? { products: [existing] }
            : { products: [], orders: [], records: [], users: [], roles: [], pages: [], datasets: [], settings: null, summary: null };
      return { ok: true, json: async () => payload } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('glow-grace-admin-token', 'test-token');
    signInDemo('admin@glowngrace.in', 'demo123');

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <ProductCatalogProvider><AdminPortal /></ProductCatalogProvider>
      </MemoryRouter>,
    );

    const navigation = await screen.findByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(navigation).getByRole('button', { name: /^Products/ }));
    await screen.findByText('Rose Quartz Cleanser');
    await user.click(screen.getByRole('button', { name: 'Edit Rose Quartz Cleanser' }));

    const nameField = await screen.findByLabelText('Product name');
    expect(nameField).toHaveValue('Rose Quartz Cleanser');
    fireEvent.change(nameField, { target: { value: 'Rose Quartz Cleanser v2' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save product' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/products/42',
      expect.objectContaining({ method: 'PATCH' }),
    ));
    expect(await screen.findByText('Rose Quartz Cleanser v2')).toBeVisible();
  });

  it('adds a team member from settings and posts them to the admin API', async () => {
    const created = { id: '9', name: 'Rhea Kapoor', email: 'rhea@glowngrace.in', role: 'Store Manager', avatar: '', status: 'Active', createdAt: '2026-01-01' };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const payload = url.endsWith('/admin/session')
        ? { user: { id: '1', name: 'Gauri Khanna', email: 'admin@glowngrace.in', role: 'admin', avatar: '', status: 'Active', createdAt: '2026-01-01' } }
        : url.endsWith('/admin/users') && init?.method === 'POST'
          ? { user: created }
          : url.endsWith('/admin/users')
            ? { users: [{ id: '1', name: 'Gauri Khanna', email: 'admin@glowngrace.in', role: 'Store Administrator', avatar: '', status: 'Active', createdAt: '2026-01-01' }], roles: ['Store Administrator', 'Store Manager', 'Content Editor'] }
            : { settings: null, summary: null, pages: [], datasets: [], records: [], products: [], orders: [] };
      return { ok: true, json: async () => payload } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('glow-grace-admin-token', 'test-token');
    signInDemo('admin@glowngrace.in', 'demo123');

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminPortal />
      </MemoryRouter>,
    );

    const navigation = await screen.findByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(navigation).getByRole('button', { name: /^Settings/ }));

    fireEvent.change(await screen.findByLabelText('Full name'), { target: { value: 'Rhea Kapoor' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'rhea@glowngrace.in' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), { target: { value: 'strongpass123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Add team member' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse(String(fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/admin/users') && call[1]?.method === 'POST')?.[1]?.body)) as Record<string, string>;
    expect(body).toMatchObject({ name: 'Rhea Kapoor', email: 'rhea@glowngrace.in', password: 'strongpass123' });
  });

  it('pre-fills and updates an existing job vacancy from the admin console', async () => {
    const job = { id: 'JOB-7', title: 'Senior Beauty Therapist', partner: 'Sculpt Studio', area: 'Bandra West', type: 'Full-time', salary: '₹45,000 – ₹60,000', experience: '4-6 yrs', skills: 'Laser, Facials', description: 'Lead the therapy floor.', applications: 3, status: 'Open', posted: '2026-01-05' };
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith('/admin/session')
        ? { user: { id: '1', name: 'Gauri Khanna', email: 'admin@glowngrace.in', role: 'admin', avatar: '', status: 'Active', createdAt: '2026-01-01' } }
        : url.endsWith('/admin/jobs')
          ? { records: [job] }
          : url.includes('/admin/jobs/JOB-7')
            ? { record: { ...job, title: 'Lead Beauty Therapist' }, message: 'Vacancy updated.' }
            : { products: [], orders: [], records: [], users: [], roles: [], pages: [], datasets: [], settings: null, summary: null };
      return { ok: true, json: async () => payload } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('glow-grace-admin-token', 'test-token');
    signInDemo('admin@glowngrace.in', 'demo123');

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <ProductCatalogProvider><AdminPortal /></ProductCatalogProvider>
      </MemoryRouter>,
    );

    const navigation = await screen.findByRole('navigation', { name: 'Dashboard sections' });
    fireEvent.click(within(navigation).getByRole('button', { name: /^Job vacancies/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit Senior Beauty Therapist' }));

    const title = await screen.findByLabelText('Position title');
    expect(title).toHaveValue('Senior Beauty Therapist');
    fireEvent.change(title, { target: { value: 'Lead Beauty Therapist' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/admin/jobs/JOB-7'),
      expect.objectContaining({ method: 'PATCH' }),
    ));
    expect(await screen.findByText('Lead Beauty Therapist')).toBeVisible();
  });

  it('hides a page from the storefront navigation and blocks its route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith('/site/pages')
        ? {
          pages: [
            { slug: 'home', label: 'Home', path: '/', visible: true, position: 0 },
            { slug: 'shop', label: 'Shop', path: '/shop', visible: true, position: 1 },
            { slug: 'careers', label: 'Careers', path: '/careers', visible: false, position: 2 },
          ],
        }
        : { products: [] };
      return { ok: true, json: async () => payload } as Response;
    }) as typeof fetch);

    render(
      <MemoryRouter initialEntries={['/']}>
        <StorefrontPagesProvider>
          <CartProvider>
            <Header />
            <PageGate path="/careers"><p>Careers content</p></PageGate>
          </CartProvider>
        </StorefrontPagesProvider>
      </MemoryRouter>,
    );

    const navigation = await screen.findByRole('navigation', { name: 'Main navigation' });
    await waitFor(() => expect(within(navigation).queryByRole('link', { name: 'Careers' })).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Shop' })).toBeVisible();
    expect(screen.queryByText('Careers content')).not.toBeInTheDocument();
  });

  it('shows the product detail layout with expandable description, image zoom, and quantity', async () => {
    const user = userEvent.setup();
    const description = 'A thoughtful beauty-house favourite. '.repeat(16);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ catalogueManaged: true, products: [{
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

describe('forgotten password and reset', () => {
  function passwordRoutes() {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/" element={<h1>Back at the storefront</h1>} />
      </Routes>
    );
  }

it('shows what the server said instead of blaming the demo account', async () => {
    // The original bug: a bare catch turned every failure, including a wrong
    // password, into "this demo account is not available", which sent people
    // resetting a password that had never been the problem.
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_credentials', message: 'That email and password do not match a console account.' }),
    }) as unknown as Response));

    render(<MemoryRouter initialEntries={['/login']}>{passwordRoutes()}</MemoryRouter>);

    // A real console administrator whose address is not also a sample portal
    // account. Every answer to them has to come from the server.
    await userEvent.type(screen.getByLabelText('Email address'), 'deepak@glowngrace.in');
    await userEvent.type(screen.getByLabelText('Password'), 'the-wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to your account' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That email and password do not match a console account.');
    expect(alert).not.toHaveTextContent(/demo account/i);
  });

  it('surfaces a server outage rather than inventing a reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'unavailable', message: 'The console database is unavailable. Try again shortly.' }),
    }) as unknown as Response));

    render(<MemoryRouter initialEntries={['/login']}>{passwordRoutes()}</MemoryRouter>);

    // admin@glowngrace.in is also a sample portal account. Even so, a 503 must
    // report the outage, never "your password is wrong, try demo123". The wrong
    // password keeps the portal fallback from swallowing the outage.
    await userEvent.type(screen.getByLabelText('Email address'), 'admin@glowngrace.in');
    await userEvent.type(screen.getByLabelText('Password'), 'oops-not-the-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to your account' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The console database is unavailable.');
    expect(alert).not.toHaveTextContent('demo123');
  });

  it('confirms a reset request without saying whether the account exists', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: 'If that address has a console account, a reset link is waiting for it.' }),
      } as unknown as Response;
    }));

    render(<MemoryRouter initialEntries={['/login']}>{passwordRoutes()}</MemoryRouter>);

    await userEvent.click(screen.getByText('Forgotten your password?'));
    await userEvent.type(screen.getByLabelText('Email to reset'), 'admin@glowngrace.in');
    await userEvent.click(screen.getByRole('button', { name: 'Send me a reset link' }));

    expect(await screen.findByText(/If that address has a console account/)).toBeVisible();
    expect(calls.some((url) => url.includes('/password-reset'))).toBe(true);
  });

  it('sets a new password from a reset link and then sends the person to sign in', async () => {
    const sent: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return {
        ok: true,
        status: 200,
        json: async () => ({ message: 'Password updated. You can sign in with it now.' }),
      } as unknown as Response;
    }));

    render(<MemoryRouter initialEntries={['/reset-password']}>{passwordRoutes()}</MemoryRouter>);

    await userEvent.type(screen.getByLabelText('Reset code'), 'a'.repeat(64));
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-2026');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'brand-new-2026');
    await userEvent.click(screen.getByRole('button', { name: 'Set my new password' }));

    expect(await screen.findByText('Password updated. You can sign in with it now.')).toBeVisible();
    expect(sent[0]).toEqual({ token: 'a'.repeat(64), newPassword: 'brand-new-2026' });

    await userEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
    expect(await screen.findByLabelText('Email address')).toBeVisible();
  });

  it('refuses to submit a reset when the two new passwords differ', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<MemoryRouter initialEntries={['/reset-password']}>{passwordRoutes()}</MemoryRouter>);

    await userEvent.type(screen.getByLabelText('Reset code'), 'a'.repeat(64));
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-2026');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'brand-new-2027');
    await userEvent.click(screen.getByRole('button', { name: 'Set my new password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match|match/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports an expired reset link without asking for the old password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_reset_token', message: 'That reset link has expired or has already been used. Ask for a new one.' }),
    }) as unknown as Response));

    render(<MemoryRouter initialEntries={['/reset-password']}>{passwordRoutes()}</MemoryRouter>);

    await userEvent.type(screen.getByLabelText('Reset code'), 'b'.repeat(64));
    await userEvent.type(screen.getByLabelText('New password'), 'brand-new-2026');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'brand-new-2026');
    await userEvent.click(screen.getByRole('button', { name: 'Set my new password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That reset link has expired or has already been used.');
    // No "current password" field exists on this page, and asking for one is the
    // thing that made the original flow impossible.
    expect(screen.queryByLabelText(/current password/i)).toBeNull();
  });
});
