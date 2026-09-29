import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getStorefrontPages, type StorefrontPage } from '../lib/api';
import { PageLoader } from './Loader';
import { StorefrontPagesContext, useStorefrontPages } from './StorefrontPagesContext';

function normalisePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function StorefrontPagesProvider({ children }: { children: ReactNode }) {
  const [pages, setPages] = useState<StorefrontPage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    // The client API already swallows a failed request and returns an empty
    // list, but a rejection here would leave `loading` stuck on true and pin a
    // loader over the page forever. Both outcomes have to clear the flag.
    getStorefrontPages()
      .then((loaded) => {
        if (mounted) setPages(loaded);
      })
      .catch(() => {
        if (mounted) setPages([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo(() => {
    const byPath = new Map(pages.map((page) => [normalisePath(page.path), page]));
    return {
      pages,
      loading,
      isVisible: (path: string) => {
        const page = byPath.get(normalisePath(path));
        return page ? page.visible : true;
      },
    };
  }, [pages, loading]);

  return <StorefrontPagesContext.Provider value={value}>{children}</StorefrontPagesContext.Provider>;
}

export function PageGate({ path, children }: { path: string; children: ReactNode }) {
  const { isVisible, loading } = useStorefrontPages();
  // Used to render nothing at all here, which left a blank white screen for as
  // long as the visibility check took. A gated page now shows a real loader.
  if (loading) return <PageLoader label="Checking this page" />;
  if (!isVisible(path)) {
    return (
      <div className="section">
        <div className="page-container empty-state">
          <span className="eyebrow">A little detour</span>
          <h1>This page isn’t in our edit.</h1>
          <p>Let’s get you back to something lovely.</p>
          <a className="button button-dark" href="/">Back to the beauty house</a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
