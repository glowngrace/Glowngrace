import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/Loader';
import { superAdminEmail, superAdminRole } from '../../auth/roles';
import { AdminApiError, adminApi, endAdminSession, type AdminUser } from '../../lib/admin-api';

/**
 * `/superadmin/ggpass` - generates the owner password, shows it, and saves the one
 * that is actually kept.
 *
 * Three steps, in this order and no other:
 *
 *   Generate  the server makes an eight character password and hands it back. This
 *             writes nothing. The previous password still works, so a tab that is
 *             closed, a refresh, or a walk away from the keyboard costs nobody a
 *             session.
 *   Edit      the value lands in a field, where it can be kept as generated or
 *             changed to something easier to remember.
 *   Save      the value in the field is hashed and stored, every session ends, a
 *             confirmation that carries no password is emailed to the owner, and
 *             the page walks back to sign-in to use it.
 *
 * That last step replaces a weekly rotation which replaced the credential whether
 * or not anybody was watching, and mailed the new one to an unattended mailbox.
 * The password now goes to the one person allowed to have it, on a screen they are
 * looking at. Nothing is written down that somebody else could read.
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
 *                     render the button for anybody but the owner account. This is a
 *                     courtesy: it stops a curious colleague seeing a control
 *                     they cannot use.
 *   The server check  both `owner-password` routes re-read the session and answer
 *                     403 to anything but the owner. This is the one that counts.
 *                     Hiding a button is not access control, so the page is safe to
 *                     reach by typing the URL, and the endpoints are safe to call
 *                     directly.
 *
 * Saving also revokes every session, the caller's included, because the old
 * password has stopped working - so the token is dropped as soon as the save
 * returns and the page is on its way to sign-in.
 */

/** How long the design's success toast stays up before it retires itself. */
const TOAST_MS = 4500;
/** Failures get longer: the message is the only account of what went wrong. */
const ERROR_TOAST_MS = 7000;
/**
 * Grace period between a saved password and the bounce to sign-in.
 *
 * Long enough to read the confirmation - which is the only account of what
 * happened - and short enough that the page, which can no longer do anything
 * having revoked its own session, does not sit there looking live.
 */
const SIGN_IN_REDIRECT_MS = 2500;

type Toast = { title: string; detail: string } | null;

