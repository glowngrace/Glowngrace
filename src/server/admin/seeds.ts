export type DemoDatasetKey = 'orders' | 'jobs' | 'candidates' | 'partners' | 'customers' | 'reviews';

export const demoDatasets: Array<{ key: DemoDatasetKey; label: string; table: string }> = [
  { key: 'orders', label: 'Sample orders', table: 'orders' },
  { key: 'jobs', label: 'Sample job vacancies', table: 'job_vacancies' },
  { key: 'candidates', label: 'Sample candidates', table: 'candidates' },
  { key: 'partners', label: 'Sample partner parlours', table: 'partner_salons' },
  { key: 'customers', label: 'Sample customers', table: 'customers' },
  { key: 'reviews', label: 'Sample reviews', table: 'reviews' },
];

export type SitePageSeed = { slug: string; label: string; path: string; position: number };

/**
 * The storefront pages the console is allowed to show or hide.
 *
 * Everything else in `site_pages` is a structural page: the shop, the product
 * page and checkout are what makes a store a store, and sign-in, the portals
 * and the order confirmation are reachable directly by link. Letting an
 * operator hide those only produces a storefront that cannot be navigated or
 * checked out, so the settings screen offers just the three editorial pages.
 */
export const switchablePageSlugs = ['partners', 'shop', 'careers'] as const;

export type SwitchablePageSlug = (typeof switchablePageSlugs)[number];

export const sitePageSeeds: SitePageSeed[] = [
  { slug: 'home', label: 'Home', path: '/', position: 1 },
  { slug: 'shop', label: 'Shop', path: '/shop', position: 2 },
  { slug: 'product', label: 'Product details', path: '/product/:productId', position: 3 },
  { slug: 'checkout', label: 'Checkout', path: '/checkout', position: 4 },
  { slug: 'order-confirmation', label: 'Order confirmation', path: '/order-confirmation', position: 5 },
  { slug: 'partners', label: 'Partners', path: '/partners', position: 6 },
  { slug: 'careers', label: 'Careers', path: '/careers', position: 7 },
  { slug: 'about', label: 'Our story', path: '/about', position: 8 },
  { slug: 'contact', label: 'Contact', path: '/contact', position: 9 },
  { slug: 'login', label: 'Sign in', path: '/login', position: 10 },
  { slug: 'wishlist', label: 'Wishlist', path: '/wishlist', position: 11 },
  { slug: 'candidate', label: 'Candidate portal', path: '/candidate', position: 12 },
  { slug: 'partner', label: 'Partner portal', path: '/partner', position: 13 },
  { slug: 'admin', label: 'Admin console', path: '/admin', position: 14 },
  // A profile is only ever reached from the directory above, and it is gated on
  // `/partners` so hiding the directory hides every profile with it. It sits at
  // the end because `ON CONFLICT DO NOTHING` means an already-migrated database
  // keeps the positions it was seeded with.
  { slug: 'partner-profile', label: 'Partner profile', path: '/partners/:partnerSlug', position: 15 },
];

type SeedRow = Array<string | number | null>;

export const jobSeeds: Record<string, SeedRow[]> = {
  job_vacancies: [
    ['JOB-4821', 'Senior Beautician', 'Blush Beauty Lounge', 'Hazratganj, Lucknow', 'Full-time', '₹18,000 – ₹25,000 / mo', '2+ yrs', 'Facial, Threading', 12, 'Open'],
    ['JOB-4820', 'Makeup Artist — Bridal', 'Elegance Bridal House', 'Mahanagar, Lucknow', 'Full-time', '₹20,000 – ₹32,000 / mo', '3+ yrs', 'Bridal makeup, HD', 9, 'Open'],
    ['JOB-4819', 'Hair Stylist', 'Style Hub Salon', 'Aliganj, Lucknow', 'Full-time', '₹15,000 – ₹22,000 / mo', '2+ yrs', 'Cutting, Colour', 6, 'Open'],
    ['JOB-4818', 'Nail Art Specialist', 'The Nail Bar', 'Indira Nagar, Lucknow', 'Part-time', '₹16,000 – ₹24,000 / mo', '2+ yrs', 'Nail art, Extensions', 4, 'Open'],
    ['JOB-4817', 'Spa Therapist', 'Glow Wellness Studio', 'Gomti Nagar, Lucknow', 'Full-time', '₹14,000 – ₹20,000 / mo', '1+ yr', 'Body massage', 0, 'Draft'],
    ['JOB-4816', 'Front Desk Associate', 'Velvet Beauty Corner', 'Alambagh, Lucknow', 'Full-time', '₹16,000 – ₹20,000 / mo', '1+ yr', 'Reception, Inventory', 0, 'Paused'],
    ['JOB-4815', 'Skin Care Specialist', 'Dewdrop Skin Clinic', 'Chowk, Lucknow', 'Full-time', '₹18,000 – ₹26,000 / mo', '3+ yrs', 'Facials, Skin analysis', 0, 'Closed'],
  ],
};

