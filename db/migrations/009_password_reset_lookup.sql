-- Lets a reset token be found again.
--
-- db/migrations/008 stores the token as a salted scrypt hash, which is the right
-- thing to keep but cannot be used in a WHERE clause: salting means the same
-- token produces a different digest every time, so the only way to match a
-- presented token against the stored rows is to run scrypt over every candidate.
-- That is one KDF per row on an unauthenticated endpoint.
--
-- token_lookup holds a plain SHA-256 of the same token. It exists only to
-- locate the row; the scrypt hash beside it still decides whether the token is
-- correct. SHA-256 is sufficient because the token is 32 bytes from randomBytes
-- and has no guessable structure, so a leaked digest cannot be brute-forced the
-- way a leaked password hash can.
--
-- Existing rows are left null. A reset link is only valid for an hour, so the
-- rows that predate this migration have expired by the time it is applied.

ALTER TABLE password_resets
  ADD COLUMN IF NOT EXISTS token_lookup CHAR(64);

CREATE INDEX IF NOT EXISTS password_resets_token_lookup_idx
  ON password_resets (token_lookup)
  WHERE used_at IS NULL;
