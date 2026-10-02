import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { CartDrawer } from './Cart';
import { useCart } from './CartContext';
import { subscribeToNewsletter } from '../lib/api';
import { useStorefrontPages } from './StorefrontPagesContext';
import { adminApi, getSignedInAccount, sessionEndedEvent, type SignedInAccount } from '../lib/admin-api';
import { destinationForRole, isConsoleRole } from '../auth/roles';

const iconProps = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

function PhoneIcon() {
  return (
    <svg {...iconProps} width="14" height="14">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg {...iconProps} width="14" height="14">
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg {...iconProps} width="14" height="14">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

const navigation = [
  { label: 'Home', to: '/' },
  { label: 'Shop', to: '/shop' },
  { label: 'Partners', to: '/partners' },
  { label: 'Careers', to: '/careers' },
  { label: 'Our story', to: '/about' },
  { label: 'Contact', to: '/contact' },
  { label: 'Wishlist', to: '/wishlist' },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [account, setAccount] = useState<SignedInAccount | null>(getSignedInAccount);
  const { count, open } = useCart();
  const { isVisible, pages } = useStorefrontPages();
  const navigate = useNavigate();
  const profileMenuRef = useRef<HTMLDivElement>(null);

  const visibleNavigation = useMemo(
    () => navigation.filter((item) => isVisible(item.to)),
    [isVisible],
  );

  const navLabel = useMemo(() => {
    const byPath = new Map(pages.map((page) => [page.path, page.label]));
    return (path: string) => byPath.get(path) ?? null;
  }, [pages]);

  async function logout() {
    // The server session goes first, so a closed tab cannot leave a live token
    // behind. endAdminSession clears the cached account in either case.
    await adminApi.signOut();
    setAccount(null);
    setMenuOpen(false);
    setProfileMenuOpen(false);
    navigate('/');
  }

  const profileImage = account?.avatar
    || (account && !isConsoleRole(account.role) ? '/images/partner1.jpg' : '/images/logo_mark.png');

  useEffect(() => {
    function syncAccount() {
      setAccount(getSignedInAccount());
    }
    window.addEventListener(sessionEndedEvent, syncAccount);
    return () => window.removeEventListener(sessionEndedEvent, syncAccount);
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !profileMenuRef.current?.contains(event.target)) {
        setProfileMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setProfileMenuOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileMenuOpen]);

  return (
    <header className="site-header">
      <div className="announcement">
        <div className="announcement-inner">
          <span className="announcement-note">✨ Free shipping across Lucknow on orders above ₹999</span>
          <div className="announcement-links">
            <a className="announcement-link" href="tel:+918971821213"><PhoneIcon /> +91 89718 21213</a>
            <a className="announcement-link" href="https://www.instagram.com/glowngracebiz/" target="_blank" rel="noopener noreferrer" aria-label="Glow and Grace on Instagram"><InstagramIcon /> Instagram</a>
            <a className="announcement-link" href="#" aria-label="Glow and Grace on Facebook"><FacebookIcon /> Facebook</a>
          </div>
        </div>
      </div>
      <div className="header-inner">
        <button
          className="icon-button menu-toggle"
          type="button"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <span aria-hidden="true">{menuOpen ? '×' : '☰'}</span>
        </button>
        <Link className="brand" to="/" aria-label="Glow and Grace home" onClick={() => setMenuOpen(false)}>
          <img src="/images/logo_mark.png" alt="" />
          <span><strong>Glow <i>&</i> Grace</strong><small>BEAUTY · CAREERS · COMMUNITY</small></span>
        </Link>
        <nav className={`main-nav${menuOpen ? ' is-open' : ''}`} aria-label="Main navigation">
          {visibleNavigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}
            >
              {navLabel(item.to) ?? item.label}
            </NavLink>
          ))}
          {!account && <Link className="nav-account-link nav-link" to="/login" onClick={() => setMenuOpen(false)}>Sign in</Link>}
        </nav>
        <div className="header-actions">
          {account ? (
            <div className="header-account" ref={profileMenuRef}>
              <button
                className="header-profile"
                type="button"
                aria-label={`Profile menu for ${account.name}`}
                aria-haspopup="true"
                aria-expanded={profileMenuOpen}
                aria-controls="header-profile-menu"
                onClick={() => setProfileMenuOpen((open) => !open)}
              >
                <img src={profileImage} alt="" />
                    <span><strong>{account.name}</strong><small><i />Signed in · {account.role}</small></span>
                    <span className="profile-menu-chevron" aria-hidden="true">⌄</span>
                  </button>
                  {profileMenuOpen && (
                    <div className="profile-dropdown" id="header-profile-menu" aria-label="Profile menu">
                      <div className="profile-dropdown-account">
                        <img src={profileImage} alt="" />
                        <span><strong>{account.name}</strong><small>{account.email}</small></span>
                      </div>
                      <p className="profile-dropdown-status"><i />Signed in · {account.role}</p>
                      <Link to={destinationForRole(account.role)} onClick={() => setProfileMenuOpen(false)}>Go to my space</Link>
                      <button type="button" onClick={logout}>Sign out</button>
                    </div>
                  )}
            </div>
          ) : <Link className="account-link" to="/login">Sign in</Link>}
          <button className="bag-button" type="button" onClick={open} aria-label={`Open shopping bag, ${count} items`}>
            <span aria-hidden="true">Bag</span><span className="bag-count">{count}</span>
          </button>
        </div>
      </div>
      <CartDrawer />
    </header>
  );
}

