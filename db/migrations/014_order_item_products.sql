-- Points every seeded `order_items.product_id` at the product it actually names.
--
-- The sample order lines were written with `product_id` values of 1..8, as if the
-- catalogue were numbered from one. `products.id` is `GENERATED ... START WITH 9`,
-- so on any database seeded from `db/init.sql` every one of those lines referenced
-- a row that was never created. `product_name` was correct on the same rows, which
-- is why this can be repaired by name rather than by guessing an offset.
--
-- `order_items.product_id` has no foreign key, so the bad ids were accepted
-- silently. The constraint is deliberately not added here: a line can name a
-- product that was later deleted from the catalogue, and refusing the delete over
-- that would be a worse failure than the one being fixed. The remap below is
-- therefore safe to run against a database holding real orders, as it only touches
-- rows whose id does not currently resolve.

UPDATE order_items
SET product_id = matched.id
FROM products AS matched
WHERE matched.name = order_items.product_name
  AND order_items.product_id IS DISTINCT FROM matched.id
  AND NOT EXISTS (SELECT 1 FROM products AS current WHERE current.id = order_items.product_id);

-- Resync the identity so a hand-inserted product cannot collide with a seeded one.
SELECT setval(
  pg_get_serial_sequence('products', 'id'),
  GREATEST((SELECT COALESCE(max(id), 0) FROM products), 8),
  true
);