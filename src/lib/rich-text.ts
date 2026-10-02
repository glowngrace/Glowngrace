/**
 * Rich text for the product fields.
 *
 * The console edits product copy with a small formatting toolbar. That copy is
 * stored as HTML and later shown on the product page, so it has to be reduced to
 * a known, harmless set of tags before it is ever stored - not when it is
 * rendered. Sanitising on write means a bad string can never reach the database,
 * and it also means the renderer below only ever has to understand tags that this
 * file already agreed to allow.
 *
 * Both sides share the tokenizer here: the server filters its output into safe
 * HTML, and the browser turns that same safe HTML into React elements. Because
 * the renderer builds elements itself it never assigns an HTML string to the DOM.
 */

/** Tags kept as-is. Everything else is unwrapped, keeping the text inside it. */
export const richTextTags = ['b', 'strong', 'i', 'em', 'u', 's', 'br', 'p', 'div', 'ul', 'ol', 'li', 'a'] as const;

export type RichTextTag = typeof richTextTags[number];

/**
 * Dropped together with everything between the tags. Their content is code or
 * styling rather than copy, so keeping the text would leak a stylesheet or a
 * script body into the page as visible nonsense.
 */
const voidedContentTags = ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript'];

const voidTags = new Set<string>(['br']);

const allowedTags = new Set<string>(richTextTags);

export type RichTextNode =
  | { kind: 'text'; value: string }
  | { kind: 'break' }
  | { kind: 'paragraph'; children: RichTextNode[] }
  | { kind: 'list'; ordered: boolean; items: RichTextNode[][] }
  | { kind: 'item'; children: RichTextNode[] }
  | { kind: 'strong'; children: RichTextNode[] }
  | { kind: 'emphasis'; children: RichTextNode[] }
  | { kind: 'underline'; children: RichTextNode[] }
  | { kind: 'strike'; children: RichTextNode[] }
  | { kind: 'link'; href: string; children: RichTextNode[] };

type Token =
  | { type: 'text'; value: string }
  | { type: 'open'; name: string; href?: string }
  | { type: 'close'; name: string };

const namedEntities: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return namedEntities[body.toLowerCase()] ?? match;
  });
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character] ?? character
  ));
}

/**
 * A link may only point somewhere a reader could follow on purpose. Everything
 * else, `javascript:` above all, is dropped so the href cannot run code.
 */
export function safeHref(value: string): string | null {
  // Entities are decoded first, so `&#106;avascript:` cannot slip past the check.
  // Control characters are exactly what this strips, so the check is intentional.
  // eslint-disable-next-line no-control-regex
  const href = decodeEntities(value).replace(/[\u0000-\u0020\u007f]/g, '').trim();
  if (!href) return null;
  if (href.startsWith('#') || href.startsWith('/')) return href;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(href);
  if (!scheme) return href;
  const allowed = ['http', 'https', 'mailto', 'tel'];
  return allowed.includes(scheme[1].toLowerCase()) ? href : null;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  const pushText = (value: string) => {
    if (value) tokens.push({ type: 'text', value });
  };

  while (index < source.length) {
    const open = source.indexOf('<', index);
    if (open === -1) {
      pushText(source.slice(index));
      break;
    }
    pushText(source.slice(index, open));

    if (source.startsWith('<!--', open)) {
      const end = source.indexOf('-->', open + 4);
      index = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<!', open) || source.startsWith('<?', open)) {
      const end = source.indexOf('>', open);
      index = end === -1 ? source.length : end + 1;
      continue;
    }

    const match = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([\s\S]*?)(\/?)\s*>/.exec(source.slice(open));
    if (!match) {
      // A `<` that does not start a tag is just a character someone typed.
      pushText('<');
      index = open + 1;
      continue;
    }

    const [, closing, rawName, rawAttributes, selfClosing] = match;
    const name = rawName.toLowerCase();
    index = open + match[0].length;

    if (!closing && voidedContentTags.includes(name)) {
      // Skip to the matching close tag so the body goes with it.
      const end = new RegExp(`</\\s*${name}\\s*>`, 'i').exec(source.slice(index));
      index = end ? index + end.index + end[0].length : source.length;
      continue;
    }
    if (!allowedTags.has(name)) continue;

    if (closing) {
      tokens.push({ type: 'close', name });
      continue;
    }

    if (name === 'a') {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(rawAttributes);
      const value = href?.[1] ?? href?.[2] ?? href?.[3] ?? '';
      const safe = safeHref(value);
      if (safe) tokens.push({ type: 'open', name, href: safe });
      // An unsafe link is left as plain text rather than dropped with its words.
      continue;
    }

    tokens.push({ type: 'open', name });
    // `<br>` has no closing tag of its own; anything else self-closed is closed
    // here so the tag stack cannot be left holding a tag that never ends.
    if (voidTags.has(name) || selfClosing) tokens.push({ type: 'close', name });
  }

  return tokens;
}

