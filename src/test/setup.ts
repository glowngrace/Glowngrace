import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, vi } from 'vitest';

// jsdom's Blob has no arrayBuffer()/stream(), which every current browser does
// have. Node's implementation is spec-identical, so use it to keep file handling
// in tests faithful to the browser.
if (typeof globalThis.Blob === 'undefined' || !('arrayBuffer' in Blob.prototype)) {
  vi.stubGlobal('Blob', NodeBlob);
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());
