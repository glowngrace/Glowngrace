export type Product = {
  id: number;
  name: string;
  category: string;
  brand?: string;
  sku?: string;
  price: number;
  mrp: number;
  stock?: number;
  rating: number;
  reviews: number;
  badge?: string;
  image: string;
  images?: string[];
  description: string;
  published?: boolean;
  featured?: boolean;
  /** Search-friendly handle, edited in the console. Not used for routing. */
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;
  shades?: string[];
  highlights?: string[];
  /** Detailed product information, split into sections for the storefront page. */
  featuresAndSpecification?: string;
  measurement?: string;
  materialAndCare?: string;
  additionalDetails?: string;
  itemDetails?: string;
};

export const products: Product[] = [
  {
    id: 1,
    name: 'Velvet Matte Luxe Liquid Lipstick',
    category: 'Makeup',
    price: 599,
    mrp: 799,
    rating: 4.8,
    reviews: 214,
    badge: 'Bestseller',
    image: 'p_lip_rose.jpg',
    description: 'A weightless, non-drying matte with vitamin E and jojoba for a soft, comfortable finish that lasts.',
  },
  {
    id: 2,
    name: 'Berry Noir Matte Liquid Lipstick',
    category: 'Makeup',
    price: 599,
    mrp: 799,
    rating: 4.7,
    reviews: 132,
    badge: 'New',
    image: 'p_lip_berry.jpg',
    description: 'An intensely pigmented plum-berry matte made for evenings, celebrations and every moment in between.',
  },
  {
    id: 3,
    name: 'Nude Silk Matte Liquid Lipstick',
    category: 'Makeup',
    price: 549,
    mrp: 749,
    rating: 4.6,
    reviews: 98,
    image: 'p_lip_nude.jpg',
    description: 'A warm caramel-rose everyday nude with a flattering soft-focus matte finish.',
  },
  {
    id: 4,
    name: 'Glow Ritual Vitamin C Face Serum',
    category: 'Skincare',
    price: 849,
    mrp: 1049,
    rating: 4.9,
    reviews: 189,
    badge: 'Bestseller',
    image: 'p_serum.jpg',
    description: 'Stabilised vitamin C and ferulic acid help brighten dullness and leave skin feeling renewed.',
  },
  {
    id: 5,
    name: 'Hydra Dew Hyaluronic Serum',
    category: 'Skincare',
    price: 799,
    mrp: 999,
    rating: 4.7,
    reviews: 141,
    badge: 'New',
    image: 'p_serum_hydra.jpg',
    description: 'Triple-weight hyaluronic acid and panthenol deliver a cushion of lightweight, non-sticky hydration.',
  },
  {
    id: 6,
    name: 'Aura Radiance Highlighter',
    category: 'Makeup',
    price: 449,
    mrp: 649,
    rating: 4.8,
    reviews: 97,
    badge: 'On sale',
    image: 'p_highlighter.jpg',
    description: 'Finely milled champagne-gold powder that catches the light with a soft, buildable glow.',
  },
  {
    id: 7,
    name: 'Bloom Essence Rose Eau De Parfum',
    category: 'Fragrance',
    price: 1199,
    mrp: 1499,
    rating: 4.8,
    reviews: 106,
    image: 'p_perfume_rose.jpg',
    description: 'A modern rose fragrance with soft floral notes and a warm, lingering finish.',
  },
  {
    id: 8,
    name: 'Radiance Ritual Glow Kit',
    category: 'Gifting',
    price: 2499,
    mrp: 3199,
    rating: 4.9,
    reviews: 82,
    badge: 'Gift favourite',
    image: 'p_glow_kit.jpg',
    description: 'A thoughtful edit of glow essentials, beautifully gathered for a little everyday ritual.',
  },
];

export function productImageUrl(image: string) {
  return image.startsWith('/') ? image : `/images/${image}`;
}

export const categories = [
  { name: 'Makeup', image: 'cat_makeup.jpg', note: 'Colour, confidence & a little radiance' },
  { name: 'Skincare', image: 'cat_skincare.jpg', note: 'Gentle rituals for your everyday glow' },
  { name: 'Fragrance', image: 'cat_fragrance.jpg', note: 'A signature, softly remembered' },
  { name: 'Gifting', image: 'cat_glow.jpg', note: 'Thoughtful little luxuries, all wrapped up' },
];

