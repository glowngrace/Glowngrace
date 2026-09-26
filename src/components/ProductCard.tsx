import { Link } from 'react-router-dom';
import type { Product } from '../data/catalog';
import { useCart } from './CartContext';

type ProductCardProps = {
  product: Product;
  isFavorite: boolean;
  toggleFavorite: (productId: number) => void;
};

const money = (amount: number) => `₹${amount.toLocaleString('en-IN')}`;

export function ProductCard({ product, isFavorite, toggleFavorite }: ProductCardProps) {
  const { add } = useCart();

  return (
    <article className="product-card">
      <div className="product-image-wrap">
        <Link className="product-image" to={`/product/${product.id}`} aria-label={`View ${product.name}`}>
          <img src={`/images/${product.image}`} alt={product.name} loading="lazy" />
        </Link>
        {product.badge && <span className="product-badge">{product.badge}</span>}
        <button
          className={`favorite-button${isFavorite ? ' is-favorite' : ''}`}
          type="button"
          aria-label={isFavorite ? `Remove ${product.name} from wishlist` : `Add ${product.name} to wishlist`}
          aria-pressed={isFavorite}
          onClick={() => toggleFavorite(product.id)}
        >
          {isFavorite ? '♥' : '♡'}
        </button>
        <button className="quick-add" type="button" onClick={() => add(product)}>Add to bag</button>
      </div>
      <div className="product-meta">
        <span>{product.category}</span>
        <span className="rating">★ {product.rating.toFixed(1)} <span>({product.reviews})</span></span>
      </div>
      <Link to={`/product/${product.id}`} className="product-name">{product.name}</Link>
      <div className="product-price"><strong>{money(product.price)}</strong><del>{money(product.mrp)}</del></div>
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
