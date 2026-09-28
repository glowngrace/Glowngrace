import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorkbook, downloadBlob, parseCsv, readSpreadsheet, sheetToRecords } from './xlsx';

function asFile(blob: Blob, name: string) {
  return Object.assign(blob, { name }) as Blob & { name: string };
}

describe('spreadsheet workbooks', () => {
  it('round-trips every cell type through a real xlsx archive', async () => {
    const blob = await buildWorkbook([
      {
        name: 'Products',
        rows: [
          ['name', 'price', 'stock', 'featured', 'notes'],
          ['Glow Ritual Vitamin C Face Serum', 849, 12, true, 'Contains "<b>vitamin C</b>" & aloe'],
          ['Velvet Matte Luxe Liquid Lipstick', 1199.5, 0, false, ''],
        ],
      },
      { name: 'Second sheet', rows: [['single column'], ['value with, comma']] },
    ]);

    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const sheets = await readSpreadsheet(asFile(blob, 'products.xlsx'));

    expect(sheets).toEqual([
      {
        name: 'Products',
        rows: [
          ['name', 'price', 'stock', 'featured', 'notes'],
          ['Glow Ritual Vitamin C Face Serum', '849', '12', 'TRUE', 'Contains "<b>vitamin C</b>" & aloe'],
          ['Velvet Matte Luxe Liquid Lipstick', '1199.5', '0', 'FALSE', ''],
        ],
      },
      { name: 'Second sheet', rows: [['single column'], ['value with, comma']] },
    ]);
  });

  it('produces a deflate-compressed archive that standard zip tools can read', async () => {
    const blob = await buildWorkbook([{ name: 'Rows', rows: [['a'.repeat(500), 'b'.repeat(500)]] }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 2))).toBe('PK');
    // The six XML parts total 3519 bytes uncompressed, so a smaller archive
    // proves the DEFLATE path ran instead of silently storing everything.
    expect(bytes.length).toBeLessThan(2100);
  });

  it('reads csv uploads including quoted commas, quotes and newlines', () => {
    const rows = parseCsv('name,notes\r\n"Serum, Vitamin C","He said ""hello"""\r\n"Lipstick","Line one\nLine two"\r\n\r\n');
    expect(rows).toEqual([
      ['name', 'notes'],
      ['Serum, Vitamin C', 'He said "hello"'],
      ['Lipstick', 'Line one\nLine two'],
    ]);
  });

  it('maps sheet rows onto header-keyed records for bulk uploads', () => {
    const { headers, records } = sheetToRecords([
      ['name', 'price', 'stock'],
      ['Glow Ritual Serum', '849', '12'],
      ['Velvet Matte Luxe Liquid Lipstick', '1199', '0'],
    ]);
    expect(headers).toEqual(['name', 'price', 'stock']);
    expect(records).toEqual([
      { name: 'Glow Ritual Serum', price: '849', stock: '12' },
      { name: 'Velvet Matte Luxe Liquid Lipstick', price: '1199', stock: '0' },
    ]);
  });

  it('fills gaps left by blank cells and trims header whitespace', () => {
    const { records } = sheetToRecords([
      [' name ', 'price', 'stock'],
      ['Serum', '', '4'],
    ]);
    expect(records).toEqual([{ name: 'Serum', price: '', stock: '4' }]);
  });

  it('rejects files that are not workbooks', async () => {
    await expect(readSpreadsheet(asFile(new Blob(['not a spreadsheet']), 'notes.txt')))
      .rejects.toThrow(/not a readable Excel workbook/i);
  });
});

/**
 * Browsers apply backpressure to `CompressionStream`: the promise returned by
 * `write()` does not settle until the readable side is being drained. Node's
 * implementation buffers eagerly, so the old write-then-read ordering inside
 * `pipeThrough` passed every test in this file while hanging forever in Chrome
 * -- which is why no bulk upload template ever downloaded.
 *
 * These fakes model exactly that one rule. A write only settles once a read has
 * happened, so an implementation that writes before it reads can never resolve
 * and the test times out. The bytes are fake on purpose: this suite asserts the
 * ordering, while the tests above assert archive correctness on real streams.
 */