export type PartnerService = {
  name: string;
  price: string;
  duration?: string;
  description?: string;
};

export type PartnerHours = {
  label: string;
  time: string;
  today?: boolean;
};

/**
 * The partner parlour profile behind `/partners/:partnerSlug`.
 *
 * `specialty`, `location`, `rating` and `image` are what the home page and the
 * partners directory already show. The rest is detail-page only, so the
 * summary and the full profile can never drift apart.
 */
export type Partner = {
  slug: string;
  name: string;
  location: string;
  area: string;
  specialty: string;
  type: string;
  rating: number;
  reviews: number;
  estd: number;
  staff: number;
  services: number;
  phone: string;
  email: string;
  description: string;
  tags: string[];
  image: string;
  images: string[];
  menu: PartnerService[];
  hours: PartnerHours[];
};

export const partners: Partner[] = [
  {
    slug: 'elegance-bridal-house',
    name: 'Elegance Bridal House',
    location: 'Mahanagar, Lucknow',
    area: 'Mahanagar',
    specialty: 'Bridal & Occasion',
    type: 'Bridal Studio',
    rating: 5,
    reviews: 128,
    estd: 2015,
    staff: 9,
    services: 22,
    phone: '+91 89718 21214',
    email: 'hello@elegancebridalhouse.in',
    description:
      'Our Mahanagar studio is where most of Lucknow’s brides begin. We keep a small, unhurried team so every bride gets her own artist for the full day — from a quiet trial at the studio through to the last touch in the family room. Engagement looks, reception colour and the family makeovers that come with them are all done in-house, using products from our Glow & Grace edit.',
    tags: ['Bridal makeup', 'Engagement', 'Reception colour', 'Draping', 'Family makeovers', 'Hair styling', 'Airbrush'],
    image: 'partner1.jpg',
    images: ['partner1.jpg', 'hero1.jpg', 'cta.jpg', 'about.jpg'],
    menu: [
      { name: 'Bridal makeup', price: '₹18,000', duration: '4 hours', description: 'HD bridal base, draping and hair, with a second artist for the family.' },
      { name: 'Engagement makeup', price: '₹7,500', duration: '2 hours', description: 'Soft luminous finish with a trial included.' },
      { name: 'Reception makeup', price: '₹9,500', duration: '2.5 hours', description: 'A polished evening look that photographs well under warm light.' },
      { name: 'Family makeover', price: '₹2,500', duration: '1 hour', description: 'A simple, flattering refresh for guests travelling with the bride.' },
      { name: 'Hair styling', price: '₹1,800', duration: '45 minutes', description: 'Buns, waves or a soft braid to match the occasion.' },
    ],
    hours: [
      { label: 'Today', time: '10:00 AM – 8:00 PM', today: true },
      { label: 'Mon – Sat', time: '10:00 AM – 8:00 PM' },
      { label: 'Sunday', time: 'By appointment' },
    ],
  },
  {
    slug: 'blush-beauty-lounge',
    name: 'Blush Beauty Lounge',
    location: 'Hazratganj, Lucknow',
    area: 'Hazratganj',
    specialty: 'Premium Unisex Salon',
    type: 'Beauty Parlour',
    rating: 4.9,
    reviews: 214,
    estd: 2017,
    staff: 14,
    services: 31,
    phone: '+91 89718 21215',
    email: 'care@blushbeautylounge.in',
    description:
      'A Hazratganj favourite for colour, cuts and the everyday facial that everyone in the neighbourhood swears by. We run six stations so weekday evenings are never rushed, and every artist here is trained in-house on the Glow & Grace retail range. Walk-ins are welcome for services; colour and cut bookings are best made a day ahead.',
    tags: ['Hair colour', 'Cut & style', 'Facials', 'Threading', 'Waxing', 'Unisex salon', 'Beard shaping'],
    image: 'partner2.jpg',
    images: ['partner2.jpg', 'about.jpg', 'strip.jpg', 'hero2.jpg'],
    menu: [
      { name: 'Signature facial', price: '₹1,200', duration: '60 minutes', description: 'A deep-cleansing facial with a mask chosen for your skin that day.' },
      { name: 'Global hair colour', price: '₹2,800', duration: '2 hours', description: 'Single-process colour with a gloss finish and blow-dry.' },
      { name: 'Cut & finish', price: '₹600', duration: '45 minutes' },
      { name: 'Full arm threading', price: '₹350', duration: '25 minutes' },
      { name: 'Beard shaping', price: '₹250', duration: '20 minutes' },
      { name: 'Waxing — full arms', price: '₹550', duration: '30 minutes' },
    ],
    hours: [
      { label: 'Today', time: '10:00 AM – 9:00 PM', today: true },
      { label: 'Mon – Fri', time: '10:00 AM – 9:00 PM' },
      { label: 'Saturday', time: '9:00 AM – 9:00 PM' },
      { label: 'Sunday', time: '11:00 AM – 6:00 PM' },
    ],
  },
  {
    slug: 'the-nail-bar',
    name: 'The Nail Bar',
    location: 'Indira Nagar, Lucknow',
    area: 'Indira Nagar',
    specialty: 'Nail Art & Spa',
    type: 'Nail & Spa Studio',
    rating: 4.9,
    reviews: 96,
    estd: 2019,
    staff: 6,
    services: 16,
    phone: '+91 89718 21216',
    email: 'studio@thenailbarlucknow.in',
    description:
      'A small, deliberate nail studio in Indira Nagar — six chairs, one artist each, and a room that never has more than two people speaking at once. We specialise in hand-painted art and structured gel work, and we are known for fixing the nails of brides three days before the wedding. Nail care comes before colour, always.',
    tags: ['Gel extensions', 'Nail art', 'Structured gel', 'Hand-painted design', 'Spa manicure', 'Nail repair', 'Bridal nails'],
    image: 'partner3.jpg',
    images: ['partner3.jpg', 'careers.jpg', 'hero3.jpg', 'strip.jpg'],
    menu: [
      { name: 'Spa manicure', price: '₹700', duration: '45 minutes', description: 'File, cuticle care, hand scrub and a polish from our retail edit.' },
      { name: 'Gel extensions', price: '₹2,200', duration: '2 hours', description: 'Full set with shaping and cuticle work.' },
      { name: 'Structured gel overlay', price: '₹1,900', duration: '90 minutes', description: 'Strength and length on natural nails, no tips.' },
      { name: 'Nail art — per nail', price: '₹150', duration: '20 minutes', description: 'Hand-painted detail, chrome, foil or minimal line work.' },
      { name: 'Bridal nail set', price: '₹3,400', duration: '2.5 hours', description: 'A full set with a trial sketch two weeks ahead.' },
    ],
    hours: [
      { label: 'Today', time: '11:00 AM – 8:00 PM', today: true },
      { label: 'Mon – Sat', time: '11:00 AM – 8:00 PM' },
      { label: 'Sunday', time: 'Closed' },
    ],
  },
];

export function findPartner(slug: string | undefined) {
  return partners.find((partner) => partner.slug === slug);
}

export const jobs = [
  { title: 'Senior Beautician', salon: 'Blush Beauty Lounge', location: 'Hazratganj, Lucknow', salary: '₹18k – ₹25k', experience: '2+ years', kind: 'Full time' },
  { title: 'Makeup Artist', salon: 'Glamour Studio', location: 'Gomti Nagar, Lucknow', salary: '₹20k – ₹30k', experience: '1+ year', kind: 'Full time' },
  { title: 'Hair Stylist', salon: 'Style Hub Salon', location: 'Aliganj, Lucknow', salary: '₹15k – ₹22k', experience: 'Fresher welcome', kind: 'Part time' },
  { title: 'Nail Art Specialist', salon: 'The Nail Bar', location: 'Indira Nagar, Lucknow', salary: '₹16k – ₹24k', experience: '1+ year', kind: 'Full time' },
];
