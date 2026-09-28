import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const whole = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const rating = z.coerce.number().min(0).max(5);
const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format.');

export type FieldDefinition = {
  key: string;
  column: string;
  schema: z.ZodTypeAny;
  required: boolean;
  defaultValue?: string | number;
};

export type Collection = {
  key: string;
  table: string;
  label: string;
  referencePrefix: string;
  fields: FieldDefinition[];
  orderBy: string;
  searchColumns: string[];
};

const jobStatuses = ['Open', 'Draft', 'Paused', 'Closed'] as const;
const candidateStages = ['New', 'Shortlisted', 'Interview', 'Offer sent', 'Not selected'] as const;
const partnerStatuses = ['Active', 'Pending', 'Paused'] as const;
const customerTiers = ['VIP', 'Loyal', 'New', 'At risk'] as const;
const reviewStatuses = ['Active', 'Pending review', 'Hidden'] as const;

export const jobStatusesList = [...jobStatuses];
export const candidateStagesList = [...candidateStages];
export const partnerStatusesList = [...partnerStatuses];
export const customerTiersList = [...customerTiers];
export const reviewStatusesList = [...reviewStatuses];

export const collections: Collection[] = [
  {
    key: 'jobs',
    table: 'job_vacancies',
    label: 'Job vacancy',
    referencePrefix: 'JOB',
    orderBy: 'created_at DESC, id',
    searchColumns: ['title', 'partner', 'area', 'id'],
    fields: [
      { key: 'title', column: 'title', schema: requiredText(120), required: true },
      { key: 'partner', column: 'partner', schema: requiredText(120), required: true },
      { key: 'area', column: 'area', schema: requiredText(80), required: true },
      { key: 'type', column: 'type', schema: z.enum(['Full-time', 'Part-time', 'Contract', 'Internship']), required: true },
      { key: 'salary', column: 'salary', schema: requiredText(80), required: true },
      { key: 'experience', column: 'experience', schema: text(60), required: false, defaultValue: '' },
      { key: 'skills', column: 'skills', schema: text(500), required: false, defaultValue: '' },
      { key: 'description', column: 'description', schema: text(2000), required: false, defaultValue: '' },
      { key: 'applications', column: 'applications', schema: whole(0, 9999), required: false, defaultValue: 0 },
      { key: 'status', column: 'status', schema: z.enum(jobStatuses), required: false, defaultValue: 'Draft' },
    ],
  },
  {
    key: 'candidates',
    table: 'candidates',
    label: 'Candidate',
    referencePrefix: 'CND',
    orderBy: 'created_at DESC, id',
    searchColumns: ['name', 'role', 'city', 'id'],
    fields: [
      { key: 'name', column: 'name', schema: requiredText(120), required: true },
      { key: 'role', column: 'role', schema: requiredText(120), required: true },
      { key: 'experience', column: 'experience', schema: text(60), required: false, defaultValue: '' },
      { key: 'city', column: 'city', schema: requiredText(80), required: true },
      { key: 'rating', column: 'rating', schema: rating, required: false, defaultValue: 0 },
      { key: 'stage', column: 'stage', schema: z.enum(candidateStages), required: false, defaultValue: 'New' },
      { key: 'email', column: 'email', schema: z.string().trim().email().max(254), required: true },
      { key: 'phone', column: 'phone', schema: text(32), required: false, defaultValue: '' },
      { key: 'avatar', column: 'avatar', schema: text(180), required: false, defaultValue: '' },
    ],
  },
  {
    key: 'partners',
    table: 'partner_salons',
    label: 'Partner parlour',
    referencePrefix: 'PTN',
    orderBy: 'created_at DESC, id',
    searchColumns: ['name', 'area', 'type', 'id'],
    fields: [
      { key: 'name', column: 'name', schema: requiredText(120), required: true },
      { key: 'area', column: 'area', schema: requiredText(80), required: true },
      { key: 'type', column: 'type', schema: requiredText(80), required: true },
      { key: 'rating', column: 'rating', schema: rating, required: false, defaultValue: 0 },
      { key: 'vacancies', column: 'vacancies', schema: whole(0, 9999), required: false, defaultValue: 0 },
      { key: 'status', column: 'status', schema: z.enum(partnerStatuses), required: false, defaultValue: 'Pending' },
      { key: 'phone', column: 'phone', schema: text(32), required: false, defaultValue: '' },
      { key: 'email', column: 'email', schema: z.string().trim().email().max(254), required: false, defaultValue: '' },
      { key: 'owner', column: 'owner', schema: text(120), required: false, defaultValue: '' },
      { key: 'since', column: 'since', schema: text(12), required: false, defaultValue: '' },
      { key: 'avatar', column: 'avatar', schema: text(180), required: false, defaultValue: '' },
    ],
  },
  {
    key: 'customers',
    table: 'customers',
    label: 'Customer',
    referencePrefix: 'CUS',
    orderBy: 'created_at DESC, id',
    searchColumns: ['name', 'email', 'id'],
    fields: [
      { key: 'name', column: 'name', schema: requiredText(120), required: true },
      { key: 'email', column: 'email', schema: z.string().trim().email().max(254), required: true },
      { key: 'phone', column: 'phone', schema: text(32), required: false, defaultValue: '' },
      { key: 'orders', column: 'orders', schema: whole(0, 9999), required: false, defaultValue: 0 },
      { key: 'spent', column: 'spent', schema: whole(0, 99999999), required: false, defaultValue: 0 },
      { key: 'tier', column: 'tier', schema: z.enum(customerTiers), required: false, defaultValue: 'New' },
      { key: 'lastOrderOn', column: 'last_order_on', schema: day, required: false },
    ],
  },
  {
    key: 'reviews',
    table: 'reviews',
    label: 'Review',
    referencePrefix: 'REV',
    orderBy: 'created_at DESC, id',
    searchColumns: ['author', 'product_name', 'text', 'id'],
    fields: [
      { key: 'author', column: 'author', schema: requiredText(120), required: true },
      { key: 'productName', column: 'product_name', schema: requiredText(180), required: true },
      { key: 'rating', column: 'rating', schema: z.coerce.number().min(1).max(5), required: true },
      { key: 'text', column: 'text', schema: requiredText(2000), required: true },
      { key: 'status', column: 'status', schema: z.enum(reviewStatuses), required: false, defaultValue: 'Pending review' },
      { key: 'avatar', column: 'avatar', schema: text(180), required: false, defaultValue: '' },
      { key: 'reviewedOn', column: 'reviewed_on', schema: day, required: false },
    ],
  },
];

