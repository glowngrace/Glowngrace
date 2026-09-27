export type AdminSection =
  | 'dashboard'
  | 'orders'
  | 'products'
  | 'add-product'
  | 'jobs'
  | 'add-job'
  | 'candidates'
  | 'partners'
  | 'customers'
  | 'reviews'
  | 'add-review'
  | 'settings';

export type IconName =
  | 'dash'
  | 'box'
  | 'plus'
  | 'cart'
  | 'case'
  | 'users'
  | 'star'
  | 'shop'
  | 'heart'
  | 'cog'
  | 'eye'
  | 'pen'
  | 'trash'
  | 'check'
  | 'hide'
  | 'bell'
  | 'search'
  | 'menu'
  | 'logout'
  | 'upload'
  | 'arrow'
  | 'home'
  | 'warn'
  | 'spark';

export const iconPaths: Record<IconName, string> = {  dash: 'M3.5 12.2 12 4.2l8.5 8-8.5 7.6z',
  box: 'M3.6 8.1 12 3.4l8.4 4.7v7.8L12 20.6l-8.4-4.7z M3.6 8.1 12 12.9l8.4-4.8 M12 12.9v7.7',
  plus: 'M12 5.4v13.2 M5.4 12h13.2',
  cart: 'M3.6 4.6h2.5l2.2 9.9h9l2.1-7.2H6.5 M9.2 19.4a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4 M17 19.4a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4',
  case: 'M3.4 8.4h17.2v10.4H3.4z M8.6 8.4V6.1a1.6 1.6 0 0 1 1.6-1.6h3.6a1.6 1.6 0 0 1 1.6 1.6v2.3 M3.4 13.1h17.2',
  users: 'M15.6 19.4v-1.7a3.4 3.4 0 0 0-3.4-3.4H6.6A3.4 3.4 0 0 0 3.2 17.7v1.7 M9.4 11.1a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6 M20.8 19.4v-1.7a3.4 3.4 0 0 0-2.6-3.3 M15.6 4.7a3.4 3.4 0 0 1 0 6.6',
  star: 'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
  shop: 'M4 9.4h16v10.9H4z M3 9.4 5.3 4.3h13.4L21 9.4 M9.6 20.3v-5.7h4.8v5.7',
  heart: 'M12 20.2 4.6 13a4.3 4.3 0 0 1 6-6.1l1.4 1.4 1.4-1.4a4.3 4.3 0 0 1 6 6.1z',
  cog: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4 M19.1 14.4a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3.4a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3.4a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1z',
  eye: 'M2.6 12S6 5.8 12 5.8 21.4 12 21.4 12 18 18.2 12 18.2 2.6 12 2.6 12 M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  pen: 'M4 20.1l.9-3.8L16.1 5.1a1.8 1.8 0 0 1 2.6 0l.9.9a1.8 1.8 0 0 1 0 2.6L8.4 19.8z M14.7 6.5l2.8 2.8',
  trash: 'M4.6 6.8h14.8 M9.4 6.8V4.9h5.2v1.9 M6.4 6.8l1 12.4h9.2l1-12.4 M10.1 10.4v5.2 M13.9 10.4v5.2',
  check: 'M4.8 12.6 9.6 17.4 19.2 6.6',
  hide: 'M3 3l18 18 M9.9 5.3A9.7 9.7 0 0 1 12 5.1c6 0 9.4 6.2 9.4 6.2a17 17 0 0 1-3.4 4.1 M6.3 7.9A16.6 16.6 0 0 0 2.6 11.3S6 17.5 12 17.5a9.5 9.5 0 0 0 3.3-.6 M10.2 10.3a2.4 2.4 0 0 0 3.4 3.4',
  bell: 'M18 9.4a6 6 0 0 0-12 0c0 6-2.4 7.6-2.4 7.6h16.8S18 15.4 18 9.4 M13.7 20a1.9 1.9 0 0 1-3.4 0',
  search: 'M11 18.2a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4 M16.4 16.4 20.8 20.8',
  menu: 'M4 7.4h16 M4 12h16 M4 16.6h16',
  logout: 'M14.6 8.2V5.4H4.4v13.2h10.2v-2.8 M9.6 12h10.2 M16.6 8.8 19.8 12l-3.2 3.2',
  upload: 'M12 16.4V4.6 M7.6 8.6 12 4.2l4.4 4.4 M4.4 15.4v4.2h15.2v-4.2',
  arrow: 'M4.6 12h14.2 M13.4 6.8 18.6 12l-5.2 5.2',
  home: 'M3.6 10.4 12 3.6l8.4 6.8v9.6H3.6z M9.4 20v-6.6h5.2V20',
  warn: 'M12 4.4 21 19.6H3z M12 10.2v4.2 M12 16.8h.01',
  spark: 'M12 3.4l1.7 5.1 5.1 1.7-5.1 1.7-1.7 5.1-1.7-5.1-5.1-1.7 5.1-1.7z',
};

