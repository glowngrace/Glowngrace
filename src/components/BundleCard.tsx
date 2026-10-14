import { Link } from 'react-router-dom';
import { productImageUrl, type Bundle } from '../data/catalog';
import { bundleMembers, type CatalogueItem } from '../lib/bundle-grid';
import { useCart } from './CartContext';
import { useProductCatalog } from './ProductCatalogContext';
import { ProductCard } from './ProductCard';

const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

export function BundleCard({ bundle }: { bundle: Bundle }) {
  const { products } = useProductCatalog();
  const { addBundle } = useCart();
  const members = bundleMembers(bundle, products);
  const save = bundle.mrp - bundle.price;
  const collageClass = members.length === 2 ? 'bundle-photo is-n2' : 'bundle-photo is-n3';

  return (
    <article className="bundle-card">
      <Link className={collageClass} to={`/bundle/${bundle.id}`} aria-label={`View the ${bundle.name} bundle`}>
        {members.slice(0, 3).map((product) => (
          <img key={product.id} src={productImageUrl(product.image)} alt={product.name} loading="lazy" />
        ))}
        {members.length > 3 && <span className="bundle-photo-more">+{members.length - 3}</span>}
        <span className="bundle-photo-plus" aria-hidden="true">+</span>
      </Link>
      <div className="bundle-body">
        <span className="bundle-kicker">Curated bundle · {members.length} {members.length === 1 ? 'product' : 'products'}{bundle.tag ? ` · ${bundle.tag}` : ''}</span>
        <h3 className="bundle-name"><Link to={`/bundle/${bundle.id}`}>{bundle.name}</Link></h3>
        <p className="bundle-desc">{bundle.description}</p>
        {members.length > 0 && (
          <ul className="bundle-items">
            {members.slice(0, 4).map((product) => (
              <li key={product.id}>
                <Link to={`/product/${product.id}`}>
                  <img src={productImageUrl(product.image)} alt="" />
                  <span>{product.name}</span>
                  <em>{money(product.price)}</em>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="bundle-price">
          <strong>{money(bundle.price)}</strong>
          {bundle.mrp > bundle.price && <del>{money(bundle.mrp)}</del>}
          {save > 0 && <span className="bundle-save">You save {money(save)}</span>}
        </div>
        <div className="bundle-actions">
          <button className="button button-dark button-small" type="button" onClick={() => addBundle(bundle)}>Add bundle to bag</button>
          <Link className="button button-line button-small" to={`/bundle/${bundle.id}`}>Details</Link>
        </div>
      </div>
    </article>
  );
}

export function CatalogueGrid({
  items,
  favorites,
  toggleFavorite,
}: {
  items: CatalogueItem[];
  favorites: number[];
  toggleFavorite: (productId: number) => void;
}) {
  if (!items.length) return <p className="empty-results">Nothing in this edit just yet. Try another view.</p>;
  return (
    <div className="product-grid is-mixed">
      {items.map((item, index) => (
        item.kind === 'bundle'
          ? <BundleCard key={item.bundle.id} bundle={item.bundle} />
          : <ProductCard
            key={`${item.product.id}-${index}`}
            product={item.product}
            isFavorite={favorites.includes(item.product.id)}
            toggleFavorite={toggleFavorite}
          />
      ))}
    </div>
  );
}