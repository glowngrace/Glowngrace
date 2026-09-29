import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDemoAccount, signOutDemo } from '../auth/demo-auth';
import { getAdminToken } from '../lib/admin-api';
import { productImageUrl, type Product } from '../data/catalog';
import { Spinner } from '../components/Loader';
import {
  jobAreas,
  money,
  seedAlerts,
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
import { AdminStoreProvider, useAdminStore, type CollectionKey, type ReviewRecord, type JobRecord } from './admin/AdminStore';
import { BulkUpload } from './admin/BulkUpload';
import { DashboardPage } from './admin/DashboardPage';
import { ProductFormPage } from './admin/ProductFormPage';
import { SettingsPage } from './admin/SettingsPage';

type NavItem = { id: AdminSection; label: string; icon: IconName; count?: number };

type EditState =
  | { kind: 'product'; id: number }
  | { kind: 'job'; id: string }
  | { kind: 'candidate'; id: string }
  | { kind: 'partner'; id: string }
  | { kind: 'customer'; id: string }
  | { kind: 'review'; id: string }
  | { kind: 'remove'; collection: CollectionKey | 'products' | 'orders'; id: string; label: string }
  | null;

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
  'edit-product': 'Edit product',
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
  | null;

const unitSpread = [184, 152, 121, 98, 74, 61, 47, 33, 22, 15];

function formatDay(value: string | null | undefined) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
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
  return (
    <AdminStoreProvider>
      <AdminConsole />
    </AdminStoreProvider>
  );
}

