import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDemoAccount, signOutDemo } from '../auth/demo-auth';
import { jobs as catalogueJobs, partners as cataloguePartners, productImageUrl, type Product } from '../data/catalog';
import { useProductCatalog } from '../components/ProductCatalogContext';
import { createCatalogueProduct, type CreateProductRequest, type ProductImageUpload } from '../lib/api';

type AdminSection =
  | 'overview'
  | 'orders'
  | 'products'
  | 'add-product'
  | 'jobs'
  | 'add-job'
  | 'candidates'
  | 'partners'
  | 'customers'
  | 'reviews'
  | 'add-review'
  | 'settings';

type AdminTab = { id: AdminSection; label: string; group: string };
type Order = { id: string; customer: string; items: number; date: string; amount: number; payment: string; status: string };
type AdminProduct = Product & { stock: number };
type Job = { title: string; salon: string; location: string; salary: string; experience: string; kind: string; status: string; applicants: number };
type Candidate = { name: string; skill: string; experience: string; role: string; applied: string; stage: string };
type Partner = { name: string; location: string; specialty: string; vacancies: number; wholesale: number; rating: number; status: string };
type Customer = { name: string; location: string; orders: number; value: number; lastOrder: string; segment: string };
type Review = { name: string; product: string; rating: number; text: string; date: string; status: string };

const tabs: AdminTab[] = [
  { id: 'overview', label: 'Business overview', group: 'Workspace' },
  { id: 'orders', label: 'All orders', group: 'Commerce' },
  { id: 'products', label: 'Catalogue & inventory', group: 'Commerce' },
  { id: 'add-product', label: 'Add a product', group: 'Commerce' },
  { id: 'customers', label: 'Customers', group: 'Commerce' },
  { id: 'reviews', label: 'Reviews', group: 'Commerce' },
  { id: 'jobs', label: 'Job vacancies', group: 'Community' },
  { id: 'candidates', label: 'Candidate pipeline', group: 'Community' },
  { id: 'partners', label: 'Partner salons', group: 'Community' },
  { id: 'add-job', label: 'Post a vacancy', group: 'Community' },
  { id: 'add-review', label: 'Add a review', group: 'Commerce' },
  { id: 'settings', label: 'Settings', group: 'Workspace' },
];

const initialOrders: Order[] = [
  { id: 'GG-5102', customer: 'Ritika Srivastava', items: 3, date: '24 Sep 2026', amount: 2147, payment: 'UPI', status: 'Packed' },
  { id: 'GG-5101', customer: 'Meenakshi Rawat', items: 1, date: '24 Sep 2026', amount: 849, payment: 'Card', status: 'Shipped' },
  { id: 'GG-5098', customer: 'Blush Beauty Lounge', items: 24, date: '23 Sep 2026', amount: 18400, payment: 'Bank transfer', status: 'Delivered' },
  { id: 'GG-5094', customer: 'Sana Khan', items: 2, date: '23 Sep 2026', amount: 1648, payment: 'UPI', status: 'Delivered' },
  { id: 'GG-5090', customer: 'Priya Agarwal', items: 5, date: '22 Sep 2026', amount: 4295, payment: 'Card', status: 'Returned' },
  { id: 'GG-5087', customer: 'Elegance Bridal House', items: 40, date: '21 Sep 2026', amount: 31200, payment: 'Bank transfer', status: 'Delivered' },
  { id: 'GG-5081', customer: 'Nikita Bhatnagar', items: 1, date: '20 Sep 2026', amount: 1199, payment: 'COD', status: 'Cancelled' },
  { id: 'GG-5077', customer: 'Anjali Verma', items: 2, date: '19 Sep 2026', amount: 1148, payment: 'UPI', status: 'Delivered' },
  { id: 'GG-5072', customer: 'Sneha Gupta', items: 3, date: '18 Sep 2026', amount: 2297, payment: 'Card', status: 'Processing' },
];

const initialJobs: Job[] = catalogueJobs.map((job, index) => ({
  title: job.title,
  salon: job.salon,
  location: job.location,
  salary: job.salary,
  experience: job.experience,
  kind: job.kind,
  status: index === 1 ? 'Paused' : 'Open',
  applicants: [12, 6, 4, 7][index] ?? 0,
}));

