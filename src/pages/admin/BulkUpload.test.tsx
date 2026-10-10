import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminStoreProvider, useAdminStore } from './AdminStore';
import { BulkUpload } from './BulkUpload';
import { bulkTemplateByDataset } from '../../lib/bulk-templates';

const TOKEN_KEY = 'glow-grace-admin-token';
const TOKEN = '3f1c9a52-8d47-4e6b-9a10-2c5b7e8d4f31';

/**
 * Shows the store's banner and toast next to the upload control, standing in for
 * the parts of the console that render them, so a test can tell whether an
 * import error actually reached the operator.
 */
function StoreBanners() {
  const { error, notice } = useAdminStore();
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {notice && <p data-testid="notice">{notice}</p>}
    </>
  );
}

function json(status: number, payload: unknown) {
  return { ok: status < 400, status, json: async () => payload } as Response;
}

/** Answers every console read with an empty body and the bulk route with `bulk`. */
function stubFetch(bulk: { status?: number; payload: unknown }) {
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = String(url).replace(/^.*\/api\/admin\//, '').split('?')[0];
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    if (path === 'bulk') {
      calls.push({ path, body });
      return json(bulk.status ?? 201, bulk.payload);
    }
    return json(200, {});
  }));
  return calls;
}

/** A product sheet whose header carries every template column and two data rows. */
function productSheet() {
  const columns = bulkTemplateByDataset.get('products')!.columns;
  const header = columns.join(',');
  const row = columns.map(() => 'x').join(',');
  return [header, row, row].join('\n');
}

async function uploadSheet() {
  const file = new File([productSheet()], 'products.csv', { type: 'text/csv' });
  await userEvent.upload(screen.getByLabelText(/Upload a product from a spreadsheet/i), file);
}

function renderBulk() {
  return render(
    <AdminStoreProvider>
      <BulkUpload dataset="products" plural="products" />
      <StoreBanners />
    </AdminStoreProvider>,
  );
}

describe('product bulk upload', () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, TOKEN);
    // jsdom's File has no arrayBuffer(), which the CSV reader calls. Node's is
    // spec-identical and does, so the upload path is exercised faithfully.
    vi.stubGlobal('File', NodeFile);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps a skipped row in front of the operator instead of reporting success', async () => {
    stubFetch({
      payload: {
        created: ['42'],
        errors: [{ row: 3, message: 'Check the product columns.', errors: { mrp: 'Lower the original price.' } }],
        message: '1 rows imported, 1 skipped.',
      },
    });

    renderBulk();
    await uploadSheet();

    // The banner survives `reload()`, which used to clear it, and names the row.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/1 row skipped/));
    expect(screen.getByRole('alert')).toHaveTextContent(/row 3/);

    // The note reports what actually happened rather than assuming success.
    await waitFor(() => expect(screen.getByText(/1 of 2 rows from Rows imported — 1 skipped/)).toBeInTheDocument());

    // The detail is left in the browser console, which is how it can be debugged.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('1 products row skipped'),
      expect.arrayContaining([expect.objectContaining({ row: 3 })]),
    );
  });

  it('reports success and raises no alert when every row is accepted', async () => {
    stubFetch({
      payload: { created: ['42', '43'], errors: [], message: '2 rows imported.' },
    });

    renderBulk();
    await uploadSheet();

    await waitFor(() => expect(screen.getByText(/2 rows from Rows imported/)).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says plainly when none of the rows could be imported', async () => {
    stubFetch({
      payload: {
        created: [],
        errors: [{ row: 2, message: 'Check the product columns.' }, { row: 3, message: 'The original price must be at least the selling price.' }],
        message: '0 rows imported, 2 skipped.',
      },
    });

    renderBulk();
    await uploadSheet();

    await waitFor(() => expect(screen.getByText(/None of the 2 rows in Rows could be imported — 2 skipped/)).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent(/2 rows skipped/);
  });
});
