import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDemoAccount, signOutDemo } from '../auth/demo-auth';
import { useProductCatalog } from '../components/ProductCatalogContext';
import { productImageUrl, type Product } from '../data/catalog';
import {
  jobAreas,
  money,
  seedAlerts,
  seedCandidates,
  seedCustomers,
  seedJobs,
  seedOrders,
  seedPartners,
  seedReviews,
  stockStatus,
  type AdminSection,
  type IconName,
} from './admin/AdminData';
import {
  Avatar,
  DataTable,
  Empty,
  FilterBar,
  Icon,
  IconButton,
  Modal,
  PageHead,
  Panel,
  PanelHead,
  Pill,
  Seal,
  StarInput,
  Stars,
  TagInput,
  Toast,
  Toggle,
} from './admin/AdminUi';
import { DashboardPage } from './admin/DashboardPage';
import { ProductFormPage } from './admin/ProductFormPage';
import { SettingsPage } from './admin/SettingsPage';

type NavItem = { id: AdminSection; label: string; icon: IconName; count?: number };

const primaryNav: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dash' },
  { id: 'orders', label: 'Orders', icon: 'cart' },
  { id: 'products', label: 'Products', icon: 'box' },
  { id: 'jobs', label: 'Job vacancies', icon: 'case' },
  { id: 'candidates', label: 'Candidates', icon: 'users' },
  { id: 'partners', label: 'Partner salons', icon: 'shop' },
  { id: 'customers', label: 'Customers', icon: 'heart' },
  { id: 'reviews', label: 'Reviews', icon: 'star' },
];

const createNav: NavItem[] = [
  { id: 'add-product', label: 'Add product', icon: 'plus' },
  { id: 'add-job', label: 'Post a vacancy', icon: 'plus' },
  { id: 'add-review', label: 'Add a review', icon: 'plus' },
];

const systemNav: NavItem[] = [
  { id: 'settings', label: 'Settings', icon: 'cog' },
];

const sectionLabels: Record<AdminSection, string> = {
  dashboard: 'Dashboard',
  orders: 'Orders',
  products: 'Products',
  'add-product': 'Add product',
  jobs: 'Job vacancies',
  'add-job': 'Post a vacancy',
  candidates: 'Candidates',
  partners: 'Partner salons',
  customers: 'Customers',
  reviews: 'Reviews',
  'add-review': 'Add a review',
  settings: 'Settings',
};

type ModalState =
  | { kind: 'order'; id: string }
  | { kind: 'product'; id: number }
  | { kind: 'job'; id: string }
  | { kind: 'candidate'; id: string }
  | { kind: 'partner'; id: string }
  | { kind: 'customer'; id: string }
  | { kind: 'review'; id: string }
  | { kind: 'remove-product'; id: number }
  | null;

const defaultStock = [84, 36, 21, 42, 18, 8, 14, 6, 24, 11];
const unitSpread = [184, 152, 121, 98, 74, 61, 47, 33, 22, 15];

function stockFor(product: Product, index: number) {
  return product.stock ?? defaultStock[index % defaultStock.length] ?? 0;
}

