import { describe, expect, it } from 'vitest';
import { parseRichText, richTextToPlainText, safeHref, sanitizeRichText } from './rich-text';

describe('sanitizeRichText', () => {
  it('leaves plain copy alone apart from turning line breaks into breaks', () => {
    expect(sanitizeRichText('A weightless, non-drying matte.')).toBe('A weightless, non-drying matte.');
    expect(sanitizeRichText('Long-wearing\nWaterproof')).toBe('Long-wearing<br>Waterproof');
  });

  it('keeps the formatting the console toolbar can produce', () => {
    expect(sanitizeRichText('<b>Bold</b> and <i>italic</i>')).toBe('<b>Bold</b> and <i>italic</i>');
    expect(sanitizeRichText('<ul><li>One</li><li>Two</li></ul>')).toBe('<ul><li>One</li><li>Two</li></ul>');
    expect(sanitizeRichText('<a href="https://example.com">Visit</a>')).toBe('<a href="https://example.com">Visit</a>');
  });

  it('drops a script and everything inside it', () => {
    expect(sanitizeRichText('Before<script>alert(1)</script>After')).toBe('BeforeAfter');
    expect(sanitizeRichText('<style>body{display:none}</style>Copy')).toBe('Copy');
    expect(sanitizeRichText('<iframe src="https://evil.example"></iframe>Copy')).toBe('Copy');
  });

  it('drops event handlers and other attributes that are not on the allow list', () => {
    expect(sanitizeRichText('<b onclick="alert(1)">Bold</b>')).toBe('<b>Bold</b>');
    expect(sanitizeRichText('<a href="https://example.com" target="_blank">Visit</a>')).toBe('<a href="https://example.com">Visit</a>');
  });

  it('refuses a link that would run code, keeping the words', () => {
    expect(sanitizeRichText('<a href="javascript:alert(1)">Click</a>')).toBe('Click');
    expect(sanitizeRichText('<a href="JaVaScRiPt:alert(1)">Click</a>')).toBe('Click');
    // Entities are decoded before the check, so this is javascript: too.
    expect(sanitizeRichText('<a href="&#106;avascript:alert(1)">Click</a>')).toBe('Click');
    expect(sanitizeRichText('<a href="data:text/html;base64,PHNjcmlwdD4=">Click</a>')).toBe('Click');
  });

  it('escapes text that merely looks like markup', () => {
    expect(sanitizeRichText('5 < 6 & 7 > 3')).toBe('5 &lt; 6 &amp; 7 &gt; 3');
    expect(sanitizeRichText('<not-a-tag>Copy</not-a-tag>')).toBe('Copy');
  });

  it('closes tags the operator left open instead of losing the copy', () => {
    expect(sanitizeRichText('<b>Unfinished')).toBe('<b>Unfinished</b>');
    expect(sanitizeRichText('Close</b>')).toBe('Close');
  });
});

describe('safeHref', () => {
  it('accepts the schemes a shopper could follow on purpose', () => {
    expect(safeHref('https://example.com/x')).toBe('https://example.com/x');
    expect(safeHref('mailto:care@example.com')).toBe('mailto:care@example.com');
    expect(safeHref('/shop')).toBe('/shop');
    expect(safeHref('#details')).toBe('#details');
    expect(safeHref('example.com')).toBe('example.com');
  });

  it('rejects anything that is not one of those', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('vbscript:msgbox(1)')).toBeNull();
    expect(safeHref('   ')).toBeNull();
  });
});

describe('parseRichText', () => {
  it('reads formatting back into elements', () => {
    expect(parseRichText('<b>Bold</b> and <i>italic</i>')).toEqual([
      { kind: 'strong', children: [{ kind: 'text', value: 'Bold' }] },
      { kind: 'text', value: ' and ' },
      { kind: 'emphasis', children: [{ kind: 'text', value: 'italic' }] },
    ]);
  });

  it('files each list item under its list', () => {
    expect(parseRichText('<ul><li>One</li><li>Two</li></ul>')).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [[{ kind: 'text', value: 'One' }], [{ kind: 'text', value: 'Two' }]],
      },
    ]);
  });

  it('keeps a link and its words', () => {
    expect(parseRichText('<a href="https://example.com">Visit</a>')).toEqual([
      { kind: 'link', href: 'https://example.com', children: [{ kind: 'text', value: 'Visit' }] },
    ]);
  });
});

describe('richTextToPlainText', () => {
  it('flattens formatting for meta tags and plain-text email', () => {
    expect(richTextToPlainText('<b>Bold</b> and <i>italic</i>')).toBe('Bold and italic');
    expect(richTextToPlainText('One<br>Two')).toBe('One\nTwo');
  });
});
