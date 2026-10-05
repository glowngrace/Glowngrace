import type { Product } from '../data/catalog';
import type { StorefrontPage } from './api';
import type { BulkDatasetKey } from './bulk-templates';
import type { StoreSettings } from '../server/admin/settings';

export type { StoreSettings, StoreProfile, StoreDelivery, StorePreview, StoreNotifications } from '../server/admin/settings';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';
const TOKEN_KEY = 'glow-grace-admin-token';
const EXPIRY_KEY = 'glow-grace-admin-session-expires-at';
const ACCOUNT_KEY = 'glow-grace-account';
const SESSION_ENDED_EVENT = 'glow-grace-admin-session-ended';

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar: string;
  status: string;
  phone: string;
  source: string;
  reviewedAt: string | null;
  createdAt: string;
};

/**
 * Who is signed in, for the parts of the interface that render before they have
 * asked the server anything: the header profile and the portal gates.
 */
export type SignedInAccount = {
  name: string;
  email: string;
  role: string;
  avatar: string;
};

export type AdminResetMessage = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  createdAt: string | null;
  readAt: string | null;
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

/**
 * Where the console is pointed, before and after a sync.
 *
 * `local` and `neon` are connection descriptions with no password in them: the
 * local host is plain and a remote one is masked, which is enough to notice the
 * wrong project without printing a credential into the DOM.
 */
export type LocalDatabaseReport = {
  store: 'memory' | 'postgres';
  local: { connection: string; error?: undefined } | { connection?: undefined; error: string };
  neon: { configured: boolean; project: string | null; host?: string; connection?: string; reason?: string };
  syncEnabled: boolean;
};

export type NeonSyncResult = {
  status: 'ok' | 'unchanged' | 'dry-run';
  message: string;
  source: string;
  target: string;
  copied: Record<string, number>;
  available: Record<string, number>;
  skipImages: boolean;
  durationMs: number;
};

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

/**
 * Milliseconds until the stored session lapses, or `null` when there is no
 * expiry to honour. A token stored without an expiry is a legacy value from
 * before sessions were short-lived, so it is left to the server to judge.
 */
export function getAdminSessionExpiresIn(now: number = Date.now()) {
  try {
    const raw = localStorage.getItem(EXPIRY_KEY);
    if (!raw) return null;
    const expiresAt = Date.parse(raw);
    if (Number.isNaN(expiresAt)) return null;
    return Math.max(0, expiresAt - now);
  } catch {
    return null;
  }
}

/**
 * Drops the stored session and tells the interface to show the sign-in screen.
 * Called both when the countdown reaches zero and when the server answers 401,
 * so a console tab left open can never keep working past its session.
 *
 * The cached account goes with the token. It is only ever written next to a
 * token the server issued, so keeping it after the session ended would leave a
 * name and an address on screen for an account that is no longer signed in.
 */
export function endAdminSession() {
  setAdminToken(null);
  try {
    localStorage.removeItem(EXPIRY_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
  broadcastAccountChanged();
}

export const sessionEndedEvent = SESSION_ENDED_EVENT;

/**
 * Tells the header and the portal gates that the account on screen has changed.
 *
 * Sign-in has to say so as well as sign-out. The sign-in form is rendered
 * inside the storefront layout, so without this the header keeps showing the
 * "Sign in" link to somebody who has just signed in, until they navigate to a
 * page that happens to remount it.
 */
function broadcastAccountChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
  }
}

/**
 * The account the stored session belongs to, or `null` when there is none.
 *
 * Read from the session rather than fetched, so the header can render a signed
 * in name on its first paint. The token is the authority; this is a cache of
 * what the server already told us at sign-in.
 */
export function getSignedInAccount(): SignedInAccount | null {
  try {
    if (!localStorage.getItem(TOKEN_KEY)) return null;
    const stored: unknown = JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null');
    if (!stored || typeof stored !== 'object') return null;
    const record = stored as Record<string, unknown>;
    if (typeof record.email !== 'string' || !record.email) return null;
    return {
      name: typeof record.name === 'string' ? record.name : record.email,
      email: record.email,
      role: typeof record.role === 'string' ? record.role : '',
      avatar: typeof record.avatar === 'string' ? record.avatar : '',
    };
  } catch {
    return null;
  }
}

