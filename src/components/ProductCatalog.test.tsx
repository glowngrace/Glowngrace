import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { products as bundledProducts } from '../data/catalog';
import { ProductCatalogProvider } from './ProductCatalog';
import { useProductCatalog } from './ProductCatalogContext';

function CatalogueProbe() {
  const { products, loading, error } = useProductCatalog();
  if (loading) return <p>Loading catalogue</p>;
  return (
    <div>
      {error && <p role="alert">{error}</p>}
      {products.length === 0
        ? <p>Nothing in this edit just yet. Try another category.</p>
        : <ul>{products.map((product) => <li key={product.id}>{product.name}</li>)}</ul>}
    </div>
  );
}

function renderCatalogue() {
  return render(
    <MemoryRouter>
      <ProductCatalogProvider>
        <CatalogueProbe />
      </ProductCatalogProvider>
    </MemoryRouter>,
  );
}

function stubCatalogue(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => payload }) as Response));
}

describe('storefront catalogue synchronisation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the bundled samples when the database has never been stocked', async () => {
    stubCatalogue({ products: [], catalogueManaged: false });
    renderCatalogue();

    await screen.findByText(bundledProducts[0].name);
    expect(screen.getAllByRole('listitem')).toHaveLength(bundledProducts.length);
  });

  it('serves only saved products once the catalogue is managed', async () => {
    stubCatalogue({
      catalogueManaged: true,
      products: [{ id: 1, name: 'Renamed Serum', category: 'Skincare', price: 900, mrp: 1200, rating: 4.5, reviews: 12, image: 'serum.jpg', description: 'Saved copy.' }],
    });
    renderCatalogue();

    await screen.findByText('Renamed Serum');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows the empty state instead of bundled samples when every product is unpublished', async () => {
    stubCatalogue({ products: [], catalogueManaged: true });
    renderCatalogue();

    await screen.findByText('Nothing in this edit just yet. Try another category.');
    expect(screen.queryByText(bundledProducts[0].name)).not.toBeInTheDocument();
  });

  it('reports a failed catalogue request and keeps the bundled samples available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    renderCatalogue();

    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    expect(screen.getByText('Failed to fetch')).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(bundledProducts.length);
  });
});
