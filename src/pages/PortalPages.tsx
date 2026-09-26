import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDemoAccount, signOutDemo, type DemoRole } from '../auth/demo-auth';
import { products } from '../data/catalog';

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
const adminTabs: PortalTab[] = [
  { id: 'overview', label: 'Business overview' },
  { id: 'orders', label: 'All orders' },
  { id: 'products', label: 'Catalogue & inventory' },
  { id: 'add-product', label: 'Add a product' },
  { id: 'candidates', label: 'Candidate pipeline' },
  { id: 'partners', label: 'Partner salons' },
];

function MetricCard({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="portal-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

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

function PortalContent({ role, tab, onTabChange }: { role: DemoRole; tab: string; onTabChange: (tab: string) => void }) {
  if (role === 'candidate') {
    if (tab === 'saved') return <><PortalHeading eyebrow="For another day" title="Saved openings" copy="A short list of lovely possibilities worth coming back to." /><DataTable headers={['Role', 'Salon', 'Location', 'Salary', 'Status']} rows={ [['Makeup Artist', 'Glamour Studio', 'Gomti Nagar', '₹20k – ₹30k', 'Still open'], ['Hair Stylist', 'Style Hub Salon', 'Aliganj', '₹15k – ₹22k', 'New opening'], ['Nail Art Specialist', 'The Nail Bar', 'Indira Nagar', '₹16k – ₹24k', 'Still open']] } /></>;
    if (tab === 'training') return <><PortalHeading eyebrow="Keep growing" title="Training & certificates" copy="Your next skill can open another door." /><div className="portal-course-grid"><article><span>06 weeks · Completed</span><h3>Bridal makeup &amp; airbrush</h3><p>Hands-on certification with in-studio practical training.</p><button className="portal-inline-button" type="button">View certificate ↗</button></article><article><span>04 weeks · In progress</span><h3>Hair styling &amp; spa care</h3><p>Three sessions left in your hair and scalp-care track.</p><div className="portal-progress"><span style={{ width: '68%' }} /></div><small>68% complete</small></article><article><span>Coming up</span><h3>Advanced bridal techniques</h3><p>Explore the next workshop from our skills studio.</p><Link className="portal-inline-button" to="/contact?topic=Training%20courses">Ask about this course ↗</Link></article></div></>;
    if (tab === 'profile') return <><PortalHeading eyebrow="A little about you" title="Personal details" copy="Keep your profile current so salons can get to know the real you." /><div className="portal-profile"><label>Full name<input defaultValue="Anjali Verma" /></label><label>Mobile number<input defaultValue="+91 98765 43210" /></label><label>Email address<input defaultValue="candidate@glowngrace.in" /></label><label>Experience<select defaultValue="3 years"><option>Fresher</option><option>1 year</option><option>3 years</option><option>5+ years</option></select></label><label className="portal-full-row">Your skills<input defaultValue="Bridal makeup, party makeup, skincare" /></label><button className="button button-dark" type="button">Save profile</button><span className="portal-profile-note">Your sample profile is for preview only.</span></div></>;
    return <><PortalHeading eyebrow="Your next chapter" title="My applications" copy="Every application is a step towards work worth celebrating." /><DataTable headers={['Role', 'Salon', 'Applied', 'Salary', 'Status']} rows={ [['Senior Beautician', 'Blush Beauty Lounge', '18 Sep 2026', '₹18k – ₹25k', 'Interview scheduled'], ['Makeup Artist', 'Glamour Studio', '15 Sep 2026', '₹20k – ₹30k', 'Application received'], ['Hair Stylist', 'Style Hub Salon', '10 Sep 2026', '₹15k – ₹22k', 'Shortlisted']] } /><div className="portal-callout"><span><strong>Two interviews coming up</strong><span>Blush Beauty Lounge · 29 September, 11:00 am</span></span><Link className="underlined-link" to="/careers">Browse openings <span>↗</span></Link></div></>;
  }
  if (role === 'partner') {
    if (tab === 'applicants') return <><PortalHeading eyebrow="People behind the applications" title="Applicant pipeline" copy="Meet the local talent who’d love to bring something special to your salon." /><DataTable headers={['Candidate', 'Applying for', 'Experience', 'Applied', 'Stage']} rows={ [['Anjali Verma', 'Senior Beautician', '3 years', '18 Sep 2026', 'Interview'], ['Meera Khan', 'Makeup Artist', '2 years', '16 Sep 2026', 'Shortlisted'], ['Riya Singh', 'Hair Stylist', 'Fresher', '15 Sep 2026', 'New applicant']] } /></>;
    if (tab === 'orders') return <><PortalHeading eyebrow="For your next restock" title="Wholesale orders" copy="Authentic favourites, delivered to your salon door." /><DataTable headers={['Order', 'Items', 'Date', 'Amount', 'Status']} rows={ [['GG-2041', '18 products', '21 Sep 2026', '₹12,480', 'Delivered'], ['GG-2022', '12 products', '08 Sep 2026', '₹8,920', 'Delivered'], ['GG-1987', '24 products', '29 Aug 2026', '₹18,200', 'Delivered']] } /><div className="portal-callout"><span><strong>Time for a little restock?</strong><span>Browse the beauty house edit and ask us about partner pricing.</span></span><Link className="underlined-link" to="/shop">Shop the collection <span>↗</span></Link></div></>;
    if (tab === 'salon') return <><PortalHeading eyebrow="Your parlour, your story" title="Salon details" copy="Help beauty lovers and talented professionals find you." /><div className="portal-profile"><label>Salon name<input defaultValue="Blush Beauty Lounge" /></label><label>Salon type<input defaultValue="Premium Unisex Salon" /></label><label>Locality<input defaultValue="Hazratganj, Lucknow" /></label><label>Established<input defaultValue="2016" /></label><label className="portal-full-row">Services offered<input defaultValue="Bridal, Hair spa, Facials, Keratin" /></label><button className="button button-dark" type="button">Save salon details</button><Link className="portal-profile-note" to="/contact?topic=Salon%20partnership">Need a hand? Contact the partner team.</Link></div></>;
    return <><PortalHeading eyebrow="Your team, growing beautifully" title="Posted vacancies" copy="Thoughtfully matched people make lovely things happen." /><DataTable headers={['Role', 'Type', 'Salary', 'Applicants', 'Status']} rows={ [['Senior Beautician', 'Full time', '₹18k – ₹25k', '12 applicants', 'Interviewing'], ['Hair Stylist', 'Full time', '₹15k – ₹22k', '6 applicants', 'Accepting applications'], ['Salon Receptionist', 'Full time', '₹12k – ₹16k', '4 applicants', 'New posting']] } /><Link className="button button-dark portal-action" to="/contact?topic=Salon%20partnership">+ Post a vacancy</Link></>;
  }
  if (role === 'admin') {
    if (tab === 'orders') return <><PortalHeading eyebrow="A considered overview" title="All orders" copy="A closer look at what the community has brought home." /><DataTable headers={['Order', 'Customer', 'Items', 'Date', 'Amount', 'Status']} rows={ [['GG-2041', 'Ritika Srivastava', '3 products', '26 Sep 2026', '₹2,497', 'Processing'], ['GG-2040', 'Priya Sharma', '1 product', '26 Sep 2026', '₹849', 'Dispatched'], ['GG-2039', 'Sana Khan', '8 products', '25 Sep 2026', '₹8,640', 'Delivered']] } /></>;
    if (tab === 'products') return <><PortalHeading eyebrow="A little care in the catalogue" title="Catalogue & inventory" copy="Keep the beauty-house favourites ready to find." /><DataTable headers={['Product', 'Category', 'Price', 'Stock', 'Rating', 'Status']} rows={ [['Velvet Matte Luxe Liquid Lipstick', 'Makeup', '₹599', '84 units', '★ 4.8', 'In stock'], ['Glow Ritual Vitamin C Face Serum', 'Skincare', '₹849', '42 units', '★ 4.9', 'In stock'], ['Radiance Ritual Glow Kit', 'Gifting', '₹2,499', '6 units', '★ 4.9', 'Low stock']] } /><button className="button button-dark portal-action" type="button" onClick={() => onTabChange('add-product')}>+ Add a product</button></>;
    if (tab === 'add-product') return <AddProductForm onCancel={() => onTabChange('products')} />;
    if (tab === 'candidates') return <><PortalHeading eyebrow="Building beauty careers" title="Candidate pipeline" copy="Good work begins with making space for good people." /><DataTable headers={['Candidate', 'Skill', 'Experience', 'Applied to', 'Stage']} rows={ [['Anjali Verma', 'Makeup', '3 years', 'Blush Beauty Lounge', 'Interview'], ['Meera Khan', 'Hair & spa', '2 years', 'Style Hub Salon', 'Shortlisted'], ['Riya Singh', 'Nail art', 'Fresher', 'The Nail Bar', 'Profile review']] } /></>;
    if (tab === 'partners') return <><PortalHeading eyebrow="Our Lucknow community" title="Partner salons" copy="Local beauty houses, building something good together." /><DataTable headers={['Salon', 'Locality', 'Type', 'Vacancies', 'Rating', 'Status']} rows={ [['Blush Beauty Lounge', 'Hazratganj', 'Premium Unisex', '3 open', '★ 4.9', 'Verified'], ['Elegance Bridal House', 'Mahanagar', 'Bridal & Occasion', '2 open', '★ 5.0', 'Verified'], ['The Nail Bar', 'Indira Nagar', 'Nail Art & Spa', '1 open', '★ 4.9', 'Review pending']] } /></>;
    return <><PortalHeading eyebrow="A complete beauty & career destination" title="Business overview" copy="A considered overview of our little corner of Lucknow." /><div className="portal-metric-grid"><MetricCard label="Revenue (this month)" value="₹6.42L" note="↑ 18% from last month" /><MetricCard label="Orders" value="412" note="↑ 9% this month" /><MetricCard label="Placements" value="27" note="6 pending offers" /><MetricCard label="Active partners" value="150" note="3 awaiting approval" /></div><div className="portal-dashboard-grid"><section className="portal-panel"><h3>Revenue by category</h3><div className="revenue-bars"><span><i style={{ height: '82%' }} /><small>Makeup</small></span><span><i style={{ height: '61%' }} /><small>Skincare</small></span><span><i style={{ height: '44%' }} /><small>Fragrance</small></span><span><i style={{ height: '32%' }} /><small>Gifting</small></span></div></section><section className="portal-panel"><h3>Needs a little attention</h3><div className="portal-alert"><span>✦</span>3 partner salons are ready for approval.</div><div className="portal-alert"><span>✦</span>6 beauty professionals are awaiting offer follow-up.</div><div className="portal-alert"><span>✦</span>Glow Ritual Serum is running low.</div></section></div></>;
  }
}

function AddProductForm({ onCancel }: { onCancel: () => void }) {
  const [notice, setNotice] = useState('');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice('This form is a demo preview. Product creation is not connected to a catalogue service yet.');
  }

  return (
    <>
      <PortalHeading eyebrow="Grow the beauty edit" title="Add a product" copy="Enter the details for a new catalogue item." />
      <form className="portal-profile" onSubmit={handleSubmit}>
        <label className="portal-full-row">Product name<input name="name" required /></label>
        <label>Category<select name="category" defaultValue="" required><option value="" disabled>Select a category</option><option>Makeup</option><option>Skincare</option><option>Fragrance</option><option>Gifting</option></select></label>
        <label>Price (₹)<input name="price" type="number" min="1" step="1" required /></label>
        <label>Original price (₹)<input name="mrp" type="number" min="1" step="1" required /></label>
        <label>Stock quantity<input name="stock" type="number" min="0" step="1" required /></label>
        <label className="portal-full-row">Image filename<input name="image" placeholder="product-image.jpg" required /></label>
        <label className="portal-full-row">Description<textarea className="portal-textarea" name="description" rows={4} required /></label>
        <div className="portal-form-actions"><button className="button button-dark" type="submit">Preview product</button><button className="portal-inline-button" type="button" onClick={onCancel}>Cancel</button></div>
        {notice && <p className="portal-form-notice" role="status">{notice}</p>}
      </form>
    </>
  );
}

function PortalHeading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <div className="portal-content-heading"><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{copy}</p></div>;
}