function storeAdminSession(token: string, expiresAt: string | null, user: AdminUser) {
  setAdminToken(token);
  try {
    if (expiresAt) localStorage.setItem(EXPIRY_KEY, expiresAt);
    else localStorage.removeItem(EXPIRY_KEY);
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
    }));
  } catch {
    // A blocked storage API only costs the user a fresh sign-in next time.
  }
  broadcastAccountChanged();
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
    // A rejected session has to end locally too, otherwise the console keeps
    // rendering its last known data until the operator notices it is stale.
    if (response.status === 401 && token) endAdminSession();
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
    const result = await post<{ token: string; expiresAt?: string; user: AdminUser }>('session', { email, password });
    storeAdminSession(result.token, result.expiresAt ?? null, result.user);
    return result.user;
  },
  /**
   * The public registration form.
   *
   * It mints no session: the account it creates is Pending, and the server will
   * not sign a Pending account in. A caller that stored a token here would be
   * holding a credential the server has already refused to issue.
   */
  signUp: (signup: { name: string; email: string; role: string; password: string; phone?: string }) =>
    post<{ user: AdminUser; message: string }>('signup', signup),
  async signOut() {
    try {
      await request<{ message: string }>('DELETE', 'session');
    } finally {
      endAdminSession();
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
  /**
   * Sets a password without asking for the current one. The account holder
   * either cannot remember it or is locked out of the account that would let
   * them change it, which is the only reason this route exists.
   */
  recoverPassword: (id: string, newPassword: string) =>
    post<{ message: string }>(`users/${encodeURIComponent(id)}/recover`, { newPassword }),
  /**
   * Puts every console account on one password. The demo state is only
   * recoverable this way, and it signs the caller out along with everyone else.
   */
  recoverAllPasswords: (newPassword: string) => post<{ message: string }>('users/recover-all', { newPassword }),

  /**
   * The forgot-password pair. Both are reachable without a session, because the
   * person using them has none.
   */
  requestPasswordReset: (email: string) => post<{ message: string }>('password-reset', { email }),
  confirmPasswordReset: (token: string, newPassword: string) =>
    post<{ message: string }>('password-reset/confirm', { token, newPassword }),
  /**
   * There is no mail server, so the reset message is read here instead. This is
   * how a locked-out administrator gets their link.
   */
  resetMessages: () => get<{ messages: AdminResetMessage[] }>('password-reset/messages').then((result) => result.messages),

  records: <T>(key: string) => get<{ records: T[] }>(collectionOf(key)).then((result) => result.records),
  createRecord: <T>(key: string, record: unknown) => post<{ record: T; message: string }>(collectionOf(key), record),
  updateRecord: <T>(key: string, id: string, record: unknown) =>
    patch<{ record: T; message: string }>(`${collectionOf(key)}/${encodeURIComponent(id)}`, record),
  deleteRecord: (key: string, id: string) => remove<{ message: string }>(`${collectionOf(key)}/${encodeURIComponent(id)}`),

  bulk: (dataset: BulkDatasetKey, rows: Array<Record<string, unknown>>) => post<BulkOutcome>('bulk', { dataset, rows }),
  bulkUsers: (rows: Array<Record<string, unknown>>) => post<BulkOutcome>('users/bulk', { rows }),

  /**
   * The local development database.
   *
   * `localDatabase` answers 404 on a deployment that has not enabled the sync,
   * so the console hides the panel rather than offering a button that fails.
   */
  localDatabase: () => get<LocalDatabaseReport>('local-db'),
  /**
   * Copies the production database into the local one.
   *
   * `skipImages` leaves `product_images` alone, which is most of the bytes and
   * the least of the use locally.
   */
  syncFromNeon: (options: { skipImages?: boolean; force?: boolean } = {}) =>
    post<NeonSyncResult>('local-db/sync', {
      skipImages: options.skipImages === true,
      force: options.force === true,
    }),

  /**
   * Generates a fresh owner password and emails it to the owner address.
   *
   * There is no `password` field on the response and there is not going to be
   * one. The generated value goes to the outbox and to the owner's inbox, and
   * this call reports only that it happened - so there is nothing here for a
   * screen to accidentally render, log, or put in the URL bar.
   *
   * Every session is revoked, the caller's included, so whoever pressed the
   * button is signed out immediately afterwards.
   */
  generateOwnerPassword: () =>
    post<{ rotated: true; email: string; sessionsRevoked: number; nextRotationDays: number }>('owner-password/generate'),
};
