import type { Product } from '../data/catalog';

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
  items: Array<{ productId: number; quantity: number }>;
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

export async function getCatalogueProducts(): Promise<Product[]> {
  const response = await fetch(`${API_BASE_URL}/products`);
  const result = await readResponse(response);
  if (!Array.isArray(result.products)) throw new Error('The catalogue response could not be verified.');
  return result.products;
}

export async function createCatalogueProduct(payload: CreateProductRequest): Promise<Product> {
  const result = await post('products', payload);
  if (!result.product) throw new Error('The saved product could not be verified. Please refresh the catalogue.');
  return result.product;
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
