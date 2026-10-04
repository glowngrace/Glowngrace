import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Spinner } from '../../components/Loader';
import {
  AdminApiError,
  adminApi,
  type LocalDatabaseReport,
  type NeonSyncResult,
} from '../../lib/admin-api';
import { Panel, PanelHead } from './AdminUi';

/**
 * The local development database, and the one button that copies production
 * into it.
 *
 * Rendered as nothing at all unless the server says the sync is enabled. The
 * route answers 404 on a deployment that has not opted in, so a production
 * console does not carry a control that could read production.
 *
 * The panel says the same thing the code does, in the order somebody needs it:
 * where the app is pointed, where Neon is, what pressing the button will cost,
 * and what happened afterwards.
 *
 * Confirmation is not decoration. The sync truncates every local table it
 * touches before refilling it, so an unconfirmed click would throw away a
 * developer's own local work.
 */
export function LocalDatabasePanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [report, setReport] = useState<LocalDatabaseReport | null>(null);
  const [absent, setAbsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [skipImages, setSkipImages] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<NeonSyncResult | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    let active = true;
    adminApi.localDatabase()
      .then((value) => { if (active) setReport(value); })
      .catch((cause: unknown) => {
        // 404 is the ordinary answer on a deployment with the sync switched off,
        // and it means "no panel" rather than "something is broken".
        if (cause instanceof AdminApiError && cause.status === 404) {
          if (active) setAbsent(true);
          return;
        }
        onNotice(cause instanceof AdminApiError ? cause.message : 'The local database report could not be loaded.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [onNotice]);

  /**
   * The confirmation is a real dialog: focus moves onto the safe action, Escape
   * cancels, and focus returns to the button that opened it. `autoFocus` alone
   * would not do the third of that, so dismissing the dialog would drop a
   * keyboard user back at the top of the page.
   */
  useEffect(() => {
    if (!confirming) return;
    const opener = document.activeElement;
    cancelRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !running) setConfirming(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [confirming, running]);

  const run = useCallback(async (force: boolean) => {
    setRunning(true);
    setConfirming(false);
    try {
      const outcome = await adminApi.syncFromNeon({ skipImages, force });
      setResult(outcome);
      onNotice(outcome.message);
    } catch (cause) {
      setResult(null);
      onNotice(cause instanceof AdminApiError
        ? cause.message
        : 'The sync did not complete. Check `npm run db:check` and try again.');
    } finally {
      setRunning(false);
    }
  }, [onNotice, skipImages]);

  if (loading) return null;
  if (absent || !report) return null;

  const localDescription = 'error' in report.local && report.local.error ? report.local.error : report.local.connection;
  const canSync = report.neon.configured && report.store === 'postgres';
  const copied = result ? Object.entries(result.copied) : [];
  const unchanged = result?.status === 'unchanged';

  return (
    <Panel>
      <PanelHead title="Local database" sub="Development and testing" />
      <div className="admin-status-card">
        <dl>
          <div>
            <dt>This console reads</dt>
            <dd className={report.store === 'postgres' ? 'is-ok' : 'is-warn'}>
              {report.store === 'postgres' ? 'Local Docker PostgreSQL' : 'In-memory (nothing is saved)'}
            </dd>
          </div>
          <div><dt>Local target</dt><dd className="admin-wrap">{localDescription}</dd></div>
          <div>
            <dt>Neon source</dt>
            <dd className={report.neon.configured ? 'admin-wrap' : 'is-warn'}>
              {report.neon.configured
                ? `${report.neon.project ?? 'Neon'} at ${report.neon.host}`
                : 'Not configured'}
            </dd>
          </div>
        </dl>
      </div>

      {!report.neon.configured && report.neon.reason && (
        <p className="admin-bulk-note" role="note">{report.neon.reason}</p>
      )}
      {report.store !== 'postgres' && (
        <p className="admin-bulk-note" role="note">
          This process is running on the in-memory store, so a sync has nowhere to write.
          Set USE_LOCAL_DATABASE=true in .env.local and restart.
        </p>
      )}

      {canSync && (
        <>
          <div className="admin-switch-list is-compact">
            <li>
              <span>
                <strong>Skip product images</strong>
                <small>Leaves out the largest and least useful table</small>
              </span>
              <label className="sr-only" htmlFor="sync-skip-images">Skip product images</label>
              <input
                id="sync-skip-images"
                type="checkbox"
                checked={skipImages}
                disabled={running}
                onChange={(event) => setSkipImages(event.target.checked)}
              />
            </li>
          </div>

          <div className="admin-form-actions">
            <button
              className="admin-btn admin-btn-dark"
              type="button"
              disabled={running}
              aria-busy={running}
              onClick={() => setConfirming(true)}
            >
              {running ? <><Spinner /> Syncing…</> : 'Sync from Neon'}
            </button>
          </div>
        </>
      )}

      <p className="admin-bulk-note" role="status" aria-live="polite">
        {running && 'Reading from Neon over a single pooled connection. Nothing is pushed back.'}
        {!running && result && result.message}
      </p>

      {copied.length > 0 && (
        <ul className="admin-team-list">
          {copied.map(([table, count]) => (
            <li key={table}>
              <span className="admin-team-info">
                <strong>{table}</strong>
                <small>
                  {count} row{count === 1 ? '' : 's'} copied
                  {result?.available[table] !== undefined && result.available[table] !== count
                    ? ` of ${result.available[table]} in Neon`
                    : ''}
                </small>
              </span>
            </li>
          ))}
        </ul>
      )}

      {unchanged && (
        <div className="admin-form-actions">
          <button
            className="admin-btn admin-btn-light"
            type="button"
            disabled={running}
            onClick={() => void run(true)}
          >
            Sync anyway
          </button>
        </div>
      )}

      {confirming && (
        <div className="admin-danger-confirm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <h4 id={titleId}>Replace the local data?</h4>
          <p>
            Every local table the sync touches is emptied and refilled from Neon.
            Anything saved locally that is not in production will be lost.
            {skipImages ? ' Product images are being skipped, so existing ones stay.' : ''}
          </p>
          <div className="admin-form-actions">
            <button
              className="admin-btn admin-btn-light"
              type="button"
              ref={cancelRef}
              disabled={running}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
            <button
              className="admin-btn admin-btn-danger"
              type="button"
              disabled={running}
              onClick={() => void run(false)}
            >
              {running ? <><Spinner /> Syncing…</> : 'Replace local data'}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}