import { createContext, useContext } from 'react';
import type { StorefrontPage } from '../lib/api';

type StorefrontPagesValue = {
  pages: StorefrontPage[];
  loading: boolean;
  isVisible: (path: string) => boolean;
};

export const StorefrontPagesContext = createContext<StorefrontPagesValue>({
  pages: [],
  loading: false,
  isVisible: () => true,
});

export function useStorefrontPages() {
  return useContext(StorefrontPagesContext);
}
