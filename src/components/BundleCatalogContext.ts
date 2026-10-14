import { createContext, useContext } from 'react';
import { bundles as initialBundles, type Bundle } from '../data/catalog';

type BundleCatalogValue = {
  bundles: Bundle[];
  loading: boolean;
  error: string;
};

export const BundleCatalogContext = createContext<BundleCatalogValue>({
  bundles: initialBundles,
  loading: false,
  error: '',
});

export function useBundleCatalog() {
  return useContext(BundleCatalogContext);
}