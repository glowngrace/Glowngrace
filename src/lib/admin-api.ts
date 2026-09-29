import type { Product } from '../data/catalog';
import type { StorefrontPage } from './api';
import type { BulkDatasetKey } from './bulk-templates';
import type { StoreSettings } from '../server/admin/settings';

export type { StoreSettings, StoreProfile, StoreDelivery, StorePreview, StoreNotifications } from '../server/admin/settings';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
const TOKEN_KEY = 'glow-grace-admin-token';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string;
  status: string;
  createdAt: string;
};

export type AdminOrder = {
  id: string;
  customer: string;
  email: string;
  phone: string;
  address: string;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
  deliveryMethod: string;
  status: string;
  items: number;
  total: number;
  date: string;
  createdAt: string;
};

export type AdminPage = StorefrontPage;

export type AdminDataset = { key: string; label: string; table: string; visible: boolean; seeded: boolean; rowCount: number };

export type AdminSummary = {
  orders: number;
  products: number;
  jobs: number;
  candidates: number;
  partners: number;
  customers: number;
  reviews: number;
  pages: string[];
  hiddenDatasets: string[];
};

/** The settings payload always arrives complete, so a section is never `undefined`. */
export type StoreSettingsResponse = { settings: StoreSettings; updatedAt: string | null };

export type BulkOutcome = { created: string[]; errors: Array<{ row: number; message: string; errors?: Record<string, string> }>; message: string };

export class AdminApiError extends Error {
  status: number;
  code: string;
  fieldErrors: Record<string, string>;

  constructor(status: number, code: string, message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function getAdminToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // A blocked storage API only costs the user a fresh sign-in next time.
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getAdminToken();
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/admin/${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new AdminApiError(0, 'network_error', 'The console could not reach the server. Check your connection and try again.');
  }
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new AdminApiError(
      response.status,
      String(payload.error ?? 'request_failed'),
      String(payload.message ?? 'Something went wrong. Please try again.'),
      (payload.errors as Record<string, string>) ?? {},
    );
  }
  return payload as T;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body);
const remove = <T>(path: string) => request<T>('DELETE', path);

function collectionOf(key: string) {
  return key === 'users' ? 'users' : key;
}

export const adminApi = {
  async signIn(email: string, password: string) {
    const result = await post<{ token: string; user: AdminUser }>('session', { email, password });
    setAdminToken(result.token);
    return result.user;
  },
  async signOut() {
    try {
      await request<{ message: string }>('DELETE', 'session');
    } finally {
      setAdminToken(null);
    }
  },
  me: () => get<{ user: AdminUser }>('me').then((result) => result.user),
  summary: () => get<AdminSummary>('summary'),
  settings: () => get<StoreSettingsResponse>('settings'),
  saveSettings: (settings: unknown) => put<StoreSettingsResponse & { message: string }>('settings', settings),
  pages: () => get<{ pages: AdminPage[] }>('pages').then((result) => result.pages),
  setPageVisible: (slug: string, visible: boolean) => patch<{ message: string }>(`pages/${encodeURIComponent(slug)}`, { visible }),
  datasets: () => get<{ datasets: AdminDataset[] }>('demo-data').then((result) => result.datasets),
  demoAction: (dataset: string, action: 'hide' | 'show' | 'delete' | 'reset' | 'reset-all') =>
    post<{ datasets: AdminDataset[]; message: string }>('demo-data', { dataset, action }),

  products: () => get<{ products: Product[] }>('products').then((result) => result.products),
  createProduct: (product: unknown) => post<{ product: Product; message: string }>('products', product),
  updateProduct: (id: number, product: unknown) => patch<{ product: Product; message: string }>(`products/${id}`, product),
  deleteProduct: (id: number) => remove<{ message: string }>(`products/${id}`),

  orders: () => get<{ orders: AdminOrder[] }>('orders').then((result) => result.orders),
  updateOrder: (id: string, order: unknown) => patch<{ order: AdminOrder; message: string }>(`orders/${encodeURIComponent(id)}`, order),
  deleteOrder: (id: string) => remove<{ message: string }>(`orders/${encodeURIComponent(id)}`),

  users: () => get<{ users: AdminUser[]; roles: string[] }>('users'),
  createUser: (user: unknown) => post<{ user: AdminUser; message: string }>('users', user),
  updateUser: (id: string, user: unknown) => patch<{ user: AdminUser; message: string }>(`users/${encodeURIComponent(id)}`, user),
  deleteUser: (id: string) => remove<{ message: string }>(`users/${encodeURIComponent(id)}`),
  changePassword: (id: string, currentPassword: string, newPassword: string) =>
    post<{ message: string }>(`users/${encodeURIComponent(id)}/password`, { currentPassword, newPassword }),

  records: <T>(key: string) => get<{ records: T[] }>(collectionOf(key)).then((result) => result.records),
  createRecord: <T>(key: string, record: unknown) => post<{ record: T; message: string }>(collectionOf(key), record),
  updateRecord: <T>(key: string, id: string, record: unknown) =>
    patch<{ record: T; message: string }>(`${collectionOf(key)}/${encodeURIComponent(id)}`, record),
  deleteRecord: (key: string, id: string) => remove<{ message: string }>(`${collectionOf(key)}/${encodeURIComponent(id)}`),

  bulk: (dataset: BulkDatasetKey, rows: Array<Record<string, unknown>>) => post<BulkOutcome>('bulk', { dataset, rows }),
  bulkUsers: (rows: Array<Record<string, unknown>>) => post<BulkOutcome>('users/bulk', { rows }),
};