export const candidateSeeds: Record<string, SeedRow[]> = {
  candidates: [
    ['CND-3110', 'Anjali Verma', 'Senior Beautician', '3 yrs', 'Lucknow', 4.9, 'Interview', 'anjali.verma@example.com', '+91 98765 43001', '/images/partner2.jpg'],
    ['CND-3109', 'Meera Khan', 'Makeup Artist', '2 yrs', 'Lucknow', 4.8, 'Shortlisted', 'meera.khan@example.com', '+91 98765 43002', '/images/partner3.jpg'],
    ['CND-3108', 'Riya Singh', 'Hair Stylist', 'Fresher', 'Barabanki', 4.6, 'New', 'riya.singh@example.com', '+91 98765 43003', '/images/about.jpg'],
    ['CND-3107', 'Neha Gupta', 'Nail Artist', '4 yrs', 'Lucknow', 4.9, 'Interview', 'neha.gupta@example.com', '+91 98765 43004', '/images/careers.jpg'],
    ['CND-3106', 'Aditi Rawat', 'Spa Therapist', '1 yr', 'Hardoi', 4.5, 'New', 'aditi.rawat@example.com', '+91 98765 43005', '/images/partner1.jpg'],
    ['CND-3105', 'Shreya Mishra', 'Beautician', '5 yrs', 'Lucknow', 4.7, 'Shortlisted', 'shreya.mishra@example.com', '+91 98765 43006', '/images/hero1.jpg'],
    ['CND-3104', 'Pooja Yadav', 'Hair Stylist', '2 yrs', 'Sitapur', 4.6, 'New', 'pooja.yadav@example.com', '+91 98765 43007', '/images/hero2.jpg'],
    ['CND-3103', 'Nandini Rathore', 'Makeup Artist', '6 yrs', 'Lucknow', 5, 'Interview', 'nandini.rathore@example.com', '+91 98765 43008', '/images/hero3.jpg'],
  ],
};

export const partnerSeeds: Record<string, SeedRow[]> = {
  partner_salons: [
    ['PTN-204', 'Blush Beauty Lounge', 'Hazratganj', 'Premium Unisex', 4.9, 3, 'Active', '+91 98765 43210', 'blush@example.com', 'Rahul Verma', '2024', '/images/partner1.jpg'],
    ['PTN-203', 'Elegance Bridal House', 'Mahanagar', 'Bridal & Occasion', 5, 2, 'Active', '+91 98765 43211', 'elegance@example.com', 'Sneha Arora', '2024', '/images/partner2.jpg'],
    ['PTN-202', 'The Nail Bar', 'Indira Nagar', 'Nail Art & Spa', 4.9, 1, 'Active', '+91 98765 43212', 'nailbar@example.com', 'Ishita Bansal', '2025', '/images/partner3.jpg'],
    ['PTN-201', 'Style Hub Salon', 'Aliganj', 'Hair & Makeup', 4.8, 2, 'Active', '+91 98765 43213', 'stylehub@example.com', 'Aman Trivedi', '2024', '/images/about.jpg'],
    ['PTN-200', 'Glow Wellness Studio', 'Gomti Nagar', 'Spa & Skin', 4.7, 1, 'Pending', '+91 98765 43214', 'glowwell@example.com', 'Kavya Nair', '2025', '/images/careers.jpg'],
    ['PTN-199', 'Velvet Beauty Corner', 'Alambagh', 'Makeup Studio', 4.6, 0, 'Active', '+91 98765 43215', 'velvet@example.com', 'Zoya Ali', '2023', '/images/hero1.jpg'],
    ['PTN-198', 'Dewdrop Skin Clinic', 'Chowk', 'Skin Care', 4.8, 1, 'Paused', '+91 98765 43216', 'dewdrop@example.com', 'Tanvi Bose', '2023', '/images/hero2.jpg'],
  ],
};

