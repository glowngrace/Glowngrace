import { useEffect, useRef, useState } from 'react';

/**
 * The formatting toolbar above a product text field.
 *
 * The editable area is a real `contenteditable` region, and a hidden textarea
 * beside it carries the same HTML under the field's `name`. That means the form
 * is submitted with `FormData` exactly as it was when these were plain textareas,
 * so nothing downstream had to change to read rich text.
 *
 * The buttons are text rather than icons: they are the letters and marks the
 * formatting is known by, and it keeps the shared admin icon set untouched.
 */
const commands = [
  { command: 'bold', label: 'Bold', glyph: 'B', className: 'is-bold' },
  { command: 'italic', label: 'Italic', glyph: 'I', className: 'is-italic' },
  { command: 'underline', label: 'Underline', glyph: 'U', className: 'is-underline' },
  { command: 'insertUnorderedList', label: 'Bulleted list', glyph: '•—', className: '' },
  { command: 'insertOrderedList', label: 'Numbered list', glyph: '1.', className: '' },
] as const;

type RichTextFieldProps = {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  hint?: string;
};

export function RichTextField({ name, label, defaultValue = '', placeholder, required, rows = 4, hint }: RichTextFieldProps) {
  const editor = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(defaultValue);

  // The editable region is not a controlled input, so its starting HTML is
  // written once from the stored value rather than on every render.
  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== defaultValue) editor.current.innerHTML = defaultValue;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = () => {
    const html = editor.current?.innerHTML ?? '';
    // An emptied contenteditable still reports a `<br>`, which would count as
    // content; treat that as an empty field so the server stores nothing.
    const cleaned = html.replace(/<br\s*\/?>/gi, '').trim() === '' ? '' : html;
    setValue(cleaned);
  };

  const run = (command: string) => {
    editor.current?.focus();
    document.execCommand(command);
    sync();
  };

  return (
    <div className="admin-field">
      <label className="admin-rte-label" htmlFor={`rte-${name}`}>{label}</label>
      <div className="admin-rte">
        <div className="admin-rte-bar" role="toolbar" aria-label={`${label} formatting`}>
          {commands.map((item) => (
            <button
              key={item.command}
              type="button"
              className={`admin-rte-btn ${item.className}`}
              title={item.label}
              aria-label={item.label}
              onMouseDown={(event) => { event.preventDefault(); run(item.command); }}
            >
              {item.glyph}
            </button>
          ))}
        </div>
        <div
          id={`rte-${name}`}
          ref={editor}
          className="admin-rte-area"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={label}
          data-placeholder={placeholder}
          style={{ minHeight: `${Math.max(rows, 2) * 1.5}rem` }}
          onInput={sync}
          onBlur={sync}
          onPaste={(event) => {
            // Pasted markup arrives as styled HTML from another site, so only the
            // text is taken. Formatting is applied with the toolbar instead.
            event.preventDefault();
            const text = event.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
            sync();
          }}
        />
        <textarea name={name} value={value} required={required} readOnly className="admin-rte-source" aria-hidden="true" tabIndex={-1} />
      </div>
      {hint && <p className="admin-rte-hint">{hint}</p>}
    </div>
  );
}
