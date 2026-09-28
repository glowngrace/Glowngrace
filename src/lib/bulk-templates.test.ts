import { describe, expect, it } from 'vitest';
import { productCreateSchema, userCreateSchema } from '../server/admin';
import { collections } from '../server/admin/collections';
import { bulkDatasets, bulkTemplateByDataset, type BulkDatasetKey } from './bulk-templates';

const productColumns = Object.keys(productCreateSchema.shape);
const userColumns = Object.keys(userCreateSchema.shape);

function serverColumns(dataset: BulkDatasetKey) {
  if (dataset === 'products') return productColumns;
  if (dataset === 'users') return userColumns;
  const collection = collections.find((entry) => entry.key === dataset);
  if (!collection) throw new Error(`No server collection for the ${dataset} dataset.`);
  return collection.fields.map((field) => field.key);
}

describe('bulk upload templates', () => {
  it('covers every dataset the import endpoint accepts', () => {
    const accepted: BulkDatasetKey[] = ['products', 'jobs', 'candidates', 'partners', 'customers', 'reviews', 'users'];
    expect(bulkDatasets.map((template) => template.dataset).sort()).toEqual([...accepted].sort());
  });

  it.each(bulkDatasets.map((template) => [template.dataset, template] as const))(
    'matches the %s template columns with the server import schema',
    (_dataset, template) => {
      expect([...template.columns].sort()).toEqual([...new Set(template.columns)].sort());
      expect([...template.example]).toHaveLength(template.columns.length);
      expect([...serverColumns(template.dataset)].sort()).toEqual([...template.columns].sort());
    },
  );

  it('marks every column the server requires as present in the template', () => {
    for (const template of bulkDatasets) {
      const collection = collections.find((entry) => entry.key === template.dataset);
      if (!collection) continue;
      const required = collection.fields.filter((field) => field.required).map((field) => field.key);
      for (const key of required) expect(template.columns).toContain(key);
    }
  });

  it('ships a unique xlsx filename and copy for each dataset', () => {
    const filenames = bulkDatasets.map((template) => template.filename);
    expect(new Set(filenames).size).toBe(filenames.length);
    for (const template of bulkDatasets) {
      expect(template.filename.endsWith('.xlsx')).toBe(true);
      expect(template.label).toBeTruthy();
      expect(template.plural).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.notes.length).toBeGreaterThan(0);
    }
  });

  it('exposes a lookup for every dataset', () => {
    expect(bulkTemplateByDataset.size).toBe(bulkDatasets.length);
    expect(bulkTemplateByDataset.get('products')?.plural).toBe('Products');
  });

  it('documents the constrained values in the notes so merchants cannot guess', () => {
    const notes = Object.fromEntries(bulkDatasets.map((template) => [template.dataset, template.notes.join(' ')]));
    expect(notes.products).toContain('Makeup, Skincare, Fragrance or Gifting');
    expect(notes.jobs).toContain('Open, Draft, Paused or Closed');
    expect(notes.candidates).toContain('New, Shortlisted, Interview, Offer sent or Not selected');
    expect(notes.partners).toContain('Active, Pending or Paused');
    expect(notes.customers).toContain('VIP, Loyal, New or At risk');
    expect(notes.reviews).toContain('Active, Pending review or Hidden');
    expect(notes.users).toContain('at least 8 characters');
  });
});
