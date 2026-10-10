-- When the owner password was generated, and when one was actually kept.
--
-- `/superadmin/ggpass` makes a password on request and stores only the value the
-- operator saved, so the two moments are different events and neither one is the
-- password. What this adds is the record of them:
--
--   `password_generated_at`  the last time the screen handed a password out. It
--                            is stamped by the generate request, which still
--                            writes no credential and ends no session - the
--                            previous password keeps working, which is the
--                            promise the screen makes. What changes is that the
--                            deployment can now tell "nobody has looked at this"
--                            from "somebody generated one and never saved it".
--   `password_changed_at`    the last time a password was stored. NULL means the
--                            row predates this migration and nobody has saved
--                            since, which is a different answer from "just now",
--                            so it is left NULL rather than backfilled from
--                            `updated_at`: that column moves for reasons that have
--                            nothing to do with the credential, and a wrong date
--                            on a security record is worse than a missing one.
--
-- Both are timestamps and nothing else. The password itself is still only a hash,
-- and the generated value is still written down nowhere.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_generated_at TIMESTAMPTZ;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- The audit trail the two columns cannot carry on their own: a column holds the
-- last event, this table holds every one of them.
--
-- No password and no remote address goes in here. `kind` is what happened,
-- `user_id` is the account it happened to - which is the owner in both cases,
-- because the route refuses anybody else - and `created_at` is when. That is
-- enough to answer "who generated a password at three in the morning?" without
-- creating a table somebody could read a credential out of.
--
-- The check constraint is not decoration: a free-text `kind` would accept a typo
-- that nothing downstream could distinguish from a real event.
CREATE TABLE IF NOT EXISTS owner_password_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('generated', 'saved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reads are per account and newest first, which is how an operator looks at a
-- record like this.
CREATE INDEX IF NOT EXISTS owner_password_events_user_idx
  ON owner_password_events (user_id, created_at DESC);
