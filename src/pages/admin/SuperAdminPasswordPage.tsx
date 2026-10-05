import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components/Loader';
import { superAdminEmail, superAdminRole } from '../../auth/roles';
import { AdminApiError, adminApi, endAdminSession, type AdminUser } from '../../lib/admin-api';
import { PageHead, Panel, PanelHead } from './AdminUi';

/**
 * `/superadmin/ggpass` - generates a new owner password and emails it to the
 * owner address.
 *
 * The password itself is never on this screen. It is generated on the server,
 * stored hashed, written to the outbox and emailed to `superAdminEmail`; this
 * page reports that it happened and nothing more. There is no field to copy out
 * of, no value in the response, and nothing for a screen recording, a shared
 * screen, or the browser history to pick up. If the mail does not arrive the
 * answer is to generate another one, which is cheap and safe to do repeatedly -
 * that is a better failure mode than a password on a page.
 *
 * Two gates, and only the first one is in the UI:
 *
 *   The role check    the screen asks the server who is signed in and refuses to
 *                     render the button for anybody but the owner account. This is
 *                     a courtesy: it stops a curious colleague seeing a control
 *                     they cannot use.
 *   The server check  `POST /admin/owner-password/generate` re-reads the session
 *                     and answers 403 to anything but the owner. This is the one
 *                     that counts. Hiding a button is not access control, so the
 *                     page is safe to reach by typing the URL, and the endpoint is
 *                     safe to call directly.
 *
 * The button also revokes every session, the caller's included, because the old
 * password has stopped working - so this page signs the person out on purpose and
 * says so before they press it.
 */
export function SuperAdminPasswordPage() {
  const [account, setAccount] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState<{ email: string; sessionsRevoked: number } | null>(null);
  const [error, setError] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // The server is the authority on who this is. The cached account in
  // localStorage would let somebody edit it into the owner role and be shown a
  // button they cannot press.
  useEffect(() => {
    let active = true;
    adminApi.me()
      .then((user) => { if (active) setAccount(user); })
      .catch(() => { if (active) setAccount(null); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

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

  const generate = useCallback(async () => {
    setRunning(true);
    setConfirming(false);
    setError('');
    try {
      const result = await adminApi.generateOwnerPassword();
      setDone({ email: result.email, sessionsRevoked: result.sessionsRevoked });
      // Every session went with the password, including this one. Leaving a token
      // behind would only produce a confusing 401 on the next click.
      endAdminSession();
    } catch (cause) {
      setDone(null);
      setError(cause instanceof AdminApiError
        ? cause.message
        : 'The password could not be generated. Try again in a moment.');
    } finally {
      setRunning(false);
    }
  }, []);

  if (checking) {
    return (
      <>
        <PageHead crumb="Owner password" title="Owner password" sub={superAdminRole} />
        <Panel>
          <p className="admin-bulk-note"><Spinner /> Checking who is signed in…</p>
        </Panel>
      </>
    );
  }

  if (!account) {
    return (
      <>
        <PageHead crumb="Owner password" title="Owner password" sub={superAdminRole} />
        <Panel>
          <div className="empty-state">
            <h2>This screen needs a signed-in owner.</h2>
            <p>Sign in as {superAdminEmail} and come back to this address.</p>
            <Link className="button button-dark" to="/login">Sign in</Link>
          </div>
        </Panel>
      </>
    );
  }

  if (account.role !== superAdminRole) {
    return (
      <>
        <PageHead crumb="Owner password" title="Owner password" sub={superAdminRole} />
        <Panel>
          <div className="empty-state">
            <h2>This screen is for the owner account only.</h2>
            <p>
              You are signed in as {account.name} with the {account.role} role.
              The {superAdminRole} account is the only one that can generate an owner
              password, and the server refuses the request from anybody else.
            </p>
            <Link className="button button-dark" to="/admin">Back to the console</Link>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHead crumb="Owner password" title="Owner password" sub={superAdminRole} />
      <Panel>
        <PanelHead title="Generate a new password" sub="Emailed to the owner address. Never shown here." />

        <p>
          Generate a new password for the <strong>{superAdminRole}</strong> account
          ({superAdminEmail}). It is emailed to that address and shown nowhere else.
        </p>

      <ul className="admin-team-list">
        <li>
          <span className="admin-team-info">
            <strong>The password is never displayed here</strong>
            <small>It exists in your inbox and in the outbox table, and nowhere in the browser.</small>
          </span>
        </li>
        <li>
          <span className="admin-team-info">
            <strong>The old password stops working immediately</strong>
            <small>Its hash is replaced, so anybody still holding it is locked out.</small>
          </span>
        </li>
        <li>
          <span className="admin-team-info">
            <strong>Every signed-in session is ended</strong>
            <small>Including yours. You will need to sign in again with the new password.</small>
          </span>
        </li>
        <li>
          <span className="admin-team-info">
            <strong>Any password hold is cleared</strong>
            <small>There is no hand-chosen password to come back to.</small>
          </span>
        </li>
      </ul>

      <div className="admin-form-actions">
        <button
          className="admin-btn admin-btn-dark"
          type="button"
          disabled={running}
          aria-busy={running}
          onClick={() => setConfirming(true)}
        >
          {running ? <><Spinner /> Generating…</> : 'Generate a new password'}
        </button>
      </div>

      <p className="admin-bulk-note" role="status" aria-live="polite">
        {running && 'Replacing the password and handing it to the mail server.'}
        {!running && done && (
          <>A new password has been sent to {done.email}. Sign in with it to continue.</>
        )}
        {!running && !done && error && <span role="alert">{error}</span>}
      </p>

      {confirming && (
        <div className="admin-danger-confirm" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <h4 id={titleId}>Generate a new owner password?</h4>
          <p>
            This replaces the {superAdminRole} password now and emails the new one to
            {' '}{superAdminEmail}. Every session ends, including this one, so make sure
            you can reach that mailbox before you continue.
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
              onClick={() => void generate()}
            >
              {running ? <><Spinner /> Generating…</> : 'Yes, generate it'}
            </button>
          </div>
        </div>
      )}
      </Panel>
    </>
  );
}