function PortalShell({ role, name, subheading, tabs, initialTab }: { role: DemoRole; name: string; subheading: string; tabs: PortalTab[]; initialTab: string }) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(initialTab);
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  function logout() {
    signOutDemo();
    navigate('/');
  }

  const account: { initials: string; image?: string; greeting: string } = role === 'candidate'
    ? { initials: 'AV', image: '/images/partner2.jpg', greeting: name }
    : role === 'partner'
      ? { initials: 'BL', image: '/images/partner1.jpg', greeting: name }
      : { initials: 'GG', greeting: 'Glow & Grace' };

  return (
    <section className={`portal-page portal-${role}`}>
      <aside className="portal-sidebar">
        <Link className="brand portal-brand" to="/"><img src="/images/logo_mark.png" alt="" /><span><strong>Glow <i>&</i> Grace</strong><small>BEAUTY · CAREERS · COMMUNITY</small></span></Link>
        {role !== 'admin' && <div className="portal-user">{account.image ? <img src={account.image} alt="" /> : <span className="portal-user-initials" aria-hidden="true">{account.initials}</span>}<span><strong>{account.greeting}</strong><small>{subheading}</small></span></div>}
        <nav aria-label="Dashboard sections" className="portal-nav">{tabs.map((tab) => <button type="button" key={tab.id} aria-current={activeTab === tab.id ? 'page' : undefined} className={activeTab === tab.id ? 'portal-nav-button active' : 'portal-nav-button'} onClick={() => setActiveTab(tab.id)}><span aria-hidden="true">✦</span>{tab.label}</button>)}</nav>
        <div className="portal-sidebar-bottom"><Link to="/">← Back to the beauty house</Link><button type="button" onClick={logout}>Sign out</button></div>
      </aside>
      <div className="portal-workspace">
        <header className="portal-topbar"><span className="portal-breadcrumb">Your space <span>/</span> {active.label}</span><div><span className="demo-preview-label">DEMO PREVIEW</span><span className="portal-avatar">{account.initials}</span></div></header>
        <div className="portal-content"><PortalContent role={role} tab={activeTab} onTabChange={setActiveTab} /></div>
      </div>
    </section>
  );
}

