/**
 * Minimal, dependency-free spreadsheet support.
 *
 * The admin console offers Excel templates for every bulk upload, so the browser
 * needs to both write and read real .xlsx workbooks. XLSX is a ZIP of XML parts,
 * which means the platform's own DEFLATE streams are enough — no third-party
 * spreadsheet library (and no prototype-pollution advisories) required.
 */

export type SpreadsheetCell = string | number | boolean | null | undefined;
export type SpreadsheetSheet = { name: string; rows: SpreadsheetCell[][] };
export type Spreadsheet = { name: string; rows: string[][] }[];

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const COMPRESSION_FALLBACK_MS = 4000;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function hasCompressionStreams() {
  return typeof DecompressionStream === 'function' && typeof CompressionStream === 'function';
}

/**
 * Feeds `bytes` through a compression or decompression stream.
 *
 * The readable side has to be drained *concurrently* with the write. Browsers
 * apply backpressure: the transform holds the write open until its output queue
 * is consumed, so awaiting `writer.write()` before anybody reads `readable`
 * deadlocks and the promise never settles. Draining first is what makes
 * templates and uploads work in a real browser.
 */
async function pipeThrough(bytes: Uint8Array, transform: CompressionStream | DecompressionStream) {
  const reader = (transform.readable as ReadableStream<Uint8Array>).getReader();
  const drained = (async () => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        length += value.length;
      }
    }
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return joined;
  })();

  try {
    const writer = (transform.writable as WritableStream<BufferSource>).getWriter();
    await writer.write(bytes as BufferSource);
    await writer.close();
  } catch (error) {
    // A failed write still has to stop the reader, otherwise the drain below
    // would wait forever on a stream nobody will ever close.
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }

  return drained;
}

function deflate(bytes: Uint8Array) {
  return pipeThrough(bytes, new CompressionStream('deflate-raw'));
}

function inflate(bytes: Uint8Array) {
  return pipeThrough(bytes, new DecompressionStream('deflate-raw'));
}

/**
 * Compresses an archive member, falling back to a stored (uncompressed) member
 * if the platform's compressor is slow to settle. A stored member is still a
 * valid .xlsx, so a stalled stream degrades the file size instead of leaving
 * the operator with no template at all.
 */