export const avatarImages = [
  '/images/partner1.jpg',
  '/images/partner2.jpg',
  '/images/partner3.jpg',
  '/images/about.jpg',
  '/images/careers.jpg',
];

export const seedOrders = [
  { id: 'GG-2046', customer: 'Ananya Mehta', email: 'ananya@email.com', items: 2, total: 3147, date: '24 Sep 2026', status: 'Delivered' },
  { id: 'GG-2045', customer: 'Ishita Bansal', email: 'ishita@email.com', items: 1, total: 899, date: '24 Sep 2026', status: 'Shipped' },
  { id: 'GG-2044', customer: 'Kavya Nair', email: 'kavya@email.com', items: 3, total: 1248, date: '23 Sep 2026', status: 'Packed' },
  { id: 'GG-2043', customer: 'Meher Kaur', email: 'meher@email.com', items: 1, total: 649, date: '23 Sep 2026', status: 'Delivered' },
  { id: 'GG-2042', customer: 'Sana Mirza', email: 'sana@email.com', items: 2, total: 4198, date: '22 Sep 2026', status: 'Processing' },
  { id: 'GG-2041', customer: 'Priya Sharma', email: 'priya@email.com', items: 1, total: 2497, date: '22 Sep 2026', status: 'Delivered' },
  { id: 'GG-2040', customer: 'Ritika Srivastava', email: 'ritika@email.com', items: 3, total: 1897, date: '21 Sep 2026', status: 'Returned' },
  { id: 'GG-2039', customer: 'Tanvi Bose', email: 'tanvi@email.com', items: 4, total: 5396, date: '21 Sep 2026', status: 'Delivered' },
  { id: 'GG-2038', customer: 'Zoya Ali', email: 'zoya@email.com', items: 1, total: 1299, date: '20 Sep 2026', status: 'Cancelled' },
];

export const seedJobs = [
  { id: 'JOB-4821', title: 'Senior Beautician', partner: 'Blush Beauty Lounge', area: 'Hazratganj, Lucknow', type: 'Full-time', salary: '₹18,000 – ₹25,000 / mo', applications: 12, status: 'Open' },
  { id: 'JOB-4820', title: 'Makeup Artist — Bridal', partner: 'Elegance Bridal House', area: 'Mahanagar, Lucknow', type: 'Full-time', salary: '₹20,000 – ₹32,000 / mo', applications: 9, status: 'Open' },
  { id: 'JOB-4819', title: 'Hair Stylist', partner: 'Style Hub Salon', area: 'Aliganj, Lucknow', type: 'Full-time', salary: '₹15,000 – ₹22,000 / mo', applications: 6, status: 'Open' },
  { id: 'JOB-4818', title: 'Nail Art Specialist', partner: 'The Nail Bar', area: 'Indira Nagar, Lucknow', type: 'Part-time', salary: '₹16,000 – ₹24,000 / mo', applications: 4, status: 'Open' },
  { id: 'JOB-4817', title: 'Spa Therapist', partner: 'Glow Wellness Studio', area: 'Gomti Nagar, Lucknow', type: 'Full-time', salary: '₹14,000 – ₹20,000 / mo', applications: 0, status: 'Draft' },
  { id: 'JOB-4816', title: 'Front Desk Associate', partner: 'Velvet Beauty Corner', area: 'Alambagh, Lucknow', type: 'Full-time', salary: '₹16,000 – ₹20,000 / mo', applications: 0, status: 'Paused' },
  { id: 'JOB-4815', title: 'Skin Care Specialist', partner: 'Dewdrop Skin Clinic', area: 'Chowk, Lucknow', type: 'Full-time', salary: '₹18,000 – ₹26,000 / mo', applications: 0, status: 'Closed' },
];

