CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contact_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(32),
  topic VARCHAR(80) NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contact_requests_created_at_idx
  ON contact_requests (created_at DESC);

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(254) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(20) NOT NULL UNIQUE,
  customer_name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  street_address VARCHAR(240) NOT NULL,
  locality VARCHAR(120) NOT NULL,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  postal_code CHAR(6) NOT NULL,
  landmark VARCHAR(120),
  delivery_method VARCHAR(16) NOT NULL CHECK (delivery_method IN ('standard', 'express', 'same_day')),
  payment_method VARCHAR(16) NOT NULL CHECK (payment_method IN ('cod')),
  status VARCHAR(16) NOT NULL DEFAULT 'placed' CHECK (status IN ('placed', 'processing', 'shipped', 'delivered', 'cancelled')),
  subtotal_paise BIGINT NOT NULL CHECK (subtotal_paise > 0),
  shipping_paise BIGINT NOT NULL CHECK (shipping_paise >= 0),
  tax_paise BIGINT NOT NULL CHECK (tax_paise >= 0),
  total_paise BIGINT NOT NULL CHECK (total_paise > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_email_created_at_idx ON orders (email, created_at DESC);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL,
  product_name VARCHAR(180) NOT NULL,
  unit_price_paise BIGINT NOT NULL CHECK (unit_price_paise > 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