function AdminConsole() {
  const navigate = useNavigate();
  const account = getDemoAccount();
  const store = useAdminStore();
  const {
    account: signedIn,
    products,
    orders,
    jobs,
    candidates,
    partners,
    customers,
    reviews,
    loading,
    reloading,
    error: storeError,
    notice,
    reload,
    saveProduct,
    setProductPublished,
    removeProduct,
    saveOrder,
    removeOrder,
    saveRecord,
    removeRecord,
    signOut: apiSignOut,
  } = store;

  const [section, setSection] = useState<AdminSection>('dashboard');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [navOpen, setNavOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [editing, setEditing] = useState<EditState>(null);

  useEffect(() => {
    if (notice) setToast(notice);
  }, [notice]);

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

  const logout = useCallback(async () => {
    await apiSignOut();
    signOutDemo();
    navigate('/');
  }, [apiSignOut, navigate]);

  const matches = (text: string) => text.toLowerCase().includes(search.toLowerCase().trim());
  const byChip = <T,>(rows: T[], chip: (row: T) => string) => rows.filter((row) => (filter === 'All' || chip(row) === filter));

  const navWithCounts = (items: NavItem[]): NavItem[] => items.map((item) => ({
    ...item,
    count: item.id === 'orders' ? orders.length
      : item.id === 'products' ? products.length
        : item.id === 'jobs' ? jobs.filter((job) => job.status === 'Open').length
          : item.id === 'candidates' ? candidates.length
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
          <DetailRow label="Delivery address">{order.address}, {order.locality}, {order.city} {order.postalCode}</DetailRow>
        </dl>
        <div className="admin-order-flow">
          {['Placed', 'Processing', 'Packed', 'Shipped', 'Delivered'].map((step) => (
            <span key={step} className={order.status === step ? 'is-done' : ''}>{step}</span>
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
            <Pill label={product.published === false ? 'Hidden' : stockStatus(product.stock ?? 0)} />
            <p className="admin-detail-copy">{product.description}</p>
          </div>
        </div>
        <dl className="admin-detail-list">
          <DetailRow label="SKU">{product.sku || 'Not set'}</DetailRow>
          <DetailRow label="Brand">{product.brand || 'Not set'}</DetailRow>
          <DetailRow label="Stock">{product.stock} units</DetailRow>
          <DetailRow label="Badge">{product.badge || 'None'}</DetailRow>
          <DetailRow label="Visible in store">{product.published === false ? 'No' : 'Yes'}</DetailRow>
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
          <DetailRow label="Experience">{job.experience || 'Not specified'}</DetailRow>
          <DetailRow label="Skills">{job.skills || 'Not listed'}</DetailRow>
          <DetailRow label="Description">{job.description || 'No description yet.'}</DetailRow>
        </dl>
      </>
    );
  }

  function renderCandidateDetail(candidateId: string) {
    const candidate = candidates.find((entry) => entry.id === candidateId);
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
          <DetailRow label="Email">{candidate.email}</DetailRow>
          <DetailRow label="Phone">{candidate.phone || 'Not given'}</DetailRow>
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
          <DetailRow label="Owner">{partner.owner || 'Not set'}</DetailRow>
          <DetailRow label="Phone">{partner.phone || 'Not given'}</DetailRow>
          <DetailRow label="Email">{partner.email || 'Not given'}</DetailRow>
          <DetailRow label="Partner since">{formatDay(partner.since)}</DetailRow>
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
          <DetailRow label="Phone">{customer.phone || 'Not given'}</DetailRow>
          <DetailRow label="Orders"><strong>{customer.orders}</strong></DetailRow>
          <DetailRow label="Lifetime value"><strong>{money(customer.spent)}</strong></DetailRow>
          <DetailRow label="Last order">{formatDay(customer.lastOrderOn)}</DetailRow>
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
          <div><h3>{review.author}</h3><p>{review.productName}</p></div>
          <Pill label={review.status} />
        </div>
        <blockquote className="admin-quote"><Stars rating={review.rating} /><p>“{review.text}”</p></blockquote>
        <dl className="admin-detail-list">
          <DetailRow label="Reference">{review.id}</DetailRow>
          <DetailRow label="Reviewed on">{formatDay(review.reviewedOn)}</DetailRow>
          <DetailRow label="Status">{review.status}</DetailRow>
        </dl>
      </>
    );
  }

  async function handleSaveRecord(key: CollectionKey, record: unknown, id?: string) {
    const saved = await saveRecord(key, record, id);
    return saved !== null;
  }

  function renderJobForm() {
    return (
      <JobForm
        areas={jobAreas}
        onCancel={() => { setEditing(null); go('jobs'); }}
        editing={editing?.kind === 'job' ? jobs.find((job) => job.id === editing.id) : undefined}
        onSave={async (job) => {
          const saved = await handleSaveRecord('jobs', job, editing?.kind === 'job' ? editing.id : undefined);
          if (saved) { setEditing(null); go('jobs'); }
          return saved;
        }}
      />
    );
  }

  function renderReviewForm() {
    return (
      <ReviewForm
        products={products.map((product) => product.name)}
        onCancel={() => { setEditing(null); go('reviews'); }}
        editing={editing?.kind === 'review' ? reviews.find((review) => review.id === editing.id) : undefined}
        onSave={async (review) => {
          const saved = await handleSaveRecord('reviews', review, editing?.kind === 'review' ? editing.id : undefined);
          if (saved) { setEditing(null); go('reviews'); }
          return saved;
        }}
      />
    );
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
                          const flow = ['Placed', 'Processing', 'Packed', 'Shipped', 'Delivered'];
                          const next = flow[Math.min(flow.indexOf(order.status) + 1, flow.length - 1)] ?? 'Delivered';
                          void saveOrder(order.id, { status: next });
                        }}
                      />
                      <IconButton
                        label={`Remove ${order.id}`}
                        icon="trash"
                        danger
                        onClick={() => setEditing({ kind: 'remove', collection: 'orders', id: order.id, label: order.id })}
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
      const statusOf = (product: Product) => (product.published === false ? 'Hidden' : stockStatus(product.stock ?? 0));
      const visible = byChip(products, statusOf).filter((product) => matches(`${product.name} ${product.category} ${product.sku ?? ''}`));
      const hidden = products.length - products.filter((product) => product.published === false).length;
      return (
        <>
          <PageHead
            crumb="Products"
            title="Products"
            sub={`${products.length} products in the catalogue · ${hidden} visible to shoppers.`}
            actions={
              <>
                <BulkUpload dataset="products" plural="products" />
                <button className="admin-btn admin-btn-dark" type="button" onClick={() => go('add-product')}><Icon name="plus" />Add a product</button>
              </>
            }
          />
          <FilterBar
            options={['All', 'Active', 'Low stock', 'Out of stock', 'Hidden']}
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
                      <IconButton label={`Edit ${product.name}`} icon="pen" onClick={() => { setEditing({ kind: 'product', id: product.id }); go('edit-product'); }} />
                      <IconButton
                        label={`${product.published === false ? 'Show' : 'Hide'} ${product.name}`}
                        icon={product.published === false ? 'check' : 'hide'}
                        onClick={() => void setProductPublished(product, product.published === false)}
                      />
                      <IconButton label={`Remove ${product.name}`} icon="trash" danger onClick={() => setEditing({ kind: 'remove', collection: 'products', id: String(product.id), label: product.name })} />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'add-product' || section === 'edit-product') {
      const editingProduct = editing?.kind === 'product' ? products.find((product) => product.id === editing.id) : undefined;
      if (section === 'edit-product' && !editingProduct) {
        return <div className="admin-card"><p className="admin-muted">That product is no longer in the catalogue.</p></div>;
      }
      return (
        <ProductFormPage
          key={editingProduct?.id ?? 'new'}
          library={imageLibrary}
          editing={editingProduct}
          onCancel={() => { setEditing(null); go('products'); }}
          onNotice={notify}
          onSave={async (payload) => {
            // `saveProduct` rejects on failure, and the form renders the
            // rejection's message itself, so only the happy path lives here.
            await saveProduct(payload, editingProduct?.id);
            setEditing(null);
            go('products');
            return true;
          }}
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
            actions={
              <>
                <BulkUpload dataset="jobs" plural="vacancies" />
                <button className="admin-btn admin-btn-dark" type="button" onClick={() => { setEditing(null); go('add-job'); }}><Icon name="plus" />Post a vacancy</button>
              </>
            }
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
                      <IconButton label={`Edit ${job.title}`} icon="pen" onClick={() => { setEditing({ kind: 'job', id: job.id }); go('add-job'); }} />
                      <IconButton
                        label={`${job.status === 'Open' ? 'Pause' : 'Open'} ${job.title}`}
                        icon={job.status === 'Open' ? 'hide' : 'check'}
                        onClick={() => void saveRecord('jobs', { status: job.status === 'Open' ? 'Paused' : 'Open' }, job.id)}
                      />
                      <IconButton label={`Remove ${job.title}`} icon="trash" danger onClick={() => setEditing({ kind: 'remove', collection: 'jobs', id: job.id, label: job.title })} />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'candidates') {
      const visible = byChip(candidates, (candidate) => candidate.stage).filter((candidate) => matches(`${candidate.name} ${candidate.role} ${candidate.city} ${candidate.email}`));
      return (
        <>
          <PageHead crumb="Candidates" title="Candidates" sub={`${candidates.length} registered beauty professionals.`} actions={<BulkUpload dataset="candidates" plural="candidates" />} />
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
                      <IconButton label={`Remove ${candidate.name}`} icon="trash" danger onClick={() => setEditing({ kind: 'remove', collection: 'candidates', id: candidate.id, label: candidate.name })} />
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
          <PageHead crumb="Partner salons" title="Partner salons" sub={`${partners.length} parlours in the local network.`} actions={<BulkUpload dataset="partners" plural="parlours" />} />
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
                        label={`${partner.status === 'Active' ? 'Pause' : 'Approve'} ${partner.name}`}
                        icon={partner.status === 'Active' ? 'hide' : 'check'}
                        onClick={() => void saveRecord('partners', { status: partner.status === 'Active' ? 'Paused' : 'Active' }, partner.id)}
                      />
                      <IconButton label={`Remove ${partner.name}`} icon="trash" danger onClick={() => setEditing({ kind: 'remove', collection: 'partners', id: partner.id, label: partner.name })} />
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
          <PageHead crumb="Customers" title="Customers" sub={`${customers.length} registered customers.`} actions={<BulkUpload dataset="customers" plural="customers" />} />
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
                    <td>{formatDay(customer.lastOrderOn)}</td>
                    <td><Pill label={customer.tier} /></td>
                    <td className="admin-row-actions">
                      <IconButton label={`View ${customer.name}`} icon="eye" onClick={() => setModal({ kind: 'customer', id: customer.id })} />
                      <IconButton label={`Remove ${customer.name}`} icon="trash" danger onClick={() => setEditing({ kind: 'remove', collection: 'customers', id: customer.id, label: customer.name })} />
                    </td>
                  </tr>
                ))}
              </DataTable>}
          </Panel>
        </>
      );
    }

    if (section === 'reviews') {
      const visible = byChip(reviews, (review) => review.status).filter((review) => matches(`${review.author} ${review.productName} ${review.text}`));
      return (
        <>
          <PageHead
            crumb="Reviews"
            title="Reviews"
            sub={`${reviews.length} customer reviews · average ${(reviews.reduce((total, review) => total + review.rating, 0) / Math.max(reviews.length, 1)).toFixed(1)} stars.`}
            actions={
              <>
                <BulkUpload dataset="reviews" plural="reviews" />
                <button className="admin-btn admin-btn-dark" type="button" onClick={() => { setEditing(null); go('add-review'); }}><Icon name="plus" />Add a review</button>
              </>
            }
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
                    <td>{review.productName}</td>
                    <td>{formatDay(review.reviewedOn)}</td>
                    <td><Pill label={review.status} /></td>
                    <td className="admin-row-actions">
                      <IconButton label={`View review by ${review.author}`} icon="eye" onClick={() => setModal({ kind: 'review', id: review.id })} />
                      <IconButton label={`Edit review by ${review.author}`} icon="pen" onClick={() => { setEditing({ kind: 'review', id: review.id }); go('add-review'); }} />
                      <IconButton
                        label={`${review.status === 'Hidden' ? 'Publish' : 'Hide'} review by ${review.author}`}
                        icon={review.status === 'Hidden' ? 'check' : 'hide'}
                        onClick={() => void saveRecord('reviews', { status: review.status === 'Hidden' ? 'Active' : 'Hidden' }, review.id)}
                      />
                      <IconButton label={`Remove review by ${review.author}`} icon="trash" danger onClick={() => setEditing({ kind: 'remove', collection: 'reviews', id: review.id, label: review.author })} />
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
                  : null
    : null;

  if (account?.role !== 'admin' || !getAdminToken()) {
    return (
      <section className="admin-locked">
        <span className="eyebrow">Administrator access</span>
        <h1>Sign in to continue.</h1>
        <p>Sign in with the administrator demo account to open this dashboard.</p>
        <button className="button button-dark" type="button" onClick={() => navigate('/login')}>Go to sign in</button>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="admin-locked" aria-busy="true">
        <span className="eyebrow">Administrator access</span>
        <div className="admin-boot" role="status" aria-live="polite" data-testid="admin-loader">
          <Spinner size="lg" />
          <h1>Loading your console…</h1>
          <p>Fetching orders, catalogue, placements and team access.</p>
        </div>
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
            <Avatar src={signedIn?.avatar ?? '/images/partner1.jpg'} name={signedIn?.name ?? account.name} round />
            <span className="admin-me-info"><strong>{signedIn?.name ?? account.name}</strong><small>{signedIn?.role ?? 'Store Administrator'}</small></span>
            <IconButton label="Sign out" icon="logout" onClick={() => void logout()} />
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
            {reloading && (
              <span className="admin-topbar-loading" role="status" aria-live="polite" data-testid="admin-reloading">
                <Spinner size="sm" />Syncing
              </span>
            )}
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
            <button className="admin-topbar-avatar" type="button" aria-label="Sign out" onClick={() => void logout()}>GK</button>
          </div>
        </header>

        <main className="admin-content" id="admin-content">
          {storeError && (
            <p className="admin-alert-inline" role="alert">
              {storeError}{' '}
              <button className="admin-text-btn" type="button" onClick={() => void reload()}>Try again</button>
            </p>
          )}
          {renderSection()}
        </main>
      </div>

      {navOpen && <button className="admin-scrim" type="button" aria-label="Close navigation" onClick={() => setNavOpen(false)} />}

      {modal && (
        <Modal title={modalTitle} onClose={() => setModal(null)}>
          {modalBody}
        </Modal>
      )}

      {editing?.kind === 'remove' && (
        <Modal title={`Remove ${editing.label}?`} onClose={() => setEditing(null)}>
          <p className="admin-muted">
            This deletes {editing.label} from the console for good. It cannot be undone, and a demo-data reset is the only way to bring the original sample row back.
          </p>
          <div className="admin-form-actions">
            <button className="admin-btn admin-btn-light" type="button" onClick={() => setEditing(null)}>Keep it</button>
            <button
              className="admin-btn admin-btn-danger"
              type="button"
              onClick={() => {
                const target = editing;
                setEditing(null);
                if (target.collection === 'products') void removeProduct(products.find((product) => String(product.id) === target.id) ?? { id: Number(target.id), name: target.label } as Product);
                else if (target.collection === 'orders') void removeOrder(target.id);
                else void removeRecord(target.collection, target.id);
              }}
            >
              Delete permanently
            </button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
    </div>
  );
}

function JobForm({
  areas,
  onCancel,
  editing,
  onSave,
}: {
  areas: readonly string[];
  onCancel: () => void;
  editing?: JobRecord;
  onSave: (job: Record<string, unknown>) => Promise<boolean>;
}) {
  const [skills, setSkills] = useState<string[]>(() => (editing?.skills ? editing.skills.split(',').map((skill) => skill.trim()).filter(Boolean) : []));
  const [accepting, setAccepting] = useState(editing ? editing.status === 'Open' : false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    title: editing?.title ?? '',
    partner: editing?.partner ?? '',
    salary: editing?.salary ?? '',
    type: editing?.type ?? 'Full-time',
    area: editing?.area ?? areas[0] ?? '',
  });

  return (
    <>
      <PageHead
        crumb={editing ? `Edit ${editing.id}` : 'Post a vacancy'}
        title={editing ? `Edit ${editing.title}` : 'Post a vacancy'}
        sub="Create a placement listing for a partner parlour."
        actions={<button className="admin-btn admin-btn-light" type="button" onClick={onCancel}>Cancel</button>}
      />
      <form
        className="admin-product-layout"
        onSubmit={async (event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          setSaving(true);
          const saved = await onSave({
            title: draft.title.trim(),
            partner: draft.partner.trim(),
            area: draft.area,
            type: draft.type,
            salary: draft.salary.trim(),
            experience: String(values.get('experience') ?? '').trim(),
            skills: skills.join(', '),
            description: String(values.get('description') ?? '').trim(),
            applications: editing?.applications ?? 0,
            status: accepting ? 'Open' : 'Draft',
          });
          if (!saved) setSaving(false);
        }}
      >
        <div className="admin-product-main">
          <Panel>
            <PanelHead title="Position details" sub="Role, parlour and compensation" />
            <div className="admin-grid-2">
              <label className="admin-field admin-span-2">Position title<input name="title" required placeholder="e.g. Senior Beautician" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
              <label className="admin-field">Parlour / salon<input name="partner" required placeholder="e.g. Blush Beauty Lounge" value={draft.partner} onChange={(event) => setDraft((current) => ({ ...current, partner: event.target.value }))} /></label>
              <label className="admin-field">Location<select name="area" value={draft.area} onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))}>{areas.map((area) => <option key={area}>{area}</option>)}</select></label>
              <label className="admin-field">Employment type<select name="type" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}><option>Full-time</option><option>Part-time</option><option>Contract</option><option>Internship</option></select></label>
              <label className="admin-field">Salary range<input name="salary" required placeholder="e.g. ₹18,000 – ₹25,000 / mo" value={draft.salary} onChange={(event) => setDraft((current) => ({ ...current, salary: event.target.value }))} /></label>
              <label className="admin-field admin-span-2">Experience required<input name="experience" defaultValue={editing?.experience ?? ''} placeholder="e.g. 2+ years in a salon" /></label>
              <fieldset className="admin-field admin-span-2">
                <legend>Skills</legend>
                <TagInput tags={skills} onChange={setSkills} placeholder="e.g. Bridal makeup" />
              </fieldset>
              <label className="admin-field admin-span-2">Description<textarea name="description" rows={5} required defaultValue={editing?.description ?? ''} placeholder="What makes this role lovely?" /></label>
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
            <button className="admin-btn admin-btn-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save vacancy'}</button>
            <button className="admin-btn admin-btn-ghost" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          </div>
        </aside>
      </form>
    </>
  );
}

