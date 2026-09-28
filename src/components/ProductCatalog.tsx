import { useEffect, useState, type ReactNode } from 'react';
import { products as initialProducts, type Product } from '../data/catalog';
import { getCatalogueProducts } from '../lib/api';
import { ProductCatalogContext } from './ProductCatalogContext';

export function ProductCatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState(initialProducts);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    getCatalogueProducts().then(({ products: savedProducts, managed }) => {
      if (mounted) {
        setProducts((current) => {
          // An unstocked database means the shop has never been set up, so keep the bundled
          // samples. Once products exist, the database is the only source of truth and an empty
          // list legitimately means every product is unpublished or deleted.
          if (!managed) return current;
          const byId = new Map(savedProducts.map((product) => [product.id, product]));
          return current
            .filter((product) => byId.has(product.id))
            .map((product) => byId.get(product.id) as Product)
            .concat(savedProducts.filter((product) => !current.some((entry) => entry.id === product.id)));
        });
        setError('');
        setLoading(false);
      }
    }).catch((loadError: unknown) => {
      if (mounted) {
        setError(loadError instanceof Error ? loadError.message : 'Saved products could not be loaded.');
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  function addProduct(product: Product) {
    setProducts((current) => current.some((existing) => existing.id === product.id)
      ? current.map((existing) => existing.id === product.id ? product : existing)
      : [...current, product]);
    setError('');
  }

  return (
    <ProductCatalogContext.Provider value={{ products, loading, error, addProduct }}>
      {children}
    </ProductCatalogContext.Provider>
  );
}
