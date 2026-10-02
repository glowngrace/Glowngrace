import { useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CartProvider } from './components/Cart';
import { LoadingProvider } from './components/LoadingProvider';
import { ProductCatalogProvider } from './components/ProductCatalog';
import { PageGate, StorefrontPagesProvider } from './components/StorefrontPages';
import { Footer, Header } from './components/Layout';
import {
  AboutPage,
  CareersPage,
  ContactPage,
  HomePage,
  PartnersPage,
  ProductPage,
  ShopPage,
} from './pages/Pages';
import { LoginPage } from './pages/AuthPage';
import { SignupPage } from './pages/SignupPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import {
  AdminPortal,
  CandidatePortal,
  PartnerPortal,
  WishlistPage,
} from './pages/PortalPages';
import { CheckoutPage, OrderConfirmationPage } from './pages/CheckoutPage';
import { PartnerDetailPage } from './pages/PartnerDetailPage';

const FAVORITES_STORAGE_KEY = 'glow-grace-wishlist';

function loadFavorites(): number[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id) && id > 0) : [];
  } catch {
    return [];
  }
}

function AppRoutes() {
  const [favorites, setFavorites] = useState<number[]>(loadFavorites);
  const location = useLocation();
  const isAdminPage = location.pathname === '/admin';

  useEffect(() => {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
  }, [favorites]);

  function toggleFavorite(productId: number) {
    setFavorites((current) =>
      current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId],
    );
  }

  const pageProps = { favorites, toggleFavorite };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      {!isAdminPage && <Header />}
      <main id="main-content">
        <Routes>
          <Route path="/" element={<PageGate path="/"><HomePage {...pageProps} /></PageGate>} />
          <Route path="/shop" element={<PageGate path="/shop"><ShopPage {...pageProps} /></PageGate>} />
          <Route path="/product/:productId" element={<ProductPage {...pageProps} />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/order-confirmation" element={<OrderConfirmationPage />} />
          <Route path="/partners" element={<PageGate path="/partners"><PartnersPage /></PageGate>} />
          {/* Gated on /partners so hiding the directory hides its profiles too. */}
          <Route path="/partners/:partnerSlug" element={<PageGate path="/partners"><PartnerDetailPage /></PageGate>} />
          <Route path="/careers" element={<PageGate path="/careers"><CareersPage /></PageGate>} />
          <Route path="/about" element={<PageGate path="/about"><AboutPage /></PageGate>} />
          <Route path="/contact" element={<PageGate path="/contact"><ContactPage /></PageGate>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/wishlist" element={<WishlistPage {...pageProps} />} />
          <Route path="/candidate" element={<CandidatePortal />} />
          <Route path="/partner" element={<PartnerPortal />} />
          <Route path="/admin" element={<AdminPortal />} />
          <Route path="*" element={<div className="section"><div className="page-container empty-state"><span className="eyebrow">A little detour</span><h1>This page isn’t in our edit.</h1><p>Let’s get you back to something lovely.</p><a className="button button-dark" href="/">Back to the beauty house</a></div></div>} />
        </Routes>
      </main>
      {!isAdminPage && <Footer />}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <LoadingProvider>
        <StorefrontPagesProvider>
          <ProductCatalogProvider><CartProvider><AppRoutes /></CartProvider></ProductCatalogProvider>
        </StorefrontPagesProvider>
      </LoadingProvider>
    </BrowserRouter>
  );
}
