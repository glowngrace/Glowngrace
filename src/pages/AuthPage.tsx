import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { demoAccounts, signInDemo } from '../auth/demo-auth';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function selectDemoAccount(accountEmail: string) {
    setEmail(accountEmail);
    setPassword('demo123');
    setError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const account = signInDemo(email, password);
    if (!account) {
      setError('Those details did not match a demo account. Please try a sample account below.');
      return;
    }
    navigate(account.destination);
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

          <details className="demo-accounts">
            <summary>Explore a demo account <span aria-hidden="true">＋</span></summary>
            <p>Choose a role to fill in its sample sign-in details.</p>
            <div className="demo-account-list">
              {demoAccounts.map((account) => (
                <button className="demo-account" key={account.role} type="button" onClick={() => selectDemoAccount(account.email)}>
                  <span><strong>{account.label}</strong><small>{account.description}</small></span>
                  <span className="demo-account-arrow" aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
            <p className="demo-password-note">Sample password for every demo account: <code>demo123</code></p>
          </details>

          <form className="login-form" onSubmit={submit}>
            <label htmlFor="login-email">Email address</label>
            <input id="login-email" type="email" autoComplete="username" placeholder="you@glowngrace.in" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {error && <p className="login-error" role="alert">{error}</p>}
            <button className="button button-dark button-full" type="submit">Sign in to your account</button>
          </form>
          <p className="login-footnote">Just looking around? <Link to="/shop">Discover the collection</Link></p>
          <Link className="login-back-link" to="/">← Back to Glow &amp; Grace</Link>
          <p className="demo-security-note">Demo-only sign-in: sample roles are stored in this browser. This is not production authentication.</p>
        </div>
      </div>
    </section>
  );
}
