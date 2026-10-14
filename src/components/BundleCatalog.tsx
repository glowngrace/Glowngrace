import { useEffect, useState, type ReactNode } from 'react';
import { bundles as initialBundles, type Bundle } from '../data/catalog';
import { getCatalogueBundles } from '../lib/api';
import { BundleCatalogContext } from './BundleCatalogContext';

export function BundleCatalogProvider({ children }: { children: ReactNode }) {
  const [bundles, setBundles] = useState<Bundle[]>(initialBundles);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    getCatalogueBundles().then(({ bundles: savedBundles, managed }) => {
      if (mounted) {
        setBundles((current) => {
          // An unstocked database means the store was never set up, so keep the
          // bundled samples. Once bundle rows exist the database is the only
          // source of truth, and an empty list means every bundle is hidden.
          if (!managed) return current;
          const byId = new Map(savedBundles.map((bundle) => [bundle.id, bundle]));
          return current
            .filter((bundle) => byId.has(bundle.id))
            .map((bundle) => byId.get(bundle.id) as Bundle)
            .concat(savedBundles.filter((bundle) => !current.some((entry) => entry.id === bundle.id)));
        });
        setError('');
        setLoading(false);
      }
    }).catch((loadError: unknown) => {
      if (mounted) {
        setError(loadError instanceof Error ? loadError.message : 'Saved bundles could not be loaded.');
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <BundleCatalogContext.Provider value={{ bundles, loading, error }}>
      {children}
    </BundleCatalogContext.Provider>
  );
}