import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { iconPaths, statusTone, type IconName } from './AdminData';

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ?? 'admin-icon'} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={iconPaths[name]} />
    </svg>
  );
}

export function Seal() {
  return <img className="admin-seal" src="/images/logo_mark.png" alt="" aria-hidden="true" />;
}

export function Pill({ label }: { label: string }) {
  return <span className={`admin-pill is-${statusTone(label)}`}>{label}</span>;
}

export function Stars({ rating }: { rating: number }) {
  const full = Math.floor(rating);
  return (
    <span className="admin-stars" title={`${rating.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <Icon key={index} className={index <= full ? 'admin-star is-on' : 'admin-star'} name="star" />
      ))}
    </span>
  );
}

export function Avatar({ src, name, round = false }: { src?: string; name: string; round?: boolean }) {
  const initials = name.split(' ').map((part) => part[0]).slice(0, 2).join('');
  return (
    <span className={round ? 'admin-avatar is-round' : 'admin-avatar'}>
      {src
        ? <img src={src} alt="" loading="lazy" />
        : <span aria-hidden="true">{initials}</span>}
    </span>
  );
}

export function PageHead({ crumb, title, sub, actions }: { crumb: string; title: string; sub: string; actions?: ReactNode }) {
  return (
    <header className="admin-page-head">
      <div>
        <p className="admin-crumb"><span>Workspace</span><Icon name="arrow" className="admin-crumb-arrow" />{crumb}</p>
        <h1>{title}</h1>
        <p className="admin-sub">{sub}</p>
      </div>
      {actions && <div className="admin-head-actions">{actions}</div>}
    </header>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `admin-panel ${className}` : 'admin-panel'}>{children}</section>;
}

export function PanelHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="admin-panel-head">
      <div>
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub, icon, tone = 'plain', onClick }: { label: string; value: string; sub?: string; icon: IconName; tone?: 'plain' | 'rose' | 'gold'; onClick?: () => void }) {
  const content = (
    <>
      <span className="admin-stat-top">
        <span className="admin-stat-label">{label}</span>
        <span className={`admin-stat-icon is-${tone}`}><Icon name={icon} /></span>
      </span>
      <strong className="admin-stat-value">{value}</strong>
      {sub && <span className="admin-stat-sub">{sub}</span>}
    </>
  );
  if (!onClick) return <article className="admin-stat">{content}</article>;
  return <button className="admin-stat is-button" type="button" onClick={onClick}>{content}</button>;
}

export function DataTable({ head, children, minWidth = 880 }: { head: string[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="admin-table-scroll">
      <table className="admin-table" style={{ minWidth }}>
        <thead>
          <tr>{head.map((cell) => <th key={cell} scope="col">{cell}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function FilterBar({ options, value, onChange, search, onSearch, placeholder, children }: {
  options: string[];
  value: string;
  onChange: (next: string) => void;
  search?: string;
  onSearch?: (next: string) => void;
  placeholder?: string;
  children?: ReactNode;
}) {
  const searchId = useId();
  return (
    <div className="admin-filters">
      <div className="admin-chips">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={option === value ? 'admin-chip is-active' : 'admin-chip'}
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {onSearch && (
        <div className="admin-search">
          <Icon name="search" className="admin-search-icon" />
          <label className="sr-only" htmlFor={searchId}>{placeholder ?? 'Search'}</label>
          <input id={searchId} type="search" value={search ?? ''} placeholder={placeholder ?? 'Search'} onChange={(event) => onSearch(event.target.value)} />
        </div>
      )}
      {children}
    </div>
  );
}

export function Empty({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="admin-empty">
      <Icon name="box" className="admin-empty-icon" />
      <p>{message}</p>
      {action}
    </div>
  );
}

export function IconButton({ label, icon, onClick, danger = false, disabled = false }: { label: string; icon: IconName; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={danger ? 'admin-icon-btn is-danger' : 'admin-icon-btn'}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    cardRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="admin-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={cardRef}>
        <div className="admin-modal-head">
          <h2 id={titleId}>{title}</h2>
          <IconButton label={`Close ${title}`} icon="plus" onClick={onClose} />
        </div>
        <div className="admin-modal-body">{children}</div>
        {footer && <div className="admin-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 4000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className="admin-toast" role="status">
      <span className="admin-toast-check"><Icon name="check" /></span>
      <span>{message}</span>
      <button type="button" className="admin-toast-close" onClick={onDismiss} aria-label="Dismiss notification">×</button>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={checked ? 'admin-switch is-on' : 'admin-switch'}
      onClick={() => onChange(!checked)}
    >
      <span className="admin-switch-knob" />
    </button>
  );
}

export function ChipRow({ options, value, onChange, label }: { options: string[]; value: string[]; onChange: (next: string[]) => void; label: string }) {
  return (
    <div className="admin-chip-row" role="group" aria-label={label}>
      {options.map((option) => {
        const active = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            className={active ? 'admin-chip is-active' : 'admin-chip'}
            onClick={() => onChange(active ? value.filter((entry) => entry !== option) : [...value, option])}
          >
            {active && <Icon name="check" className="admin-chip-check" />}
            {option}
          </button>
        );
      })}
    </div>
  );
}

export function TagInput({ tags, onChange, placeholder = 'Add and press Enter' }: { tags: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');

  function commit() {
    const next = draft.trim();
    if (!next || tags.includes(next)) {
      setDraft('');
      return;
    }
    onChange([...tags, next]);
    setDraft('');
  }

  return (
    <div className="admin-tags">
      {tags.map((tag) => (
        <span className="admin-tag" key={tag}>
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(tags.filter((entry) => entry !== tag))}>×</button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
      />
    </div>
  );
}

export function StarInput({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  return (
    <div className="admin-star-input" role="group" aria-label="Rating out of 5">
      {[1, 2, 3, 4, 5].map((index) => (
        <button
          key={index}
          type="button"
          aria-label={`${index} star${index > 1 ? 's' : ''}`}
          aria-pressed={index <= value}
          onClick={() => onChange(index)}
        >
          <Icon name="star" className={index <= value ? 'admin-star is-on' : 'admin-star'} />
        </button>
      ))}
      <span className="admin-star-caption">{value ? `${value}.0` : 'Not rated'}</span>
    </div>
  );
}
