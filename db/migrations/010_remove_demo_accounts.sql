-- The console used to be seeded with six named accounts that all shared one
-- published password, so a fresh deployment could be opened by anyone who had
-- read the README. They are gone.
--
-- The bootstrap administrator that db/migrations/007 used to insert with that
-- shared password is dealt with differently from the other five. Deleting it
-- outright would not work: this file is replayed on every migration run, so the
-- row would be removed again a moment after the server seeded a real password
-- for it. Matching it on its password hash does not work either. `hashPassword`
-- salts every value, so the same password has a different hash on every row in
-- every database, and a literal copied from one of them matches only that one row:
-- on any database where the row was hashed at seed time the comparison silently
-- finds nothing and the published credential stays live.
--
-- So the check moved to the one place that can answer it. `seedAdminData` verifies
-- the stored hash against the published password, using the salt the row already
-- has, and replaces it with a generated one when it still matches. A row holding
-- a password an operator chose does not verify and is left untouched. That runs on
-- the first request after the migration, which is the same moment the application
-- would otherwise be seeding anyway.
--
-- The other five seeded colleagues have no such history: they are demo rows and
-- nothing an operator would keep, so they go by address, every time.
DELETE FROM admin_users WHERE email IN (
  'deepak@glowngrace.in',
  'aditi@glowngrace.in',
  'rohit@glowngrace.in',
  'neha@glowngrace.in',
  'karan@glowngrace.in'
);

-- The sessions that were minted against the shared password are worthless now
-- and would otherwise keep working until they lapsed.
DELETE FROM admin_sessions WHERE user_id NOT IN (SELECT id FROM admin_users);

-- "Placements Coordinator" was a typo, and a role name is what a person is
-- shown on the team list, so it is spelled correctly from here on. Written as an
-- update rather than a schema change because the column is free text.
UPDATE admin_users SET role = 'Placement Coordinator' WHERE role = 'Placements Coordinator';

-- When the owner account's password was last generated, so the weekly rotation
-- can tell an account that is due from one that is not.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS password_rotated_at TIMESTAMPTZ;
