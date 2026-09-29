import { cleanup, configure } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, vi } from 'vitest';

// `waitFor` gives up after one second by default, which is fine for a unit test
// but not for a page that has to resolve a dozen requests and re-render before
// its first assertion can match. Anything slower was failing intermittently.
configure({ asyncUtilTimeout: 10000 });

// jsdom's Blob has no arrayBuffer()/stream(), which every current browser does
// have. Node's implementation is spec-identical, so use it to keep file handling
// in tests faithful to the browser.
if (typeof globalThis.Blob === 'undefined' || !('arrayBuffer' in Blob.prototype)) {
  vi.stubGlobal('Blob', NodeBlob);
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());
