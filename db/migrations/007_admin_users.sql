-- The demo administrator. The password is the same well-known demo password the
-- storefront demo sign-in uses (demo123); the value below is a salted scrypt
-- hash, never the password itself.
INSERT INTO admin_users (id, name, email, role, password_hash, avatar, status) VALUES
  ('00000000-0000-4000-8000-000000000001', 'Glow & Grace Admin', 'admin@glowngrace.in', 'Store Administrator',
   'scrypt$16384$8$1$8ad60c22a397f20a36e452887332fea3$b91fbd9edb011c0c620edfc8638f3b18c9128e24492126f98a960e81a3f003280c3ba4e74e2deb31e51f3004ba8c5aaf2dda974cd40e54c376a307f3842f6fae',
   '/images/partner1.jpg', 'Active'),
  ('00000000-0000-4000-8000-000000000002', 'Deepak Kumar', 'deepak@glowngrace.in', 'Store Administrator',
   'scrypt$16384$8$1$8003ee31b7da570f121260fe234d125c$9846b54b7762b19b8970e61572aae9395502caddcc00a28e22d3de0f4027bf79ebf322f81dada6f0609d7226e47386cb31fd1ed6cab9def2e806f5590c61f38d',
   '/images/partner1.jpg', 'Active'),
  ('00000000-0000-4000-8000-000000000003', 'Aditi Srivastava', 'aditi@glowngrace.in', 'Inventory Manager',
   'scrypt$16384$8$1$8ad60c22a397f20a36e452887332fea3$b91fbd9edb011c0c620edfc8638f3b18c9128e24492126f98a960e81a3f003280c3ba4e74e2deb31e51f3004ba8c5aaf2dda974cd40e54c376a307f3842f6fae',
   '/images/partner2.jpg', 'Active'),
  ('00000000-0000-4000-8000-000000000004', 'Rohit Malhotra', 'rohit@glowngrace.in', 'Partnerships Lead',
   'scrypt$16384$8$1$8ad60c22a397f20a36e452887332fea3$b91fbd9edb011c0c620edfc8638f3b18c9128e24492126f98a960e81a3f003280c3ba4e74e2deb31e51f3004ba8c5aaf2dda974cd40e54c376a307f3842f6fae',
   '/images/partner3.jpg', 'Active'),
  ('00000000-0000-4000-8000-000000000005', 'Neha Kulkarni', 'neha@glowngrace.in', 'Content & Reviews',
   'scrypt$16384$8$1$8ad60c22a397f20a36e452887332fea3$b91fbd9edb011c0c620edfc8638f3b18c9128e24492126f98a960e81a3f003280c3ba4e74e2deb31e51f3004ba8c5aaf2dda974cd40e54c376a307f3842f6fae',
   '/images/about.jpg', 'Active'),
  ('00000000-0000-4000-8000-000000000006', 'Karan Sethi', 'karan@glowngrace.in', 'Placements Coordinator',
   'scrypt$16384$8$1$8ad60c22a397f20a36e452887332fea3$b91fbd9edb011c0c620edfc8638f3b18c9128e24492126f98a960e81a3f003280c3ba4e74e2deb31e51f3004ba8c5aaf2dda974cd40e54c376a307f3842f6fae',
   '/images/careers.jpg', 'Active')
ON CONFLICT (email) DO NOTHING;
