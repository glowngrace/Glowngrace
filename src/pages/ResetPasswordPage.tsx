import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi, AdminApiError } from '../lib/admin-api';

/**
 * Redeems a reset link.
 *
 * Reached from the link in the reset message, so the token normally arrives in
 * the query string. It is still accepted from the field below, because there is
 * no mail server here: the link is handed over by an administrator, often by
 * copying just the code.
 */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(searchParams.get('token') ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setDone('');
    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await adminApi.confirmPasswordReset(token.trim(), newPassword);
      setDone(result.message);
      setNewPassword('');
      setConfirmPassword('');
    } catch (resetError) {
      setError(resetError instanceof AdminApiError ? resetError.message : 'The reset link could not be redeemed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="login-section">
      <div className="login-photo">
        <img src="/images/about.jpg" alt="A warm welcome to the Glow & Grace beauty house" />
        <div className="login-photo-caption"><span>Cosmetics · Placement · Careers</span><h2>One little house.<br />Room for everyone.</h2><p>Thoughtful beauty and brighter possibilities, together in Lucknow.</p></div>
      </div>
      <div className="login-panel">
        <div className="login-panel-inner">
          <span className="eyebrow">Account recovery</span>
          <h1>Set a new password</h1>
          <p className="login-intro">Paste the code from your reset link and choose a new password.</p>

          {done && (
            <>
              <p className="login-reset-notice" role="status">{done}</p>
              <button className="button button-dark button-full" type="button" onClick={() => navigate('/login')}>Go to sign in</button>
            </>
          )}

          <form className="login-form" onSubmit={submit}>
            <label htmlFor="reset-token">Reset code</label>
            <input id="reset-token" type="text" autoComplete="one-time-code" spellCheck={false} placeholder="The code from your reset link" value={token} onChange={(event) => setToken(event.target.value)} required />
            <label htmlFor="reset-new-password">New password</label>
            <input id="reset-new-password" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
            <label htmlFor="reset-confirm-password">Confirm new password</label>
            <input id="reset-confirm-password" type="password" autoComplete="new-password" placeholder="Type it once more" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="button button-dark button-full" type="submit" disabled={submitting || Boolean(done)}>{submitting ? 'Saving…' : 'Set my new password'}</button>
          </form>

          <p className="login-footnote">Lost the link? <Link to="/login">Ask for another one</Link>.</p>
          <p className="login-footnote">No account yet? <Link to="/signup">Create one</Link>.</p>
          <Link className="login-back-link" to="/">← Back to Glow &amp; Grace</Link>
          <p className="login-security-note">A reset link works once and expires after an hour. A registration that is still waiting for approval cannot sign in yet.</p>
        </div>
      </div>
    </section>
  );
}
