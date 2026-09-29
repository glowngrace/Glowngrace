import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Product } from '../../data/catalog';
import { adminApi, AdminApiError, getAdminToken, type AdminDataset, type AdminOrder, type AdminPage, type AdminSummary, type AdminUser, type StoreSettings } from '../../lib/admin-api';
import type { BulkDatasetKey } from '../../lib/bulk-templates';

export type JobRecord = {
  id: string;
  title: string;
  partner: string;
  area: string;
  type: string;
  salary: string;
  experience: string;
  skills: string;
  applications: number;
  status: string;
  description: string;
};

export type CandidateRecord = {
  id: string;
  name: string;
  role: string;
  experience: string;
  city: string;
  rating: number;
  stage: string;
  email: string;
  phone: string;
  avatar: string;
};

export type PartnerRecord = {
  id: string;
  name: string;
  area: string;
  type: string;
  rating: number;
  vacancies: number;
  status: string;
  phone: string;
  email: string;
  owner: string;
  since: string;
  avatar: string;
};

export type CustomerRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  orders: number;
  spent: number;
  tier: string;
  lastOrderOn: string | null;
};

export type ReviewRecord = {
  id: string;
  author: string;
  productName: string;
  rating: number;
  text: string;
  status: string;
  avatar: string;
  reviewedOn: string | null;
};

export type CollectionKey = 'jobs' | 'candidates' | 'partners' | 'customers' | 'reviews';

type AdminData = {
  account: AdminUser | null;
  products: Product[];
  orders: AdminOrder[];
  jobs: JobRecord[];
  candidates: CandidateRecord[];
  partners: PartnerRecord[];
  customers: CustomerRecord[];
  reviews: ReviewRecord[];
  users: AdminUser[];
  roles: string[];
  pages: AdminPage[];
  datasets: AdminDataset[];
  settings: StoreSettings | null;
  summary: AdminSummary | null;
};

const emptyData: AdminData = {
  account: null,
  products: [],
  orders: [],
  jobs: [],
  candidates: [],
  partners: [],
  customers: [],
  reviews: [],
  users: [],
  roles: [],
  pages: [],
  datasets: [],
  settings: null,
  summary: null,
};

type AdminStore = AdminData & {
  loading: boolean;
  reloading: boolean;
  error: string;
  notice: string;
  setNotice: (message: string) => void;
  setError: (message: string) => void;
  reload: () => Promise<void>;
  saveProduct: (product: unknown, productId?: number) => Promise<Product | null>;
  setProductPublished: (product: Product, published: boolean) => Promise<void>;
  removeProduct: (product: Product) => Promise<void>;
  saveOrder: (id: string, order: unknown) => Promise<void>;
  removeOrder: (id: string) => Promise<void>;
  saveUser: (user: unknown, id?: string) => Promise<void>;
  removeUser: (id: string) => Promise<void>;
  changePassword: (id: string, currentPassword: string, newPassword: string) => Promise<boolean>;
  saveRecord: <T>(key: CollectionKey, record: unknown, id?: string) => Promise<T | null>;
  removeRecord: (key: CollectionKey, id: string) => Promise<void>;
  importRows: (dataset: BulkDatasetKey, rows: Array<Record<string, unknown>>) => Promise<void>;
  saveSettings: (settings: unknown) => Promise<void>;
  setPageVisible: (slug: string, visible: boolean) => Promise<void>;
  runDemoAction: (dataset: string, action: 'hide' | 'show' | 'delete' | 'reset' | 'reset-all') => Promise<void>;
  signOut: () => Promise<void>;
};

const AdminStoreContext = createContext<AdminStore | null>(null);

const collectionKeyOf: Record<CollectionKey, keyof AdminData> = {
  jobs: 'jobs',
  candidates: 'candidates',
  partners: 'partners',
  customers: 'customers',
  reviews: 'reviews',
};

