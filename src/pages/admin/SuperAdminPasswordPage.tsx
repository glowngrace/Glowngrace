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
  const [deployment, setDeployment] = useState<Awaited<ReturnType<typeof adminApi.health>>>(null);
  const emailId = useId();
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

  // Whether this deployment can actually keep the password. Worth asking for on
  // arrival rather than after a failed generation, because the failure mode is
  // otherwise invisible: a rotation against an unconfigured store reports success
  // and the only copy of the password dies with the next request.
  //
  // Started together with the session check rather than after it, so the two land in
  // the same paint. Waiting for the first would show "needs a signed-in owner", then
  // swap to a database warning, which reads as the page making things up.
  useEffect(() => {
    let active = true;
    void adminApi.health().then((report) => { if (active) setDeployment(report); });
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

  // Whether pressing the button could do anything useful. Only a positive report of
  // a broken deployment blocks it - an unreachable health route is unknown, and
  // blocking on a network hiccup would take away a working feature.
  const blocked = deployment?.store === 'memory' || deployment?.mail === 'absent';

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
    // This is what the page shows on a deployment with no database, because a
    // sign-in against an in-memory store can never succeed. Saying "sign in and
    // come back" would send the owner in a circle; the deployment is what needs
    // fixing, and that is worth saying instead of implying the person is at fault.
    if (deployment?.store === 'memory') {
      return (
        <>
          <PageHead crumb="Owner password" title="Owner password" sub={superAdminRole} />
          <Panel>
            <div className="empty-state">
              <h2>This deployment has no database, so signing in is impossible.</h2>
              <p>
                The server is running on an in-memory store that is emptied on every
                restart, which means there is no owner account to sign in as. Set{' '}
                <code>NEON_DATABASE_URL</code> in the Vercel project environment
                variables and redeploy. Your account and passwords are in the database and
                are not affected - they are simply not reachable until it is connected.
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

        {deployment?.store === 'memory' && (
          <div className="admin-danger-confirm" role="alert">
            <h4>This deployment has no database.</h4>
            <p>
              Nothing generated here can be kept: the server is running on an in-memory
              store, so the password, the outbox row and the account itself all disappear
              on the next restart. Set <code>NEON_DATABASE_URL</code> in the Vercel
              project environment variables and redeploy before using this screen.
            </p>
          </div>
        )}

        {deployment?.mail === 'absent' && (
          <div className="admin-danger-confirm" role="alert">
            <h4>Mail is not configured on this deployment.</h4>
            <p>
              The password would be written to the outbox and go nowhere, which makes
              the outbox the only copy. Set <code>MAIL_HOST</code>, <code>MAIL_PORT</code>,{' '}
              <code>MAIL_USERNAME</code>, <code>MAIL_PASSWORD</code>,{' '}
              <code>MAIL_FROM_ADDRESS</code> and <code>MAIL_FROM_NAME</code> in the Vercel
              environment variables first.
            </p>
          </div>
        )}

        <div className="admin-field admin-span-2" style={{ maxWidth: 420 }}>
          <label htmlFor={emailId}>Send the new password to</label>
          <input
            id={emailId}
            type="email"
            name="email"
            value={superAdminEmail}
            readOnly
            disabled
            aria-describedby={`${emailId}-hint`}
          />
          <small className="admin-field-hint" id={`${emailId}-hint`}>
            Fixed to the {superAdminRole} account. A password generated here is only ever
            delivered to this address.
          </small>
        </div>

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
          disabled={running || blocked}
          aria-busy={running}
          onClick={() => setConfirming(true)}
        >
          {running ? <><Spinner /> Generating…</> : 'Generate a new password'}
        </button>
      </div>

      <p className="admin-bulk-note" role="status" aria-live="polite">
        {running && 'Replacing the password and handing it to the mail server.'}
        {!running && blocked && 'Fix the deployment above, then this button becomes available.'}
        {!running && !blocked && done && (
          <>A new password has been sent to {done.email}. Sign in with it to continue.</>
        )}
        {!running && !blocked && !done && error && <span role="alert">{error}</span>}
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