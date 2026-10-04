-- Role-based registration: self-service signups that stay inactive until an
-- administrator approves them, plus the password-reset and email-outbox tables
-- behind the forgot-password flow.
--
-- Every statement here is idempotent because scripts/migrate-database.ts replays
-- the whole file on each run.

-- The signup lifecycle is Pending -> Active -> Suspended. The old vocabulary was
-- Active/Paused, so existing rows are moved across before the constraint is
-- narrowed. ORDER matters: the UPDATE must run while the old constraint still
-- permits 'Paused', and the new constraint must not reject the legacy value.
UPDATE admin_users SET status = 'Suspended' WHERE status = 'Paused';

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_status_check;
ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_status_check CHECK (status IN ('Pending', 'Active', 'Suspended'));

-- Where the account came from, and who last reviewed it. 'console' rows are the
-- team members an administrator adds by hand; 'signup' rows arrived through the
-- public registration form and are waiting for approval.
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS phone VARCHAR(24),
  ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'console'
    CHECK (source IN ('console', 'signup')),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES admin_users (id) ON DELETE SET NULL;

ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_source_check;
ALTER TABLE admin_users
  ADD CONSTRAINT admin_users_source_check CHECK (source IN ('console', 'signup'));

-- The console queue is "who is waiting for a decision".
CREATE INDEX IF NOT EXISTS admin_users_status_idx ON admin_users (status, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_users_source_idx ON admin_users (source, status);

-- Single-use reset links. The token is stored only as a scrypt-shaped hash so a
-- database leak cannot be replayed as a working reset URL.
CREATE TABLE IF NOT EXISTS password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_resets_token_hash_idx ON password_resets (token_hash);
CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id, created_at DESC);

-- There is no SMTP transport in this deployment, so every message the product
-- would send is written here instead. The console reads this table to show the
-- operator the message that was produced, which is how the demo forgot-password
-- flow reaches glowngracebiz@gmail.com.
CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind VARCHAR(48) NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS email_outbox_created_at_idx ON email_outbox (created_at DESC);
