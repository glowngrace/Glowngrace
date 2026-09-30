import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { demoAccounts, signInConsoleAccount, signInDemo } from '../auth/demo-auth';
import { adminApi, AdminApiError } from '../lib/admin-api';
import { demoPassword } from '../lib/demo-credentials';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resetAddress, setResetAddress] = useState('');
  const [resetNotice, setResetNotice] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  function selectDemoAccount(accountEmail: string) {
    setEmail(accountEmail);
    setPassword('demo123');
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const address = email.trim().toLowerCase();

    // The console holds the only server-side accounts, so try it for every
    // address. The sample portal accounts are not in admin_users, so they fall
    // through to the offline sign-in below, and any real administrator signs in
    // here regardless of whether their password is still the sample one.
    setSubmitting(true);
    let consoleFailure: AdminApiError | null = null;
    try {
      const user = await adminApi.signIn(address, password);
      signInConsoleAccount({ email: user.email, name: user.name });
      navigate('/admin');
      return;
    } catch (signInError) {
      // Keep the server's reason. It is the only thing that distinguishes a
      // mistyped password from an unreachable deployment, and this page used to
      // throw it away and blame the sample accounts for every failure.
      consoleFailure = signInError instanceof AdminApiError ? signInError : null;
    }

    const account = signInDemo(email, password);
    if (account) {
      setSubmitting(false);
      navigate(account.destination);
      return;
    }

    setSubmitting(false);
    // Nothing matched. Report whichever failure is actually informative: the
    // server's message when it answered, otherwise the fact that it did not.
    if (!consoleFailure || consoleFailure.status === 0) {
      setError('The console could not be reached. Check your connection and try again.');
      return;
    }
    // The sample hint is only ever offered when the server actually rejected the
    // credentials. Attaching it to a 500 or a 503 would tell someone their
    // password was wrong when the deployment was the problem, which is the same
    // class of wrong answer this page used to give for every failure.
    const rejectedCredentials = consoleFailure.status === 401 || consoleFailure.status === 403;
    if (rejectedCredentials && demoAccounts.some((sample) => sample.email === address)) {
      setError(`That password is not right for the ${sampleLabel(address)} sample account. Its sample password is ${demoPassword}.`);
      return;
    }
    setError(consoleFailure.message);
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
        <div className="login-photo-caption"><span>Cosmetics Â· Placement Â· Careers</span><h2>One little house.<br />Room for everyone.</h2><p>Thoughtful beauty and brighter possibilities, together in Lucknow.</p></div>
      </div>
      <div className="login-panel">
        <div className="login-panel-inner">
          <span className="eyebrow">Welcome back</span>
          <h1>Sign in</h1>
          <p className="login-intro">Sign in to your Glow &amp; Grace account.</p>

          <details className="demo-accounts">
            <summary>Explore a demo account <span aria-hidden="true">ï¼‹</span></summary>
            <p>Choose a role to fill in its sample sign-in details.</p>
            <div className="demo-account-list">
              {demoAccounts.map((account) => (
                <button className="demo-account" key={account.role} type="button" onClick={() => selectDemoAccount(account.email)}>
                  <span><strong>{account.label}</strong><small>{account.description}</small></span>
                  <span className="demo-account-arrow" aria-hidden="true">â†—</span>
                </button>
              ))}
            </div>
            <p className="demo-password-note">Sample password for every demo account: <code>demo123</code>. Administrators sign in with their own password.</p>
          </details>

          <form className="login-form" onSubmit={submit}>
            <label htmlFor="login-email">Email address</label>
            <input id="login-email" type="email" autoComplete="username" placeholder="you@glowngrace.in" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="button button-dark button-full" type="submit" disabled={submitting}>{submitting ? 'Signing inâ€¦' : 'Sign in to your account'}</button>
          </form>

          <details className="login-reset">
            <summary>Forgotten your password?</summary>
            <p>Ask for a reset link. This deployment has no mail server, so the link is written to the console inbox and an administrator can hand it over.</p>
            <form className="login-form" onSubmit={askForResetLink}>
              <label htmlFor="reset-email">Email to reset</label>
              <input id="reset-email" type="email" autoComplete="username" placeholder="you@glowngrace.in" value={resetAddress} onChange={(event) => setResetAddress(event.target.value)} required />
              {resetNotice && <p className="login-reset-notice" role="status">{resetNotice}</p>}
              <button className="button button-light button-full" type="submit" disabled={resetBusy}>{resetBusy ? 'Requestingâ€¦' : 'Send me a reset link'}</button>
            </form>
            <p className="login-footnote">Already have a link? <Link to="/reset-password">Set a new password</Link>.</p>
          </details>

          <p className="login-footnote">Just looking around? <Link to="/shop">Discover the collection</Link></p>
          <Link className="login-back-link" to="/">â† Back to Glow &amp; Grace</Link>
          <p className="demo-security-note">Console accounts are verified by the server. The sample portal roles are stored in this browser only.</p>
        </div>
      </div>
    </section>
  );
}

/** The sample account's own label, so the message names the role being used. */
function sampleLabel(address: string) {
  return demoAccounts.find((sample) => sample.email === address)?.label ?? 'sample';
}

