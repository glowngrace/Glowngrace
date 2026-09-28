import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { type ProductImageUpload } from '../../lib/api';
import type { Product } from '../../data/catalog';
import { productCategories } from './AdminData';
import { ChipRow, Icon, PageHead, Panel, PanelHead, Stars, TagInput, Toggle } from './AdminUi';

const productImageMaxBytes = 300 * 1024;
const maxImages = 10;

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

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}: this image could not be opened.`);
  }
  const { width, height } = bitmap;
  bitmap.close();
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
  return { filename: file.name, mimeType: file.type, data: dataUrl.slice(separator + 1), width, height };
}

type SelectedImage = { key: string; name: string; previewUrl: string; file?: File };

type LibraryImage = { name: string; src: string };

export function ProductFormPage({
  library,
  onCancel,
  editing,
  onNotice,
  onSave,
}: {
  library: LibraryImage[];
  onCancel: () => void;
  editing?: Product;
  onNotice: (message: string) => void;
  onSave: (payload: Record<string, unknown>, productId?: number) => Promise<boolean>;
}) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const [shades, setShades] = useState<string[]>([]);
  const [published, setPublished] = useState(editing ? editing.published !== false : true);
  const [featured, setFeatured] = useState(editing?.featured === true);
  const [highlights, setHighlights] = useState<string[]>([]);
  const [preview, setPreview] = useState({
    name: editing?.name ?? '',
    price: editing ? String(editing.price) : '',
    mrp: editing ? String(editing.mrp) : '',
    stock: editing?.stock === undefined ? '' : String(editing.stock),
    category: editing?.category ?? 'Makeup',
  });
  const [addingFromLibrary, setAddingFromLibrary] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function addFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length > maxImages - images.length) {
      setError(`A product can have up to ${maxImages} images.`);
      return;
    }
    const invalid = selected.find((file) => !isSupportedProductImage(file.type) || file.size > productImageMaxBytes);
    if (invalid) {
      setError(`${invalid.name}: use a JPEG, PNG or WebP image no larger than 300 KB.`);
      return;
    }
    setError('');
    const added = selected.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.push(previewUrl);
      return { key: `${file.name}-${file.size}-${previewUrl}`, name: file.name, previewUrl, file };
    });
    setImages((current) => [...current, ...added]);
  }

  function removeImage(key: string) {
    setImages((current) => {
      const target = current.find((image) => image.key === key);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrls.current = objectUrls.current.filter((url) => url !== target.previewUrl);
      }
      return current.filter((image) => image.key !== key);
    });
    setError('');
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  async function addLibraryImage(entry: LibraryImage) {
    if (images.length >= maxImages) {
      setError(`A product can have up to ${maxImages} images.`);
      return;
    }
    setAddingFromLibrary(entry.src);
    setError('');
    try {
      const response = await fetch(entry.src);
      if (!response.ok) throw new Error(`${entry.name}: the image could not be loaded.`);
      const blob = await response.blob();
      const file = new File([blob], entry.name, { type: blob.type || 'image/jpeg' });
      const previewUrl = URL.createObjectURL(file);
      objectUrls.current.push(previewUrl);
      setImages((current) => [...current, { key: `lib-${entry.src}-${current.length}`, name: entry.name, previewUrl, file }]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : `${entry.name}: the image could not be loaded.`);
    } finally {
      setAddingFromLibrary('');
    }
  }

  function updatePreview(field: keyof typeof preview, value: string) {
    setPreview((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (images.length < 1 && !editing) {
      setError('Upload at least 1 product image.');
      return;
    }
    setSaving(true);
    try {
      const values = new FormData(event.currentTarget);
      const payload: Record<string, unknown> = {
        name: String(values.get('name') ?? '').trim(),
        brand: String(values.get('brand') ?? '').trim(),
        sku: String(values.get('sku') ?? '').trim(),
        category: String(values.get('category') ?? ''),
        price: Number(values.get('price')),
        mrp: Number(values.get('mrp')),
        stock: Number(values.get('stock')),
        description: String(values.get('description') ?? '').trim(),
        published,
        featured,
      };
      if (images.length > 0) {
        payload.images = await Promise.all(images.map((image) => encodeProductImage(image.file as File)));
      }
      const saved = await onSave(payload, editing?.id);
      if (!saved) setSaving(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The product could not be saved. Please try again.');
      setSaving(false);
    }
  }

  const leadImage = images[0];
  const discount = Number(preview.mrp) > Number(preview.price) && Number(preview.price) > 0
    ? Math.round((1 - Number(preview.price) / Number(preview.mrp)) * 100)
    : 0;

  return (
    <>
      <PageHead
        crumb={editing ? `Edit ${editing.name}` : 'Add product'}
        title={editing ? 'Edit product' : 'Add a product'}
        sub={editing ? 'Update this product and how it appears in the store.' : 'Add a new product to your catalogue.'}
        actions={
          <>
            <button className="admin-btn admin-btn-light" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
            <button className="admin-btn admin-btn-dark" type="submit" form="admin-product-form" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Add product'}
            </button>
          </>
        }
      />

      <form className="admin-product-layout" id="admin-product-form" aria-label={editing ? 'Edit a product' : 'Add a product'} onSubmit={submit}>
        <div className="admin-product-main">
          <Panel>
            <PanelHead title="Product information" sub="The essentials shoppers see first" />
            <div className="admin-grid-2">
              <label className="admin-field admin-span-2">Product name<input name="name" required defaultValue={editing?.name ?? ''} placeholder="e.g. Velvet Matte Luxe Liquid Lipstick" onChange={(event) => updatePreview('name', event.target.value)} /></label>
              <label className="admin-field">Brand<input name="brand" defaultValue={editing?.brand ?? ''} placeholder="e.g. Glow &amp; Grace" /></label>
              <label className="admin-field">SKU / code<input name="sku" defaultValue={editing?.sku ?? ''} placeholder="e.g. GG-LIP-001" /></label>
              <label className="admin-field">Category<select name="category" value={preview.category} onChange={(event) => updatePreview('category', event.target.value)}>{productCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label className="admin-field">Price (₹)<input name="price" type="number" min="1" step="1" required defaultValue={editing?.price ?? ''} onChange={(event) => updatePreview('price', event.target.value)} /></label>
              <label className="admin-field">Original price (₹)<input name="mrp" type="number" min="1" step="1" required defaultValue={editing?.mrp ?? ''} onChange={(event) => updatePreview('mrp', event.target.value)} /></label>
              <label className="admin-field">Stock quantity<input name="stock" type="number" min="0" step="1" required defaultValue={editing?.stock ?? ''} onChange={(event) => updatePreview('stock', event.target.value)} /></label>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Media" sub={`${images.length} of ${maxImages} images added`} />
            <div
              className={dragging ? 'admin-drop is-dragging' : 'admin-drop'}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
              onDrop={handleDrop}
            >
              <input
                ref={imageInput}
                className="sr-only"
                id="product-images"
                name="images"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                aria-describedby="product-image-guidance"
                onChange={(event) => { addFiles(event.currentTarget.files ?? []); event.currentTarget.value = ''; }}
              />
              <label className="admin-drop-label" htmlFor="product-images">Product images</label>
              <Icon name="upload" className="admin-drop-icon" />
              <p><strong>Drag and drop images here</strong></p>
              <p className="admin-muted">or choose from your computer</p>
              <button className="admin-btn admin-btn-light" type="button" onClick={() => imageInput.current?.click()}>Choose images</button>
              <small id="product-image-guidance">JPEG, PNG or WebP · max 1200 × 1200 px · max 300 KB each · up to {maxImages} images{editing ? ' · leave empty to keep the current images' : ''}</small>
            </div>

            {images.length > 0 && (
              <ul className="admin-thumbs">
                {images.map((image, index) => (
                  <li key={image.key} className="admin-thumb">
                    <img src={image.previewUrl} alt={`Preview of ${image.name}`} />
                    {index === 0 && <span className="admin-thumb-badge">Cover</span>}
                    <button type="button" aria-label={`Remove ${image.name}`} onClick={() => removeImage(image.key)} disabled={saving}>×</button>
                  </li>
                ))}
              </ul>
            )}

            <div className="admin-library">
              <p className="admin-library-title">Or pick from your image library</p>
              <ul className="admin-thumbs is-library">
                {library.map((entry) => (
                  <li className="admin-thumb" key={entry.src}>
                    <img src={entry.src} alt="" loading="lazy" />
                    <button
                      type="button"
                      aria-label={`Use ${entry.name}`}
                      onClick={() => addLibraryImage(entry)}
                      disabled={addingFromLibrary === entry.src || images.length >= maxImages}
                    >
                      <Icon name="plus" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Organisation" sub="How this product is grouped" />
            <div className="admin-stack">
              <fieldset className="admin-field">
                <legend>Shades / variants</legend>
                <TagInput tags={shades} onChange={setShades} placeholder="e.g. Nude Silk" />
              </fieldset>
              <fieldset className="admin-field">
                <legend>Highlights</legend>
                <TagInput tags={highlights} onChange={setHighlights} placeholder="e.g. Long-lasting" />
              </fieldset>
              <label className="admin-field">Description<textarea name="description" rows={5} required defaultValue={editing?.description ?? ''} placeholder="A considered description of the product." /></label>
            </div>
          </Panel>
        </div>

        <aside className="admin-product-side">
          <Panel className="admin-preview-card">
            <PanelHead title="Live preview" sub="Storefront card" />
            <div className="admin-preview">
              <div className="admin-preview-media">
                {leadImage
                  ? <img src={leadImage.previewUrl} alt="" />
                  : <span className="admin-preview-empty"><Icon name="box" />Product image</span>}
                {discount > 0 && <span className="admin-preview-off">{discount}% off</span>}
              </div>
              <div className="admin-preview-body">
                <span className="admin-preview-cat">{preview.category || 'Category'}</span>
                <h3>{preview.name || 'Product name'}</h3>
                <div className="admin-preview-meta">
                  <Stars rating={4.8} />
                  <span>{preview.stock ? `${preview.stock} in stock` : 'Stock'}</span>
                </div>
                <p className="admin-preview-price">
                  {preview.price ? `₹${Number(preview.price).toLocaleString('en-IN')}` : '₹—'}
                  {preview.mrp && <del>₹{Number(preview.mrp).toLocaleString('en-IN')}</del>}
                </p>
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Publishing" />
            <div className="admin-stack">
              <ChipRow label="Extra categories" options={[...productCategories]} value={highlights} onChange={setHighlights} />
              <div className="admin-switch-row">
                <span><strong>Visible in store</strong><small>Show this product to shoppers</small></span>
                <Toggle label="Visible in store" checked={published} onChange={setPublished} />
              </div>
              <div className="admin-switch-row">
                <span><strong>Featured</strong><small>Pin to the home page edit</small></span>
                <Toggle label="Featured" checked={featured} onChange={setFeatured} />
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHead title="Search &amp; SEO" />
            <div className="admin-stack">
              <label className="admin-field">URL slug<input name="slug" placeholder="velvet-matte-luxe-lipstick" /></label>
              <label className="admin-field">Meta title<input name="metaTitle" placeholder={preview.name || 'Product name'} /></label>
              <label className="admin-field">Meta description<textarea name="metaDescription" rows={3} placeholder="A short, search-friendly summary." /></label>
            </div>
          </Panel>

          <div className="admin-form-actions">
            <button className="admin-btn admin-btn-dark" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save product'}</button>
            <button className="admin-btn admin-btn-light" type="button" onClick={() => { setPublished(false); onNotice('Save the product to keep it hidden from shoppers.'); }} disabled={saving}>Keep hidden</button>
            <button className="admin-btn admin-btn-ghost" type="button" onClick={onCancel} disabled={saving}>Cancel</button>
          </div>
          {error && <p className="admin-alert-inline" role="alert">{error}</p>}
        </aside>
      </form>
    </>
  );
}
