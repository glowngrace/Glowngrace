-- Default store settings. The demo collections, the page list and the admin
-- account are seeded by the API on first use (see src/server/admin/seeds.ts) so
-- that a freshly migrated database and a reset always agree.

INSERT INTO store_settings (key, value) VALUES
  ('profile', '{"storeName":"Glow & Grace","tagline":"A complete beauty & career destination","email":"care@glowngrace.in","phone":"+91 98765 43210","address":"Hazratganj, Lucknow, Uttar Pradesh 226001"}'::jsonb),
  ('delivery', '{"freeAbove":999,"deliveryFee":59,"gst":18,"returns":7}'::jsonb),
  ('notifications', '{"orders":true,"lowStock":true,"partners":true,"reviews":false}'::jsonb),
  ('preview', '{"livePreview":true}'::jsonb)
ON CONFLICT (key) DO NOTHING;