const initialCandidates: Candidate[] = [
  { name: 'Anjali Verma', skill: 'Bridal makeup', experience: '3 years', role: 'Blush Beauty Lounge', applied: '12 Sep 2026', stage: 'Interview' },
  { name: 'Sneha Rastogi', skill: 'Facials & skincare', experience: '5 years', role: 'Blush Beauty Lounge', applied: '11 Sep 2026', stage: 'Shortlisted' },
  { name: 'Kavita Mishra', skill: 'Hair styling', experience: '4 years', role: 'Style Hub Salon', applied: '09 Sep 2026', stage: 'Offer sent' },
  { name: 'Pooja Yadav', skill: 'Hair styling', experience: '1 year', role: 'Style Hub Salon', applied: '08 Sep 2026', stage: 'New' },
  { name: 'Ruchi Kapoor', skill: 'Nail art', experience: '2 years', role: 'The Nail Bar', applied: '05 Sep 2026', stage: 'Placed' },
  { name: 'Farah Siddiqui', skill: 'Front desk', experience: 'Fresher', role: 'Blush Beauty Lounge', applied: '03 Sep 2026', stage: 'New' },
];

const initialPartners: Partner[] = cataloguePartners.map((partner, index) => ({
  name: partner.name,
  location: partner.location.split(',')[0],
  specialty: partner.specialty,
  vacancies: [2, 4, 1][index] ?? 0,
  wholesale: [31200, 84200, 12400][index] ?? 0,
  rating: Number(partner.rating),
  status: index === 2 ? 'Pending review' : 'Active',
}));

const initialCustomers: Customer[] = [
  { name: 'Ritika Srivastava', location: 'Gomti Nagar', orders: 14, value: 24680, lastOrder: '24 Sep 2026', segment: 'VIP' },
  { name: 'Anjali Verma', location: 'Hazratganj', orders: 9, value: 11420, lastOrder: '19 Sep 2026', segment: 'Loyal' },
  { name: 'Sneha Gupta', location: 'Aliganj', orders: 6, value: 8940, lastOrder: '18 Sep 2026', segment: 'Loyal' },
  { name: 'Meenakshi Rawat', location: 'Indira Nagar', orders: 4, value: 5210, lastOrder: '24 Sep 2026', segment: 'Active' },
  { name: 'Sana Khan', location: 'Mahanagar', orders: 3, value: 4180, lastOrder: '23 Sep 2026', segment: 'Active' },
  { name: 'Priya Agarwal', location: 'Gomti Nagar', orders: 2, value: 6470, lastOrder: '22 Sep 2026', segment: 'At risk' },
  { name: 'Nikita Bhatnagar', location: 'Alambagh', orders: 1, value: 1199, lastOrder: '20 Sep 2026', segment: 'New' },
];

const initialReviews: Review[] = [
  { name: 'Ritika Srivastava', product: 'Velvet Matte Luxe Liquid Lipstick', rating: 5, text: 'The shade matching was better than anything I have had in Delhi. Lasted a twelve hour function.', date: '22 Sep 2026', status: 'Approved' },
  { name: 'Anjali Verma', product: 'Glow Ritual Vitamin C Face Serum', rating: 5, text: 'Skin feels visibly brighter within three weeks of nightly use.', date: '20 Sep 2026', status: 'Approved' },
  { name: 'Sneha Gupta', product: 'Bloom Essence Rose Eau De Parfum', rating: 4, text: 'Lovely soft rose, though I wish the sillage lasted a little longer in summer.', date: '18 Sep 2026', status: 'Approved' },
  { name: 'Meenakshi Rawat', product: 'Aura Radiance Highlighter', rating: 5, text: 'No glitter fallout at all — photographs beautifully under bridal lighting.', date: '17 Sep 2026', status: 'Pending' },
  { name: 'Priya Agarwal', product: 'Hydra Dew Hyaluronic Serum', rating: 3, text: 'Good hydration but takes a while to absorb in humid weather.', date: '15 Sep 2026', status: 'Pending' },
];

const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

