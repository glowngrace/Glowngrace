import { Link, useParams } from 'react-router-dom';
import { productImageUrl } from '../data/catalog';
import { useBundleCatalog } from '../components/BundleCatalogContext';
import { useProductCatalog } from '../components/ProductCatalogContext';
import { bundleMembers } from '../lib/bundle-grid';
import { useCart } from '../components/CartContext';

const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

export function BundlePage() {
  const { bundleId } = useParams();
  const { bundles, loading } = useBundleCatalog();
  const { products } = useProductCatalog();
  const { addBundle } = useCart();
  const bundle = bundles.find((item) => item.id === bundleId);

  if (!bundle) {
    if (loading) return <section className="section"><div className="page-container"><p className="empty-results">Loading this curated edit…</p></div></section>;
    return (
      <section className="section">
        <div className="page-container empty-state">
          <span className="eyebrow">A little detour</span>
          <h1>That bundle has been retired.</h1>
          <p>It was a lovely edit while it lasted. There’s plenty more in the collection.</p>
          <Link className="button button-dark" to="/shop">Back to the collection</Link>
        </div>
      </section>
    );
  }

  const members = bundleMembers(bundle, products);
  const save = bundle.mrp - bundle.price;
  const collageClass = members.length === 2 ? 'bundle-detail-photo is-n2' : 'bundle-detail-photo is-n3';

  return (
    <>
      <section className="section bundle-detail-section">
        <div className="page-container bundle-detail">
          <div className="bundle-detail-gallery">
            <div className={collageClass}>
              {members.slice(0, 3).map((product) => <img key={product.id} src={productImageUrl(product.image)} alt={product.name} />)}
              {members.length > 3 && <span className="bundle-photo-more">+{members.length - 3} more</span>}
            </div>
            {members.length > 0 && <p className="bundle-detail-caption">The edit, at a glance — {members.map((product) => product.name).join(' · ')}</p>}
          </div>
          <div className="bundle-detail-copy">
            <nav className="product-breadcrumb" aria-label="Breadcrumb"><Link to="/">Home</Link><span>/</span><Link to="/shop">Shop</Link><span>/</span><span>Curated bundle</span></nav>
            <span className="eyebrow">Curated bundle · {members.length} {members.length === 1 ? 'product' : 'products'}{bundle.tag ? ` · ${bundle.tag}` : ''}</span>
            <h1>{bundle.name}</h1>
            {bundle.description && <p className="bundle-detail-description">{bundle.description}</p>}
            <div className="detail-price">
              <strong>{money(bundle.price)}</strong>
              {bundle.mrp > bundle.price && <del>{money(bundle.mrp)}</del>}
              {save > 0 && <span className="detail-save">You save {money(save)}</span>}
            </div>
            {save > 0 && <p className="bundle-detail-save-note">These {members.length} favourites cost {money(bundle.mrp)} on their own — together they’re {money(bundle.price)}.</p>}
            <ul className="bundle-detail-members">
              {members.map((product) => (
                <li key={product.id}>
                  <Link to={`/product/${product.id}`} className="bundle-detail-member">
                    <img src={productImageUrl(product.image)} alt="" />
                    <span><strong>{product.name}</strong><small>Sold individually at {money(product.price)}</small></span>
                    <b>{money(product.price)}</b>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="product-detail-actions">
              <button className="button button-dark" type="button" onClick={() => addBundle(bundle)}>Add bundle to bag · {money(bundle.price)}</button>
              <Link className="underlined-link" to="/shop">Explore everything in the collection <span>↗</span></Link>
            </div>
            <p className="detail-sku">Bundle code <span>{bundle.id}</span></p>
          </div>
        </div>
      </section>
      {members.length > 0 && (
        <section className="section section-soft">
          <div className="page-container">
            <div className="section-heading heading-with-link">
              <div><span className="eyebrow">Inside this edit</span><span className="gold-rule" /><h2>Every product, at a glance</h2><p>Each of these can also be bought on its own.</p></div>
              <Link className="underlined-link" to="/shop">See the whole collection <span>↗</span></Link>
            </div>
            <div className="product-grid">
              {members.map((product) => (
                <Link className="bundle-member-card" to={`/product/${product.id}`} key={product.id}>
                  <img src={productImageUrl(product.image)} alt="" loading="lazy" />
                  <span><strong>{product.name}</strong><em>{money(product.price)}</em></span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}