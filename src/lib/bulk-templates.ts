/**
 * Column definitions for the downloadable bulk upload templates.
 *
 * `src/lib/bulk-templates.test.ts` keeps these column keys in step with the
 * server validation in `src/server/admin/collections.ts` and `admin.ts`, so a
 * template can never drift away from what the import endpoint accepts.
 */

export type BulkDatasetKey = 'products' | 'jobs' | 'candidates' | 'partners' | 'customers' | 'reviews' | 'users';

export type BulkTemplate = {
  dataset: BulkDatasetKey;
  label: string;
  plural: string;
  description: string;
  filename: string;
  columns: string[];
  example: Array<string | number>;
  notes: string[];
};

export const bulkDatasets: BulkTemplate[] = [
  {
    dataset: 'products',
    label: 'Product',
    plural: 'Products',
    description: 'Add several products to the catalogue in one upload.',
    filename: 'glow-and-grace-products-template.xlsx',
    columns: ['name', 'category', 'brand', 'sku', 'price', 'mrp', 'stock', 'published', 'featured', 'rating', 'reviews', 'badge', 'image', 'description', 'slug', 'metaTitle', 'metaDescription', 'shades', 'highlights', 'featuresAndSpecification', 'measurement', 'materialAndCare', 'additionalDetails', 'itemDetails'],
    example: ['Glow Ritual Vitamin C Face Serum', 'Skincare', 'Glow & Grace', 'GG-SKM-1001', 849, 999, 24, 'TRUE', 'TRUE', 4.8, 126, 'Bestseller', 'serum.jpg', 'Brightening 12% vitamin C serum for Indian skin tones.', 'glow-ritual-vitamin-c-face-serum', 'Glow Ritual Vitamin C Face Serum', 'A brightening 12% vitamin C serum for Indian skin tones.', 'Rose Nude, Amber Glow', 'Long-lasting, Non-comedogenic', '12% vitamin C, Hyaluronic acid', '30 ml x 45 mm', 'Glass bottle, keep away from direct sunlight', 'Dermatologist tested', 'Item code GG-SKM-1001'],
    notes: [
      'category must be Makeup, Skincare, Fragrance or Gifting.',
      'price and mrp are whole rupees; mrp must be at least price.',
      'published and featured accept Yes/No, TRUE/FALSE or 1/0.',
      'image is a file name in public/images; leave blank to use the product name.',
      'Images are added through the Add product form or a product edit, not this sheet.',
      'slug is lowercase words joined by hyphens, the way a URL reads.',
      'shades and highlights are comma-separated lists; leave blank if a product has none.',
      'metaTitle and metaDescription are for search results; leave blank to use the product name and description.',
      'The last five columns are the Product Information sections; put one item per line, and leave a section blank to hide it.',
    ],
  },
  {
    dataset: 'jobs',
    label: 'Job vacancy',
    plural: 'Job vacancies',
    description: 'Publish several placement vacancies at once.',
    filename: 'glow-and-grace-jobs-template.xlsx',
    columns: ['title', 'partner', 'area', 'type', 'salary', 'experience', 'skills', 'applications', 'status', 'description'],
    example: ['Senior Beauty Therapist', 'Sculpt & Glow Studio', 'Baner, Pune', 'Full-time', '₹25,000 – ₹40,000', '3–5 years', 'Facial therapy, LED', 18, 'Open', 'Lead client services across facials and advanced skin treatments.'],
    notes: [
      'type must be Full-time, Part-time, Contract or Internship.',
      'status must be Open, Draft, Paused or Closed.',
      'Applications are counted in whole numbers.',
    ],
  },
  {
    dataset: 'candidates',
    label: 'Candidate',
    plural: 'Candidates',
    description: 'Add several placement candidates at once.',
    filename: 'glow-and-grace-candidates-template.xlsx',
    columns: ['name', 'role', 'experience', 'city', 'rating', 'stage', 'email', 'phone', 'avatar'],
    example: ['Ananya Rao', 'Beauty Therapist', '4 years', 'Pune', 4.5, 'Interview', 'ananya.rao@example.com', '+91 98220 11223', ''],
    notes: [
      'stage must be New, Shortlisted, Interview, Offer sent or Not selected.',
      'email is required and must be a valid address.',
      'rating runs from 0 to 5.',
    ],
  },
  {
    dataset: 'partners',
    label: 'Partner parlour',
    plural: 'Partner parlours',
    description: 'Add several partner parlours at once.',
    filename: 'glow-and-grace-partners-template.xlsx',
    columns: ['name', 'area', 'type', 'rating', 'vacancies', 'status', 'phone', 'email', 'owner', 'since', 'avatar'],
    example: ['Sculpt & Glow Studio', 'Baner, Pune', 'Unisex salon', 4.7, 3, 'Active', '+91 98220 11223', 'hello@sculptandglow.in', 'Meera Kulkarni', '2024-06-01', ''],
    notes: [
      'status must be Active, Pending or Paused.',
      'since uses the YYYY-MM-DD format.',
    ],
  },
  {
    dataset: 'customers',
    label: 'Customer',
    plural: 'Customers',
    description: 'Add several customer records at once.',
    filename: 'glow-and-grace-customers-template.xlsx',
    columns: ['name', 'email', 'phone', 'orders', 'spent', 'tier', 'lastOrderOn'],
    example: ['Priya Sharma', 'priya.sharma@example.com', '+91 98765 43210', 6, 18420, 'Loyal', '2026-08-19'],
    notes: [
      'tier must be VIP, Loyal, New or At risk.',
      'spent is in whole rupees and orders counts completed orders.',
      'lastOrderOn uses the YYYY-MM-DD format; leave blank if unknown.',
    ],
  },
  {
    dataset: 'reviews',
    label: 'Review',
    plural: 'Reviews',
    description: 'Add several customer reviews at once.',
    filename: 'glow-and-grace-reviews-template.xlsx',
    columns: ['author', 'productName', 'rating', 'text', 'status', 'reviewedOn', 'avatar'],
    example: ['Priya Sharma', 'Glow Ritual Vitamin C Face Serum', 5, 'Two weeks in and my skin looks brighter.', 'Active', '2026-08-21', ''],
    notes: [
      'rating must be a whole number from 1 to 5.',
      'status must be Active, Pending review or Hidden.',
      'reviewedOn uses the YYYY-MM-DD format.',
    ],
  },
  {
    dataset: 'users',
    label: 'Team member',
    plural: 'Team members',
    description: 'Invite several console accounts at once.',
    filename: 'glow-and-grace-team-template.xlsx',
    columns: ['name', 'email', 'role', 'password', 'avatar'],
    example: ['Riya Sharma', 'riya.sharma@glowngrace.in', 'Inventory Manager', 'change-me-now', ''],
    notes: [
      'role must match one of the console roles exactly.',
      `password needs at least ${8} characters and must be changed after the first sign-in.`,
      'Existing email addresses are skipped rather than overwritten.',
    ],
  },
];

export const bulkTemplateByDataset = new Map(bulkDatasets.map((template) => [template.dataset, template]));