export const collectionByKey = new Map(collections.map((collection) => [collection.key, collection]));

export type Row = Record<string, unknown>;

export function mapRow(collection: Collection, row: Row) {
  const record: Record<string, unknown> = { id: String(row.id) };
  for (const field of collection.fields) {
    const value = row[field.column];
    if (field.key === 'rating') {
      record[field.key] = Number(value ?? 0);
      continue;
    }
    if (field.key === 'reviewedOn' || field.key === 'lastOrderOn') {
      record[field.key] = value ? new Date(String(value)).toISOString().slice(0, 10) : null;
      continue;
    }
    record[field.key] = value === null || value === undefined ? (field.defaultValue ?? '') : value;
  }
  return record;
}

export function validateFields(
  collection: Collection,
  input: Record<string, unknown>,
  mode: 'create' | 'update',
) {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input)) {
    const field = collection.fields.find((candidate) => candidate.key === key);
    if (!field) {
      errors[key] = 'This column is not part of the template.';
      continue;
    }
    const parsed = field.schema.safeParse(raw);
    if (!parsed.success) {
      errors[key] = parsed.error.issues[0]?.message ?? 'This value is not valid.';
      continue;
    }
    values[field.column] = parsed.data === '' && (field.defaultValue !== undefined) ? field.defaultValue : parsed.data;
  }
  if (mode === 'create') {
    for (const field of collection.fields) {
      if (field.required && !(field.column in values)) errors[field.key] = 'This column is required.';
    }
  }
  return { values, errors, ok: Object.keys(errors).length === 0 };
}