export const customerSeeds: Record<string, SeedRow[]> = {
  customers: [
    ['CUS-8841', 'Priya Sharma', 'priya@email.com', '+91 98765 43101', 18, 32640, 'VIP', '2026-09-21'],
    ['CUS-8840', 'Ritika Srivastava', 'ritika@email.com', '+91 98765 43102', 12, 18760, 'Loyal', '2026-09-20'],
    ['CUS-8839', 'Ananya Mehta', 'ananya@email.com', '+91 98765 43103', 9, 14320, 'Loyal', '2026-09-19'],
    ['CUS-8838', 'Ishita Bansal', 'ishita@email.com', '+91 98765 43104', 7, 9980, 'Loyal', '2026-09-18'],
    ['CUS-8837', 'Kavya Nair', 'kavya@email.com', '+91 98765 43105', 5, 7240, 'New', '2026-09-17'],
    ['CUS-8836', 'Meher Kaur', 'meher@email.com', '+91 98765 43106', 3, 3980, 'New', '2026-09-15'],
    ['CUS-8835', 'Tanvi Bose', 'tanvi@email.com', '+91 98765 43107', 1, 1290, 'At risk', '2026-08-02'],
  ],
};

export const reviewSeeds: Record<string, SeedRow[]> = {
  reviews: [
    ['REV-2214', 'Priya Sharma', 'Velvet Matte Luxe Liquid Lipstick', 5, 'The shade is gorgeous and it stays all evening.', 'Active', '/images/partner1.jpg', '2026-09-22'],
    ['REV-2213', 'Kavya Nair', 'Glow Ritual Vitamin C Face Serum', 5, 'My skin looks noticeably brighter in three weeks.', 'Active', '/images/partner2.jpg', '2026-09-21'],
    ['REV-2212', 'Ishita Bansal', 'Velvet Matte Luxe Liquid Lipstick', 3, 'Lovely colour but the cap feels a little loose.', 'Pending review', '/images/partner3.jpg', '2026-09-20'],
    ['REV-2211', 'Ananya Mehta', 'Radiance Ritual Glow Kit', 5, 'A beautiful gift set. Packaging feels very special.', 'Active', '/images/about.jpg', '2026-09-19'],
    ['REV-2210', 'Ritika Srivastava', 'Glow Ritual Vitamin C Face Serum', 2, 'Expected a stronger glow for the price.', 'Hidden', '/images/careers.jpg', '2026-09-18'],
    ['REV-2209', 'Meher Kaur', 'Hydra Dew Face Serum', 4, 'Great texture and it layers beautifully.', 'Active', '/images/hero1.jpg', '2026-09-16'],
  ],
};

