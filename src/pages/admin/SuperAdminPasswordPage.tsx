import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/Loader';
import { superAdminEmail, superAdminRole } from '../../auth/roles';
import { AdminApiError, adminApi, endAdminSession, type AdminUser } from '../../lib/admin-api';

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
 * The layout follows the sign-in and reset screens rather than the console: a
 * split page with the beauty house on one side and a single card on the other.
 * This is the way into the account, so it reads as a doorway rather than as
 * another panel of the admin workspace - and it is shown with no site header or
 * footer, which `isAdminPage` already arranges for `/superadmin/`.
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
 * password has stopped working - so this page asks once before it acts, and says
 * so on the way in. That also means this screen has nothing left to protect once
 * it succeeds: the token is dropped, and a minute later the owner is walked back
 * to the sign-in page to use the password that has just been mailed to them.
 */

/** How long the design's success toast stays up before it retires itself. */
const TOAST_MS = 4500;
/** Failures get longer: the message is the only account of what went wrong. */
const ERROR_TOAST_MS = 7000;
/**
 * Grace period between a successful generation and the bounce to sign-in.
 *
 * Long enough to read the toast, open the mailbox and find the mail, short
 * enough that the page - which can no longer do anything, having revoked its own
 * session - does not sit there looking live.
 */
const SIGN_IN_REDIRECT_MS = 60_000;
export function SuperAdminPasswordPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [deployment, setDeployment] = useState<Awaited<ReturnType<typeof adminApi.health>>>(null);
  const emailId = useId();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Whether this deployment can actually keep the password. Asked for on arrival
  // rather than after a failed generation, because the failure mode is otherwise
  // invisible: a rotation against an unconfigured store reports success and the
  // only copy of the password dies with the next request.
  //
  // Started alongside the session check rather than after it, so both land in the
  // same paint. Waiting for the first would show "needs a signed-in owner" and
  // then swap to a database warning, which reads as the page making things up.
  useEffect(() => {
    let active = true;
    void adminApi.health().then((report) => { if (active) setDeployment(report); });
    return () => { active = false; };
  }, []);

  // This screen has its own address and its own title, and it is not reached
  // through the site chrome, so the storefront title would otherwise stay put.
  // Restored on the way out, because leaving a stale title behind after somebody
  // navigates away is worse than not setting one at all.
  useEffect(() => {
    const previous = document.title;
    document.title = 'Generate Password — Glow & Grace';
    return () => { document.title = previous; };
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (redirectTimer.current) clearTimeout(redirectTimer.current);
  }, []);

  useEffect(() => {
    if (!confirming) return;
    // Captured on the way in, while it is still the focused node: on the way out
    // it has to be handed back so a keyboard user lands where they left off.
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
    // One toast at a time. A stale failure left up next to a fresh success would
    // be read as "it worked, and also it did not".
    if (toastTimer.current) clearTimeout(toastTimer.current);
    try {
      const result = await adminApi.generateOwnerPassword();
      setSentTo(result.email);
      // Every session went with the password, including this one. Leaving a token
      // behind would only produce a confusing 401 on the next click.
      endAdminSession();
      toastTimer.current = setTimeout(() => setSentTo(null), TOAST_MS);
      // The countdown is not tied to the toast: the toast retires after a few
      // seconds but the wait for the owner is the whole point of being kept here.
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
      redirectTimer.current = setTimeout(() => navigate('/login'), SIGN_IN_REDIRECT_MS);
    } catch (cause) {
      setSentTo(null);
      const message = cause instanceof AdminApiError
        ? cause.message
        : 'The password could not be generated. Try again in a moment.';
      setError(message);
      toastTimer.current = setTimeout(() => setError(''), ERROR_TOAST_MS);
    } finally {
      setRunning(false);
    }
  }, [navigate]);

  // Whether pressing the button could do anything useful. Only a positive report of
  // a broken deployment blocks it - an unreachable health route is unknown, and
  // blocking on a network hiccup would take away a working feature.
  const brokenStore = deployment?.store === 'memory';
  const brokenMail = deployment?.mail === 'absent';
  const blocked = brokenStore || brokenMail;
  const isOwner = account?.role === superAdminRole;

  return (
    <section className="ggpass">
      <div className="ggpass-art">
        <img src="/images/about.jpg" alt="" />
        <div className="ggpass-art-inner">
          <img className="ggpass-seal" src="/images/logo_mark.png" alt="" />
          <span className="eyebrow">Account access</span>
          <h2>Secure access to your <em>beauty house</em></h2>
          <p>A complete beauty &amp; career destination — Lucknow.</p>
        </div>
      </div>

      <div className="ggpass-panel">
        <div className="ggpass-card">
          <img className="ggpass-mark" src="/images/logo_mark.png" alt="" />

          {checking ? (
            <>
              <span className="eyebrow">Password assistance</span>
              <h1>Generate password</h1>
              <p className="ggpass-sub ggpass-waiting"><Spinner size="sm" /> Checking who is signed in…</p>
            </>
          ) : brokenStore && !account ? (
            // Only when there is nobody signed in. A missing database blocks a
            // signed-in owner just as hard - the button is disabled for them below -
            // but it must not cost them the form, or the page would claim that
            // signing in is impossible while somebody is in fact already signed in.
            <>
              <span className="eyebrow">Password assistance</span>
              <h1>Generate password</h1>
              <p className="ggpass-sub">This deployment has no database, so signing in is impossible.</p>
              <div className="ggpass-note is-error" role="alert">
                <i />
                <div>
                  The server is running on an in-memory store that is emptied on every
                  restart, so there is no owner account to sign in as. Set{' '}
                  <code>NEON_DATABASE_URL</code> in the Vercel project environment
                  variables and redeploy. Your account and passwords are in the database
                  and are not affected — they are simply not reachable until it is
                  connected.
                </div>
              </div>
              <Link className="ggpass-btn" to="/admin">Back to the console</Link>
            </>
          ) : !account ? (
            <>
              <span className="eyebrow">Password assistance</span>
              <h1>Generate password</h1>
              <p className="ggpass-sub">This screen is for the {superAdminRole} account. Sign in to continue.</p>
              <div className="ggpass-field">
                <label htmlFor={emailId}>Registered email</label>
                <div className="ggpass-input-wrap">
                  <EnvelopeIcon />
                  <input id={emailId} type="email" value={superAdminEmail} readOnly disabled />
                  <span className="ggpass-lock">Locked</span>
                </div>
                <p className="ggpass-hint">This email is linked to the business account and cannot be changed.</p>
              </div>
              {/* One button, one label, whatever the state: the design has a single
                  control on this screen and swapping its wording to describe the
                  next step makes the card look like a different page. It still
                  leads to sign-in, because that is the only way anybody gets from
                  here to a session that can generate anything. */}
              <Link className="ggpass-btn" to="/login">Generate Password</Link>
              <p className="ggpass-foot">Nobody can be signed in here without the {superAdminRole} credentials.</p>
            </>
          ) : !isOwner ? (
            <>
              <span className="eyebrow">Password assistance</span>
              <h1>Generate password</h1>
              <p className="ggpass-sub">This screen is for the {superAdminRole} account only.</p>
              <div className="ggpass-note is-error" role="alert">
                <i />
                <div>
                  You are signed in as {account.name} with the {account.role} role. The
                  server refuses this request from anybody else, so the button is not
                  shown rather than shown and rejected.
                </div>
              </div>
              <Link className="ggpass-btn" to="/admin">Back to the console</Link>
            </>
          ) : (
            <>
              <span className="eyebrow">Password assistance</span>
              <h1>Generate password</h1>
              <p className="ggpass-sub">A new password will be generated and sent to the registered email address below.</p>

              {brokenStore && (
                <div className="ggpass-note is-error" role="alert">
                  <i />
                  <div>
                    This deployment has no database, so nothing generated here can be
                    kept. Set <code>NEON_DATABASE_URL</code> in the Vercel project
                    environment variables and redeploy.
                  </div>
                </div>
              )}

              {brokenMail && (
                <div className="ggpass-note is-error" role="alert">
                  <i />
                  <div>
                    Mail is not configured here, so the password would be written to
                    the outbox and go nowhere. Set <code>MAIL_HOST</code>,{' '}
                    <code>MAIL_PORT</code>, <code>MAIL_USERNAME</code>,{' '}
                    <code>MAIL_PASSWORD</code>, <code>MAIL_FROM_ADDRESS</code> and{' '}
                    <code>MAIL_FROM_NAME</code> first.
                  </div>
                </div>
              )}

              {/* A real form so Enter in the locked field submits, as the design's
                  own markup does. The submit never generates anything itself: it
                  opens the confirmation, and only that dialog sends the request. */}
              <form onSubmit={(event) => { event.preventDefault(); setConfirming(true); }}>
                <div className="ggpass-field">
                  <label htmlFor={emailId}>Registered email</label>
                  <div className="ggpass-input-wrap">
                    <EnvelopeIcon />
                    <input id={emailId} type="email" value={superAdminEmail} readOnly disabled />
                    <span className="ggpass-lock">Locked</span>
                  </div>
                  <p className="ggpass-hint">This email is linked to the business account and cannot be changed.</p>
                </div>

                {/* The trigger stays mounted underneath the overlay rather than being
                    swapped out for it. Unmounting it would detach the node that had
                    focus, and there would be nothing to hand focus back to when the
                    dialog closes. */}
                <button className="ggpass-btn" type="submit" disabled={running || blocked || confirming} aria-busy={running} aria-haspopup="dialog" onClick={() => setConfirming(true)}>
                  {running ? <><Spinner size="sm" /> Generating…</> : 'Generate password'}
                </button>
              </form>

              {confirming && (
                <div className="ggpass-confirm-layer">
                  <div className="ggpass-confirm" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-detail`}>
                    <h2 id={titleId}>Generate a new owner password?</h2>
                    <p id={`${titleId}-detail`}>
                      This replaces the {superAdminRole} password now and emails the new
                      one to {superAdminEmail}. Every session ends, including this one, so
                      make sure you can reach that mailbox before you continue.
                    </p>
                    <div className="ggpass-confirm-actions">
                      <button className="ggpass-btn is-quiet" type="button" ref={cancelRef} disabled={running} onClick={() => setConfirming(false)}>
                        Cancel
                      </button>
                      <button className="ggpass-btn" type="button" disabled={running} onClick={() => void generate()}>
                        {running ? <><Spinner size="sm" /> Generating…</> : 'Yes, generate it'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {blocked && <p className="ggpass-foot">Fix the deployment above, then this becomes available.</p>}

              {/* Always under the button, exactly as the design puts it. It is the
                  answer to "where is it" for the state the owner is about to be in,
                  so hiding it behind a success or a failure would leave the one
                  question nobody else on the page answers. */}
              <div className="ggpass-note">
                <i />
                <div>The password email usually arrives within <b>2 minutes</b>. Check your spam folder if you don't see it.</div>
              </div>
            </>
          )}

          {/* Away from the sign-in page, and not towards it either when there is
              nothing to sign in with: with no database the account is unreachable,
              so "back to sign in" would send the owner round in a circle on the
              one screen that is telling them what is actually wrong. */}
          <Link className="ggpass-back" to={brokenStore ? '/admin' : '/login'}>
            {brokenStore ? '← Back to the console' : '← Back to sign in'}
          </Link>
          <p className="ggpass-copyright">© 2026 Glow &amp; Grace · Secure access</p>
        </div>
      </div>

      {/* The design's toast, in both colours. A failure that only appeared as text
          under the button would be missed by somebody who had just watched the
          button light up and start working; this is the same shape, the same
          corner and the same timer in both directions. */}
      {sentTo && (
        <div className="ggpass-toast" role="status" aria-live="polite">
          <span className="ggpass-toast-icon"><CheckIcon /></span>
          <div>
            <b>Password generated</b>
            <span>A new password has been sent to <strong>{sentTo}</strong>.</span>
          </div>
          <button className="ggpass-toast-close" type="button" aria-label="Close" onClick={() => setSentTo(null)}>✕</button>
          <span className="ggpass-toast-bar" />
        </div>
      )}

      {error && (
        <div className="ggpass-toast is-error" role="alert">
          <span className="ggpass-toast-icon"><AlertIcon /></span>
          <div>
            <b>Password not generated</b>
            <span>{error}</span>
          </div>
          <button className="ggpass-toast-close" type="button" aria-label="Close" onClick={() => setError('')}>✕</button>
          <span className="ggpass-toast-bar" />
        </div>
      )}
    </section>
  );
}

function EnvelopeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="5" width="18" height="14" rx="1" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 8v5M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
