-- A password an operator chose by hand, and the moment it stops being theirs.
--
-- The owner account is normally rotated every 7 days, which is what stops a
-- credential that leaked sitting on the account forever. That is the wrong
-- behaviour for the short window where somebody genuinely needs a known password
-- to get into a deployment - a handover, a demo, an incident - because the
-- rotation replaces it within a week whether or not anyone has read it.
--
-- `password_hold_until` is that window. While NOW() is before it, the owner
-- rotation leaves the password alone, so a hand-set one survives. The moment the
-- hold is in the past the account is due for rotation whatever `password_rotated_at`
-- says, and the rotation clears the column, so the hold is spent exactly once
-- and cannot be extended by leaving a stale value behind.
--
-- NULL is the ordinary state and means "rotate on the weekly clock as usual", so
-- every existing row keeps the behaviour it had before this column existed.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_hold_until TIMESTAMPTZ;

-- The owner account is reached at one address, and it was misspelled until this
-- migration: `glownglancebiz@gmail.com`. The code has been corrected to
-- `glowngracebiz@gmail.com`, so a row still holding the old address is now
-- invisible to the rotation, the mail restriction and the console's owner checks.
--
-- Renamed rather than inserted, because the row carries the account's history and
-- its id is the one the console recognises. Guarded on the new address not already
-- existing, so a deployment that already corrected the row by hand is left alone
-- rather than failing on a duplicate key.
UPDATE admin_users
SET email = 'glowngracebiz@gmail.com', updated_at = NOW()
WHERE email = 'glownglancebiz@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM admin_users AS already_correct
    WHERE already_correct.email = 'glowngracebiz@gmail.com'
  );

-- Sessions belong to the account, not the address, so the rename above does not
-- invalidate any. The two addresses can never both exist after this migration, so
-- there is no row left that the weekly rotation would stop watching.
