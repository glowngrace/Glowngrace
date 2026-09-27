import { createContext, useContext } from 'react';
import { products as initialProducts, type Product } from '../data/catalog';

type ProductCatalogValue = {
  products: Product[];
  loading: boolean;
  error: string;
  addProduct: (product: Product) => void;
};

export const ProductCatalogContext = createContext<ProductCatalogValue>({
  products: initialProducts,
  loading: false,
  error: '',
  addProduct: () => undefined,
});

export function useProductCatalog() {
  return useContext(ProductCatalogContext);
}
