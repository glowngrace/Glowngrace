import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getSignedInAccount, adminApi, type SignedInAccount } from '../lib/admin-api';
import { isConsoleRole, type PortalRole } from '../auth/roles';
import { productImageUrl } from '../data/catalog';
import { useProductCatalog } from '../components/ProductCatalogContext';
import { AdminPortal as AdminConsole } from './AdminConsole';

type PortalTab = { id: string; label: string };

const candidateTabs: PortalTab[] = [
  { id: 'applications', label: 'My applications' },
  { id: 'saved', label: 'Saved openings' },
  { id: 'training', label: 'Training & certificates' },
  { id: 'profile', label: 'Personal details' },
];
const partnerTabs: PortalTab[] = [
  { id: 'vacancies', label: 'Posted vacancies' },
  { id: 'applicants', label: 'Applicant pipeline' },
  { id: 'orders', label: 'Wholesale orders' },
  { id: 'salon', label: 'Salon details' },
];
function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="portal-table-scroll">
      <table className="portal-table">
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cellIndex}-${cell}`}>{cellIndex === row.length - 1 ? <span className="portal-status">{cell}</span> : cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function PortalContent({ role, tab }: { role: PortalRole; tab: string }) {
  if (role === 'Candidate') {
    if (tab === 'saved') return <><PortalHeading eyebrow="For another day" title="Saved openings" copy="A short list of lovely possibilities worth coming back to." /><DataTable headers={['Role', 'Salon', 'Location', 'Salary', 'Status']} rows={ [['Makeup Artist', 'Glamour Studio', 'Gomti Nagar', '₹20k – ₹30k', 'Still open'], ['Hair Stylist', 'Style Hub Salon', 'Aliganj', '₹15k – ₹22k', 'New opening'], ['Nail Art Specialist', 'The Nail Bar', 'Indira Nagar', '₹16k – ₹24k', 'Still open']] } /></>;
    if (tab === 'training') return <><PortalHeading eyebrow="Keep growing" title="Training & certificates" copy="Your next skill can open another door." /><div className="portal-course-grid"><article><span>06 weeks · Completed</span><h3>Bridal makeup &amp; airbrush</h3><p>Hands-on certification with in-studio practical training.</p><button className="portal-inline-button" type="button">View certificate ↗</button></article><article><span>04 weeks · In progress</span><h3>Hair styling &amp; spa care</h3><p>Three sessions left in your hair and scalp-care track.</p><div className="portal-progress"><span style={{ width: '68%' }} /></div><small>68% complete</small></article><article><span>Coming up</span><h3>Advanced bridal techniques</h3><p>Explore the next workshop from our skills studio.</p><Link className="portal-inline-button" to="/contact?topic=Training%20courses">Ask about this course ↗</Link></article></div></>;
    if (tab === 'profile') return <><PortalHeading eyebrow="A little about you" title="Personal details" copy="Keep your profile current so salons can get to know the real you." /><div className="portal-profile"><label>Full name<input defaultValue="Anjali Verma" /></label><label>Mobile number<input defaultValue="+91 98765 43210" /></label><label>Email address<input defaultValue="candidate@glowngrace.in" /></label><label>Experience<select defaultValue="3 years"><option>Fresher</option><option>1 year</option><option>3 years</option><option>5+ years</option></select></label><label className="portal-full-row">Your skills<input defaultValue="Bridal makeup, party makeup, skincare" /></label><button className="button button-dark" type="button">Save profile</button><span className="portal-profile-note">Salons see the details you save here.</span></div></>;
    return <><PortalHeading eyebrow="Your next chapter" title="My applications" copy="Every application is a step towards work worth celebrating." /><DataTable headers={['Role', 'Salon', 'Applied', 'Salary', 'Status']} rows={ [['Senior Beautician', 'Blush Beauty Lounge', '18 Sep 2026', '₹18k – ₹25k', 'Interview scheduled'], ['Makeup Artist', 'Glamour Studio', '15 Sep 2026', '₹20k – ₹30k', 'Application received'], ['Hair Stylist', 'Style Hub Salon', '10 Sep 2026', '₹15k – ₹22k', 'Shortlisted']] } /><div className="portal-callout"><span><strong>Two interviews coming up</strong><span>Blush Beauty Lounge · 29 September, 11:00 am</span></span><Link className="underlined-link" to="/careers">Browse openings <span>↗</span></Link></div></>;
  }
  if (role === 'Partner Salon') {
    if (tab === 'applicants') return <><PortalHeading eyebrow="People behind the applications" title="Applicant pipeline" copy="Meet the local talent who’d love to bring something special to your salon." /><DataTable headers={['Candidate', 'Applying for', 'Experience', 'Applied', 'Stage']} rows={ [['Anjali Verma', 'Senior Beautician', '3 years', '18 Sep 2026', 'Interview'], ['Meera Khan', 'Makeup Artist', '2 years', '16 Sep 2026', 'Shortlisted'], ['Riya Singh', 'Hair Stylist', 'Fresher', '15 Sep 2026', 'New applicant']] } /></>;
    if (tab === 'orders') return <><PortalHeading eyebrow="For your next restock" title="Wholesale orders" copy="Authentic favourites, delivered to your salon door." /><DataTable headers={['Order', 'Items', 'Date', 'Amount', 'Status']} rows={ [['GG-2041', '18 products', '21 Sep 2026', '₹12,480', 'Delivered'], ['GG-2022', '12 products', '08 Sep 2026', '₹8,920', 'Delivered'], ['GG-1987', '24 products', '29 Aug 2026', '₹18,200', 'Delivered']] } /><div className="portal-callout"><span><strong>Time for a little restock?</strong><span>Browse the beauty house edit and ask us about partner pricing.</span></span><Link className="underlined-link" to="/shop">Shop the collection <span>↗</span></Link></div></>;
    if (tab === 'salon') return <><PortalHeading eyebrow="Your parlour, your story" title="Salon details" copy="Help beauty lovers and talented professionals find you." /><div className="portal-profile"><label>Salon name<input defaultValue="Blush Beauty Lounge" /></label><label>Salon type<input defaultValue="Premium Unisex Salon" /></label><label>Locality<input defaultValue="Hazratganj, Lucknow" /></label><label>Established<input defaultValue="2016" /></label><label className="portal-full-row">Services offered<input defaultValue="Bridal, Hair spa, Facials, Keratin" /></label><button className="button button-dark" type="button">Save salon details</button><Link className="portal-profile-note" to="/contact?topic=Salon%20partnership">Need a hand? Contact the partner team.</Link></div></>;
    return <><PortalHeading eyebrow="Your team, growing beautifully" title="Posted vacancies" copy="Thoughtfully matched people make lovely things happen." /><DataTable headers={['Role', 'Type', 'Salary', 'Applicants', 'Status']} rows={ [['Senior Beautician', 'Full time', '₹18k – ₹25k', '12 applicants', 'Interviewing'], ['Hair Stylist', 'Full time', '₹15k – ₹22k', '6 applicants', 'Accepting applications'], ['Salon Receptionist', 'Full time', '₹12k – ₹16k', '4 applicants', 'New posting']] } /><Link className="button button-dark portal-action" to="/contact?topic=Salon%20partnership">+ Post a vacancy</Link></>;
  }
}

function PortalHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <div className="portal-content-heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{copy}</p></div>;
}

function PortalShell({ role, account, subheading, tabs, initialTab }: { role: PortalRole; account: SignedInAccount; subheading: string; tabs: PortalTab[]; initialTab: string }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(initialTab);
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  async function logout() {
    await adminApi.signOut();
    navigate('/login');
  }

  const initials = account.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'GG';
  const profileImage = account.avatar || (role === 'Candidate' ? '/images/partner2.jpg' : '/images/partner1.jpg');

  return (
    <section className={`portal-page portal-${role === 'Partner Salon' ? 'partner' : 'candidate'}`}>
      <aside className="portal-sidebar">
        <Link className="brand portal-brand" to="/"><img src="/images/logo_mark.png" alt="" /><span><strong>Glow <i>&</i> Grace</strong><small>BEAUTY · CAREERS · COMMUNITY</small></span></Link>
        <div className="portal-user"><img src={profileImage} alt="" /><span><strong>{account.name}</strong><small>{subheading}</small></span></div>
        <nav aria-label={`${role} sections`} className="portal-nav">{tabs.map((tab) => <button type="button" key={tab.id} aria-current={activeTab === tab.id ? 'page' : undefined} className={activeTab === tab.id ? 'portal-nav-button active' : 'portal-nav-button'} onClick={() => setActiveTab(tab.id)}><span aria-hidden="true">✦</span>{tab.label}</button>)}</nav>
        <div className="portal-sidebar-bottom"><Link to="/">← Back to the beauty house</Link><button type="button" onClick={logout}>Sign out</button></div>
      </aside>
      <div className="portal-workspace">
        <header className="portal-topbar"><span className="portal-breadcrumb">Your space <span>/</span> {active.label}</span><div><span className="portal-avatar">{initials}</span></div></header>
        <div className="portal-content"><PortalContent role={role} tab={activeTab} /></div>
      </div>
    </section>
  );
}

/**
 * Gates a portal on the signed-in account's own role.
 *
 * A console role is let through as well: the back office has to be able to look
 * at a partner's or a candidate's page to answer a question about it.
 */
function ProtectedPortal({ role, subheading, tabs, initialTab }: { role: PortalRole; subheading: string; tabs: PortalTab[]; initialTab: string }) {
  const navigate = useNavigate();
  const account = getSignedInAccount();
  if (!account || (account.role !== role && !isConsoleRole(account.role))) {
    return (
      <section className="portal-locked">
        <span className="eyebrow">Your space is waiting</span>
        <h1>Sign in to continue.</h1>
        <p>Sign in with the account registered for this space. If you do not have one yet, you can request it.</p>
        <div className="portal-locked-actions">
          <button className="button button-dark" type="button" onClick={() => navigate('/login')}>Go to sign in</button>
          <Link className="button button-light" to="/signup">Request an account</Link>
        </div>
      </section>
    );
  }
  return <PortalShell role={role} account={account} subheading={subheading} tabs={tabs} initialTab={initialTab} />;
}

export function CandidatePortal() {
  return <ProtectedPortal role="Candidate" subheading="Candidate · Lucknow" tabs={candidateTabs} initialTab="applications" />;
}

export function PartnerPortal() {
  return <ProtectedPortal role="Partner Salon" subheading="Partner salon" tabs={partnerTabs} initialTab="vacancies" />;
}

export function AdminPortal() {
  return <AdminConsole />;
}

export function WishlistPage({ favorites, toggleFavorite }: { favorites: number[]; toggleFavorite: (productId: number) => void }) {
  const { products } = useProductCatalog();
  const savedProducts = products.filter((product) => favorites.includes(product.id));
  return (
    <section className="section">
      <div className="page-container wishlist-page">
        <span className="eyebrow">Little things you love</span>
        <h1>Your Wishlist</h1>
        <span className="gold-rule" />
        {favorites.length === 0
          ? <><p>Your saved beauty edit is waiting to take shape.</p><Link className="button button-dark" to="/shop">Explore the collection</Link></>
          : <div className="portal-saved-products">{savedProducts.map((product) => <article className="wishlist-card" key={product.id}><Link to={`/product/${product.id}`}><img src={productImageUrl(product.image)} alt={product.name} /><span>{product.category}</span><h2>{product.name}</h2></Link><p>₹{product.price.toLocaleString('en-IN')}</p><button type="button" onClick={() => toggleFavorite(product.id)}>Remove from wishlist</button></article>)}</div>}
      </div>
    </section>
  );
}