export function Footer() {
  const [status, setStatus] = useState('');
  const { isVisible } = useStorefrontPages();

  async function handleSubscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = new FormData(form).get('email')?.toString() ?? '';
    setStatus('Adding you to the list…');
    try {
      const result = await subscribeToNewsletter(email);
      setStatus(result.message ?? 'You are on the list.');
      form.reset();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'We could not subscribe you right now.');
    }
  }

  return (
    <footer className="site-footer">
      <div className="footer-newsletter">
        <div>
          <span className="eyebrow">Notes from the beauty house</span>
          <h2>A little glow in your inbox.</h2>
          <p>New rituals, thoughtful edits and lovely things happening in Lucknow.</p>
        </div>
        <form className="newsletter-form" onSubmit={handleSubscribe}>
          <label className="sr-only" htmlFor="newsletter-email">Email address</label>
          <input id="newsletter-email" name="email" type="email" placeholder="Your email address" autoComplete="email" required />
          <button className="button button-dark" type="submit">Join our list</button>
          <span className="form-status" role="status">{status}</span>
        </form>
      </div>
      <div className="footer-main">
        <div className="footer-brand">
          <Link className="brand brand-footer" to="/">
            <img src="/images/logo_mark.png" alt="" />
            <span><strong>Glow <i>&</i> Grace</strong><small>BEAUTY · CAREERS · COMMUNITY</small></span>
          </Link>
          <p>A considered beauty house rooted in Lucknow, where feeling good and doing good belong together.</p>
        </div>
        <div className="footer-column"><h3>Explore</h3>{isVisible('/shop') && <Link to="/shop">The collection</Link>}{isVisible('/partners') && <Link to="/partners">Partner parlours</Link>}{isVisible('/careers') && <Link to="/careers">Beauty careers</Link>}</div>
        <div className="footer-column"><h3>Our house</h3>{isVisible('/about') && <Link to="/about">Our story</Link>}{isVisible('/contact') && <Link to="/contact">Get in touch</Link>}<a href="mailto:hello@glowandgrace.in">hello@glowandgrace.in</a></div>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} Glow &amp; Grace, Lucknow</span><span>Made with care, for the glow in all of us.</span></div>
    </footer>
  );
}

export function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="main-content">{children}</main>
      <Footer />
    </>
  );
}