export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AdminData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const fail = useCallback((cause: unknown) => {
    setError(cause instanceof AdminApiError ? cause.message : 'The console could not complete that action. Please try again.');
  }, []);

  const announce = useCallback((message: string) => {
    setError('');
    setNotice(message);
  }, []);

  // A ref, not `data`: reading it must not change the identity of `reload`, or
  // the effect below would re-run on every response and loop forever.
  const hasLoaded = useRef(false);

  const reload = useCallback(async () => {
    // The first load blanks the console, so it owns the blocking loader. Every
    // later refresh keeps the current rows on screen and only raises the quiet
    // inline indicator, so a bulk import never blanks the table under the
    // operator.
    if (hasLoaded.current) setReloading(true);
    else setLoading(true);
    try {
      if (!getAdminToken()) {
        setData(emptyData);
        setError('Sign in to the console to load your data.');
        return;
      }
      const [account, products, orders, jobs, candidates, partners, customers, reviews, team, pages, datasets, settings, summary] = await Promise.all([
        adminApi.me(),
        adminApi.products(),
        adminApi.orders(),
        adminApi.records<JobRecord>('jobs'),
        adminApi.records<CandidateRecord>('candidates'),
        adminApi.records<PartnerRecord>('partners'),
        adminApi.records<CustomerRecord>('customers'),
        adminApi.records<ReviewRecord>('reviews'),
        adminApi.users(),
        adminApi.pages(),
        adminApi.datasets(),
        adminApi.settings(),
        adminApi.summary(),
      ]);
      setData({
        account,
        products,
        orders,
        jobs,
        candidates,
        partners,
        customers,
        reviews,
        users: team.users,
        roles: team.roles,
        pages,
        datasets,
        settings,
        summary,
      });
      hasLoaded.current = true;
      setError('');
    } catch (cause) {
      setError(cause instanceof AdminApiError ? cause.message : 'The console data could not be loaded. Please try again.');
    } finally {
      setLoading(false);
      setReloading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const store = useMemo<AdminStore>(() => ({
    ...data,
    loading,
    reloading,
    error,
    notice,
    setNotice,
    setError,
    reload,

    async saveProduct(product, productId) {
      try {
        const result = productId === undefined
          ? await adminApi.createProduct(product)
          : await adminApi.updateProduct(productId, product);
        if (!result?.product) throw new Error('The saved product could not be verified. Please refresh and try again.');
        setData((current) => ({
          ...current,
          products: current.products.some((entry) => entry.id === result.product.id)
            ? current.products.map((entry) => (entry.id === result.product.id ? result.product : entry))
            : [...current.products, result.product],
        }));
        announce(result.message);
        return result.product;
      } catch (cause) {
        fail(cause);
        return null;
      }
    },

    async setProductPublished(product, published) {
      try {
        const result = await adminApi.updateProduct(product.id, { published });
        setData((current) => ({
          ...current,
          products: current.products.map((entry) => (entry.id === product.id ? result.product : entry)),
        }));
        announce(published ? `${product.name} is live in the catalogue.` : `${product.name} is hidden from shoppers.`);
      } catch (cause) {
        fail(cause);
      }
    },

    async removeProduct(product) {
      try {
        const result = await adminApi.deleteProduct(product.id);
        setData((current) => ({ ...current, products: current.products.filter((entry) => entry.id !== product.id) }));
        announce(result.message);
      } catch (cause) {
        fail(cause);
      }
    },

    async saveOrder(id, order) {
      try {
        const result = await adminApi.updateOrder(id, order);
        setData((current) => ({ ...current, orders: current.orders.map((entry) => (entry.id === id ? result.order : entry)) }));
        announce(result.message);
      } catch (cause) {
        fail(cause);
      }
    },

    async removeOrder(id) {
      try {
        const result = await adminApi.deleteOrder(id);
        setData((current) => ({ ...current, orders: current.orders.filter((entry) => entry.id !== id) }));
        announce(result.message);
      } catch (cause) {
        fail(cause);
      }
    },

    async saveUser(user, id) {
      try {
        const result = id === undefined ? await adminApi.createUser(user) : await adminApi.updateUser(id, user);
        setData((current) => ({
          ...current,
          users: id === undefined ? [...current.users, result.user] : current.users.map((entry) => (entry.id === id ? result.user : entry)),
          account: current.account && result.user.id === current.account.id ? result.user : current.account,
        }));
        announce(result.message);
      } catch (cause) {
        fail(cause);
      }
    },

    async removeUser(id) {
      try {
        const result = await adminApi.deleteUser(id);
        setData((current) => ({ ...current, users: current.users.filter((entry) => entry.id !== id) }));
        announce(result.message);
      } catch (cause) {
        fail(cause);
      }
    },

    async changePassword(id, currentPassword, newPassword) {
      try {
        const result = await adminApi.changePassword(id, currentPassword, newPassword);
        announce(result.message);
        return true;
      } catch (cause) {
        fail(cause);
        return false;
      }
    },

    async saveRecord(key, record, id) {
      try {
        const result = id === undefined
          ? await adminApi.createRecord<Record<string, unknown>>(key, record)
          : await adminApi.updateRecord<Record<string, unknown>>(key, id, record);
        const field = collectionKeyOf[key];
        setData((current) => {
          const existing = current[field] as unknown[];
          return {
            ...current,
            [field]: id === undefined
              ? [...existing, result.record]
              : existing.map((entry) => (String((entry as { id: string }).id) === id ? result.record : entry)),
          };
        });
        announce(result.message);
        return result.record as never;
      } catch (cause) {
        fail(cause);
        return null;
      }
    },

    async removeRecord(key, id) {
      try {
        const result = await adminApi.deleteRecord(key, id);
        const field = collectionKeyOf[key];
        setData((current) => ({
          ...current,
          [field]: (current[field] as unknown[]).filter((entry) => String((entry as { id: string }).id) !== id),
        }));
        announce(result.message);
      } catch (cause) {
        fail(cause);
      }
    },

    async importRows(dataset, rows) {
      try {
        const result = dataset === 'users' ? await adminApi.bulkUsers(rows) : await adminApi.bulk(dataset, rows);
        announce(result.message);
        if (result.errors.length > 0) {
          setError(`${result.errors.length} row${result.errors.length === 1 ? '' : 's'} skipped: ${result.errors[0].message}`);
        }
        await reload();
      } catch (cause) {
        fail(cause);
      }
    },

    async saveSettings(settings) {
      try {
        const result = await adminApi.saveSettings(settings);
        setData((current) => ({ ...current, settings: result.settings }));
        announce(result.message);
      } catch (cause) {
        fail(cause);
      }
    },

    async setPageVisible(slug, visible) {
      try {
        const result = await adminApi.setPageVisible(slug, visible);
        setData((current) => ({ ...current, pages: current.pages.map((page) => (page.slug === slug ? { ...page, visible } : page)) }));
        announce(result.message);
      } catch (cause) {
        fail(cause);
      }
    },

    async runDemoAction(dataset, action) {
      try {
        const result = await adminApi.demoAction(dataset, action);
        setData((current) => ({ ...current, datasets: result.datasets }));
        announce(result.message);
        await reload();
      } catch (cause) {
        fail(cause);
      }
    },

    async signOut() {
      try {
        await adminApi.signOut();
      } finally {
        setData(emptyData);
      }
    },
  }), [announce, data, error, fail, loading, notice, reload, reloading]);

  return <AdminStoreContext.Provider value={store}>{children}</AdminStoreContext.Provider>;
}

export function useAdminStore() {
  const store = useContext(AdminStoreContext);
  if (!store) throw new Error('useAdminStore must be used inside AdminStoreProvider.');
  return store;
}