/**
 * Reduces arbitrary input to the allowed tags. Newlines become `<br>` so a plain
 * spreadsheet cell keeps its line breaks once it is stored as HTML.
 */
export function sanitizeRichText(source: string): string {
  const tokens = tokenize(source);
  const open: string[] = [];
  let html = '';

  for (const token of tokens) {
    if (token.type === 'text') {
      // Each line the operator typed stays a line break, blank lines included.
      html += escapeHtml(token.value).replace(/\r?\n/g, '<br>');
      continue;
    }
    if (token.type === 'open') {
      if (voidTags.has(token.name)) {
        html += '<br>';
        continue;
      }
      if (token.name === 'a') html += `<a href="${escapeHtml(token.href ?? '')}">`;
      else html += `<${token.name}>`;
      open.push(token.name);
      continue;
    }
    const index = open.lastIndexOf(token.name);
    // An unmatched close tag, or one for a tag already closed, is ignored.
    if (index === -1) continue;
    // Close anything left open inside it so the output stays balanced.
    for (let depth = open.length - 1; depth >= index; depth -= 1) html += `</${open[depth]}>`;
    open.length = index;
  }

  for (let depth = open.length - 1; depth >= 0; depth -= 1) html += `</${open[depth]}>`;
  return html;
}

/** Turns stored HTML into plain elements. Only the allowed tags can appear. */
export function parseRichText(source: string): RichTextNode[] {
  const root: RichTextNode[] = [];
  type Frame = { name: string; children: RichTextNode[]; items?: RichTextNode[][] };
  const stack: Frame[] = [{ name: '#root', children: root }];
  const top = () => stack[stack.length - 1];

  for (const token of tokenize(source)) {
    if (token.type === 'text') {
      const lines = token.value.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (index > 0) top().children.push({ kind: 'break' });
        if (line) top().children.push({ kind: 'text', value: line });
      });
      continue;
    }
    if (token.type === 'open') {
      if (voidTags.has(token.name)) {
        top().children.push({ kind: 'break' });
        continue;
      }
      const isList = token.name === 'ul' || token.name === 'ol';
      const children: RichTextNode[] = [];
      const items: RichTextNode[][] = [];
      const node: RichTextNode = isList
        ? { kind: 'list', ordered: token.name === 'ol', items }
        : createNode(token.name, token.href, children);
      top().children.push(node);
      stack.push({ name: token.name, children, ...(isList ? { items } : {}) });
      continue;
    }
    const index = stack.map((frame) => frame.name).lastIndexOf(token.name);
    if (index <= 0) continue;
    const finished = stack[index];
    // A finished list item belongs to the list around it, so it is filed there
    // rather than left as a loose child of the list.
    if (token.name === 'li') stack[index - 1].items?.push(finished.children);
    stack.length = index;
  }

  return root;
}

function createNode(name: string, href: string | undefined, children: RichTextNode[]): RichTextNode {
  switch (name) {
    case 'strong': case 'b': return { kind: 'strong', children };
    case 'em': case 'i': return { kind: 'emphasis', children };
    case 'u': return { kind: 'underline', children };
    case 's': return { kind: 'strike', children };
    case 'p': case 'div': return { kind: 'paragraph', children };
    case 'ul': return { kind: 'list', ordered: false, items: [] };
    case 'ol': return { kind: 'list', ordered: true, items: [] };
    case 'li': return { kind: 'item', children };
    case 'a': return { kind: 'link', href: href ?? '#', children };
    default: return { kind: 'paragraph', children };
  }
}

/** Plain copy with the formatting taken back out, for meta tags and emails. */
export function richTextToPlainText(source: string): string {
  const parts: string[] = [];
  const walk = (nodes: RichTextNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'text') parts.push(node.value);
      else if (node.kind === 'break') parts.push('\n');
      else if (node.kind === 'item') parts.push('• ');
      else if ('children' in node) walk(node.children);
      else if (node.kind === 'list') node.items.forEach(walk);
    }
  };
  walk(parseRichText(source));
  return parts.join('');
}