export function SuperAdminPasswordPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [sentTo, setSentTo] = useState<Toast>(null);
  const [error, setError] = useState<Toast>(null);
  const [copied, setCopied] = useState(false);
  const [deployment, setDeployment] = useState<Awaited<ReturnType<typeof adminApi.health>>>(null);
  const emailId = useId();
  const passwordId = useId();
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
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
  // rather than after a failed save, because the failure mode is otherwise
  // invisible: a save against an unconfigured store reports success and the only
  // copy of the password dies with the next request.
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
    setError(null);
    setCopied(false);
    // One toast at a time. A stale failure left up next to a fresh success would
    // be read as "it worked, and also it did not".
    if (toastTimer.current) clearTimeout(toastTimer.current);
    try {
      const result = await adminApi.generateOwnerPassword();
      // Into the field, not only into the toast: the field is what gets saved, so
      // leaving the generated value somewhere else would mean the operator has to
      // copy it out by hand before anything can be kept.
      setGenerated(result.password);
      setPassword(result.password);
      setSentTo({
        title: 'Password generated',
        detail: `Copy it now, or save it below. Nothing is kept until you save.`,
      });
      toastTimer.current = setTimeout(() => setSentTo(null), TOAST_MS);
    } catch (cause) {
      setGenerated(null);
      setPassword('');
      const message = cause instanceof AdminApiError
        ? cause.message
        : 'The password could not be generated. Try again in a moment.';
      setError({ title: 'Password not generated', detail: message });
      toastTimer.current = setTimeout(() => setError(null), ERROR_TOAST_MS);
    } finally {
      setRunning(false);
    }
  }, []);

  /**
   * Puts the password on the clipboard, and says whether it worked.
   *
   * What goes on the clipboard is the field's value, not the value that came back
   * from the server. Those are the same thing until the owner edits the field, and
   * when they differ it is the field that decides what gets saved - so copying the
   * original would put a password on the clipboard that no longer works, and would
   * read as a successful copy of something the owner never chose.
   *
   * The async clipboard API is refused outside a secure context and by browsers
   * that withhold permission, and a copy button that silently does nothing is worse
   * than no button - so the result is reported either way, and the toast is not
   * dismissed by a failed attempt.
   */
  const copy = useCallback(async () => {
    const value = password || generated;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setSentTo({ title: 'Copied', detail: 'The password is on your clipboard.' });
    } catch {
      setCopied(false);
      setSentTo({
        title: 'Could not copy',
        detail: 'Your browser would not copy it for you. Select the field and copy it by hand.',
      });
    }
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setSentTo(null), TOAST_MS);
  }, [generated, password]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    try {
      const result = await adminApi.saveOwnerPassword(password);
      // Every session went with the password, including this one. Leaving a token
      // behind would only produce a confusing 401 on the next click.
      endAdminSession();
      setSentTo({ title: 'Password saved', detail: result.message });
      // This toast gets no timer of its own. The redirect is the thing that takes
      // it away, and it is shorter than the others, so a timer here would only ever
      // be racing it - and if the bounce ever failed to happen, the toast would still
      // be on screen saying the wrong thing next to a form it does not belong to.
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
      redirectTimer.current = setTimeout(() => navigate('/login'), SIGN_IN_REDIRECT_MS);
    } catch (cause) {
      const message = cause instanceof AdminApiError
        ? cause.message
        : 'The password could not be saved. Nothing has changed - try again in a moment.';
      setError({ title: 'Password not saved', detail: message });
      toastTimer.current = setTimeout(() => setError(null), ERROR_TOAST_MS);
    } finally {
      setSaving(false);
    }
  }, [navigate, password]);

  /**
   * Whether the form can be saved from.
   *
   * The same policy the server holds the value to, checked here so a password that
   * could only be refused is not offered as saveable. The generated value always
   * satisfies it; a hand-edited one is where it matters.
   */
  const tooShort = password.trim().length > 0 && password.trim().length < 8;

  // Whether pressing the button could do anything useful. Only a positive report of
  // a broken deployment blocks it - an unreachable health route is unknown, and
  // blocking on a network hiccup would take away a working feature.
  //
  // Mail is deliberately not one of the blockers any more. The password is on this
  // screen, so a relay that is down costs the owner a confirmation and nothing
  // else; blocking here would mean a deployment with no SMTP could not change its
  // owner password at all, which is precisely when somebody needs to.
  const brokenStore = deployment?.store === 'memory';
  const brokenMail = deployment?.mail === 'absent';
  const blocked = brokenStore;
  const isOwner = account?.role === superAdminRole;
  /**
   * The deployment's own diagnosis, when it has one.
   *
   * `/api/health` names every connection-string variable this build accepts, and
   * the previous wording here named a single one. Somebody whose deployment is set
   * up for a different variable was told to set a variable that was already set,
   * which reads as the page not knowing what is wrong with it. Falling back to
   * local copy only when the server said nothing.
   */
  const storeReason = typeof deployment?.reason === 'string' && deployment.reason.trim() !== ''
    ? deployment.reason
    : null;

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
                  {storeReason ?? (
                    <>The server is running on an in-memory store that is emptied on every
                    restart, so there is no owner account to sign in as. Set{' '}
                    <code>NEON_DATABASE_URL</code> in the Vercel project environment
                    variables and redeploy. Your account and passwords are in the database
                    and are not affected — they are simply not reachable until it is
                    connected.</>
                  )}
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
              <p className="ggpass-sub">Generate a password, then save the one you keep. It only becomes yours when you save it.</p>

              {brokenStore && (
                <div className="ggpass-note is-error" role="alert">
                  <i />
                  <div>
                    {storeReason ?? (
                      <>This deployment has no database, so nothing saved here can be
                      kept. Set <code>NEON_DATABASE_URL</code> in the Vercel project
                      environment variables and redeploy.</>
                    )}
                  </div>
                </div>
              )}

              {brokenMail && (
                <div className="ggpass-note is-warning" role="status">
                  <i />
                  <div>
                    Mail is not configured here, so the confirmation that a password was
                    saved will be written to the outbox and go nowhere. Your password
                    still works - set <code>MAIL_HOST</code>, <code>MAIL_PORT</code>,{' '}
                    <code>MAIL_USERNAME</code>, <code>MAIL_PASSWORD</code>,{' '}
                    <code>MAIL_FROM_ADDRESS</code> and <code>MAIL_FROM_NAME</code> to get it.
                  </div>
                </div>
              )}

              {/* A real form so Enter in either field submits, as the design's own
                  markup does. Nothing generates or saves on a plain submit: the
                  generate button opens the confirmation, and only that dialog
                  generates. Saving goes straight through, because by then the
                  operator has already been asked to confirm generating it. */}
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

              {/* The password and the button that keeps it, together below the
                  generate button. The field is editable on purpose: an operator who
                  would rather have something memorable than something random can
                  type one, and the server holds it to the same policy either way.
                  It stays visible after saving rather than being cleared, so the
                  toast's value and the field cannot disagree on screen. */}
              <div className="ggpass-field ggpass-save">
                <label htmlFor={passwordId}>New password</label>
                <div className="ggpass-input-wrap">
                  <KeyIcon />
                  <input
                    id={passwordId}
                    ref={passwordRef}
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    className="ggpass-code"
                    value={password}
                    placeholder="Generate a password to fill this in"
                    readOnly={!generated}
                    disabled={blocked || saving}
                    aria-describedby={`${passwordId}-hint`}
                    onChange={(event) => { setPassword(event.target.value); setCopied(false); }}
                  />
                </div>
                <p className="ggpass-hint" id={`${passwordId}-hint`}>
                  {tooShort
                    ? 'A password needs at least 8 characters.'
                    : generated
                      ? 'Keep it as generated, or change it to something you will remember.'
                      : 'Nothing is kept until this is saved.'}
                </p>
                <button
                  className="ggpass-btn"
                  type="button"
                  disabled={!generated || blocked || saving || password.trim().length < 8}
                  aria-busy={saving}
                  onClick={() => void save()}
                >
                  {saving ? <><Spinner size="sm" /> Saving…</> : 'Save password'}
                </button>
              </div>

              {confirming && (
                <div className="ggpass-confirm-layer">
                  <div className="ggpass-confirm" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-detail`}>
                    <h2 id={titleId}>Generate a new owner password?</h2>
                    <p id={`${titleId}-detail`}>
                      An eight character password will be made and shown here for you to
                      copy or change. Your current password keeps working until you press
                      <b> Save password</b>, and saving ends every session, including this
                      one.
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

              {/* Always under the form, exactly as the design puts it. It is the
                  answer to "what happens now" for the state the owner is about to be
                  in, so hiding it behind a success or a failure would leave the one
                  question nobody else on the page answers. */}
              <div className="ggpass-note">
                <i />
                <div>The password is shown once, here. Copy it before you leave — nothing else will be able to show it to you.</div>
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
          corner and the same timer in both directions.

          The success toast is the only place outside the field that carries the
          password, and it carries it with a copy button beside it - because
          "generated" followed by a value you have to select by hand is the thing
          the copy button exists to remove. It is announced politely rather than
          assertively: it appears on a deliberate action, not as an interruption. */}
      {sentTo && (
        <div className="ggpass-toast" role="status" aria-live="polite">
          <span className="ggpass-toast-icon"><CheckIcon /></span>
          <div>
            <b>{sentTo.title}</b>
            {/* The field's value, for the same reason the copy button uses it: two
                places on one screen showing two different passwords would be worse
                than showing it in only one. */}
            {generated && !copied && sentTo.title === 'Password generated' && (
              <span className="ggpass-toast-code">{password}</span>
            )}
            <span>{sentTo.detail}</span>
            {generated && (
              <button className="ggpass-toast-copy" type="button" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy password'}
              </button>
            )}
          </div>
          <button className="ggpass-toast-close" type="button" aria-label="Close" onClick={() => setSentTo(null)}>✕</button>
          <span className="ggpass-toast-bar" />
        </div>
      )}

      {error && (
        <div className="ggpass-toast is-error" role="alert">
          <span className="ggpass-toast-icon"><AlertIcon /></span>
          <div>
            <b>{error.title}</b>
            <span>{error.detail}</span>
          </div>
          <button className="ggpass-toast-close" type="button" aria-label="Close" onClick={() => setError(null)}>✕</button>
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

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="8" cy="12" r="4" />
      <path d="M12 12h9M18 12v3M21 12v2" />
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