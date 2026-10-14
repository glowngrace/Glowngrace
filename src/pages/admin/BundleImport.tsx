import { useRef, useState } from 'react';
import type { Product } from '../../data/catalog';
import { Spinner } from '../../components/Loader';
import { buildWorkbook, downloadBlob, readSpreadsheet, sheetToRecords, type SpreadsheetCell } from '../../lib/xlsx';
import { Icon } from './AdminUi';
import { useAdminStore } from './AdminStore';

const columns = ['productId', 'productName', 'category', 'price', 'bundleName', 'type', 'bundlePrice', 'bundleTag', 'bundleDescription'];
const notes = [
  'The sheet lists your catalogue one row per product, ready to edit.',
  'To put a product in a bundle, type the bundle name into its row.',
  'Products sharing a bundle name become the members of one bundle.',
  'Rows left with a blank bundle name, or "Standalone", stay out of any bundle.',
  'bundlePrice is the single price shoppers pay for the whole bundle.',
  'bundlePrice, bundleTag and bundleDescription are copied from the first member row.',
  'A bundle needs at least two products, so a name on one row alone is skipped.',
];

export function BundleImport() {
  const { importRows, setError, products } = useAdminStore();
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState<'template' | 'import' | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function downloadTemplate() {
    setBusy('template');
    setSummary('Preparing your template…');
    try {
      const rows: SpreadsheetCell[][] = [columns];
      const listed: Product[] = products.filter((product) => product.published !== false);
      rows.push(...listed.map((product) => [
        product.id,
        product.name,
        product.category,
        product.price,
        '',
        'Standalone',
        '',
        '',
        '',
      ]));
      downloadBlob(await buildWorkbook([
        { name: 'Bundles', rows },
        {
          name: 'How to fill this in',
          rows: [['Column', 'Meaning'], ...notes.map((note) => ['Note', note])],
        },
      ]), 'glow-and-grace-bundles-template.xlsx');
      setSummary(`${listed.length} product rows in the template. Type a bundle name to group them.`);
    } catch (cause) {
      setSummary('');
      console.error('[glow-admin] could not build the bundles template', cause);
      setError(cause instanceof Error ? cause.message : 'The template could not be created.');
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy('import');
    setSummary(`Reading ${file.name}…`);
    try {
      const [sheet] = await readSpreadsheet(file);
      if (!sheet) throw new Error('That workbook has no sheets to import.');
      const { headers, records } = sheetToRecords(sheet.rows);
      const missing = columns.filter((column) => !headers.includes(column));
      const unknown = headers.filter((column) => !columns.includes(column));
      if (headers.length === 0) throw new Error('The first row of the sheet must contain the column names.');
      if (missing.length > 0) throw new Error(`Missing columns: ${missing.join(', ')}. Download the template and copy your data into it.`);
      if (records.length === 0) throw new Error('No data rows were found below the column names.');
      if (unknown.length > 0) setError(`Ignored unknown columns: ${unknown.join(', ')}.`);
      // The server groups rows by bundle name itself, so every row goes across —
      // the standalone ones are simply not part of any bundle.
      const rows = records.map((record) => {
        const row: Record<string, unknown> = {};
        for (const column of columns) row[column] = record[column] ?? '';
        return row;
      });
      setSummary(`Importing ${rows.length} product rows from ${sheet.name}…`);
      const outcome = await importRows('bundles', rows);
      const imported = outcome.created.length;
      const skipped = outcome.errors.length;
      const noun = (count: number) => `bundle${count === 1 ? '' : 's'}`;
      if (skipped === 0) {
        setSummary(`${imported} ${noun(imported)} grouped.`);
      } else if (imported === 0) {
        setSummary(`None of the rows could be grouped into bundles — ${skipped} skipped.`);
      } else {
        setSummary(`${imported} ${noun(imported)} grouped — ${skipped} skipped.`);
      }
    } catch (cause) {
      setSummary('');
      console.error('[glow-admin] could not import the bundles workbook', cause);
      setError(cause instanceof Error ? cause.message : 'That spreadsheet could not be read.');
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  }

  const working = busy !== null;

  return (
    <div className="admin-bulk">
      <input
        ref={input}
        className="sr-only"
        id="bulk-bundles"
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        aria-label="Upload bundles from a spreadsheet"
        aria-describedby="bulk-bundles-note"
        onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }}
      />
      <button
        className="admin-btn admin-btn-light"
        type="button"
        data-testid="bulk-template-bundles"
        onClick={() => void downloadTemplate()}
        disabled={working}
      >
        {busy === 'template' ? <Spinner /> : <Icon name="download" />}
        {busy === 'template' ? 'Preparing…' : 'Template'}
      </button>
      <button
        className="admin-btn admin-btn-light"
        type="button"
        data-testid="bulk-upload-bundles"
        onClick={() => input.current?.click()}
        disabled={working}
      >
        {busy === 'import' ? <Spinner /> : <Icon name="upload" />}
        {busy === 'import' ? 'Importing…' : 'Upload bundles'}
      </button>
      {summary && <span className="admin-bulk-note" id="bulk-bundles-note" role="status" aria-live="polite">{summary}</span>}
    </div>
  );
}