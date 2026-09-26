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

type ApiResponse = { message?: string; error?: string; orderNumber?: string; total?: number };

async function post<T>(path: string, payload: T): Promise<ApiResponse> {
  const response = await fetch(`${API_BASE_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = (await response.json()) as ApiResponse;
  if (!response.ok) throw new Error(result.message ?? 'Something went wrong. Please try again.');
  return result;
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