function ProtectedPortal({ role, name, subheading, tabs, initialTab }: { role: DemoRole; name: string; subheading: string; tabs: PortalTab[]; initialTab: string }) {
  const navigate = useNavigate();
  const account = getDemoAccount();
  if (account?.role !== role && account?.role !== 'admin') {
    return <section className="portal-locked"><span className="eyebrow">Your space is waiting</span><h1>Sign in to continue.</h1><p>Sign in with the matching demo account to see this dashboard.</p><button className="button button-dark" type="button" onClick={() => navigate('/login')}>Go to sign in</button></section>;
  }
  return <PortalShell role={role} name={name} subheading={subheading} tabs={tabs} initialTab={initialTab} />;
}

export function CandidatePortal() {
  return <ProtectedPortal role="candidate" name="Anjali Verma" subheading="Senior Beautician · Lucknow" tabs={candidateTabs} initialTab="applications" />;
}

export function PartnerPortal() {
  return <ProtectedPortal role="partner" name="Blush Beauty Lounge" subheading="Premium salon · Hazratganj" tabs={partnerTabs} initialTab="vacancies" />;
}

export function AdminPortal() {
  return <ProtectedPortal role="admin" name="Business overview" subheading="Glow & Grace administration" tabs={adminTabs} initialTab="overview" />;
}

export function WishlistPage({ favorites, toggleFavorite }: { favorites: number[]; toggleFavorite: (productId: number) => void }) {
  const savedProducts = products.filter((product) => favorites.includes(product.id));
  return (
    <section className="section">
      <div className="page-container wishlist-page">
        <span className="eyebrow">Little things you love</span>
        <h1>Your Wishlist</h1>
        <span className="gold-rule" />
        {favorites.length === 0
          ? <><p>Your saved beauty edit is waiting to take shape.</p><Link className="button button-dark" to="/shop">Explore the collection</Link></>
          : <div className="portal-saved-products">{savedProducts.map((product) => <article className="wishlist-card" key={product.id}><Link to={`/product/${product.id}`}><img src={`/images/${product.image}`} alt={product.name} /><span>{product.category}</span><h2>{product.name}</h2></Link><p>₹{product.price.toLocaleString('en-IN')}</p><button type="button" onClick={() => toggleFavorite(product.id)}>Remove from wishlist</button></article>)}</div>}
      </div>
    </section>
  );
}
