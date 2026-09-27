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
    getCatalogueProducts().then((savedProducts) => {
      if (mounted) {
        setProducts((current) => {
          const byId = new Map(current.map((product) => [product.id, product]));
          savedProducts.forEach((product) => byId.set(product.id, product));
          return [...byId.values()];
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
