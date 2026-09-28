ALTER TABLE product_images
  DROP CONSTRAINT IF EXISTS product_images_width_check,
  DROP CONSTRAINT IF EXISTS product_images_height_check,
  DROP CONSTRAINT IF EXISTS product_images_width_range_check,
  DROP CONSTRAINT IF EXISTS product_images_height_range_check;

ALTER TABLE product_images
  ADD CONSTRAINT product_images_width_range_check CHECK (width BETWEEN 1 AND 1200),
  ADD CONSTRAINT product_images_height_range_check CHECK (height BETWEEN 1 AND 1200);
