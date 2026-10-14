-- Curated product bundles: a set of catalogue products sold together at one
-- bundle price. The console creates them, the storefront shows them beside the
-- catalogue, and a checkout can carry a bundle as its own order line.
--
-- Members are stored as a single comma-separated `product_ids` string, the same
-- shape `products.shades` and `job_vacancies.skills` already use, rather than a
-- join table: a bundle is only ever read and written whole, and the member
-- products are resolved when the bundle is listed.
CREATE TABLE IF NOT EXISTS product_bundles (
  id VARCHAR(24) PRIMARY KEY,
  name VARCHAR(180) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price > 0),
  tag VARCHAR(40),
  product_ids TEXT NOT NULL DEFAULT '',
  published BOOLEAN NOT NULL DEFAULT TRUE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A checkout line names either a product or a bundle. `product_id` loses its
-- NOT NULL (it never had a foreign key, so a deleted product was already an
-- accepted value) and `bundle_id` carries the bundle a line came from. A
-- bundle line stores the bundle's own price, so the discount survives the
-- member prices changing afterwards.
ALTER TABLE order_items
  ALTER COLUMN product_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS bundle_id VARCHAR(24);