export const orderSeeds: Record<string, SeedRow[]> = {
  orders: [
    ['GG-2046', 'Ananya Mehta', 'ananya@email.com', '+91 98765 43221', '12/4 Park Road', 'Hazratganj', 'Lucknow', 'Uttar Pradesh', '226001', null, 'standard', 'delivered', 271400, 5900, 49820, 327120, '2026-09-24 10:12:00+00'],
    ['GG-2045', 'Ishita Bansal', 'ishita@email.com', '+91 98765 43222', '9 Station Road', 'Aliganj', 'Lucknow', 'Uttar Pradesh', '226024', null, 'express', 'shipped', 79000, 9900, 16020, 104920, '2026-09-24 09:02:00+00'],
    ['GG-2044', 'Kavya Nair', 'kavya@email.com', '+91 98765 43223', '22 Vibhuti Khand', 'Gomti Nagar', 'Lucknow', 'Uttar Pradesh', '226010', 'Near Botanical Garden', 'standard', 'packed', 103200, 5900, 19634, 128734, '2026-09-23 18:41:00+00'],
    ['GG-2043', 'Meher Kaur', 'meher@email.com', '+91 98765 43224', '3 Kothi Rampur', 'Chowk', 'Lucknow', 'Uttar Pradesh', '226003', null, 'same_day', 'delivered', 54000, 14900, 12420, 81320, '2026-09-23 12:15:00+00'],
    ['GG-2042', 'Sana Mirza', 'sana@email.com', '+91 98765 43225', '77 Faizabad Road', 'Mahanagar', 'Lucknow', 'Uttar Pradesh', '226003', null, 'express', 'processing', 354200, 9900, 65538, 429638, '2026-09-22 16:30:00+00'],
    ['GG-2041', 'Priya Sharma', 'priya@email.com', '+91 98765 43226', '14 Mall Road', 'Hazratganj', 'Lucknow', 'Uttar Pradesh', '226001', null, 'standard', 'delivered', 206000, 5900, 38148, 250048, '2026-09-22 08:55:00+00'],
    ['GG-2040', 'Ritika Srivastava', 'ritika@email.com', '+91 98765 43227', '5 Alambagh Road', 'Alambagh', 'Lucknow', 'Uttar Pradesh', '226006', null, 'standard', 'returned', 156200, 5900, 29178, 191078, '2026-09-21 15:20:00+00'],
    ['GG-2039', 'Tanvi Bose', 'tanvi@email.com', '+91 98765 43228', '30 Indira Nagar', 'Indira Nagar', 'Lucknow', 'Uttar Pradesh', '226016', null, 'same_day', 'delivered', 456300, 14900, 84872, 556072, '2026-09-21 11:05:00+00'],
    ['GG-2038', 'Zoya Ali', 'zoya@email.com', '+91 98765 43229', '8 Cantt Road', 'Alambagh', 'Lucknow', 'Uttar Pradesh', '226006', null, 'standard', 'cancelled', 109900, 5900, 20826, 136626, '2026-09-20 19:44:00+00'],
  ],
};

export const orderItemSeeds: Array<{ orderNumber: string; productId: number; productName: string; unitPricePaise: number; quantity: number }> = [
  { orderNumber: 'GG-2046', productId: 1, productName: 'Velvet Matte Luxe Liquid Lipstick', unitPricePaise: 59900, quantity: 2 },
  { orderNumber: 'GG-2046', productId: 4, productName: 'Glow Ritual Vitamin C Face Serum', unitPricePaise: 84900, quantity: 1 },
  { orderNumber: 'GG-2045', productId: 5, productName: 'Hydra Dew Hyaluronic Serum', unitPricePaise: 79900, quantity: 1 },
  { orderNumber: 'GG-2045', productId: 8, productName: 'Radiance Ritual Glow Kit', unitPricePaise: 249900, quantity: 1 },
  { orderNumber: 'GG-2044', productId: 6, productName: 'Aura Radiance Highlighter', unitPricePaise: 44900, quantity: 1 },
  { orderNumber: 'GG-2044', productId: 7, productName: 'Bloom Essence Rose Eau De Parfum', unitPricePaise: 119900, quantity: 1 },
  { orderNumber: 'GG-2043', productId: 3, productName: 'Nude Silk Matte Liquid Lipstick', unitPricePaise: 54900, quantity: 1 },
  { orderNumber: 'GG-2042', productId: 2, productName: 'Berry Noir Matte Liquid Lipstick', unitPricePaise: 59900, quantity: 2 },
  { orderNumber: 'GG-2042', productId: 8, productName: 'Radiance Ritual Glow Kit', unitPricePaise: 249900, quantity: 1 },
  { orderNumber: 'GG-2041', productId: 4, productName: 'Glow Ritual Vitamin C Face Serum', unitPricePaise: 84900, quantity: 2 },
  { orderNumber: 'GG-2040', productId: 5, productName: 'Hydra Dew Hyaluronic Serum', unitPricePaise: 79900, quantity: 1 },
  { orderNumber: 'GG-2040', productId: 1, productName: 'Velvet Matte Luxe Liquid Lipstick', unitPricePaise: 59900, quantity: 1 },
  { orderNumber: 'GG-2039', productId: 8, productName: 'Radiance Ritual Glow Kit', unitPricePaise: 249900, quantity: 1 },
  { orderNumber: 'GG-2039', productId: 7, productName: 'Bloom Essence Rose Eau De Parfum', unitPricePaise: 119900, quantity: 1 },
  { orderNumber: 'GG-2039', productId: 6, productName: 'Aura Radiance Highlighter', unitPricePaise: 44900, quantity: 1 },
  { orderNumber: 'GG-2038', productId: 2, productName: 'Berry Noir Matte Liquid Lipstick', unitPricePaise: 59900, quantity: 1 },
];
