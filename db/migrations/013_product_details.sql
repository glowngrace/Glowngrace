-- The product form has shown a slug, two SEO fields and two tag lists for a
-- while, but nothing ever read them: the save payload never included them, so an
-- operator could fill the whole "Search & SEO" and "Organisation" panels in and
-- watch every value disappear. A bulk upload sheet had the same problem in a
-- different place, because there was nowhere on the server to put a column.
--
-- These are the columns both the console form and the bulk upload template now
-- write to. `shades` and `highlights` are a single comma-separated string, the
-- same shape `job_vacancies.skills` already uses, so the tag inputs round-trip
-- without a join table.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS slug VARCHAR(180),
  ADD COLUMN IF NOT EXISTS meta_title VARCHAR(180),
  ADD COLUMN IF NOT EXISTS meta_description VARCHAR(500),
  ADD COLUMN IF NOT EXISTS shades TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS highlights TEXT NOT NULL DEFAULT '';

-- The "Product Information" block on the product page. Each section is one free
-- text block so the console can edit them independently without a join table.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS features_and_specification TEXT,
  ADD COLUMN IF NOT EXISTS measurement TEXT,
  ADD COLUMN IF NOT EXISTS material_and_care TEXT,
  ADD COLUMN IF NOT EXISTS additional_details TEXT,
  ADD COLUMN IF NOT EXISTS item_details TEXT;
