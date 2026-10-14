import type { Bundle, Product } from '../data/catalog';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export type ContactRequest = {
  name: string;
  email: string;
  phone?: string;
  topic: string;
  message: string;
};

export type CheckoutRequest = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
  landmark?: string;
  deliveryMethod: 'standard' | 'express' | 'same_day';
  paymentMethod: 'cod';
  items: Array<{ productId: number; quantity: number } | { bundleId: string; quantity: number }>;
};

export type ProductImageUpload = {
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string;
  width: number;
  height: number;
};

export type CreateProductRequest = {
  name: string;
  category: string;
  brand: string;
  sku: string;
  price: number;
  mrp: number;
  stock: number;
  images: ProductImageUpload[];
  description: string;
};

type ApiResponse = {
  message?: string;
  error?: string;
  orderNumber?: string;
  total?: number;
  product?: Product;
  products?: Product[];
  bundles?: Bundle[];
  catalogueManaged?: boolean;
  bundlesManaged?: boolean;
};

async function readResponse(response: Response): Promise<ApiResponse> {
  const result = await response.json() as ApiResponse;
  if (!response.ok) throw new Error(result.message ?? 'Something went wrong. Please try again.');
  return result;
}

async function post<T>(path: string, payload: T): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readResponse(response);
}

export type CatalogueResponse = {
  products: Product[];
  /** True once the database holds products, so an empty list means the shop has nothing for sale. */
  managed: boolean;
};

export async function getCatalogueProducts(): Promise<CatalogueResponse> {
  const response = await fetch(`${API_BASE_URL}/products`);
  const result = await readResponse(response);
  if (!Array.isArray(result.products)) throw new Error('The catalogue response could not be verified.');
  return { products: result.products, managed: result.catalogueManaged === true };
}

export type BundleCatalogueResponse = {
  bundles: Bundle[];
  /** True once the database holds bundles, so an empty list means the shop has no bundles. */
  managed: boolean;
};

export async function getCatalogueBundles(): Promise<BundleCatalogueResponse> {
  const response = await fetch(`${API_BASE_URL}/bundles`);
  const result = await readResponse(response);
  if (!Array.isArray(result.bundles)) throw new Error('The bundle catalogue response could not be verified.');
  return { bundles: result.bundles, managed: result.bundlesManaged === true };
}

export async function createCatalogueProduct(payload: CreateProductRequest): Promise<Product> {
  const result = await post('products', payload);
  if (!result.product) throw new Error('The saved product could not be verified. Please refresh the catalogue.');
  return result.product;
}

export type StorefrontPage = {
  slug: string;
  label: string;
  path: string;
  visible: boolean;
  position: number;
};

export async function getStorefrontPages(): Promise<StorefrontPage[]> {
  try {
    const response = await fetch(`${API_BASE_URL}/site/pages`);
    const result = await response.json() as { pages?: StorefrontPage[] };
    if (!response.ok || !Array.isArray(result.pages)) return [];
    return result.pages;
  } catch {
    return [];
  }
}

export function submitContactRequest(payload: ContactRequest) {
  return post('contact', payload);
}

export function subscribeToNewsletter(email: string) {
  return post('newsletter', { email });
}

export function placeCheckoutOrder(payload: CheckoutRequest) {
  return post('checkout', payload);
}
