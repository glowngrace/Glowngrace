import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/Loader';
import { superAdminEmail, superAdminRole } from '../../auth/roles';
import {
  AdminApiError,
  adminApi,
  endAdminSession,
  getAdminSessionExpiresIn,
  getAdminToken,
  sessionEndedEvent,
  type AdminUser,
} from '../../lib/admin-api';

/**
 * `/superadmin/ggpass` - generates the owner password, shows it once, and saves
 * the one that is actually kept.
 *
 * Three steps, in this order and no other, which is the flow the design file
 * (`Design/gg-generate-password.html`) already lays out on its right-hand side:
 *
 *   Generate  the server makes an eight character password and hands it back. The
 *             credential itself is written nowhere. The previous password still
 *             works, so a tab that is closed, a refresh, or a walk away from the
 *             keyboard costs nobody a session.
 *   Copy      the value goes to the clipboard from the notification, and the
 *             notification says so. Copying is what opens the save field: the
 *             screen asks for the generated value to be pasted back rather than
 *             for a new one to be typed, so the thing that is saved is the thing
 *             that was shown. Nothing else on the page can be mistaken for a
 *             password the owner chose.
 *   Save      the pasted value is checked against the one that was generated,
 *             hashed and stored, every session ends, a confirmation that carries
 *             no password is emailed to the owner, and the page walks back to
 *             sign-in to use it.
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
 *   The role check    the screen asks the server who is signed in and names the
 *                     refused role on the card. This is a courtesy: it says who the
 *                     screen is for without pretending the button changed anything.
 *                     The single "Generate password" control is always the design's
 *                     own button, and it is never a route away from this page - the
 *                     server's answer is what the card reports.
 *   The server check  both `owner-password` routes re-read the session and answer
 *                     403 to anything but the owner. This is the one that counts.
 *                     Showing a button is not the same as letting the press through,
 *                     so the page is safe to reach by typing the URL, and the
 *                     endpoints are safe to call directly.
 *
 * Saving also revokes every session, the caller's included, because the old
 * password has stopped working - so the token is dropped as soon as the save
 * returns and the page is on its way to sign-in.
 */

/** How long the design's success toast stays up before it retires itself. */
const TOAST_MS = 4500;
/**
 * How long the generated password stays in the notification after it has been
 * copied. The design counts this one down from the copy rather than from the
 * appearance: while it is up it is the only place the password exists in the
 * clear, and the clipboard is where it went.
 */
const COPIED_TOAST_MS = 4000;
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

/** The screen's own words for a password it will not save. */
const EMPTY_PASTE_ERROR = 'Please paste the generated password.';
const SHAPE_ERROR = 'Password must be exactly 8 letters or numbers.';
const MISMATCH_ERROR = "This doesn't match the generated password.";
/** Eight letters and numbers, the same rule the server holds the value to. */
const SHAPED = /^[A-Za-z0-9]{8}$/;

/** A success notification. `timed` is what puts the design's countdown bar under it. */
type Toast = { title: string; detail: string; timed?: boolean } | null;

