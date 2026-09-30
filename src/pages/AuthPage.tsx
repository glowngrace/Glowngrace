import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi, AdminApiError } from '../lib/admin-api';
import { destinationForRole } from '../auth/roles';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetAddress, setResetAddress] = useState('');
  const [resetNotice, setResetNotice] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await adminApi.signIn(email.trim().toLowerCase(), password);
      navigate(destinationForRole(user.role));
    } catch (signInError) {
      // The console holds the only accounts, so its answer is the only one there
      // is. Keep the reason it gave: it is what separates a mistyped password
      // from a deployment that is not migrated yet, and this page used to throw
      // it away and blame the sample accounts for every failure.
      if (signInError instanceof AdminApiError && signInError.status === 0) {
        setError('The console could not be reached. Check your connection and try again.');
      } else {
        setError(signInError instanceof AdminApiError ? signInError.message : 'That email address and password do not match an account.');
      }
      setSubmitting(false);
    }
  }

  async function askForResetLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResetNotice('');
    setResetBusy(true);
    try {
      const result = await adminApi.requestPasswordReset(resetAddress.trim().toLowerCase());
      setResetNotice(result.message);
    } catch (resetError) {
      setResetNotice(resetError instanceof AdminApiError ? resetError.message : 'A reset link could not be requested right now.');
    } finally {
      setResetBusy(false);
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
          <span className="eyebrow">Welcome back</span>
          <h1>Sign in</h1>
          <p className="login-intro">Sign in to your Glow &amp; Grace account.</p>

          <form className="login-form" onSubmit={submit}>
            <label htmlFor="login-email">Email address</label>
            <input id="login-email" type="email" autoComplete="username" placeholder="you@glowngrace.in" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="button button-dark button-full" type="submit" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in to your account'}</button>
          </form>

          <details className="login-reset">
            <summary>Forgotten your password?</summary>
            <p>Ask for a reset link. This deployment has no mail server, so the link is written to the console inbox and an administrator can hand it over.</p>
            <form className="login-form" onSubmit={askForResetLink}>
              <label htmlFor="reset-email">Email to reset</label>
              <input id="reset-email" type="email" autoComplete="username" placeholder="you@glowngrace.in" value={resetAddress} onChange={(event) => setResetAddress(event.target.value)} required />
              {resetNotice && <p className="login-reset-notice" role="status">{resetNotice}</p>}
              <button className="button button-light button-full" type="submit" disabled={resetBusy}>{resetBusy ? 'Requesting…' : 'Send me a reset link'}</button>
            </form>
            <p className="login-footnote">Already have a link? <Link to="/reset-password">Set a new password</Link>.</p>
          </details>

          <p className="login-footnote">New here? <Link to="/signup">Create an account</Link></p>
          <p className="login-footnote">Just looking around? <Link to="/shop">Discover the collection</Link></p>
          <Link className="login-back-link" to="/">← Back to Glow &amp; Grace</Link>
          <p className="login-security-note">Accounts are checked by the server. A new registration is reviewed by an administrator before it can sign in.</p>
        </div>
      </div>
    </section>
  );
}
