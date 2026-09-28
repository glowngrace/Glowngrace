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

export const partners = [
  { name: 'Elegance Bridal House', location: 'Mahanagar, Lucknow', specialty: 'Bridal & Occasion', rating: '5.0', image: 'partner1.jpg' },
  { name: 'Blush Beauty Lounge', location: 'Hazratganj, Lucknow', specialty: 'Premium Unisex Salon', rating: '4.9', image: 'partner2.jpg' },
  { name: 'The Nail Bar', location: 'Indira Nagar, Lucknow', specialty: 'Nail Art & Spa', rating: '4.9', image: 'partner3.jpg' },
];

export const jobs = [
  { title: 'Senior Beautician', salon: 'Blush Beauty Lounge', location: 'Hazratganj, Lucknow', salary: '₹18k – ₹25k', experience: '2+ years', kind: 'Full time' },
  { title: 'Makeup Artist', salon: 'Glamour Studio', location: 'Gomti Nagar, Lucknow', salary: '₹20k – ₹30k', experience: '1+ year', kind: 'Full time' },
  { title: 'Hair Stylist', salon: 'Style Hub Salon', location: 'Aliganj, Lucknow', salary: '₹15k – ₹22k', experience: 'Fresher welcome', kind: 'Part time' },
  { title: 'Nail Art Specialist', salon: 'The Nail Bar', location: 'Indira Nagar, Lucknow', salary: '₹16k – ₹24k', experience: '1+ year', kind: 'Full time' },
];
