import { describe, expect, it } from 'vitest';
import { buildWorkbook, parseCsv, readSpreadsheet, sheetToRecords } from './xlsx';

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
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('PK');
    // The six XML parts total 3519 bytes uncompressed, so a smaller archive
    // proves the DEFLATE path ran instead of silently storing everything.
    expect(bytes.length).toBeLessThan(2100);
  });

  it('reads csv uploads including quoted commas, quotes and newlines', async () => {
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
