import { z } from 'zod';

/**
 * The single source of truth for the store settings the console edits.
 *
 * The values live in `store_settings` as one JSONB row per section, so a row
 * can be missing, partial, or hold a value that was written before a schema
 * tightened. Everything that reads or writes settings therefore goes through
 * this module: `storeSettingsSchema` validates an incoming change and
 * `normalizeStoreSettings` guarantees that a reader always receives a complete,
 * correctly typed object.
 */

export type StoreProfile = {
  storeName: string;
  tagline: string;
  email: string;
  phone: string;
  address: string;
};

export type StoreDelivery = {
  freeAbove: number;
  deliveryFee: number;
  gst: number;
  returns: number;
};

export type StorePreview = { livePreview: boolean };
export type StoreNotifications = Record<string, boolean>;

export type StoreSettings = {
  profile: StoreProfile;
  delivery: StoreDelivery;
  notifications: StoreNotifications;
  preview: StorePreview;
};

/** The notification switches the console renders, in the order it shows them. */
export const notificationKeys = ['orders', 'lowStock', 'partners', 'reviews'] as const;
export type NotificationKey = (typeof notificationKeys)[number];

/** Mirrors db/migrations/006_store_settings.sql. */
export const defaultStoreSettings: StoreSettings = {
  profile: {
    storeName: 'Glow & Grace',
    tagline: 'A complete beauty & career destination',
    email: 'care@glowngrace.in',
    phone: '+91 98765 43210',
    address: 'Hazratganj, Lucknow, Uttar Pradesh 226001',
  },
  delivery: { freeAbove: 999, deliveryFee: 59, gst: 18, returns: 7 },
  notifications: { orders: true, lowStock: true, partners: true, reviews: false },
  preview: { livePreview: true },
};

const trimmedText = (max: number, label: string) =>
  z.string({ invalid_type_error: `${label} must be text.`, required_error: `${label} is required.` })
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`);

const count = (label: string, min: number, max: number) =>
  z.coerce.number({ invalid_type_error: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(min, `${label} cannot be below ${min}.`)
    .max(max, `${label} cannot be above ${max}.`);

export const storeProfileSchema = z.object({
  storeName: trimmedText(120, 'The store name').min(1, 'Enter a store name.'),
  tagline: trimmedText(160, 'The tagline'),
  email: trimmedText(254, 'The contact email').pipe(z.string().email('Enter a valid email address.')),
  phone: trimmedText(32, 'The phone number'),
  address: trimmedText(300, 'The studio address'),
});

export const storeDeliverySchema = z.object({
  freeAbove: count('The free delivery threshold', 0, 9_999_999),
  deliveryFee: count('The standard delivery fee', 0, 99_999),
  gst: z.coerce.number({ invalid_type_error: 'The GST rate must be a number.' })
    .min(0, 'The GST rate cannot be below 0.')
    .max(100, 'The GST rate cannot be above 100.'),
  returns: count('The return window', 0, 365),
});

export const storePreviewSchema = z.object({ livePreview: z.boolean() });

export const storeNotificationsSchema = z.object(
  Object.fromEntries(notificationKeys.map((key) => [key, z.boolean()])) as Record<NotificationKey, z.ZodBoolean>,
).strict('That notification is not one this store can send.');

/** An update to any subset of the sections. Every field inside a section is required. */
export const storeSettingsSchema = z.object({
  profile: storeProfileSchema.partial().optional(),
  delivery: storeDeliverySchema.partial().optional(),
  notifications: storeNotificationsSchema.partial().optional(),
  preview: storePreviewSchema.partial().optional(),
});

export type StoreSettingsUpdate = z.infer<typeof storeSettingsSchema>;

/** The sections a client may send, used to reject a body that changes nothing. */
export const settingsSections = ['profile', 'delivery', 'notifications', 'preview'] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, fallback: string) {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? value.slice(0, 500) : fallback;
}

function amount(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function flag(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(text)) return true;
    if (['false', 'no', 'n', '0', ''].includes(text)) return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

/**
 * Turns whatever is in `store_settings` into a complete, correctly typed
 * object. Every field falls back to its default, so a missing section, a
 * half-written section, or a section written by an older build can never reach
 * the console as `undefined` and crash a controlled input.
 */
export function normalizeStoreSettings(raw: unknown): StoreSettings {
  const settings = asRecord(raw);
  const profile = asRecord(settings.profile);
  const delivery = asRecord(settings.delivery);
  const preview = asRecord(settings.preview);
  const notifications = asRecord(settings.notifications);
  return {
    profile: {
      storeName: text(profile.storeName, defaultStoreSettings.profile.storeName),
      tagline: text(profile.tagline, defaultStoreSettings.profile.tagline),
      email: text(profile.email, defaultStoreSettings.profile.email),
      phone: text(profile.phone, defaultStoreSettings.profile.phone),
      address: text(profile.address, defaultStoreSettings.profile.address),
    },
    delivery: {
      freeAbove: amount(delivery.freeAbove, defaultStoreSettings.delivery.freeAbove, 0, 9_999_999),
      deliveryFee: amount(delivery.deliveryFee, defaultStoreSettings.delivery.deliveryFee, 0, 99_999),
      gst: amount(delivery.gst, defaultStoreSettings.delivery.gst, 0, 100),
      returns: amount(delivery.returns, defaultStoreSettings.delivery.returns, 0, 365),
    },
    notifications: Object.fromEntries(
      notificationKeys.map((key) => [key, flag(notifications[key], defaultStoreSettings.notifications[key])]),
    ) as StoreNotifications,
    preview: {
      livePreview: flag(preview.livePreview, defaultStoreSettings.preview.livePreview),
    },
  };
}

export type SettingsValidation =
  | { ok: true; update: StoreSettingsUpdate; sections: string[] }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates a settings update and reports the offending field for each problem.
 *
 * An update that changes nothing is a mistake rather than a no-op: the console
 * used to answer `200 Settings saved.` for an empty body, which told the
 * operator their edit had been stored when nothing had been sent.
 */
export function validateStoreSettings(input: unknown): SettingsValidation {
  const parsed = storeSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.map(String).join('.') || 'settings';
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }
  const update = parsed.data;
  const sections = settingsSections.filter((section) => {
    const value = update[section];
    return value !== undefined && Object.keys(value).length > 0;
  });
  if (sections.length === 0) {
    return { ok: false, errors: { settings: 'Change at least one setting before saving.' } };
  }
  return { ok: true, update, sections };
}
