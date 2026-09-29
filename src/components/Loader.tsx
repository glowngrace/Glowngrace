/**
 * The one loading primitive for the whole application.
 *
 * Everything that waits — the storefront page gate, the catalogue, the admin
 * console and every form — renders one of these, so a slow request always
 * produces the same visible, announced feedback instead of a blank screen.
 */

export type LoaderSize = 'sm' | 'md' | 'lg';

const LABELS: Record<LoaderSize, number> = { sm: 14, md: 22, lg: 44 };

export function Spinner({ size = 'md', className }: { size?: LoaderSize; className?: string }) {
  return (
    <span
      className={className ? `loader-spinner is-${size} ${className}` : `loader-spinner is-${size}`}
      role="progressbar"
      aria-label="Loading"
      aria-busy="true"
      style={{ '--loader-size': `${LABELS[size]}px` } as React.CSSProperties}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle className="loader-spinner-track" cx="12" cy="12" r="9" />
        <circle className="loader-spinner-arc" cx="12" cy="12" r="9" />
      </svg>
    </span>
  );
}

/** A labelled spinner for a region that is still fetching its first payload. */
export function Loader({ label = 'Loading', size = 'lg', className }: { label?: string; size?: LoaderSize; className?: string }) {
  return (
    <div
      className={className ? `loader is-${size} ${className}` : `loader is-${size}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="loader"
    >
      <Spinner size={size} />
      <p className="loader-label">{label}</p>
    </div>
  );
}

/** A full-viewport loader for the first paint of a whole page. */
export function PageLoader({ label = 'Loading this page' }: { label?: string }) {
  return (
    <div className="page-loader" role="status" aria-live="polite" aria-busy="true" data-testid="page-loader">
      <Spinner size="lg" />
      <p>{label}</p>
    </div>
  );
}

/** Skeleton placeholders so a loading region keeps its final shape. */
export function Skeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={className ? `skeleton ${className}` : 'skeleton'} aria-hidden="true">
      {Array.from({ length: lines }, (_entry, index) => (
        <span className="skeleton-line" key={index} style={{ width: `${100 - index * 9}%` }} />
      ))}
    </div>
  );
}

/** Shimmering placeholders that match the admin data table. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }, (_entry, rowIndex) => (
        <span className="skeleton-row" key={rowIndex}>
          {Array.from({ length: columns }, (_cell, cellIndex) => (
            <span className="skeleton-cell" key={cellIndex} />
          ))}
        </span>
      ))}
    </div>
  );
}