function withBrowserBackpressure<T>(run: () => Promise<T>) {
  const scope = globalThis as unknown as Record<string, unknown>;
  const real = { compression: scope.CompressionStream, decompression: scope.DecompressionStream };
  const calls: string[] = [];
  let drained = false;

  const fake = () => {
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([0x78, 0x9c, 0x03, 0x00]));
        controller.close();
      },
    });
    const realGetReader = readable.getReader.bind(readable);
    readable.getReader = ((...args: unknown[]) => {
      const reader = realGetReader(...(args as []));
      const realRead = reader.read.bind(reader);
      reader.read = async () => {
        calls.push('read');
        drained = true;
        return realRead();
      };
      return reader;
    }) as ReadableStream<Uint8Array>['getReader'];

    const writable = new WritableStream<BufferSource>({
      write() {
        calls.push('write');
        if (drained) return undefined;
        // A browser holds the write open until the reader drains. Nothing reads
        // in the buggy ordering, so this promise would never settle.
        return new Promise<void>((resolve) => {
          const poll = setInterval(() => {
            if (drained) {
              clearInterval(poll);
              resolve();
            }
          }, 5);
        });
      },
    });
    return { readable, writable };
  };

  const constructor = function Constructed(this: unknown) {
    calls.push('construct');
    return fake();
  };
  scope.CompressionStream = constructor as unknown;
  scope.DecompressionStream = constructor as unknown;

  return run()
    .then((value) => ({ value, calls, drained }))
    .finally(() => {
      scope.CompressionStream = real.compression;
      scope.DecompressionStream = real.decompression;
    });
}

describe('spreadsheet workbooks under browser stream backpressure', () => {
  it('drains the readable side before it waits on a write that cannot settle', async () => {
    const result = await withBrowserBackpressure(() =>
      buildWorkbook([{ name: 'Products', rows: [['name', 'price'], ['Serum', 849]] }]));

    expect(result.drained).toBe(true);
    // The first thing done to each stream is a read, never a write.
    expect(result.calls[1]).toBe('read');
    // And the archive is still a real ZIP: a stalled compressor falls back to
    // storing members rather than failing the download.
    const bytes = new Uint8Array(await (result.value as Blob).arrayBuffer());
    expect(String.fromCharCode(...bytes.subarray(0, 2))).toBe('PK');
  });

  it('drains the readable side of an upload before waiting on the write', async () => {
    const workbook = await buildWorkbook([{ name: 'Jobs', rows: [['title', 'partner'], ['Beautician', 'Blush']] }]);

    // The fake decompressor emits placeholder bytes, so the parse itself is
    // expected to fail. What matters is that it fails fast instead of hanging,
    // which proves the reader was draining while the write was still pending.
    const outcome = await withBrowserBackpressure(() => readSpreadsheet(asFile(workbook, 'jobs.xlsx')))
      .then(() => 'resolved', () => 'rejected');

    expect(outcome).toBe('rejected');
  });
});

describe('template downloads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('attaches the anchor to the document so the click is honoured', () => {
    const clicks: Array<{ inDom: boolean; download: string | null }> = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function patched(this: HTMLAnchorElement) {
      clicks.push({ inDom: document.contains(this), download: this.getAttribute('download') });
    };

    downloadBlob(new Blob(['a,b'], { type: 'text/csv' }), 'glow-and-grace-products-template.xlsx');

    expect(clicks).toEqual([{ inDom: true, download: 'glow-and-grace-products-template.xlsx' }]);
    // The node is cleaned up again so it cannot pile up in the document.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
    HTMLAnchorElement.prototype.click = original;
  });

  it('revokes the object URL only after the download has had a turn to start', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const realCreate = URL.createObjectURL.bind(URL);
    const realRevoke = URL.revokeObjectURL.bind(URL);
    const anchorProto = HTMLAnchorElement.prototype;
    const originalClick = anchorProto.click;
    URL.createObjectURL = () => { order.push('create'); return realCreate(new Blob(['x'])); };
    URL.revokeObjectURL = (url) => { order.push('revoke'); return realRevoke(url); };
    anchorProto.click = function patched() { order.push('click'); };

    downloadBlob(new Blob(['a,b'], { type: 'text/csv' }), 'orders.csv');
    // Revoking inline tears the blob down before the browser reads it, which is
    // what made the download silently do nothing.
    expect(order).toEqual(['create', 'click']);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(order).toEqual(['create', 'click', 'revoke']);

    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
    anchorProto.click = originalClick;
    vi.useRealTimers();
  });
});
