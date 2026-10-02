import type { ReactNode } from 'react';
import { parseRichText, type RichTextNode } from '../lib/rich-text';

/**
 * Shows product copy that was edited with the console's rich text editor.
 *
 * The stored HTML was reduced to an allow list when it was saved, and this builds
 * React elements from that list rather than handing a string to the DOM. So even a
 * stored value that somehow carried markup the sanitiser did not expect would be
 * shown as text, not run.
 */
function renderNodes(nodes: RichTextNode[]): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.kind}-${index}`;
    switch (node.kind) {
      case 'text': return <span key={key}>{node.value}</span>;
      case 'break': return <br key={key} />;
      case 'paragraph': return <p key={key}>{renderNodes(node.children)}</p>;
      case 'strong': return <strong key={key}>{renderNodes(node.children)}</strong>;
      case 'emphasis': return <em key={key}>{renderNodes(node.children)}</em>;
      case 'underline': return <u key={key}>{renderNodes(node.children)}</u>;
      case 'strike': return <s key={key}>{renderNodes(node.children)}</s>;
      case 'link': return <a key={key} href={node.href} rel="noreferrer">{renderNodes(node.children)}</a>;
      case 'item': return <li key={key}>{renderNodes(node.children)}</li>;
      case 'list': {
        const List = node.ordered ? 'ol' : 'ul';
        return <List key={key}>{node.items.map((item, itemIndex) => <li key={itemIndex}>{renderNodes(item)}</li>)}</List>;
      }
      default: return null;
    }
  });
}

export function RichText({ html, className }: { html: string | undefined; className?: string }) {
  if (!html) return null;
  return <div className={className}>{renderNodes(parseRichText(html))}</div>;
}
