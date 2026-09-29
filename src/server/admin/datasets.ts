import { demoDatasets, type DemoDatasetKey } from './seeds.js';

/**
 * Row counts for the demo datasets the danger zone lists.
 *
 * `demo_datasets` only records whether a dataset is visible and seeded, so the
 * console used to render a blank where the count belonged. Counting each table
 * in one round trip keeps the panel honest without adding a query per dataset.
 */

export type DatasetRowCounts = Record<string, number>;

/**
 * Builds one `SELECT` of per-table counts. The column list is generated from
 * `demoDatasets`, so a new dataset cannot be added without also being counted.
 *
 * The identifiers come from the seed list rather than from user input and are
 * validated here anyway, because this SQL is assembled by string concatenation.
 */
export function datasetCountSql() {
  const keys = demoDatasets.map((dataset) => dataset.key);
  for (const key of keys) {
    if (!/^[a-z_][a-z0-9_]*$/.test(key)) throw new Error(`Unsafe dataset key: ${key}`);
    if (!/^[a-z_][a-z0-9_]*$/.test(datasetTable(key))) throw new Error(`Unsafe dataset table: ${datasetTable(key)}`);
  }
  const selects = keys.map((key, index) => `(SELECT count(*)::int FROM ${datasetTable(key)}) AS dataset_${index}`);
  return { sql: `SELECT ${selects.join(', ')}`, keys };
}

function datasetTable(key: DemoDatasetKey) {
  return demoDatasets.find((dataset) => dataset.key === key)?.table ?? key;
}

/** Reads the row of `datasetCountSql()` back into a lookup by dataset key. */
export function mapDatasetRowCounts(keys: string[], row: Record<string, unknown> | undefined): DatasetRowCounts {
  const counts: DatasetRowCounts = {};
  keys.forEach((key, index) => {
    counts[key] = Number(row?.[`dataset_${index}`] ?? 0);
  });
  return counts;
}
