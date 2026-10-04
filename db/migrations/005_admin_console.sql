-- Admin console persistence: publishing flags, team accounts, store settings,
-- page visibility and the editable preview collections behind every console section.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS products_published_idx ON products (published, id);

-- The console moves orders through a "Packed" and a "Returned" stage, so the
-- stored vocabulary has to cover them too.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check CHECK (status IN ('placed', 'processing', 'packed', 'shipped', 'delivered', 'returned', 'cancelled'));

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  role VARCHAR(48) NOT NULL,
  password_hash TEXT NOT NULL,
  avatar VARCHAR(180),
  status VARCHAR(16) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Paused')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_expires_at_idx ON admin_sessions (expires_at);

CREATE TABLE IF NOT EXISTS store_settings (
  key VARCHAR(64) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS site_pages (
  slug VARCHAR(48) PRIMARY KEY,
  label VARCHAR(80) NOT NULL,
  path VARCHAR(80) NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_vacancies (
  id VARCHAR(20) PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  partner VARCHAR(120) NOT NULL,
  area VARCHAR(80) NOT NULL,
  type VARCHAR(32) NOT NULL,
  salary VARCHAR(80) NOT NULL,
  experience VARCHAR(60) NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  applications INTEGER NOT NULL DEFAULT 0 CHECK (applications >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Open', 'Draft', 'Paused', 'Closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidates (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  role VARCHAR(120) NOT NULL,
  experience VARCHAR(60) NOT NULL DEFAULT '',
  city VARCHAR(80) NOT NULL,
  rating NUMERIC(2, 1) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  stage VARCHAR(24) NOT NULL DEFAULT 'New' CHECK (stage IN ('New', 'Shortlisted', 'Interview', 'Offer sent', 'Not selected')),
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(32) NOT NULL DEFAULT '',
  avatar VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_salons (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  area VARCHAR(80) NOT NULL,
  type VARCHAR(80) NOT NULL,
  rating NUMERIC(2, 1) NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  vacancies INTEGER NOT NULL DEFAULT 0 CHECK (vacancies >= 0),
  status VARCHAR(16) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Active', 'Pending', 'Paused')),
  phone VARCHAR(32) NOT NULL DEFAULT '',
  email VARCHAR(254) NOT NULL DEFAULT '',
  owner VARCHAR(120) NOT NULL DEFAULT '',
  since VARCHAR(12) NOT NULL DEFAULT '',
  avatar VARCHAR(180),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  phone VARCHAR(32) NOT NULL DEFAULT '',
  orders INTEGER NOT NULL DEFAULT 0 CHECK (orders >= 0),
  spent INTEGER NOT NULL DEFAULT 0 CHECK (spent >= 0),
  tier VARCHAR(16) NOT NULL DEFAULT 'New' CHECK (tier IN ('VIP', 'Loyal', 'New', 'At risk')),
  last_order_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id VARCHAR(20) PRIMARY KEY,
  author VARCHAR(120) NOT NULL,
  product_name VARCHAR(180) NOT NULL,
  rating NUMERIC(2, 1) NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'Pending review' CHECK (status IN ('Active', 'Pending review', 'Hidden')),
  avatar VARCHAR(180),
  reviewed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS demo_datasets (
  key VARCHAR(32) PRIMARY KEY,
  label VARCHAR(80) NOT NULL,
  visible BOOLEAN NOT NULL DEFAULT TRUE,
  seeded BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

