import { useRef, useState } from 'react';
import { Spinner } from '../../components/Loader';
import { bulkTemplateByDataset, type BulkDatasetKey, type BulkTemplate } from '../../lib/bulk-templates';
import { buildWorkbook, downloadBlob, readSpreadsheet, sheetToRecords } from '../../lib/xlsx';
import { Icon } from './AdminUi';
import { useAdminStore } from './AdminStore';

function templateWorkbook(template: BulkTemplate) {
  return buildWorkbook([
    {
      name: template.plural,
      rows: [
        template.columns,
        template.example,
        template.columns.map(() => ''),
      ],
    },
    {
      name: 'How to fill this in',
      rows: [
        ['Column', 'Meaning'],
        ...template.notes.map((note) => ['Note', note]),
      ],
    },
  ]);
}

export function BulkUpload({ dataset, plural }: { dataset: BulkDatasetKey; plural: string }) {
  const { importRows, setError } = useAdminStore();
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState<'template' | 'import' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const template = bulkTemplateByDataset.get(dataset) ?? (() => { throw new Error(`No bulk template for ${dataset}.`); })();

  async function downloadTemplate() {
    setBusy('template');
    setSummary('Preparing your template…');
    try {
      downloadBlob(await templateWorkbook(template), template.filename);
      setSummary(`${template.plural} template downloaded. Fill in the example row and upload it back.`);
    } catch (cause) {
      setSummary('');
      console.error(`[glow-admin] could not build the ${dataset} template`, cause);
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
      const missing = template.columns.filter((column) => !headers.includes(column));
      const unknown = headers.filter((column) => !template.columns.includes(column));
      if (headers.length === 0) throw new Error('The first row of the sheet must contain the column names.');
      if (missing.length > 0) throw new Error(`Missing columns: ${missing.join(', ')}. Download the template and copy your data into it.`);
      if (records.length === 0) throw new Error('No data rows were found below the column names.');
      if (unknown.length > 0) setError(`Ignored unknown columns: ${unknown.join(', ')}.`);
      setSummary(`Importing ${records.length} row${records.length === 1 ? '' : 's'} from ${sheet.name}…`);
      const outcome = await importRows(dataset, records.map((record) => {
        const row: Record<string, unknown> = {};
        for (const column of template.columns) row[column] = record[column] ?? '';
        return row;
      }));
      // The server answers with what it actually wrote, so the note reports the
      // truth rather than assuming every row was accepted. `importRows` has
      // already raised the banner and logged the detail for anything skipped.
      const total = records.length;
      const imported = outcome.created.length;
      const skipped = outcome.errors.length;
      const rows = (count: number) => `row${count === 1 ? '' : 's'}`;
      if (skipped === 0) {
        setSummary(`${imported} ${rows(imported)} from ${sheet.name} imported.`);
      } else if (imported === 0) {
        setSummary(`None of the ${total} ${rows(total)} in ${sheet.name} could be imported — ${skipped} skipped.`);
      } else {
        setSummary(`${imported} of ${total} ${rows(total)} from ${sheet.name} imported — ${skipped} skipped.`);
      }
    } catch (cause) {
      setSummary('');
      console.error(`[glow-admin] could not import ${file.name}`, cause);
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
        id={`bulk-${dataset}`}
        type="file"
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        // `sr-only` hides this from the eye without taking it out of the tab
        // order, so a keyboard or screen-reader user reaches it directly and it
        // has to announce itself. Without a name it is announced as an unlabelled
        // file control, which is worse than the button that normally opens it.
        // The template's singular reads as a sentence ("Upload a product from a
        // spreadsheet"); its plural would not - there is no "a products".
        aria-label={`Upload a ${template.label.toLowerCase()} from a spreadsheet`}
        aria-describedby={`bulk-${dataset}-note`}
        onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void upload(file); }}
      />
      <button
        className="admin-btn admin-btn-light"
        type="button"
        data-testid={`bulk-template-${dataset}`}
        onClick={() => void downloadTemplate()}
        disabled={working}
      >
        {busy === 'template' ? <Spinner /> : <Icon name="download" />}
        {busy === 'template' ? 'Preparing…' : 'Template'}
      </button>
      <button
        className="admin-btn admin-btn-light"
        type="button"
        data-testid={`bulk-upload-${dataset}`}
        onClick={() => input.current?.click()}
        disabled={working}
      >
        {busy === 'import' ? <Spinner /> : <Icon name="upload" />}
        {busy === 'import' ? 'Importing…' : `Upload ${plural.toLowerCase()}`}
      </button>
      {summary && <span className="admin-bulk-note" id={`bulk-${dataset}-note`} role="status" aria-live="polite">{summary}</span>}
    </div>
  );
}