export function SuperAdminPasswordPage() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<AdminUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [unreachable, setUnreachable] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  /** The value the server generated. The save field has to match it exactly. */
  const [generated, setGenerated] = useState<string | null>(null);
  /** What has been pasted into the save field. Kept apart from `generated` on purpose. */
  const [pasted, setPasted] = useState('');
  /** Whether the save field is on screen. Copying is what opens it. */
  const [showSave, setShowSave] = useState(false);
  /** Why the save field will not go. Cleared by typing. */
  const [fieldError, setFieldError] = useState('');
  /** Whether the save field is showing its value rather than dots. */
  const [revealed, setRevealed] = useState(false);
  const [sentTo, setSentTo] = useState<Toast>(null);
  const [error, setError] = useState<Toast>(null);
  const [copied, setCopied] = useState(false);
  const [deployment, setDeployment] = useState<Awaited<ReturnType<typeof adminApi.health>>>(null);
  const emailId = useId();
  const passwordId = useId();
  const passwordRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The server is the authority on who this is. The cached account in
  // localStorage would let somebody edit it into the owner role and be shown a
  // button they cannot press.
  //
  // The two ways this can fail are not the same answer. 401 says nobody is
  // signed in, and the card below says so. Anything else - a database that timed
  // out, a network that dropped - says nothing at all about the session, and
  // showing "sign in to continue" to somebody who is already signed in sends
  // them to type credentials that were never the problem.
  const alive = useRef(false);
  const recheck = useCallback(async () => {
    setChecking(true);
    setUnreachable(false);
    // The console never asks the server anything without a stored token, and this
    // screen follows the same rule. With no session at all - or with one whose own
    // countdown has already run out - the answer is a foregone 401, and firing the
    // request anyway puts a red line in the console that reads as this screen being
    // broken rather than as nobody being signed in.
    const token = getAdminToken();
    if (!token || getAdminSessionExpiresIn() === 0) {
      if (token) endAdminSession();
      setAccount(null);
      setChecking(false);
      return;
    }
    try {
      const user = await adminApi.me();
      if (alive.current) setAccount(user);
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof AdminApiError && cause.status === 401) setAccount(null);
      else setUnreachable(true);
    } finally {
      if (alive.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => { void recheck(); }, [recheck]);

  // A session that runs out while this screen is open has to show it. Without
  // this the form stays on screen looking ready, and the first sign that anything
  // changed is a 401 in the console when the button is finally pressed.
  //
  // The save ends the session deliberately and says so in its own toast, so that
  // one is allowed through: the confirmation is the only account of what happened,
  // and it has to outlive the token it retired.
  const endingOnPurpose = useRef(false);
  useEffect(() => {
    function handleSessionEnded() {
      if (endingOnPurpose.current) return;
      setAccount(null);
      setUnreachable(false);
    }
    window.addEventListener(sessionEndedEvent, handleSessionEnded);
    return () => window.removeEventListener(sessionEndedEvent, handleSessionEnded);
  }, []);

  useEffect(() => {
    const remaining = getAdminSessionExpiresIn();
    // No expiry recorded is a token from before sessions were short-lived, so the
    // server stays the authority on whether it is still good.
    if (remaining === null) return;
    if (remaining <= 0) {
      endAdminSession();
      return;
    }
    const timer = window.setTimeout(() => endAdminSession(), remaining);
    return () => window.clearTimeout(timer);
  }, []);

  // A 401 on any request other than the session check ends the stored session,
  // so the form below has just become a form with nothing to send it with. Left
  // on screen, the next press fails the same way and reads as the feature being
  // broken rather than as a session that ran out.
  const dropSessionIfEnded = useCallback((cause: unknown) => {
    if (cause instanceof AdminApiError && cause.status === 401) setAccount(null);
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
    if (focusTimer.current) clearTimeout(focusTimer.current);
  }, []);

  /** Clears every countdown the success toast owns, whichever one started it. */
  const clearToastTimer = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  /**
   * Shows a success notification and decides when it goes.
   *
   * `auto` is the design's own distinction: the generated password stays until it
   * is copied or dismissed, because it is the only copy anywhere - while a
   * confirmation, which is about something that has already happened, retires
   * itself so the screen does not keep announcing a finished event.
   */
  const showSuccess = useCallback((toast: { title: string; detail: string }, auto: number | null) => {
    clearToastTimer();
    setError(null);
    setSentTo({ ...toast, timed: auto !== null });
    if (auto !== null) toastTimer.current = setTimeout(() => setSentTo(null), auto);
  }, [clearToastTimer]);

  const showError = useCallback((title: string, detail: string) => {
    clearToastTimer();
    setSentTo(null);
    setError({ title, detail });
    toastTimer.current = setTimeout(() => setError(null), ERROR_TOAST_MS);
  }, [clearToastTimer]);

  const generate = useCallback(async () => {
    // The same cheap check as the visit itself: with no session to send, the
    // press can only draw a 401 out of the server - a red line that reads as
    // this screen being broken, for somebody already looking at the sign-in
    // note. Refused here, in the screen's own words, rather than fired and
    // then answered.
    const token = getAdminToken();
    if (!token || getAdminSessionExpiresIn() === 0) {
      if (token) endAdminSession();
      setAccount(null);
      setUnreachable(false);
      showError('Password not generated', 'Sign in to the console to continue.');
      return;
    }
    setRunning(true);
    // A regeneration starts the flow again: what was pasted belonged to the
    // password that is about to stop existing, so keeping it would set the save
    // up to be refused as a mismatch a moment later.
    setShowSave(false);
    setPasted('');
    setFieldError('');
    setRevealed(false);
    setCopied(false);
    try {
      const result = await adminApi.generateOwnerPassword();
      setGenerated(result.password);
      showSuccess({ title: 'Password generated', detail: `New password for ${result.email}` }, null);
    } catch (cause) {
      dropSessionIfEnded(cause);
      setGenerated(null);
      const message = cause instanceof AdminApiError
        ? cause.message
        : 'The password could not be generated. Try again in a moment.';
      showError('Password not generated', message);
    } finally {
      setRunning(false);
    }
  }, [dropSessionIfEnded, showError, showSuccess]);

  /**
   * Puts the generated password on the clipboard, and opens the save field.
   *
   * The field is empty until this runs, and pasting is how it gets filled: the
   * screen asks for the value it just showed rather than for a new one, so what
   * gets saved is what was copied and nobody has to retype eight characters they
   * only saw once.
   *
   * The async clipboard API is refused outside a secure context and by browsers
   * that withhold permission, and a button that silently does nothing is worse
   * than no button - so the attempt is reported either way, and the save field
   * opens on both. Refusing to open it would leave the only way forward behind a
   * browser setting the owner cannot change from here.
   */
  const copy = useCallback(async () => {
    if (!generated) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(generated);
      ok = true;
    } catch {
      // The design's own fallback: a hidden textarea and the older copy command,
      // which still works where the async API is withheld.
      const scratch = document.createElement('textarea');
      scratch.value = generated;
      scratch.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(scratch);
      scratch.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      scratch.remove();
    }
    setCopied(ok);
    setShowSave(true);
    showSuccess(
      ok
        ? { title: 'Password generated', detail: 'Copied to clipboard. Paste it below to save.' }
        : { title: 'Password generated', detail: 'Copy failed — select the password and copy manually.' },
      // The copied value is also in the field, so this one can retire. A failure
      // has to stay: it is the only account of what happened, and the password in
      // the notification is what still has to be copied by hand.
      ok ? COPIED_TOAST_MS : null,
    );
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => passwordRef.current?.focus(), 250);
  }, [generated, showSuccess]);

  const save = useCallback(async () => {
    if (!generated) return;
    // Symmetric with the generate press: a token whose countdown ran out while
    // the field was open would otherwise reach the server for a foregone 401.
    const token = getAdminToken();
    if (!token || getAdminSessionExpiresIn() === 0) {
      if (token) endAdminSession();
      setAccount(null);
      setUnreachable(false);
      setFieldError('');
      showError('Password not saved', 'Sign in to the console to continue.');
      return;
    }
    // Checked here first so the words under the field are the screen's own, and so
    // a password nobody pasted can never reach the server as a save attempt. The
    // server holds the value to the same eight letters and numbers regardless: this
    // is the screen explaining its own refusal, not the screen deciding it.
    const value = pasted.trim();
    if (!value) { setFieldError(EMPTY_PASTE_ERROR); return; }
    if (!SHAPED.test(value)) { setFieldError(SHAPE_ERROR); return; }
    if (value !== generated) { setFieldError(MISMATCH_ERROR); return; }

    setSaving(true);
    try {
      const result = await adminApi.saveOwnerPassword(value);
      // Every session went with the password, including this one. Leaving a token
      // behind would only produce a confusing 401 on the next click. The listener
      // above is told to keep out of it, because this end is announced by the
      // confirmation rather than by the sign-in card.
      endingOnPurpose.current = true;
      try {
        endAdminSession();
      } finally {
        endingOnPurpose.current = false;
      }
      // The save section closes the way the design closes it: the value has been
      // kept, so what was pasted belongs to the credential that has just been
      // replaced rather than to the one that follows it.
      setGenerated(null);
      setPasted('');
      setShowSave(false);
      setFieldError('');
      setRevealed(false);
      setCopied(false);
      showSuccess({ title: 'Password saved', detail: `The password for ${result.email} has been updated.` }, TOAST_MS);
      // This toast also gets the redirect, which is shorter than its own timer: the
      // bounce is the thing that takes it away in practice, and if it ever failed to
      // happen the toast would still be on screen saying the right thing.
      if (redirectTimer.current) clearTimeout(redirectTimer.current);
      redirectTimer.current = setTimeout(() => navigate('/login'), SIGN_IN_REDIRECT_MS);
    } catch (cause) {
      dropSessionIfEnded(cause);
      const message = cause instanceof AdminApiError
        ? cause.message
        : 'The password could not be saved. Nothing has changed - try again in a moment.';
      showError('Password not saved', message);
    } finally {
      setSaving(false);
    }
  }, [dropSessionIfEnded, generated, navigate, pasted, showError, showSuccess]);

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

      {/* The design's right-hand side (`Design/gg-generate-password.html`) is one
          card in every state it can be in. Signing out, being refused the role or
          hitting a broken deployment changes what the card says, never the card
          - so the single "Generate password" control is always a button that
          reaches for the server and reports back, never a route away from here. */}
      <div className="ggpass-form">
        <div className="ggpass-card">
          <img className="ggpass-mark" src="/images/logo_mark.png" alt="" />

          <span className="eyebrow">Password assistance</span>
          <h1>Generate password</h1>
          <p className={`ggpass-sub muted${checking ? ' ggpass-waiting' : ''}`}>
            {checking
              ? <><Spinner size="sm" /> Checking who is signed in…</>
              : 'A new password will be generated for the registered email address below.'}
          </p>

          {unreachable && !account && (
            // The session check itself failed. This is not "nobody is signed in" -
            // that answer only arrives as a 401 - so the card says what actually
            // happened and offers the one thing that can settle it.
            <>
              <div className="ggpass-note is-error" role="alert">
                <i />
                <div>
                  The console could not be reached to check who is signed in. The server did
                  not answer the session check, so nothing here can tell whether anybody is
                  signed in. Nothing has been changed. Try again in a moment; if it keeps
                  happening, the deployment itself needs looking at.
                </div>
              </div>
              <button className="ggpass-btn ggpass-retry" type="button" onClick={() => void recheck()}>Try again</button>
            </>
          )}

          {brokenStore && (
            // Only the wording changes with the session: a missing database blocks a
            // signed-in owner just as hard, but it must not accuse them of being signed
            // out while somebody is in fact already signed in.
            <div className="ggpass-note is-error" role="alert">
              <i />
              <div>
                {!account ? (
                  <>{'This deployment has no database, so signing in is impossible. '}
                    {storeReason ?? (
                      <>The server is running on an in-memory store that is emptied on every
                      restart, so there is no owner account to sign in as. Set{' '}
                      <code>NEON_DATABASE_URL</code> in the Vercel project environment
                      variables and redeploy. Your account and passwords are in the database
                      and are not affected — they are simply not reachable until it is
                      connected.</>
                    )}
                  </>
                ) : (
                  <>{storeReason ?? (
                    <>This deployment has no database, so nothing saved here can be kept.
                    Set <code>NEON_DATABASE_URL</code> in the Vercel project environment
                    variables and redeploy.</>
                  )}</>
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

          {account && !isOwner && (
            // A courtesy, not the guard: the endpoint answers 403 regardless, which is
            // asserted in src/server/admin.test.ts. The card is not swapped for a
            // different one, because the design has a single card and the server's
            // refusal is the thing that names the real reason.
            <div className="ggpass-note is-error" role="alert">
              <i />
              <div>
                This screen is for the {superAdminRole} account only. You are signed in as{' '}
                {account.name} with the {account.role} role. The server refuses requests from
                any other account.
              </div>
            </div>
          )}

          {!account && !checking && !unreachable && (
            <div className="ggpass-note">
              <i />
              <div>This screen is for the {superAdminRole} account. Sign in to continue.</div>
            </div>
          )}

          <div className="ggpass-field">
            <label htmlFor={emailId}>Registered email</label>
            <div className="ggpass-input-wrap">
              <EnvelopeIcon />
              <input id={emailId} type="email" value={superAdminEmail} readOnly disabled />
              <span className="ggpass-lock">Locked</span>
            </div>
            <p className="ggpass-hint">This email is linked to the business account and cannot be changed.</p>
          </div>

          {/* The design's single control, in the design's only place on the card.
              No confirmation stands in front of it any more: the design's own answer
              to "are you sure" is that nothing is written until the save, and a dialog
              in front of a step that changes nothing only trains people to press
              through dialogs. The button never points at the sign-in page - with no
              session the server refuses the press and the failure notification says
              why, on this screen. */}
          <button
            className="ggpass-btn"
            type="button"
            disabled={checking || running || blocked}
            aria-busy={running}
            onClick={() => void generate()}
          >
            {running
              ? <><Spinner size="sm" /> Generating…</>
              // The label the design swaps to once there is a password to replace: the
              // same control, doing the same thing again, and it is not a second step.
              : generated ? 'Regenerate password' : 'Generate password'}
          </button>

          {/* The save half of the design, which does not exist until a copy has been
              attempted. Paste is the only way in: the screen is asking for the value it
              just showed, so what gets saved is what was shown rather than something
              somebody had time to think about while it sat on screen. */}
          {showSave && (
            <div className="ggpass-save">
              <div className="ggpass-field">
                <label htmlFor={passwordId}>Save new password</label>
                <div className="ggpass-input-wrap">
                  <PadlockIcon />
                  <input
                    id={passwordId}
                    ref={passwordRef}
                    type={revealed ? 'text' : 'password'}
                    maxLength={8}
                    autoComplete="new-password"
                    spellCheck={false}
                    className="ggpass-code"
                    value={pasted}
                    placeholder="Paste the copied password"
                    disabled={blocked || saving}
                    aria-invalid={fieldError ? true : undefined}
                    aria-describedby={fieldError ? `${passwordId}-err` : undefined}
                    onChange={(event) => { setPasted(event.target.value); setFieldError(''); }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !saving) { event.preventDefault(); void save(); }
                    }}
                  />
                  {/* The value is deliberately not shown by default: this is a
                      password the owner is about to make the only credential for
                      the account, and the design gives them the eye rather than
                      putting it on screen for whoever is standing behind them. */}
                  <button
                    className="ggpass-eye"
                    type="button"
                    aria-label={revealed ? 'Hide password' : 'Show password'}
                    onClick={() => setRevealed((on) => !on)}
                  >
                    <EyeIcon />
                  </button>
                </div>
                {/* Not a live region: it is empty until the owner presses save, and
                    an always-mounted alert would be waiting there to swallow the
                    assertion made about every other alert on the page. */}
                <p className="ggpass-err" id={`${passwordId}-err`}>{fieldError}</p>
              </div>
              <button
                className="ggpass-btn"
                type="button"
                disabled={blocked || saving}
                aria-busy={saving}
                onClick={() => void save()}
              >
                {saving ? <><Spinner size="sm" /> Saving…</> : 'Save password'}
              </button>
            </div>
          )}

          {blocked && <p className="ggpass-foot">Fix the deployment above, then this becomes available.</p>}

          {/* Always under the button, exactly as the design puts it. It is the only
              line on the page that says what the password is made of and what to do
              with it, so it has to be there before anything is pressed as well as
              after. */}
          <div className="ggpass-note">
            <i />
            <div>
              The password is <b>8 characters, letters and numbers</b>. Copy it from the
              notification, then paste it above to save.
            </div>
          </div>

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

          The success toast is the only place that carries the password in the
          clear, and it carries it with the copy button beside it - because
          "generated" followed by a value you have to select by hand is the thing
          the copy button exists to remove. It is announced politely rather than
          assertively: it appears on a deliberate action, not as an interruption. */}
      {sentTo && (
        <div className={`ggpass-toast${sentTo.timed ? ' is-timed' : ''}`} role="status" aria-live="polite">
          <span className="ggpass-toast-icon"><CheckIcon /></span>
          <div className="ggpass-toast-body">
            <b>{sentTo.title}</b>
            <span>{sentTo.detail}</span>
            {/* The generated value, for the same reason the copy button uses it:
                two places on one screen showing two different passwords would be
                worse than showing it in one. It stays up after the copy, because
                the clipboard is the thing that may not have taken it. */}
            {generated && sentTo.title === 'Password generated' && (
              <div className="ggpass-toast-pw">
                <code className="ggpass-toast-code">{generated}</code>
                <button
                  className={`ggpass-toast-copy${copied ? ' is-done' : ''}`}
                  type="button"
                  title={copied ? 'Copied' : 'Copy to clipboard'}
                  aria-label={copied ? 'Copied' : 'Copy password'}
                  onClick={() => void copy()}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            )}
          </div>
          <button className="ggpass-toast-close" type="button" aria-label="Close" onClick={() => setSentTo(null)}>✕</button>
          <span className="ggpass-toast-bar" />
        </div>
      )}

      {error && (
        <div className="ggpass-toast is-error is-timed" role="alert">
          <span className="ggpass-toast-icon"><AlertIcon /></span>
          <div className="ggpass-toast-body">
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

function PadlockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="5" y="11" width="14" height="10" rx="1" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" strokeWidth="1.5">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="9" width="12" height="12" rx="1" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
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