function exportRows(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="admin-detail-row"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function AdminPortal() {
  const navigate = useNavigate();
  const account = getDemoAccount();
  const { products: catalogueProducts, error: catalogueError, addProduct } = useProductCatalog();

  const [section, setSection] = useState<AdminSection>('dashboard');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [navOpen, setNavOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

  const [orders, setOrders] = useState(seedOrders);
  const [jobs, setJobs] = useState(seedJobs);
  const [partners, setPartners] = useState(seedPartners);
  const [reviews, setReviews] = useState(seedReviews);
  const [drafts, setDrafts] = useState<number[]>([]);
  const customers = seedCustomers;

  const products = useMemo(
    () => catalogueProducts.map((product, index) => ({ ...product, stock: stockFor(product, index) })),
    [catalogueProducts],
  );

  const dashboardRows = useMemo(
    () => products.map((product, index) => {
      const units = unitSpread[index % unitSpread.length] ?? 12;
      return {
        id: product.id,
        name: product.name,
        category: product.category,
        price: product.price,
        image: product.image,
        imageUrl: productImageUrl(product.image),
        units,
        revenue: units * product.price,
      };
    }),
    [products],
  );

  const imageLibrary = useMemo(
    () => dashboardRows.map((row) => ({ name: `${row.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}.jpg`, src: row.imageUrl })),
    [dashboardRows],
  );

  function notify(message: string) {
    setToast(message);
  }

  function go(next: AdminSection) {
    setSection(next);
    setSearch('');
    setFilter('All');
    setNavOpen(false);
    setModal(null);
    setQuickOpen(false);
  }

  function logout() {
    signOutDemo();
    navigate('/');
  }

  const matches = (text: string) => text.toLowerCase().includes(search.toLowerCase().trim());
  const byChip = <T,>(rows: T[], chip: (row: T) => string) => rows.filter((row) => (filter === 'All' || chip(row) === filter));

  const navWithCounts = (items: NavItem[]): NavItem[] => items.map((item) => ({
    ...item,
    count: item.id === 'orders' ? orders.length
      : item.id === 'products' ? products.length
        : item.id === 'jobs' ? jobs.filter((job) => job.status === 'Open').length
          : item.id === 'candidates' ? seedCandidates.length
            : item.id === 'partners' ? partners.length
              : item.id === 'customers' ? customers.length
                : item.id === 'reviews' ? reviews.length
                  : undefined,
  }));

  function renderOrderDetail(orderId: string) {
    const order = orders.find((entry) => entry.id === orderId);
    if (!order) return null;
    return (
      <>
        <div className="admin-detail-hero">
          <span className="admin-detail-id">{order.id}</span>
          <Pill label={order.status} />
        </div>
        <dl className="admin-detail-list">
          <DetailRow label="Customer">{order.customer}<small>{order.email}</small></DetailRow>
          <DetailRow label="Items">{order.items} product{order.items === 1 ? '' : 's'}</DetailRow>
          <DetailRow label="Placed">{order.date}</DetailRow>
          <DetailRow label="Total"><strong>{money(order.total)}</strong></DetailRow>
          <DetailRow label="Payment">Cash on delivery / UPI</DetailRow>
          <DetailRow label="Delivery address">12/4 Park Road, Hazratganj, Lucknow 226001</DetailRow>
        </dl>
        <div className="admin-order-flow">
          {['Placed', 'Processing', 'Shipped', 'Delivered'].map((step) => (
            <span key={step} className={order.status === step || (order.status === 'Packed' && step === 'Processing') ? 'is-done' : ''}>{step}</span>
          ))}
        </div>
      </>
    );
  }

  function renderProductDetail(productId: number) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) return null;
    const gallery = product.images?.length ? product.images : [product.image];
    return (
      <>
        <div className="admin-product-detail">
          <div className="admin-product-gallery">
            {gallery.map((image, index) => <img key={`${image}-${index}`} src={productImageUrl(image)} alt="" loading="lazy" />)}
          </div>
          <div className="admin-product-summary">
            <span className="admin-muted">{product.category}</span>
            <h3>{product.name}</h3>
            <div className="admin-product-rating"><Stars rating={product.rating} /><span>{product.rating.toFixed(1)} · {product.reviews} reviews</span></div>
            <p className="admin-detail-price">{money(product.price)}{product.mrp > product.price && <del>{money(product.mrp)}</del>}</p>
            <Pill label={drafts.includes(product.id) ? 'Draft' : stockStatus(product.stock)} />
            <p className="admin-detail-copy">{product.description}</p>
          </div>
        </div>
        <dl className="admin-detail-list">
          <DetailRow label="SKU">{product.sku || 'Not set'}</DetailRow>
          <DetailRow label="Brand">{product.brand || 'Not set'}</DetailRow>
          <DetailRow label="Stock">{product.stock} units</DetailRow>
          <DetailRow label="Badge">{product.badge || 'None'}</DetailRow>
        </dl>
      </>
    );
  }

  function renderJobDetail(jobId: string) {
    const job = jobs.find((entry) => entry.id === jobId);
    if (!job) return null;
    return (
      <>
        <div className="admin-detail-hero">
          <span className="admin-detail-id">{job.id}</span>
          <Pill label={job.status} />
        </div>
        <dl className="admin-detail-list">
          <DetailRow label="Position">{job.title}</DetailRow>
          <DetailRow label="Parlour">{job.partner}</DetailRow>
          <DetailRow label="Location">{job.area}</DetailRow>
          <DetailRow label="Employment">{job.type}</DetailRow>
          <DetailRow label="Salary">{job.salary}</DetailRow>
          <DetailRow label="Applicants"><strong>{job.applications}</strong></DetailRow>
        </dl>
        <p className="admin-muted">Placements listings are preview data in this console. Publishing is handled by the partner salon.</p>
      </>
    );
  }

  function renderCandidateDetail(candidateId: string) {
    const candidate = seedCandidates.find((entry) => entry.id === candidateId);
    if (!candidate) return null;
    return (
      <>
        <div className="admin-person">
          <Avatar src={candidate.avatar} name={candidate.name} round />
          <div><h3>{candidate.name}</h3><p>{candidate.role} · {candidate.city}</p></div>
          <Pill label={candidate.stage} />
        </div>
        <dl className="admin-detail-list">
          <DetailRow label="Reference">{candidate.id}</DetailRow>
          <DetailRow label="Experience">{candidate.experience}</DetailRow>
          <DetailRow label="Rating"><Stars rating={candidate.rating} /></DetailRow>
          <DetailRow label="Stage">{candidate.stage}</DetailRow>
        </dl>
      </>
    );
  }

  function renderPartnerDetail(partnerId: string) {
    const partner = partners.find((entry) => entry.id === partnerId);
    if (!partner) return null;
    return (
      <>
        <div className="admin-person">
          <Avatar src={partner.avatar} name={partner.name} round />
          <div><h3>{partner.name}</h3><p>{partner.type} · {partner.area}</p></div>
          <Pill label={partner.status} />
        </div>
        <dl className="admin-detail-list">
          <DetailRow label="Reference">{partner.id}</DetailRow>
          <DetailRow label="Owner">{partner.owner}</DetailRow>
          <DetailRow label="Phone">{partner.phone}</DetailRow>
          <DetailRow label="Email">{partner.email}</DetailRow>
          <DetailRow label="Partner since">{partner.since}</DetailRow>
          <DetailRow label="Rating"><Stars rating={partner.rating} /></DetailRow>
          <DetailRow label="Open vacancies">{partner.vacancies}</DetailRow>
        </dl>
      </>
    );
  }

  function renderCustomerDetail(customerId: string) {
    const customer = customers.find((entry) => entry.id === customerId);
    if (!customer) return null;
    return (
      <>
        <div className="admin-person">
          <Avatar name={customer.name} round />
          <div><h3>{customer.name}</h3><p>{customer.email}</p></div>
          <Pill label={customer.tier} />
        </div>
        <dl className="admin-detail-list">
          <DetailRow label="Reference">{customer.id}</DetailRow>
          <DetailRow label="Orders"><strong>{customer.orders}</strong></DetailRow>
          <DetailRow label="Lifetime value"><strong>{money(customer.spent)}</strong></DetailRow>
          <DetailRow label="Last order">{customer.last}</DetailRow>
        </dl>
      </>
    );
  }

  function renderReviewDetail(reviewId: string) {
    const review = reviews.find((entry) => entry.id === reviewId);
    if (!review) return null;
    return (
      <>
        <div className="admin-person">
          <Avatar src={review.avatar} name={review.author} round />
          <div><h3>{review.author}</h3><p>{review.product}</p></div>
          <Pill label={review.status} />
        </div>
        <blockquote className="admin-quote"><Stars rating={review.rating} /><p>“{review.text}”</p></blockquote>
        <dl className="admin-detail-list">
          <DetailRow label="Reference">{review.id}</DetailRow>
          <DetailRow label="Reviewed on">{review.date}</DetailRow>
          <DetailRow label="Status">{review.status}</DetailRow>
        </dl>
      </>
    );
  }

  function renderJobForm() {
    return (
      <JobForm
        onCancel={() => go('jobs')}
        onSave={(job) => {
          setJobs((current) => [job, ...current]);
          notify(`${job.title} saved as a draft vacancy.`);
          go('jobs');
        }}
      />
    );
  }

  function renderReviewForm() {
    return <ReviewForm onCancel={() => go('reviews')} onSave={(review) => { setReviews((current) => [review, ...current]); notify('Review added to the moderation list.'); go('reviews'); }} />;
  }

  function renderSection(): ReactNode {
    if (section === 'dashboard') {
      return (
        <DashboardPage
          products={dashboardRows}
          orders={orders}
          alerts={seedAlerts}
          openAlerts={alertsOpen}
          onToggleAlerts={() => setAlertsOpen((current) => !current)}
          onAddProduct={() => go('add-product')}
          onExport={() => { exportRows('glow-grace-dashboard.csv', [['Metric', 'Value'], ['Revenue (MTD)', '₹6.42L'], ['Orders', orders.length], ['Customers', customers.length], ['Open roles', jobs.filter((job) => job.status === 'Open').length]]); notify('Dashboard report downloaded.'); }}
          onOpenOrders={() => go('orders')}
          onOpenJobs={() => go('jobs')}
          onOpenOrder={(orderId) => setModal({ kind: 'order', id: orderId })}
          onOpenProduct={(productId) => setModal({ kind: 'product', id: productId })}
          adminName={account?.name ?? 'Administrator'}
        />
      );
    }

    if (section === 'orders') {
      const visible = byChip(orders, (order) => order.status).filter((order) => matches(`${order.id} ${order.customer} ${order.email}`));
      return (
        <>
          <PageHead
            crumb="Orders"
            title="Orders"
            sub={`${orders.length} orders placed to date.`}
            actions={<button className="admin-btn admin-btn-light" type="button" onClick={() => { exportRows('glow-grace-orders.csv', [['Order', 'Customer', 'Email', 'Items', 'Date', 'Total', 'Status'], ...visible.map((order) => [order.id, order.customer, order.email, order.items, order.date, order.total, order.status])]); notify('Orders exported as CSV.'); }}>Export CSV</button>}
          />
          <FilterBar
            options={['All', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Returned', 'Cancelled']}
            value={filter}
            onChange={setFilter}
            search={search}
            onSearch={setSearch}
            placeholder="Search order or customer"
          />
          <Panel>
            {visible.length === 0
              ? <Empty message="No orders match this filter." action={<button className="admin-btn admin-btn-light" type="button" onClick={() => { setFilter('All'); setSearch(''); }}>Clear filters</button>} />
              : <DataTable head={['Order', 'Customer', 'Items', 'Date', 'Total', 'Status', '']} minWidth={860}>
                {visible.map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.id}</strong></td>
                    <td>{order.customer}<small className="admin-cell-sub">{order.email}</small></td>
                    <td>{order.items}</td>
                    <td>{order.date}</td>
                    <td><strong>{money(order.total)}</strong></td>
                    <td><Pill label={order.status} /></td>
                    <td className="admin-row-actions">
                      <IconButton label={`View ${order.id}`} icon="eye" onClick={() => setModal({ kind: 'order', id: order.id })} />
                      <IconButton
                        label={`Update ${order.id}`}
                        icon="pen"
                        onClick={() => {
                          const flow = ['Processing', 'Packed', 'Shipped', 'Delivered'];
                          const next = flow[Math.min(flow.indexOf(order.status) + 1, flow.length - 1)] ?? 'Delivered';
                          setOrders((current) => current.map((entry) => (entry.id === order.id ? { ...entry, status: next } : entry)));
                          notify(`${order.id} moved to ${next}.`);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'products') {
      const statusOf = (product: (typeof products)[number]) => (drafts.includes(product.id) ? 'Draft' : stockStatus(product.stock));
      const visible = byChip(products, statusOf).filter((product) => matches(`${product.name} ${product.category} ${product.sku ?? ''}`));
      return (
        <>
          <PageHead
            crumb="Products"
            title="Products"
            sub={`${products.length} products in the catalogue.`}
            actions={<button className="admin-btn admin-btn-dark" type="button" onClick={() => go('add-product')}><Icon name="plus" />Add a product</button>}
          />
          <FilterBar
            options={['All', 'Active', 'Low stock', 'Out of stock', 'Draft']}
            value={filter}
            onChange={setFilter}
            search={search}
            onSearch={setSearch}
            placeholder="Search product or SKU"
          />
          <Panel>
            {visible.length === 0
              ? <Empty message="No products match this filter." action={<button className="admin-btn admin-btn-light" type="button" onClick={() => { setFilter('All'); setSearch(''); }}>Clear filters</button>} />
              : <DataTable head={['Product', 'Category', 'Price', 'Stock', 'Rating', 'Status', '']} minWidth={920}>
                {visible.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <button className="admin-product-cell" type="button" onClick={() => setModal({ kind: 'product', id: product.id })}>
                        <img src={productImageUrl(product.image)} alt="" loading="lazy" />
                        <span><strong>{product.name}</strong><small>{product.sku || 'No SKU'}</small></span>
                      </button>
                    </td>
                    <td>{product.category}</td>
                    <td><strong>{money(product.price)}</strong></td>
                    <td>{product.stock}</td>
                    <td><Stars rating={product.rating} /></td>
                    <td><Pill label={statusOf(product)} /></td>
                    <td className="admin-row-actions">
                      <IconButton label={`View ${product.name}`} icon="eye" onClick={() => setModal({ kind: 'product', id: product.id })} />
                      <IconButton
                        label={`Toggle draft for ${product.name}`}
                        icon={drafts.includes(product.id) ? 'check' : 'hide'}
                        onClick={() => {
                          setDrafts((current) => (current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id]));
                          notify(drafts.includes(product.id) ? `${product.name} is live in the catalogue.` : `${product.name} moved to drafts.`);
                        }}
                      />
                      <IconButton label={`Remove ${product.name}`} icon="trash" danger onClick={() => setModal({ kind: 'remove-product', id: product.id })} />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'add-product') {
      return (
        <ProductFormPage
          library={imageLibrary}
          onCancel={() => go('products')}
          onNotice={notify}
          onSaved={(created) => { addProduct(created); notify('Product added to the catalogue.'); go('products'); }}
        />
      );
    }

    if (section === 'jobs') {
      const visible = byChip(jobs, (job) => job.status).filter((job) => matches(`${job.title} ${job.partner} ${job.area} ${job.id}`));
      return (
        <>
          <PageHead
            crumb="Job vacancies"
            title="Job vacancies"
            sub={`${jobs.filter((job) => job.status === 'Open').length} open roles in the beauty community.`}
            actions={<button className="admin-btn admin-btn-dark" type="button" onClick={() => go('add-job')}><Icon name="plus" />Post a vacancy</button>}
          />
          <FilterBar
            options={['All', 'Open', 'Draft', 'Paused', 'Closed']}
            value={filter}
            onChange={setFilter}
            search={search}
            onSearch={setSearch}
            placeholder="Search role, parlour or area"
          />
          <Panel>
            {visible.length === 0
              ? <Empty message="No vacancies match this filter." action={<button className="admin-btn admin-btn-light" type="button" onClick={() => { setFilter('All'); setSearch(''); }}>Clear filters</button>} />
              : <DataTable head={['Reference', 'Title', 'Parlour', 'Area', 'Type', 'Salary', 'Applicants', 'Status', '']} minWidth={1040}>
                {visible.map((job) => (
                  <tr key={job.id}>
                    <td><span className="admin-cell-ref">{job.id}</span></td>
                    <td><strong>{job.title}</strong></td>
                    <td>{job.partner}</td>
                    <td>{job.area}</td>
                    <td>{job.type}</td>
                    <td>{job.salary}</td>
                    <td>{job.applications}</td>
                    <td><Pill label={job.status} /></td>
                    <td className="admin-row-actions">
                      <IconButton label={`View ${job.title}`} icon="eye" onClick={() => setModal({ kind: 'job', id: job.id })} />
                      <IconButton
                        label={`Toggle ${job.title}`}
                        icon="pen"
                        onClick={() => {
                          const next = job.status === 'Open' ? 'Paused' : 'Open';
                          setJobs((current) => current.map((entry) => (entry.id === job.id ? { ...entry, status: next } : entry)));
                          notify(`${job.title} is now ${next.toLowerCase()}.`);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'candidates') {
      const visible = byChip(seedCandidates, (candidate) => candidate.stage).filter((candidate) => matches(`${candidate.name} ${candidate.role} ${candidate.city}`));
      return (
        <>
          <PageHead crumb="Candidates" title="Candidates" sub={`${seedCandidates.length} registered beauty professionals.`} />
          <FilterBar
            options={['All', 'New', 'Shortlisted', 'Interview']}
            value={filter}
            onChange={setFilter}
            search={search}
            onSearch={setSearch}
            placeholder="Search candidate, skill or city"
          />
          <Panel>
            {visible.length === 0
              ? <Empty message="No candidates match this filter." action={<button className="admin-btn admin-btn-light" type="button" onClick={() => { setFilter('All'); setSearch(''); }}>Clear filters</button>} />
              : <DataTable head={['Candidate', 'Role', 'Experience', 'City', 'Rating', 'Stage', '']} minWidth={820}>
                {visible.map((candidate) => (
                  <tr key={candidate.id}>
                    <td>
                      <button className="admin-product-cell" type="button" onClick={() => setModal({ kind: 'candidate', id: candidate.id })}>
                        <Avatar src={candidate.avatar} name={candidate.name} round />
                        <span><strong>{candidate.name}</strong><small>{candidate.id}</small></span>
                      </button>
                    </td>
                    <td>{candidate.role}</td>
                    <td>{candidate.experience}</td>
                    <td>{candidate.city}</td>
                    <td><Stars rating={candidate.rating} /></td>
                    <td><Pill label={candidate.stage} /></td>
                    <td className="admin-row-actions">
                      <IconButton label={`View ${candidate.name}`} icon="eye" onClick={() => setModal({ kind: 'candidate', id: candidate.id })} />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'partners') {
      const visible = byChip(partners, (partner) => partner.status).filter((partner) => matches(`${partner.name} ${partner.area} ${partner.type}`));
      return (
        <>
          <PageHead crumb="Partner salons" title="Partner salons" sub={`${partners.length} parlours in the local network.`} />
          <FilterBar
            options={['All', 'Active', 'Pending', 'Paused']}
            value={filter}
            onChange={setFilter}
            search={search}
            onSearch={setSearch}
            placeholder="Search parlour, area or type"
          />
          <Panel>
            {visible.length === 0
              ? <Empty message="No parlours match this filter." action={<button className="admin-btn admin-btn-light" type="button" onClick={() => { setFilter('All'); setSearch(''); }}>Clear filters</button>} />
              : <DataTable head={['Parlour', 'Area', 'Type', 'Rating', 'Vacancies', 'Status', '']} minWidth={880}>
                {visible.map((partner) => (
                  <tr key={partner.id}>
                    <td>
                      <button className="admin-product-cell" type="button" onClick={() => setModal({ kind: 'partner', id: partner.id })}>
                        <Avatar src={partner.avatar} name={partner.name} round />
                        <span><strong>{partner.name}</strong><small>{partner.id}</small></span>
                      </button>
                    </td>
                    <td>{partner.area}</td>
                    <td>{partner.type}</td>
                    <td><Stars rating={partner.rating} /></td>
                    <td>{partner.vacancies}</td>
                    <td><Pill label={partner.status} /></td>
                    <td className="admin-row-actions">
                      <IconButton label={`View ${partner.name}`} icon="eye" onClick={() => setModal({ kind: 'partner', id: partner.id })} />
                      <IconButton
                        label={`Approve ${partner.name}`}
                        icon={partner.status === 'Active' ? 'pen' : 'check'}
                        onClick={() => {
                          const next = partner.status === 'Active' ? 'Paused' : 'Active';
                          setPartners((current) => current.map((entry) => (entry.id === partner.id ? { ...entry, status: next } : entry)));
                          notify(`${partner.name} is now ${next.toLowerCase()}.`);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'customers') {
      const visible = byChip(customers, (customer) => customer.tier).filter((customer) => matches(`${customer.name} ${customer.email}`));
      return (
        <>
          <PageHead crumb="Customers" title="Customers" sub={`${customers.length} registered customers.`} />
          <FilterBar
            options={['All', 'VIP', 'Loyal', 'New', 'At risk']}
            value={filter}
            onChange={setFilter}
            search={search}
            onSearch={setSearch}
            placeholder="Search customer or email"
          />
          <Panel>
            {visible.length === 0
              ? <Empty message="No customers match this filter." action={<button className="admin-btn admin-btn-light" type="button" onClick={() => { setFilter('All'); setSearch(''); }}>Clear filters</button>} />
              : <DataTable head={['Customer', 'Email', 'Orders', 'Lifetime value', 'Last order', 'Segment', '']} minWidth={880}>
                {visible.map((customer) => (
                  <tr key={customer.id}>
                    <td>
                      <button className="admin-product-cell" type="button" onClick={() => setModal({ kind: 'customer', id: customer.id })}>
                        <Avatar name={customer.name} round />
                        <span><strong>{customer.name}</strong><small>{customer.id}</small></span>
                      </button>
                    </td>
                    <td>{customer.email}</td>
                    <td>{customer.orders}</td>
                    <td><strong>{money(customer.spent)}</strong></td>
                    <td>{customer.last}</td>
                    <td><Pill label={customer.tier} /></td>
                    <td className="admin-row-actions">
                      <IconButton label={`View ${customer.name}`} icon="eye" onClick={() => setModal({ kind: 'customer', id: customer.id })} />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'reviews') {
      const visible = byChip(reviews, (review) => review.status).filter((review) => matches(`${review.author} ${review.product} ${review.text}`));
      return (
        <>
          <PageHead
            crumb="Reviews"
            title="Reviews"
            sub={`${reviews.length} customer reviews · average ${(reviews.reduce((total, review) => total + review.rating, 0) / Math.max(reviews.length, 1)).toFixed(1)} stars.`}
            actions={<button className="admin-btn admin-btn-dark" type="button" onClick={() => go('add-review')}><Icon name="plus" />Add a review</button>}
          />
          <FilterBar
            options={['All', 'Active', 'Pending review', 'Hidden']}
            value={filter}
            onChange={setFilter}
            search={search}
            onSearch={setSearch}
            placeholder="Search author, product or review"
          />
          <Panel>
            {visible.length === 0
              ? <Empty message="No reviews match this filter." action={<button className="admin-btn admin-btn-light" type="button" onClick={() => { setFilter('All'); setSearch(''); }}>Clear filters</button>} />
              : <DataTable head={['Review', 'Author', 'Product', 'Date', 'Status', '']} minWidth={960}>
                {visible.map((review) => (
                  <tr key={review.id}>
                    <td className="admin-cell-review">
                      <Stars rating={review.rating} />
                      <span>{review.text}</span>
                    </td>
                    <td>{review.author}</td>
                    <td>{review.product}</td>
                    <td>{review.date}</td>
                    <td><Pill label={review.status} /></td>
                    <td className="admin-row-actions">
                      <IconButton label={`View review by ${review.author}`} icon="eye" onClick={() => setModal({ kind: 'review', id: review.id })} />
                      <IconButton
                        label={`${review.status === 'Hidden' ? 'Publish' : 'Hide'} review by ${review.author}`}
                        icon={review.status === 'Hidden' ? 'check' : 'hide'}
                        onClick={() => {
                          const next = review.status === 'Hidden' ? 'Active' : 'Hidden';
                          setReviews((current) => current.map((entry) => (entry.id === review.id ? { ...entry, status: next } : entry)));
                          notify(`Review by ${review.author} is now ${next.toLowerCase()}.`);
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'add-job') return renderJobForm();
    if (section === 'add-review') return renderReviewForm();
    return <SettingsPage onNotice={notify} />;
  }

  const modalTitle = modal
    ? {
      order: 'Order details',
      product: 'Product details',
      job: 'Vacancy details',
      candidate: 'Candidate profile',
      partner: 'Partner parlour',
      customer: 'Customer profile',
      review: 'Review moderation',
      'remove-product': 'Remove this product?',
    }[modal.kind]
    : '';

  const modalBody = modal
    ? modal.kind === 'order' ? renderOrderDetail(modal.id)
      : modal.kind === 'product' ? renderProductDetail(modal.id)
        : modal.kind === 'job' ? renderJobDetail(modal.id)
          : modal.kind === 'candidate' ? renderCandidateDetail(modal.id)
            : modal.kind === 'partner' ? renderPartnerDetail(modal.id)
              : modal.kind === 'customer' ? renderCustomerDetail(modal.id)
                : modal.kind === 'review' ? renderReviewDetail(modal.id)
                  : <p className="admin-muted">The catalogue API supports creating products, not deleting them. This item stays in the catalogue until the products API grows a delete endpoint.</p>
    : null;

  if (account?.role !== 'admin') {
    return (
      <section className="admin-locked">
        <span className="eyebrow">Administrator access</span>
        <h1>Sign in to continue.</h1>
        <p>Sign in with the matching demo account to see this dashboard.</p>
        <button className="button button-dark" type="button" onClick={() => navigate('/login')}>Go to sign in</button>
      </section>
    );
  }

  const navGroups: Array<{ title?: string; items: NavItem[] }> = [
    { items: navWithCounts(primaryNav) },
    { title: 'Create', items: navWithCounts(createNav) },
    { title: 'System', items: navWithCounts(systemNav) },
  ];

  return (
    <div className={navOpen ? 'admin-shell is-nav-open' : 'admin-shell'}>
      <aside className="admin-side" id="admin-side">
        <Link className="admin-brand" to="/">
          <Seal />
          <span><strong>Glow <i>&amp;</i> Grace</strong><small>ADMIN CONSOLE</small></span>
        </Link>
        <nav className="admin-nav" aria-label="Dashboard sections">
          {navGroups.map((group, groupIndex) => (
            <div className="admin-nav-group" key={group.title ?? `group-${groupIndex}`}>
              {group.title && <span className="admin-nav-title">{group.title}</span>}
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={section === item.id ? 'admin-nav-item is-active' : 'admin-nav-item'}
                  aria-current={section === item.id ? 'page' : undefined}
                  onClick={() => go(item.id)}
                >
                  <Icon name={item.icon} className="admin-nav-icon" />
                  <span className="admin-nav-label">{item.label}</span>
                  {item.count !== undefined && <span className="admin-nav-count">{item.count}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="admin-side-foot">
          <Link className="admin-storefront-link" to="/">View storefront <Icon name="arrow" /></Link>
          <div className="admin-me">
            <Avatar src="/images/partner1.jpg" name={account.name} round />
            <span className="admin-me-info"><strong>{account.name}</strong><small>Store Administrator</small></span>
            <IconButton label="Sign out" icon="logout" onClick={logout} />
          </div>
        </div>
      </aside>

      <div className="admin-body">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button
              className="admin-burger"
              type="button"
              aria-label="Toggle navigation"
              aria-expanded={navOpen}
              aria-controls="admin-side"
              onClick={() => setNavOpen((current) => !current)}
            >
              <Icon name={navOpen ? 'plus' : 'menu'} />
            </button>
            <nav className="admin-breadcrumb" aria-label="Breadcrumb">
              <Link to="/admin">Admin</Link>
              <Icon name="arrow" className="admin-crumb-arrow" />
              <span aria-current="page">{sectionLabels[section]}</span>
            </nav>
          </div>

          <div className="admin-topbar-search">
            <Icon name="search" className="admin-search-icon" />
            <label className="sr-only" htmlFor="admin-global-search">Search the console</label>
            <input
              id="admin-global-search"
              type="search"
              value={search}
              placeholder="Search products, orders, customers…"
              onChange={(event) => { setSearch(event.target.value); if (event.target.value && ['dashboard', 'settings'].includes(section)) setSection('products'); }}
            />
            <kbd>⌘K</kbd>
          </div>

          <div className="admin-topbar-actions">
            <div className="admin-bell-wrap">
              <button
                className="admin-topbar-icon"
                type="button"
                aria-label="Notifications"
                aria-expanded={alertsOpen}
                onClick={() => setAlertsOpen((current) => !current)}
              >
                <Icon name="bell" />
                <i className="admin-bell-dot" />
              </button>
              {alertsOpen && (
                <div className="admin-bell-panel">
                  <strong>Notifications</strong>
                  <ul>
                    {seedAlerts.slice(0, 3).map((alert) => <li key={alert.id}>{alert.text}</li>)}
                  </ul>
                  <button className="admin-text-btn" type="button" onClick={() => { setAlertsOpen(false); go('dashboard'); }}>See all activity</button>
                </div>
              )}
            </div>
            <div className="admin-new-wrap">
              <button className="admin-btn admin-btn-dark admin-new-btn" type="button" aria-expanded={quickOpen} onClick={() => setQuickOpen((current) => !current)}>
                <Icon name="plus" />New
              </button>
              {quickOpen && (
                <ul className="admin-quick-menu">
                  {createNav.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => go(item.id)}><Icon name={item.icon} />{item.label}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button className="admin-topbar-avatar" type="button" aria-label="Sign out" onClick={logout}>GK</button>
          </div>
        </header>

        <main className="admin-content" id="admin-content">
          {catalogueError && <p className="admin-alert-inline" role="status">{catalogueError}</p>}
          {renderSection()}
        </main>
      </div>

      {navOpen && <button className="admin-scrim" type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}

      {modal && (
        <Modal title={modalTitle} onClose={() => setModal(null)}>
          {modalBody}
          {modal.kind === 'remove-product' && (
            <div className="admin-form-actions">
              <button className="admin-btn admin-btn-light" type="button" onClick={() => setModal(null)}>Keep product</button>
            </div>
          )}
        </Modal>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
    </div>
  );
}

type NewJob = {
  id: string;
  title: string;
  partner: string;
  area: string;
  type: string;
  salary: string;
  applications: number;
  status: string;
};

function JobForm({ onCancel, onSave }: { onCancel: () => void; onSave: (job: NewJob) => void }) {
  const [skills, setSkills] = useState<string[]>([]);
  const [accepting, setAccepting] = useState(false);
  const [draft, setDraft] = useState({ title: '', partner: '', salary: '', type: 'Full-time' });

  return (
    <>
      <PageHead
        crumb="Post a vacancy"
        title="Post a vacancy"
        sub="Create a placement listing for a partner parlour."
        actions={<button className="admin-btn admin-btn-light" type="button" onClick={onCancel}>Cancel</button>}
      />
      <form
        className="admin-product-layout"
        onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const title = draft.title.trim();
          onSave({
            id: `JOB-${4822 + Math.floor(Math.random() * 90)}`,
            title,
            partner: draft.partner.trim(),
            area: String(values.get('area') ?? ''),
            type: draft.type,
            salary: draft.salary.trim(),
            applications: 0,
            status: accepting ? 'Open' : 'Draft',
          });
        }}
      >
        <div className="admin-product-main">
          <Panel>
            <PanelHead title="Position details" sub="Role, parlour and compensation" />
            <div className="admin-grid-2">
              <label className="admin-field admin-span-2">Position title<input name="title" required placeholder="e.g. Senior Beautician" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
              <label className="admin-field">Parlour / salon<input name="partner" required placeholder="e.g. Blush Beauty Lounge" value={draft.partner} onChange={(event) => setDraft((current) => ({ ...current, partner: event.target.value }))} /></label>
              <label className="admin-field">Location<select name="area" defaultValue={jobAreas[0]}>{jobAreas.map((area) => <option key={area}>{area}</option>)}</select></label>
              <label className="admin-field">Employment type<select name="type" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}><option>Full-time</option><option>Part-time</option><option>Contract</option><option>Internship</option></select></label>
              <label className="admin-field">Salary range<input name="salary" required placeholder="e.g. ₹18,000 – ₹25,000 / mo" value={draft.salary} onChange={(event) => setDraft((current) => ({ ...current, salary: event.target.value }))} /></label>
              <label className="admin-field admin-span-2">Experience required<input name="experience" placeholder="e.g. 2+ years in a salon" /></label>
              <fieldset className="admin-field admin-span-2">
                <legend>Skills</legend>
                <TagInput tags={skills} onChange={setSkills} placeholder="e.g. Bridal makeup" />
              </fieldset>
              <label className="admin-field admin-span-2">Description<textarea name="description" rows={5} required placeholder="What makes this role lovely?" /></label>
            </div>
          </Panel>
        </div>
        <aside className="admin-product-side">
          <Panel className="admin-preview-card">
            <PanelHead title="Preview" sub="Careers card" />
            <div className="admin-job-preview">
              <span className="admin-preview-cat">{accepting ? 'Now hiring' : 'Draft'}</span>
              <h3>{draft.title || 'Position title'}</h3>
              <p>{draft.partner || 'Parlour name'} · Lucknow</p>
              <strong>{draft.salary || 'Salary range'}</strong>
              <span className="admin-muted">{draft.type}</span>
            </div>
          </Panel>
          <Panel>
            <PanelHead title="Publishing" />
            <div className="admin-switch-row">
              <span><strong>Accepting applications</strong><small>Show this vacancy on /careers</small></span>
              <Toggle label="Accepting applications" checked={accepting} onChange={setAccepting} />
            </div>
          </Panel>
          <div className="admin-form-actions">
            <button className="admin-btn admin-btn-dark" type="submit">Save vacancy</button>
            <button className="admin-btn admin-btn-ghost" type="button" onClick={onCancel}>Cancel</button>
          </div>
          <p className="admin-alert-inline" role="note">Placements data in this console is a preview. Vacancies are published by the partner salon.</p>
        </aside>
      </form>
    </>
  );
}

type NewReview = {
  id: string;
  author: string;
  avatar: string;
  product: string;
  rating: number;
  text: string;
  status: string;
  date: string;
};

function ReviewForm({ onCancel, onSave }: { onCancel: () => void; onSave: (review: NewReview) => void }) {
  const [rating, setRating] = useState(5);
  const [published, setPublished] = useState(true);
  const { products } = useProductCatalog();

  return (
    <>
      <PageHead
        crumb="Add a review"
        title="Add a review"
        sub="Record a testimonial to publish on the storefront."
        actions={<button className="admin-btn admin-btn-light" type="button" onClick={onCancel}>Cancel</button>}
      />
      <form
        className="admin-product-layout"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const author = String(values.get('author') ?? '').trim();
          onSave({
            id: `REV-${2215 + Math.floor(Math.random() * 40)}`,
            author,
            avatar: '/images/partner2.jpg',
            product: String(values.get('product') ?? ''),
            rating,
            text: String(values.get('quote') ?? '').trim(),
            status: published ? 'Active' : 'Pending review',
            date: '26 Sep 2026',
          });
        }}
      >
        <div className="admin-product-main">
          <Panel>
            <PanelHead title="Testimonial" sub="Who said it and what they said" />
            <div className="admin-grid-2">
              <label className="admin-field">Author name<input name="author" required placeholder="e.g. Priya Sharma" /></label>
              <label className="admin-field">Product<select name="product" defaultValue="" required><option value="" disabled>Select a product</option>{products.map((product) => <option key={product.id}>{product.name}</option>)}</select></label>
              <fieldset className="admin-field admin-span-2">
                <legend>Rating</legend>
                <StarInput value={rating} onChange={setRating} />
              </fieldset>
              <label className="admin-field admin-span-2">Quote<textarea name="quote" rows={5} required placeholder="A warm, honest line about the product." /></label>
            </div>
          </Panel>
        </div>
        <aside className="admin-product-side">
          <Panel className="admin-preview-card">
            <PanelHead title="Preview" sub="Storefront testimonial" />
            <blockquote className="admin-quote is-preview">
              <Stars rating={rating} />
              <p>“{rating > 0 ? 'A lovely, considered find for your beauty ritual.' : 'Your quote will appear here.'}”</p>
              <cite>Author name</cite>
            </blockquote>
          </Panel>
          <Panel>
            <PanelHead title="Publishing" />
            <div className="admin-switch-row">
              <span><strong>Publish now</strong><small>Show this review on the storefront</small></span>
              <Toggle label="Publish now" checked={published} onChange={setPublished} />
            </div>
          </Panel>
          <div className="admin-form-actions">
            <button className="admin-btn admin-btn-dark" type="submit">Save review</button>
            <button className="admin-btn admin-btn-ghost" type="button" onClick={onCancel}>Cancel</button>
          </div>
        </aside>
      </form>
    </>
  );
}
