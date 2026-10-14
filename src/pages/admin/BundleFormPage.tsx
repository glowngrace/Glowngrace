import { useState, type FormEvent } from 'react';
import { productImageUrl, type Bundle, type Product } from '../../data/catalog';
import { money } from './AdminData';
import { ChipRow, PageHead, Panel, PanelHead, Toggle } from './AdminUi';

export function BundleFormPage({
  products,
  onCancel,
  editing,
  onSave,
}: {
  products: Product[];
  onCancel: () => void;
  editing?: Bundle;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const members = editing?.productIds ?? [];
  const [draft, setDraft] = useState({
    name: editing?.name ?? '',
    description: editing?.description ?? '',
    tag: editing?.tag ?? '',
    price: editing ? String(editing.price) : '',
  });
  const [selectedIds, setSelectedIds] = useState<number[]>(members);
  const [published, setPublished] = useState(editing ? editing.published !== false : true);
  const [featured, setFeatured] = useState(editing?.featured === true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedProducts = selectedIds
    .map((id) => products.find((product) => product.id === id))
    .filter((product): product is Product => Boolean(product));
  const mrp = selectedProducts.reduce((sum, product) => sum + product.price, 0);
  const price = Number(draft.price);
  const save = Number.isFinite(price) && price > 0 && mrp > price ? mrp - price : 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (selectedIds.length < 2) {
      setError('A bundle needs at least two products.');
      return;
    }
    setSaving(true);
    const saved = await onSave({
      name: draft.name.trim(),
      description: draft.description.trim(),
      price,
      tag: draft.tag.trim(),
      productIds: selectedIds,
      published,
      featured,
    });
    if (!saved) setSaving(false);
  }

  return (
    <>
      <PageHead
        crumb={editing ? `Edit ${editing.id}` : 'Curate a bundle'}
        title={editing ? `Edit ${editing.name}` : 'Curate a bundle'}
        sub="Group published products and sell them together at a bundle price."
        actions={<button className="admin-btn admin-btn-light" type="button" onClick={onCancel}>Cancel</button>}
      />
      <form className="admin-product-layout" onSubmit={submit} aria-label={editing ? 'Edit a bundle' : 'Add a bundle'}>
        <div className="admin-product-main">
          <Panel>
            <PanelHead title="Bundle details" sub="Name, story and the price shoppers pay" />
            <div className="admin-grid-2">
              <label className="admin-field admin-span-2">Bundle name<input name="name" required maxLength={180} value={draft.name} placeholder="e.g. The Bridal Glow Edit" onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className="admin-field admin-span-2">Description<textarea name="description" rows={4} maxLength={2000} value={draft.description} placeholder="What makes this edit special, and when would someone reach for it?" onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
              <label className="admin-field">Bundle price (₹)<input name="price" type="number" min="1" step="1" required value={draft.price} placeholder="e.g. 1799" onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} /></label>
              <label className="admin-field">Tag <span className="admin-optional">(optional)</span><input name="tag" maxLength={40} value={draft.tag} placeholder="e.g. Bestseller, Gift ready" onChange={(event) => setDraft((current) => ({ ...current, tag: event.target.value }))} /></label>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Member products" sub={`${selectedProducts.length} of 20 products selected`} />
            <p className="admin-muted">Pick the products this bundle sells together. The MRP is the sum of their prices, so shoppers can see what they save.</p>
            <div className="admin-chip-wrap">
              <ChipRow
                label="Member products"
                options={products.map((product) => product.name)}
                value={selectedProducts.map((product) => product.name)}
                onChange={(names) => setSelectedIds(
                  names.map((name) => products.find((product) => product.name === name)?.id).filter((id): id is number => id !== undefined),
                )}
              />
            </div>
          </Panel>
        </div>

        <aside className="admin-product-side">
          <Panel className="admin-preview-card">
            <PanelHead title="Live preview" sub="Storefront bundle card" />
            <div className="admin-bundle-preview">
              <span className={selectedProducts.length === 2 ? 'admin-bundle-photo is-n2' : 'admin-bundle-photo is-n3'}>
                {selectedProducts.slice(0, 3).map((product) => <img key={product.id} src={productImageUrl(product.image)} alt="" />)}
                <span className="admin-bundle-photo-plus">+</span>
              </span>
              <div className="admin-preview-body">
                <span className="admin-preview-cat">Curated bundle · {selectedProducts.length} {selectedProducts.length === 1 ? 'product' : 'products'}</span>
                <h3>{draft.name || 'Bundle name'}</h3>
                <p className="admin-preview-price">
                  {price > 0 ? money(price) : '₹—'}
                  {mrp > 0 && <del>{money(mrp)}</del>}
                </p>
                {save > 0 && <span className="admin-save-amount">You save {money(save)}</span>}
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Publishing" />
            <div className="admin-stack">
              <div className="admin-switch-row">
                <span><strong>Visible in store</strong><small>Show this bundle to shoppers</small></span>
                <Toggle label="Visible in store" checked={published} onChange={setPublished} />
              </div>
              <div className="admin-switch-row">
                <span><strong>Featured</strong><small>Pin to the home page edit</small></span>
                <Toggle label="Featured" checked={featured} onChange={setFeatured} />
              </div>
            </div>
          </Panel>

          <div className="admin-form-actions">
            <button className="admin-btn admin-btn-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save bundle'}</button>
            <button className="admin-btn admin-btn-ghost" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          </div>
          {error && <p className="admin-alert-inline" role="alert">{error}</p>}
        </aside>
      </form>
    </>
  );
}