function ReviewForm({
  products,
  onCancel,
  editing,
  onSave,
}: {
  products: string[];
  onCancel: () => void;
  editing?: ReviewRecord;
  onSave: (review: Record<string, unknown>) => Promise<boolean>;
}) {
  const [rating, setRating] = useState(editing?.rating ?? 5);
  const [published, setPublished] = useState(editing ? editing.status === 'Active' : true);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <PageHead
        crumb={editing ? `Edit ${editing.id}` : 'Add a review'}
        title={editing ? `Edit review by ${editing.author}` : 'Add a review'}
        sub="Record a testimonial to publish on the storefront."
        actions={<button className="admin-btn admin-btn-light" type="button" onClick={onCancel}>Cancel</button>}
      />
      <form
        className="admin-product-layout"
        onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          setSaving(true);
          const saved = await onSave({
            author: String(values.get('author') ?? '').trim(),
            avatar: editing?.avatar ?? '',
            productName: String(values.get('product') ?? ''),
            rating,
            text: String(values.get('quote') ?? '').trim(),
            status: published ? 'Active' : 'Pending review',
            reviewedOn: editing?.reviewedOn ?? new Date().toISOString().slice(0, 10),
          });
          if (!saved) setSaving(false);
        }}
      >
        <div className="admin-product-main">
          <Panel>
            <PanelHead title="Testimonial" sub="Who said it and what they said" />
            <div className="admin-grid-2">
              <label className="admin-field">Author name<input name="author" required defaultValue={editing?.author ?? ''} placeholder="e.g. Priya Sharma" /></label>
              <label className="admin-field">Product<select name="product" required defaultValue={editing?.productName ?? ''}><option value="" disabled>Select a product</option>{products.map((name) => <option key={name}>{name}</option>)}</select></label>
              <fieldset className="admin-field admin-span-2">
                <legend>Rating</legend>
                <StarInput value={rating} onChange={setRating} />
              </fieldset>
              <label className="admin-field admin-span-2">Quote<textarea name="quote" rows={5} required defaultValue={editing?.text ?? ''} placeholder="A warm, honest line about the product." /></label>
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
            <button className="admin-btn admin-btn-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save review'}</button>
            <button className="admin-btn admin-btn-ghost" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          </div>
        </aside>
      </form>
    </>
  );
}