export const seedCandidates = [
  { id: 'CND-3110', name: 'Anjali Verma', role: 'Senior Beautician', experience: '3 yrs', rating: 4.9, stage: 'Interview', city: 'Lucknow', avatar: '/images/partner2.jpg' },
  { id: 'CND-3109', name: 'Meera Khan', role: 'Makeup Artist', experience: '2 yrs', rating: 4.8, stage: 'Shortlisted', city: 'Lucknow', avatar: '/images/partner3.jpg' },
  { id: 'CND-3108', name: 'Riya Singh', role: 'Hair Stylist', experience: 'Fresher', rating: 4.6, stage: 'New', city: 'Barabanki', avatar: '/images/about.jpg' },
  { id: 'CND-3107', name: 'Neha Gupta', role: 'Nail Artist', experience: '4 yrs', rating: 4.9, stage: 'Interview', city: 'Lucknow', avatar: '/images/careers.jpg' },
  { id: 'CND-3106', name: 'Aditi Rawat', role: 'Spa Therapist', experience: '1 yr', rating: 4.5, stage: 'New', city: 'Hardoi', avatar: '/images/partner1.jpg' },
  { id: 'CND-3105', name: 'Shreya Mishra', role: 'Beautician', experience: '5 yrs', rating: 4.7, stage: 'Shortlisted', city: 'Lucknow', avatar: '/images/hero1.jpg' },
  { id: 'CND-3104', name: 'Pooja Yadav', role: 'Hair Stylist', experience: '2 yrs', rating: 4.6, stage: 'New', city: 'Sitapur', avatar: '/images/hero2.jpg' },
  { id: 'CND-3103', name: 'Nandini Rathore', role: 'Makeup Artist', experience: '6 yrs', rating: 5, stage: 'Interview', city: 'Lucknow', avatar: '/images/hero3.jpg' },
];

export const seedPartners = [
  { id: 'PTN-204', name: 'Blush Beauty Lounge', area: 'Hazratganj', type: 'Premium Unisex', rating: 4.9, vacancies: 3, status: 'Active', phone: '+91 98765 43210', email: 'blush@example.com', since: '2024', owner: 'Rahul Verma', avatar: '/images/partner1.jpg' },
  { id: 'PTN-203', name: 'Elegance Bridal House', area: 'Mahanagar', type: 'Bridal & Occasion', rating: 5, vacancies: 2, status: 'Active', phone: '+91 98765 43211', email: 'elegance@example.com', since: '2024', owner: 'Sneha Arora', avatar: '/images/partner2.jpg' },
  { id: 'PTN-202', name: 'The Nail Bar', area: 'Indira Nagar', type: 'Nail Art & Spa', rating: 4.9, vacancies: 1, status: 'Active', phone: '+91 98765 43212', email: 'nailbar@example.com', since: '2025', owner: 'Ishita Bansal', avatar: '/images/partner3.jpg' },
  { id: 'PTN-201', name: 'Style Hub Salon', area: 'Aliganj', type: 'Hair & Makeup', rating: 4.8, vacancies: 2, status: 'Active', phone: '+91 98765 43213', email: 'stylehub@example.com', since: '2024', owner: 'Aman Trivedi', avatar: '/images/about.jpg' },
  { id: 'PTN-200', name: 'Glow Wellness Studio', area: 'Gomti Nagar', type: 'Spa & Skin', rating: 4.7, vacancies: 1, status: 'Pending', phone: '+91 98765 43214', email: 'glowwell@example.com', since: '2025', owner: 'Kavya Nair', avatar: '/images/careers.jpg' },
  { id: 'PTN-199', name: 'Velvet Beauty Corner', area: 'Alambagh', type: 'Makeup Studio', rating: 4.6, vacancies: 0, status: 'Active', phone: '+91 98765 43215', email: 'velvet@example.com', since: '2023', owner: 'Zoya Ali', avatar: '/images/hero1.jpg' },
  { id: 'PTN-198', name: 'Dewdrop Skin Clinic', area: 'Chowk', type: 'Skin Care', rating: 4.8, vacancies: 1, status: 'Paused', phone: '+91 98765 43216', email: 'dewdrop@example.com', since: '2023', owner: 'Tanvi Bose', avatar: '/images/hero2.jpg' },
];