function AdminHeading({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return (
    <div className="admin-page-heading">
      <div><span className="eyebrow">Glow &amp; Grace · Admin</span><h1>{title}</h1><p>{copy}</p></div>
      {action && <div className="admin-heading-actions">{action}</div>}
    </div>
  );
}

function AdminTable({ headers, rows, emptyMessage }: { headers: string[]; rows: ReactNode[][]; emptyMessage: string }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.length
            ? rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)
            : <tr><td className="admin-empty" colSpan={headers.length}>{emptyMessage}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function Status({ children }: { children: string }) {
  const kind = /delivered|active|approved|placed|open|vip|loyal/i.test(children)
    ? 'good'
    : /pending|processing|new|at risk|paused|packed|interview/i.test(children)
      ? 'pending'
      : /cancelled|returned|hidden|not selected/i.test(children)
        ? 'quiet'
        : 'info';
  return <span className={`admin-status ${kind}`}>{children}</span>;
}

const productImageMaxBytes = 300 * 1024;

function isSupportedProductImage(type: string): type is ProductImageUpload['mimeType'] {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
}

async function encodeProductImage(file: File): Promise<ProductImageUpload> {
  if (!isSupportedProductImage(file.type)) {
    throw new Error(`${file.name}: choose a JPEG, PNG or WebP image.`);
  }
  if (file.size > productImageMaxBytes) {
    throw new Error(`${file.name}: each image must be 300 KB or smaller.`);
  }

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}: this image could not be opened.`);
  }
  const { width, height } = image;
  image.close();
  if (width < 1 || height < 1 || width > 1200 || height > 1200) {
    throw new Error(`${file.name}: image dimensions must be no larger than 1200 × 1200 px.`);
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error(`${file.name}: the image could not be read.`));
    });
    reader.addEventListener('error', () => reject(new Error(`${file.name}: the image could not be read.`)));
    reader.readAsDataURL(file);
  });
  const separator = dataUrl.indexOf(',');
  if (separator < 0) throw new Error(`${file.name}: the image could not be encoded.`);
  return {
    filename: file.name,
    mimeType: file.type,
    data: dataUrl.slice(separator + 1),
    width,
    height,
  };
}

type SelectedProductImage = { file: File; previewUrl: string };

function ProductForm({ onCancel, onSave }: { onCancel: () => void; onSave: (product: Product) => void }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<SelectedProductImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  const imagePreviewUrls = useRef<string[]>([]);

  useEffect(() => () => {
    imagePreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function addImages(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length > 10 - images.length) {
      setError('A product can have up to 10 images.');
      return;
    }
    const invalidImage = selected.find((file) => !isSupportedProductImage(file.type) || file.size > productImageMaxBytes);
    if (invalidImage) {
      setError(`${invalidImage.name}: use a JPEG, PNG or WebP image no larger than 300 KB.`);
      return;
    }
    setError('');
    const newImages = selected.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      imagePreviewUrls.current.push(previewUrl);
      return { file, previewUrl };
    });
    setImages((current) => [...current, ...newImages]);
  }

  function removeImage(index: number) {
    const image = images[index];
    if (!image) return;
    URL.revokeObjectURL(image.previewUrl);
    imagePreviewUrls.current = imagePreviewUrls.current.filter((url) => url !== image.previewUrl);
    setImages((current) => current.filter((_item, itemIndex) => itemIndex !== index));
    setError('');
  }

  function handleImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addImages(event.dataTransfer.files);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const form = event.currentTarget;
      const values = new FormData(form);
      const files = images.map((image) => image.file);
      if (files.length < 1 || files.length > 10) throw new Error('Upload between 1 and 10 product images.');
      const payload: CreateProductRequest = {
        name: String(values.get('name') ?? '').trim(),
        brand: String(values.get('brand') ?? '').trim(),
        sku: String(values.get('sku') ?? '').trim(),
        category: String(values.get('category') ?? ''),
        price: Number(values.get('price')),
        mrp: Number(values.get('mrp')),
        stock: Number(values.get('stock')),
        description: String(values.get('description') ?? '').trim(),
        images: await Promise.all(files.map(encodeProductImage)),
      };
      onSave(await createCatalogueProduct(payload));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The product could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <AdminHeading title="Add a product" copy="Create a considered new addition to the beauty-house catalogue." />
      <form className="admin-form-card admin-product-form" onSubmit={submit}>
        <div className="admin-form-intro"><span>01</span><div><h2>Product details</h2><p>Product name, category, pricing and stock.</p></div></div>
        <label className="admin-field admin-span-all">Product name<input name="name" required placeholder="e.g. Velvet Matte Luxe Liquid Lipstick" /></label>
        <label className="admin-field">Brand<input name="brand" placeholder="e.g. Glow & Grace" /></label>
        <label className="admin-field">SKU / code<input name="sku" placeholder="e.g. GG-LIP-001" /></label>
        <label className="admin-field">Category<select name="category" defaultValue="Makeup"><option>Makeup</option><option>Skincare</option><option>Fragrance</option><option>Gifting</option></select></label>
        <label className="admin-field">Price (₹)<input name="price" type="number" min="1" step="1" required /></label>
        <label className="admin-field">Original price (₹)<input name="mrp" type="number" min="1" step="1" required /></label>
        <label className="admin-field">Stock quantity<input name="stock" type="number" min="0" step="1" required /></label>
        <label className="admin-field admin-span-all" htmlFor="product-images">Product images</label>
        <div className={`admin-image-drop-zone admin-span-all${dragging ? ' is-dragging' : ''}`}
          onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={handleImageDrop}>
          <input ref={imageInput} className="admin-file-input" id="product-images" name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby="product-image-guidance"
            onChange={(event) => { addImages(event.currentTarget.files ?? []); event.currentTarget.value = ''; }} />
          <span>Drag and drop product images here</span>
          <span>or</span>
          <button className="button button-light" type="button" onClick={() => imageInput.current?.click()}>Choose images</button>
        </div>
        <p className="admin-image-guidance admin-span-all" id="product-image-guidance">Upload up to 10 images. Each image can be up to 1200 × 1200 px and 300 KB. JPEG, PNG and WebP are supported.</p>
        {images.length > 0 && <div className="admin-image-previews admin-span-all">{images.map((image, index) => <figure key={`${image.file.name}-${index}`}><img src={image.previewUrl} alt={`Preview of ${image.file.name}`} /><figcaption>{image.file.name}</figcaption><button type="button" aria-label={`Remove ${image.file.name}`} onClick={() => removeImage(index)} disabled={saving}>Remove</button></figure>)}</div>}
        <label className="admin-field admin-span-all">Description<textarea name="description" rows={4} required /></label>
        <div className="admin-form-actions admin-span-all"><button className="button button-dark" type="submit" disabled={saving}>{saving ? 'Saving product…' : 'Save product'}</button><button className="button button-light" type="button" onClick={onCancel} disabled={saving}>Cancel</button></div>
        {error && <p className="admin-form-notice admin-form-error admin-span-all" role="alert">{error}</p>}
      </form>
    </>
  );
}

export function AdminPortal() {
  const navigate = useNavigate();
  const account = getDemoAccount();
  const { products: catalogueProducts, error: catalogueError, addProduct } = useProductCatalog();
  const [section, setSection] = useState<AdminSection>('overview');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [orders] = useState(initialOrders);
  const products: AdminProduct[] = catalogueProducts.map((product, index) => ({
    ...product,
    stock: product.stock ?? [84, 36, 21, 42, 18, 8, 14, 6][index] ?? 0,
  }));
  const [jobs] = useState(initialJobs);
  const [candidates] = useState(initialCandidates);
  const [partners] = useState(initialPartners);
  const [customers] = useState(initialCustomers);
  const [reviews] = useState(initialReviews);
  const [notice, setNotice] = useState('');
  const activeTab = tabs.find((tab) => tab.id === section) ?? tabs[0];

  const filteredOrders = useMemo(() => orders.filter((order) =>
    (filter === 'All' || order.status === filter) &&
    `${order.id} ${order.customer}`.toLowerCase().includes(search.toLowerCase())), [orders, filter, search]);
  const filteredProducts = useMemo(() => products.filter((product) =>
    (filter === 'All' || product.category === filter) &&
    `${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase())), [products, filter, search]);
  const filteredJobs = useMemo(() => jobs.filter((job) =>
    (filter === 'All' || job.status === filter) &&
    `${job.title} ${job.salon} ${job.location}`.toLowerCase().includes(search.toLowerCase())), [jobs, filter, search]);
  const filteredCandidates = useMemo(() => candidates.filter((candidate) =>
    (filter === 'All' || candidate.stage === filter) &&
    `${candidate.name} ${candidate.skill} ${candidate.role}`.toLowerCase().includes(search.toLowerCase())), [candidates, filter, search]);
  const filteredPartners = useMemo(() => partners.filter((partner) =>
    (filter === 'All' || partner.status === filter) &&
    `${partner.name} ${partner.location} ${partner.specialty}`.toLowerCase().includes(search.toLowerCase())), [partners, filter, search]);
  const filteredCustomers = useMemo(() => customers.filter((customer) =>
    (filter === 'All' || customer.segment === filter) &&
    `${customer.name} ${customer.location}`.toLowerCase().includes(search.toLowerCase())), [customers, filter, search]);
  const filteredReviews = useMemo(() => reviews.filter((review) =>
    (filter === 'All' || review.status === filter) &&
    `${review.name} ${review.product} ${review.text}`.toLowerCase().includes(search.toLowerCase())), [reviews, filter, search]);

  function changeSection(next: AdminSection) {
    setSection(next);
    setSearch('');
    setFilter('All');
    setNotice('');
  }

  function logout() {
    signOutDemo();
    navigate('/');
  }

  function productSaved(product: Product) {
    addProduct(product);
    setSection('products');
    setSearch('');
    setFilter('All');
    setNotice('');
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

  function pageContent(): ReactNode {
    if (section === 'overview') {
      return (
        <>
          <AdminHeading title="Dashboard" copy="Welcome back — here is your store overview." action={<><button className="button button-light" type="button" onClick={() => exportRows('glow-grace-report.csv', [['Metric', 'Value'], ['Revenue (MTD)', '₹6.42L'], ['Orders', orders.length], ['Customers', customers.length], ['Open roles', jobs.filter((job) => job.status === 'Open').length]])}>Export report</button><button className="button button-dark" type="button" onClick={() => changeSection('add-product')}>Add product</button></>} />
          <div className="admin-metrics">
            <article><span>Revenue (MTD)</span><strong>₹6.42L</strong><small>▲ 18.2% vs last month</small><i style={{ width: '78%' }} /></article>
            <article><span>Orders</span><strong>1,248</strong><small>▲ 8.2% this month</small><i style={{ width: '64%' }} /></article>
            <article><span>Customers</span><strong>5,024</strong><small>▲ 5.1% new signups</small><i style={{ width: '52%' }} /></article>
            <article><span>Open roles</span><strong>32</strong><small>▼ 2.3% vs last month</small><i style={{ width: '38%' }} /></article>
          </div>
          <div className="admin-dashboard-grid">
            <section className="admin-panel"><h2>Revenue overview <small>Last 7 months</small></h2><div className="admin-revenue-chart" aria-label="Revenue by month from March through September">{[['Mar', 62], ['Apr', 78], ['May', 55], ['Jun', 88], ['Jul', 72], ['Aug', 95], ['Sep', 84]].map(([month, amount]) => <div key={month}><span style={{ height: `${amount}%` }} /><small>{month}</small></div>)}</div></section>
            <section className="admin-panel"><h2>Sales by category</h2><div className="admin-category-list">{[['Makeup', '38%', '₹2.42L'], ['Skincare', '29%', '₹1.86L'], ['Fragrance', '19%', '₹1.24L'], ['Gifting', '14%', '₹90k']].map(([label, percent, value]) => <div key={label}><span>{label}</span><i><b style={{ width: percent }} /></i><strong>{value}</strong></div>)}</div></section>
            <section className="admin-panel admin-panel-wide"><h2>Recent orders <button className="admin-text-button" type="button" onClick={() => changeSection('orders')}>View all →</button></h2><AdminTable headers={['Order', 'Customer', 'Items', 'Amount', 'Status']} emptyMessage="No recent orders." rows={orders.slice(0, 5).map((order) => [<strong>{order.id}</strong>, order.customer, `${order.items} products`, money(order.amount), <Status>{order.status}</Status>])} /></section>
            <section className="admin-panel"><h2>Needs attention</h2><ul className="admin-attention-list"><li><b>2</b><span>partner applications awaiting approval</span></li><li><b>4</b><span>products below reorder level</span></li><li><b>3</b><span>reviews pending moderation</span></li><li><b>2</b><span>orders flagged for return</span></li></ul></section>
          </div>
        </>
      );
    }

    if (section === 'orders') return <>
      <AdminHeading title="Orders" copy={`${orders.length} orders placed to date.`} action={<button className="button button-light" type="button" onClick={() => exportRows('glow-grace-orders.csv', [['Order', 'Customer', 'Items', 'Date', 'Amount', 'Payment', 'Status'], ...filteredOrders.map((order) => [order.id, order.customer, order.items, order.date, order.amount, order.payment, order.status])])}>Export orders</button>} />
      <div className="admin-toolbar"><label className="admin-search">Search orders<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Order number or customer" /></label><label className="admin-filter">Status<select value={filter} onChange={(event) => setFilter(event.target.value)}>{['All', 'Processing', 'Packed', 'Shipped', 'Delivered', 'Returned', 'Cancelled'].map((status) => <option key={status}>{status}</option>)}</select></label></div>
      <AdminTable headers={['Order', 'Customer', 'Items', 'Date', 'Amount', 'Payment', 'Status']} emptyMessage="No orders match this filter." rows={filteredOrders.map((order) => [<strong>{order.id}</strong>, order.customer, `${order.items} products`, order.date, money(order.amount), order.payment, <Status>{order.status}</Status>])} />
    </>;

    if (section === 'products') return <>
      <AdminHeading title="Catalogue & inventory" copy={`${products.length} products in the catalogue.`} action={<button className="button button-dark" type="button" onClick={() => changeSection('add-product')}>+ Add a product</button>} />
      <div className="admin-toolbar"><label className="admin-search">Search products<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Product or category" /></label><label className="admin-filter">Category<select value={filter} onChange={(event) => setFilter(event.target.value)}>{['All', 'Makeup', 'Skincare', 'Fragrance', 'Gifting'].map((category) => <option key={category}>{category}</option>)}</select></label></div>
      <AdminTable headers={['Product', 'Category', 'Price', 'Stock', 'Rating', 'Status']} emptyMessage="No products match this filter." rows={filteredProducts.map((product) => [<span className="admin-product-cell"><img src={productImageUrl(product.image)} alt="" /><strong>{product.name}</strong></span>, product.category, money(product.price), <Status>{product.stock < 12 ? `${product.stock} · Low stock` : `${product.stock} units`}</Status>, `★ ${product.rating.toFixed(1)}`, product.stock < 12 ? <Status>Restock</Status> : <Status>Active</Status>])} />
    </>;

    if (section === 'add-product') return <ProductForm onCancel={() => changeSection('products')} onSave={productSaved} />;

    if (section === 'jobs') return <>
      <AdminHeading title="Job vacancies" copy={`${jobs.length} vacancies in the beauty community.`} action={<button className="button button-dark" type="button" onClick={() => changeSection('add-job')}>Post a vacancy</button>} />
      <div className="admin-toolbar"><label className="admin-search">Search vacancies<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Role, salon or location" /></label><label className="admin-filter">Status<select value={filter} onChange={(event) => setFilter(event.target.value)}>{['All', 'Open', 'Paused', 'Closed'].map((status) => <option key={status}>{status}</option>)}</select></label></div>
      <AdminTable headers={['Position', 'Salon', 'Location', 'Salary', 'Experience', 'Applicants', 'Status']} emptyMessage="No vacancies match this filter." rows={filteredJobs.map((job) => [<strong>{job.title}</strong>, job.salon, job.location, job.salary, job.experience, job.applicants, <Status>{job.status}</Status>])} />
    </>;

    if (section === 'add-job') return <>
      <AdminHeading title="Post a vacancy" copy="Create a beauty-parlour placement listing." />
      <form className="admin-form-card" onSubmit={(event) => { event.preventDefault(); setNotice('Vacancy saved for preview. Job publishing is not connected yet.'); }}>
        <div className="admin-form-intro admin-span-all"><span>01</span><div><h2>Position details</h2><p>Role, salon, compensation and experience.</p></div></div>
        <label className="admin-field">Position title<input name="title" required placeholder="e.g. Senior Beautician" /></label><label className="admin-field">Salon / parlour<input name="salon" required placeholder="e.g. Blush Beauty Lounge" /></label>
        <label className="admin-field">Location<input name="location" required placeholder="e.g. Hazratganj, Lucknow" /></label><label className="admin-field">Employment type<select name="kind"><option>Full time</option><option>Part time</option><option>Contract</option></select></label>
        <label className="admin-field">Salary range<input name="salary" placeholder="e.g. ₹18k – ₹25k" /></label><label className="admin-field">Experience<input name="experience" placeholder="e.g. 2+ years" /></label>
        <div className="admin-form-actions admin-span-all"><button className="button button-dark" type="submit">Preview vacancy</button><button className="button button-light" type="button" onClick={() => changeSection('jobs')}>Cancel</button></div>
        {notice && <p className="admin-form-notice admin-span-all" role="status">{notice}</p>}
      </form>
    </>;

    if (section === 'candidates') return <>
      <AdminHeading title="Candidates" copy={`${candidates.length} registered beauty professionals.`} action={<label className="admin-filter">Stage<select value={filter} onChange={(event) => setFilter(event.target.value)}>{['All', ...new Set(candidates.map((candidate) => candidate.stage))].map((stage) => <option key={stage}>{stage}</option>)}</select></label>} />
      <div className="admin-toolbar"><label className="admin-search">Search candidates<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, skill or salon" /></label></div>
      <AdminTable headers={['Candidate', 'Skill', 'Experience', 'Applied to', 'Applied', 'Stage']} emptyMessage="No candidates match this filter." rows={filteredCandidates.map((candidate) => [<strong>{candidate.name}</strong>, candidate.skill, candidate.experience, candidate.role, candidate.applied, <Status>{candidate.stage}</Status>])} />
    </>;

    if (section === 'partners') return <>
      <AdminHeading title="Partner salons" copy={`${partners.length} salons in the local network.`} />
      <div className="admin-toolbar"><label className="admin-search">Search partners<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Salon, locality or specialty" /></label><label className="admin-filter">Status<select value={filter} onChange={(event) => setFilter(event.target.value)}>{['All', 'Active', 'Pending review'].map((status) => <option key={status}>{status}</option>)}</select></label></div>
      <AdminTable headers={['Salon', 'Locality', 'Type', 'Vacancies', 'Wholesale (MTD)', 'Rating', 'Status']} emptyMessage="No partners match this filter." rows={filteredPartners.map((partner) => [<strong>{partner.name}</strong>, partner.location, partner.specialty, partner.vacancies, money(partner.wholesale), partner.rating.toFixed(1), <Status>{partner.status}</Status>])} />
    </>;

    if (section === 'customers') return <>
      <AdminHeading title="Customers" copy={`${customers.length} registered customers.`} />
      <div className="admin-toolbar"><label className="admin-search">Search customers<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or locality" /></label><label className="admin-filter">Segment<select value={filter} onChange={(event) => setFilter(event.target.value)}>{['All', ...new Set(customers.map((customer) => customer.segment))].map((segment) => <option key={segment}>{segment}</option>)}</select></label></div>
      <AdminTable headers={['Customer', 'Locality', 'Orders', 'Lifetime value', 'Last order', 'Segment']} emptyMessage="No customers match this filter." rows={filteredCustomers.map((customer) => [<strong>{customer.name}</strong>, customer.location, customer.orders, money(customer.value), customer.lastOrder, <Status>{customer.segment}</Status>])} />
    </>;

    if (section === 'reviews') return <>
      <AdminHeading title="Reviews" copy={`${reviews.length} customer reviews · average ${(reviews.reduce((total, review) => total + review.rating, 0) / reviews.length).toFixed(1)} stars.`} action={<button className="button button-dark" type="button" onClick={() => changeSection('add-review')}>Add review</button>} />
      <div className="admin-toolbar"><label className="admin-search">Search reviews<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Customer, product or review" /></label><label className="admin-filter">Status<select value={filter} onChange={(event) => setFilter(event.target.value)}>{['All', 'Approved', 'Pending', 'Hidden'].map((status) => <option key={status}>{status}</option>)}</select></label></div>
      <AdminTable headers={['Customer', 'Product', 'Rating', 'Review', 'Date', 'Status']} emptyMessage="No reviews match this filter." rows={filteredReviews.map((review) => [<strong>{review.name}</strong>, review.product, `★ ${review.rating}.0`, review.text, review.date, <Status>{review.status}</Status>])} />
    </>;

    if (section === 'add-review') return <>
      <AdminHeading title="Add a review" copy="Record a customer product review." />
      <form className="admin-form-card" onSubmit={(event) => { event.preventDefault(); setNotice('Review saved for preview. Review publishing is not connected yet.'); }}>
        <div className="admin-form-intro admin-span-all"><span>01</span><div><h2>Reviewer &amp; feedback</h2><p>Customer details, product and review status.</p></div></div>
        <label className="admin-field">Customer name<input name="name" required placeholder="e.g. Ritika Srivastava" /></label><label className="admin-field">Product<select name="product" defaultValue="" required><option value="" disabled>Select a product</option>{products.map((product) => <option key={product.id}>{product.name}</option>)}</select></label>
        <label className="admin-field">Rating<select name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} stars</option>)}</select></label><label className="admin-field">Moderation status<select name="status"><option>Approved</option><option>Pending</option><option>Hidden</option></select></label>
        <label className="admin-field admin-span-all">Review<textarea name="review" rows={4} required /></label>
        <div className="admin-form-actions admin-span-all"><button className="button button-dark" type="submit">Save review</button><button className="button button-light" type="button" onClick={() => changeSection('reviews')}>Cancel</button></div>
        {notice && <p className="admin-form-notice admin-span-all" role="status">{notice}</p>}
      </form>
    </>;

    return (
      <>
        <AdminHeading title="Settings" copy="Store profile, delivery and notification preferences." />
        <div className="admin-settings-grid">
          <form className="admin-form-card" onSubmit={(event) => { event.preventDefault(); setNotice('Store profile saved for preview.'); }}>
            <div className="admin-form-intro admin-span-all"><span>01</span><div><h2>Store profile</h2><p>Details shown across the storefront.</p></div></div>
            <label className="admin-field admin-span-all">Store name<input defaultValue="Glow & Grace" /></label><label className="admin-field admin-span-all">Tagline<input defaultValue="A complete beauty & career destination" /></label>
            <label className="admin-field">Contact email<input type="email" defaultValue="care@glowngrace.in" /></label><label className="admin-field">Phone<input defaultValue="+91 98765 43210" /></label>
            <label className="admin-field admin-span-all">Studio address<textarea rows={3} defaultValue="Hazratganj, Lucknow, Uttar Pradesh 226001" /></label>
            <div className="admin-form-actions admin-span-all"><button className="button button-dark" type="submit">Save profile</button></div>
            {notice && <p className="admin-form-notice admin-span-all" role="status">{notice}</p>}
          </form>
          <section className="admin-form-card"><div className="admin-form-intro"><span>02</span><div><h2>Delivery &amp; pricing</h2><p>Shipping thresholds and tax.</p></div></div><label className="admin-field">Free delivery above (₹)<input type="number" defaultValue="999" /></label><label className="admin-field">Standard delivery fee (₹)<input type="number" defaultValue="59" /></label><label className="admin-field">GST rate (%)<input type="number" defaultValue="18" /></label><label className="admin-field">Return window (days)<input type="number" defaultValue="7" /></label></section>
          <section className="admin-form-card"><div className="admin-form-intro"><span>03</span><div><h2>Team access</h2><p>People helping run the beauty house.</p></div></div><ul className="admin-team-list"><li><b>Deepak Kumar</b><span>Store Administrator · full access</span></li><li><b>Richa Gupta</b><span>Store Manager · orders &amp; catalogue</span></li><li><b>Mohammed Masood</b><span>Placement Lead · jobs &amp; candidates</span></li></ul></section>
        </div>
      </>
    );
  }

  const sections = [...new Set(tabs.map((tab) => tab.group))];

  return (
    <section className="admin-console">
      <aside className="admin-sidebar">
        <Link className="admin-brand" to="/"><img src="/images/logo_mark.png" alt="" /><span><strong>Glow <i>&amp;</i> Grace</strong><small>ADMIN CONSOLE</small></span></Link>
        <nav className="admin-navigation" aria-label="Dashboard sections">
          {sections.map((group) => <div className="admin-nav-group" key={group}><span>{group}</span>{tabs.filter((tab) => tab.group === group).map((tab) => <button key={tab.id} type="button" aria-current={section === tab.id ? 'page' : undefined} className={section === tab.id ? 'active' : ''} onClick={() => changeSection(tab.id)}><span aria-hidden="true">{tab.id === 'overview' ? '⌂' : tab.id === 'orders' ? '▤' : tab.id === 'products' || tab.id === 'add-product' ? '◇' : tab.id === 'settings' ? '⚙' : '✦'}</span>{tab.label}</button>)}</div>)}
        </nav>
        <div className="admin-sidebar-footer"><span className="admin-avatar">GG</span><span><strong>Glow &amp; Grace</strong><small>Store Administrator</small></span><button type="button" title="Sign out" aria-label="Sign out" onClick={logout}>↪</button></div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar"><div><span className="admin-breadcrumb">Admin <i>/</i> {activeTab.label}</span><span className="admin-preview">DEMO PREVIEW</span></div><label className="admin-global-search"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search this section…" aria-label="Search this section" /></label><button className="admin-user-badge" type="button" onClick={logout} title="Sign out">GG</button></header>
        <main className="admin-content" aria-live="polite">{catalogueError && <p className="admin-service-warning" role="status">{catalogueError}</p>}{pageContent()}</main>
      </div>
    </section>
  );
}