async function compressOrStore(bytes: Uint8Array) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), COMPRESSION_FALLBACK_MS);
  });
  try {
    const compressed = await Promise.race([deflate(bytes), timeout]);
    return compressed ? { method: 8, payload: compressed } : { method: 0, payload: bytes };
  } catch {
    return { method: 0, payload: bytes };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function dosDateTime(date: Date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

async function zip(entries: Array<{ name: string; bytes: Uint8Array }>) {
  if (!hasCompressionStreams()) {
    throw new Error('This browser cannot create Excel files. Use a current version of Chrome, Edge, Safari or Firefox.');
  }
  const stamp = dosDateTime(new Date());
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const compressed = await compressOrStore(entry.bytes);
    let method = compressed.method;
    let payload: Uint8Array = compressed.payload;
    if (method === 8 && payload.length >= entry.bytes.length) {
      method = 0;
      payload = entry.bytes;
    }
    const checksum = crc32(entry.bytes);
    const header = new Uint8Array(30 + name.length);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x04034b50, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 0, true);
    headerView.setUint16(8, method, true);
    headerView.setUint16(10, stamp.time, true);
    headerView.setUint16(12, stamp.day, true);
    headerView.setUint32(14, checksum, true);
    headerView.setUint32(18, payload.length, true);
    headerView.setUint32(22, entry.bytes.length, true);
    headerView.setUint16(26, name.length, true);
    headerView.setUint16(28, 0, true);
    header.set(name, 30);
    local.push(header, payload);

    const directory = new Uint8Array(46 + name.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(10, method, true);
    directoryView.setUint16(12, stamp.time, true);
    directoryView.setUint16(14, stamp.day, true);
    directoryView.setUint32(16, checksum, true);
    directoryView.setUint32(20, payload.length, true);
    directoryView.setUint32(24, entry.bytes.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint32(42, offset, true);
    directory.set(name, 46);
    central.push(directory);
    offset += header.length + payload.length;
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const parts = [...local, ...central, end];
  const size = parts.reduce((total, part) => total + part.length, 0);
  const archive = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) {
    archive.set(part, cursor);
    cursor += part.length;
  }
  return archive;
}

function stripControlChars(value: string) {
  let output = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
    output += character;
  }
  return output;
}

function escapeXml(value: string) {
  return stripControlChars(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function columnName(index: number) {
  let name = '';
  let remaining = index;
  do {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return name;
}

function cellXml(reference: string, value: SpreadsheetCell) {
  if (value === null || value === undefined || value === '') return `<c r="${reference}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${reference}"><v>${value}</v></c>`;
  if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function sheetXml(rows: SpreadsheetCell[][]) {
  const body = rows
    .map((row, rowIndex) => `<row r="${rowIndex + 1}">${row
      .map((value, columnIndex) => cellXml(`${columnName(columnIndex)}${rowIndex + 1}`, value))
      .join('')}</row>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function safeSheetName(name: string, index: number) {
  const cleaned = name.replaceAll(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31);
  return cleaned || `Sheet${index + 1}`;
}

export async function buildWorkbook(sheets: SpreadsheetSheet[]) {
  const used = sheets.length === 0 ? [{ name: 'Sheet1', rows: [[]] }] : sheets;
  const names = used.map((sheet, index) => safeSheetName(sheet.name, index));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names
    .map((_name, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
    .map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('')}</sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
    .map((_name, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join('')}</Relationships>`;

  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Glow &amp; Grace bulk upload template</dc:title><dc:creator>Glow &amp; Grace admin console</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`;

  const entries = [
    { name: '[Content_Types].xml', bytes: encoder.encode(contentTypes) },
    { name: '_rels/.rels', bytes: encoder.encode(rootRels) },
    { name: 'docProps/core.xml', bytes: encoder.encode(core) },
    { name: 'xl/workbook.xml', bytes: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: encoder.encode(workbookRels) },
    ...used.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, bytes: encoder.encode(sheetXml(sheet.rows)) })),
  ];

  return new Blob([await zip(entries) as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

type ZipEntry = { name: string; method: number; compressedSize: number; uncompressedSize: number; localOffset: number };

function readZipDirectory(bytes: Uint8Array) {
  let end = -1;
  for (let index = bytes.length - 22; index >= 0 && index > bytes.length - 22 - 65536; index -= 1) {
    if (bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 0x05 && bytes[index + 3] === 0x06) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error('That file is not a readable Excel workbook.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    entries.push({
      name: decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength)),
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      uncompressedSize: view.getUint32(cursor + 24, true),
      localOffset: view.getUint32(cursor + 42, true),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipFile(bytes: Uint8Array, entry: ZipEntry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.localOffset, true) !== 0x04034b50) throw new Error('That workbook is damaged.');
  const nameLength = view.getUint16(entry.localOffset + 26, true);
  const extraLength = view.getUint16(entry.localOffset + 28, true);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const payload = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return payload;
  if (entry.method !== 8) throw new Error('That workbook uses an unsupported compression method.');
  if (!hasCompressionStreams()) {
    throw new Error('This browser cannot read Excel files. Use a current version of Chrome, Edge, Safari or Firefox.');
  }
  return inflate(payload);
}

function parseXml(text: string) {
  return new DOMParser().parseFromString(text, 'application/xml');
}

function cellText(cell: Element, shared: string[]) {
  const type = cell.getAttribute('t');
  if (type === 'inlineStr') {
    return Array.from(cell.getElementsByTagName('t')).map((node) => node.textContent ?? '').join('');
  }
  const value = cell.getElementsByTagName('v')[0]?.textContent ?? '';
  if (type === 's') return shared[Number(value)] ?? '';
  if (type === 'b') return value === '1' ? 'TRUE' : 'FALSE';
  return value;
}

function columnIndex(reference: string) {
  let index = 0;
  for (const character of reference.replaceAll(/\d/g, '')) {
    index = index * 26 + (character.toUpperCase().charCodeAt(0) - 64);
  }
  return Math.max(index - 1, 0);
}

function parseSheet(xml: string, shared: string[]) {
  const document_ = parseXml(xml);
  const rows: string[][] = [];
  for (const row of Array.from(document_.getElementsByTagName('row'))) {
    const rowIndex = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
    const cells: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName('c'))) {
      const reference = cell.getAttribute('r') ?? '';
      cells[columnIndex(reference)] = cellText(cell, shared);
    }
    rows[rowIndex] = Array.from(cells, (value) => value ?? '');
  }
  for (let index = 0; index < rows.length; index += 1) rows[index] ??= [];
  return rows;
}

function parseSharedStrings(xml: string) {
  return Array.from(parseXml(xml).getElementsByTagName('si')).map((entry) => Array.from(entry.getElementsByTagName('t'))
    .map((node) => node.textContent ?? '').join(''));
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (character !== '\r') {
      cell += character;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ''));
}

export async function readSpreadsheet(file: Blob & { name?: string }): Promise<Spreadsheet> {
  const name = file.name?.toLowerCase() ?? '';
  if (name.endsWith('.csv') || file.type === 'text/csv') {
    return [{ name: 'Rows', rows: parseCsv(decoder.decode(await file.arrayBuffer())) }];
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const directory = readZipDirectory(bytes);
  const parts = new Map<string, ZipEntry>();
  for (const entry of directory) parts.set(entry.name, entry);

  const workbookEntry = parts.get('xl/workbook.xml');
  if (!workbookEntry) throw new Error('That file is not a readable Excel workbook.');
  const workbookXml = decoder.decode(await readZipFile(bytes, workbookEntry));
  const relsXml = parts.get('xl/_rels/workbook.xml.rels')
    ? decoder.decode(await readZipFile(bytes, parts.get('xl/_rels/workbook.xml.rels')!))
    : '';
  const sharedXml = parts.get('xl/sharedStrings.xml')
    ? decoder.decode(await readZipFile(bytes, parts.get('xl/sharedStrings.xml')!))
    : '';
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const relationships = new Map<string, string>();
  for (const relationship of Array.from(parseXml(relsXml).getElementsByTagName('Relationship'))) {
    relationships.set(relationship.getAttribute('Id') ?? '', relationship.getAttribute('Target') ?? '');
  }

  const sheets: Spreadsheet = [];
  for (const sheet of Array.from(parseXml(workbookXml).getElementsByTagName('sheet'))) {
    const id = sheet.getAttribute('r:id') ?? sheet.getAttribute('id') ?? '';
    const target = relationships.get(id) ?? `worksheets/${id.replace('rId', 'sheet')}.xml`;
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    const entry = parts.get(path);
    if (!entry) continue;
    const rows = parseSheet(decoder.decode(await readZipFile(bytes, entry)), shared);
    sheets.push({ name: sheet.getAttribute('name') ?? `Sheet${sheets.length + 1}`, rows });
  }
  if (sheets.length === 0) throw new Error('That workbook has no readable sheets.');
  return sheets;
}

/**
 * Turns the header row and data rows of a sheet into objects keyed by the
 * header text, which is exactly what the bulk upload endpoints expect.
 */
export function sheetToRecords(rows: string[][]) {
  const [header, ...body] = rows;
  if (!header) return { headers: [], records: [] };
  const headers = header.map((value) => value.trim());
  const records = body
    .filter((row) => row.some((value) => String(value ?? '').trim() !== ''))
    .map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((key, index) => {
        if (!key) return;
        record[key] = String(row[index] ?? '').trim();
      });
      return record;
    });
  return { headers, records };
}

/**
 * Saves a generated file to the shopper's downloads folder.
 *
 * The anchor is attached to the document because some browsers ignore a click
 * on a detached node, and the object URL is revoked on a later turn of the
 * event loop: revoking it inline can tear the blob down before the download has
 * started reading it, which is exactly how the template download used to fail
 * with no error at all.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