export const seedCustomers = [
  { id: 'CUS-8841', name: 'Priya Sharma', email: 'priya@email.com', orders: 18, spent: 32640, tier: 'VIP', last: '21 Sep 2026' },
  { id: 'CUS-8840', name: 'Ritika Srivastava', email: 'ritika@email.com', orders: 12, spent: 18760, tier: 'Loyal', last: '20 Sep 2026' },
  { id: 'CUS-8839', name: 'Ananya Mehta', email: 'ananya@email.com', orders: 9, spent: 14320, tier: 'Loyal', last: '19 Sep 2026' },
  { id: 'CUS-8838', name: 'Ishita Bansal', email: 'ishita@email.com', orders: 7, spent: 9980, tier: 'Loyal', last: '18 Sep 2026' },
  { id: 'CUS-8837', name: 'Kavya Nair', email: 'kavya@email.com', orders: 5, spent: 7240, tier: 'New', last: '17 Sep 2026' },
  { id: 'CUS-8836', name: 'Meher Kaur', email: 'meher@email.com', orders: 3, spent: 3980, tier: 'New', last: '15 Sep 2026' },
  { id: 'CUS-8835', name: 'Tanvi Bose', email: 'tanvi@email.com', orders: 1, spent: 1290, tier: 'At risk', last: '02 Aug 2026' },
];

export const seedReviews = [
  { id: 'REV-2214', author: 'Priya Sharma', avatar: '/images/partner1.jpg', product: 'Velvet Matte Luxe Liquid Lipstick', rating: 5, text: 'The shade is gorgeous and it stays all evening.', status: 'Active', date: '22 Sep 2026' },
  { id: 'REV-2213', author: 'Kavya Nair', avatar: '/images/partner2.jpg', product: 'Glow Ritual Vitamin C Face Serum', rating: 5, text: 'My skin looks noticeably brighter in three weeks.', status: 'Active', date: '21 Sep 2026' },
  { id: 'REV-2212', author: 'Ishita Bansal', avatar: '/images/partner3.jpg', product: 'Velvet Matte Luxe Liquid Lipstick', rating: 3, text: 'Lovely colour but the cap feels a little loose.', status: 'Pending review', date: '20 Sep 2026' },
  { id: 'REV-2211', author: 'Ananya Mehta', avatar: '/images/about.jpg', product: 'Radiance Ritual Glow Kit', rating: 5, text: 'A beautiful gift set. Packaging feels very special.', status: 'Active', date: '19 Sep 2026' },
  { id: 'REV-2210', author: 'Ritika Srivastava', avatar: '/images/careers.jpg', product: 'Glow Ritual Vitamin C Face Serum', rating: 2, text: 'Expected a stronger glow for the price.', status: 'Hidden', date: '18 Sep 2026' },
  { id: 'REV-2209', author: 'Meher Kaur', avatar: '/images/hero1.jpg', product: 'Hydra Dew Face Serum', rating: 4, text: 'Great texture and it layers beautifully.', status: 'Active', date: '16 Sep 2026' },
];

export const seedAlerts = [
  { id: 1, tone: 'warn' as const, icon: 'warn' as IconName, text: 'Glow Ritual Vitamin C Face Serum has only 12 units left.' },
  { id: 2, tone: 'rose' as const, icon: 'users' as IconName, text: '7 salons are waiting to be listed as partner parlours.' },
  { id: 3, tone: 'info' as const, icon: 'box' as IconName, text: '3 orders are packed and ready to be handed over.' },
  { id: 4, tone: 'ok' as const, icon: 'star' as IconName, text: '4 new 5-star reviews this week.' },
  { id: 5, tone: 'warn' as const, icon: 'case' as IconName, text: '4 partners are hiring this month — placements are moving.' },
  { id: 6, tone: 'rose' as const, icon: 'heart' as IconName, text: '2 testimonials are waiting to be published.' },
  { id: 7, tone: 'info' as const, icon: 'cart' as IconName, text: '2 returns were requested in the last 7 days.' },
  { id: 8, tone: 'ok' as const, icon: 'users' as IconName, text: '21 new customer sign-ups this month.' },
  { id: 9, tone: 'info' as const, icon: 'shop' as IconName, text: '3 new job vacancies were posted by partners.' },
];

