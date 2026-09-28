import { Link } from 'react-router-dom';
import { productImageUrl, type Product } from '../data/catalog';
import { useCart } from './CartContext';

type ProductCardProps = {
  product: Product;
  isFavorite: boolean;
  toggleFavorite: (productId: number) => void;
};

const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

function starRow(rating: number) {
  return `${'★'.repeat(Math.round(rating))}${'☆'.repeat(Math.max(0, 5 - Math.round(rating)))}`;
}

export function ProductCard({ product, isFavorite, toggleFavorite }: ProductCardProps) {
  const { add } = useCart();
  const discount = product.mrp > product.price ? Math.round((1 - product.price / product.mrp) * 100) : 0;
  const tagLabel = product.badge === 'Sale' && discount > 0 ? `−${discount}%` : product.badge;

  return (
    <article className="product-card">
      <div className="product-image-wrap">
        <Link className="product-image" to={`/product/${product.id}`} aria-label={`View ${product.name}`}>
          <img src={productImageUrl(product.image)} alt={product.name} loading="lazy" />
        </Link>
        {tagLabel && <span className={`product-badge${product.badge === 'Sale' ? ' is-sale' : ''}`}>{tagLabel}</span>}
        <button
          className={`favorite-button${isFavorite ? ' is-favorite' : ''}`}
          type="button"
          aria-label={isFavorite ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          aria-pressed={isFavorite}
          onClick={() => toggleFavorite(product.id)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 20s-7-4.6-7-9.4A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.6C19 15.4 12 20 12 20z" />
          </svg>
        </button>
        <Link className="quick-add" to={`/product/${product.id}`}>Quick view</Link>
      </div>
      <div className="product-meta">
        <span className="product-category">{product.category}</span>
        <h3 className="product-name"><Link to={`/product/${product.id}`}>{product.name}</Link></h3>
        <p className="product-rating">
          <span className="stars" aria-hidden="true">{starRow(product.rating)}</span>
          <span>({product.reviews})</span>
        </p>
        <p className="product-price">
          <strong>{money(product.price)}</strong>
          {product.mrp > product.price && <del>{money(product.mrp)}</del>}
        </p>
        <div className="product-add">
          <button className="button button-line button-small" type="button" onClick={() => add(product)}>Add to bag</button>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({
  items,
  favorites,
  toggleFavorite,
}: {
  items: Product[];
  favorites: number[];
  toggleFavorite: (productId: number) => void;
}) {
  if (!items.length) return <p className="empty-results">Nothing in this edit just yet. Try another category.</p>;
  return (
    <div className="product-grid">
      {items.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          isFavorite={favorites.includes(product.id)}
          toggleFavorite={toggleFavorite}
        />
      ))}
    </div>
  );
}