export const seedTeam = [
  { name: 'Deepak Kumar', email: 'deepak@glowngrace.in', avatar: '/images/partner1.jpg', role: 'Store Administrator · full access' },
  { name: 'Aditi Srivastava', email: 'aditi@glowngrace.in', avatar: '/images/partner2.jpg', role: 'Inventory Manager' },
  { name: 'Rohit Malhotra', email: 'rohit@glowngrace.in', avatar: '/images/partner3.jpg', role: 'Partnerships Lead' },
  { name: 'Neha Kulkarni', email: 'neha@glowngrace.in', avatar: '/images/about.jpg', role: 'Content & Reviews' },
  { name: 'Karan Sethi', email: 'karan@glowngrace.in', avatar: '/images/careers.jpg', role: 'Placements Coordinator' },
];

export const seedFeed = [
  { initials: 'AM', name: 'Ananya Mehta', text: 'left a 5-star review on Velvet Matte Luxe Liquid Lipstick.', time: '2 hours ago', avatar: '/images/partner1.jpg' },
  { initials: 'KN', name: 'Kavya Nair', text: 'placed an order of 3 items.', time: '5 hours ago', avatar: '/images/partner2.jpg' },
  { initials: 'AV', name: 'Anjali Verma', text: 'was shortlisted for Senior Beautician.', time: 'Yesterday', avatar: '/images/partner3.jpg' },
  { initials: 'IB', name: 'Ishita Bansal', text: 'published a new opening at Blush Beauty Lounge.', time: 'Yesterday', avatar: '/images/about.jpg' },
  { initials: 'RV', name: 'Rahul Verma', text: 'signed a partner agreement for the store.', time: '2 days ago', avatar: '/images/careers.jpg' },
];

export const seedChannel = [
  { label: 'Website', percent: '52%', tone: 'rose' },
  { label: 'Marketplace', percent: '22%', tone: 'gold' },
  { label: 'Walk-in', percent: '26%', tone: 'deep' },
];

export const productCategories = ['Makeup', 'Skincare', 'Fragrance', 'Gifting', 'Hair Care', 'Accessories'] as const;
export const jobAreas = ['Hazratganj, Lucknow', 'Mahanagar, Lucknow', 'Gomti Nagar, Lucknow', 'Aliganj, Lucknow', 'Indira Nagar, Lucknow', 'Alambagh, Lucknow', 'Chowk, Lucknow'] as const;

export const statusTones: Record<string, string> = {
  Delivered: 'ok',
  Shipped: 'info',
  Packed: 'info',
  Processing: 'warn',
  Returned: 'bad',
  Cancelled: 'mute',
  Active: 'ok',
  'Low stock': 'warn',
  'Out of stock': 'bad',
  Draft: 'mute',
  Open: 'ok',
  Paused: 'warn',
  Closed: 'mute',
  Approved: 'ok',
  Pending: 'warn',
  Interview: 'info',
  Shortlisted: 'ok',
  'Offer sent': 'ok',
  New: 'warn',
  'Pending review': 'warn',
  Hidden: 'mute',
  Placed: 'ok',
  'Not selected': 'bad',
  VIP: 'rose',
  Loyal: 'ok',
  'At risk': 'bad',
};

export function money(value: number) {
  return `₹${value.toLocaleString('en-IN')}`;
}

export function statusTone(status: string) {
  return statusTones[status] ?? 'mute';
}

export function stockStatus(stock: number) {
  if (stock <= 0) return 'Out of stock';
  if (stock < 15) return 'Low stock';
  return 'Active';
}
