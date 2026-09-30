import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, AdminApiError } from '../lib/admin-api';
import { roleDescriptions, signupRoles, type AccountRole } from '../auth/roles';

type FieldName = 'name' | 'email' | 'phone' | 'role' | 'password' | 'confirmPassword';

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
};

/**
 * The public registration form.
 *
 * A visitor picks the role they want, the account is created Pending, and an
 * administrator decides whether to activate it. So the page is explicit about
 * that up front rather than letting somebody discover it by being refused at the
 * sign-in form a minute later.
 */
export function SignupPage() {
  const [form, setForm] = useState(emptyForm);
  const [role, setRole] = useState<AccountRole>('Customer');
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  function update(field: FieldName, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  /**
   * The same three rules the server enforces, checked here so a mistake is
   * caught beside the field that caused it. The server still checks all of
   * them: this only decides where the complaint appears.
   */
  function validate() {
    const found: Partial<Record<FieldName, string>> = {};
    if (form.name.trim().length < 2) found.name = 'Tell us the name to put on the account.';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) found.email = 'Enter an email address we can reach you at.';
    if (form.password.length < 8) found.password = 'Use at least 8 characters.';
    if (form.password !== form.confirmPassword) found.confirmPassword = 'The two passwords do not match.';
    return found;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const result = await adminApi.signUp({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        role,
        password: form.password,
        phone: form.phone.trim(),
      });
      setMessage(result.message);
      setForm(emptyForm);
    } catch (signupError) {
      // A field the server named is shown beside itself; anything else is a
      // whole-form problem, such as the address already being taken.
      if (signupError instanceof AdminApiError) {
        const named = Object.entries(signupError.fieldErrors);
        if (named.length > 0) {
          const next: Partial<Record<FieldName, string>> = {};
          for (const [field, problem] of named) {
            if (field === 'confirmPassword') next.confirmPassword = problem;
            else if (field in emptyForm) next[field as FieldName] = problem;
          }
          if (Object.keys(next).length > 0) {
            setErrors(next);
            setBusy(false);
            return;
          }
        }
        setError(signupError.message);
      } else {
        setError('Your registration could not be sent. Please try again shortly.');
      }
    } finally {
      setBusy(false);
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
          <span className="eyebrow">Join the house</span>
          <h1>Create an account</h1>
          <p className="login-intro">Choose the role that fits you. An administrator reviews every request before an account can sign in.</p>

          {message ? (
            <>
              <p className="login-reset-notice" role="status">{message}</p>
              <Link className="button button-dark button-full" to="/login">Go to sign in</Link>
              <p className="login-footnote">Still waiting to hear? <Link to="/login">Ask for a reset link</Link> if you already have an account.</p>
            </>
          ) : (
            <form className="login-form" onSubmit={submit} noValidate>
              <fieldset className="role-picker">
                <legend>What brings you here?</legend>
                <div className="role-options">
                  {signupRoles.map((option) => (
                    <label className="role-option" key={option} htmlFor={`role-${option.replaceAll(/\s+/g, '-').toLowerCase()}`}>
                      <input
                        id={`role-${option.replaceAll(/\s+/g, '-').toLowerCase()}`}
                        type="radio"
                        name="role"
                        value={option}
                        checked={role === option}
                        onChange={() => setRole(option)}
                      />
                      <span><strong>{option}</strong><small>{roleDescriptions[option]}</small></span>
                    </label>
                  ))}
                </div>
                {errors.role && <p className="login-error" role="alert">{errors.role}</p>}
              </fieldset>

              <label htmlFor="signup-name">Full name</label>
              <input id="signup-name" type="text" autoComplete="name" placeholder="Your name" value={form.name} onChange={(event) => update('name', event.target.value)} aria-invalid={errors.name ? true : undefined} required />
              {errors.name && <p className="login-error" role="alert">{errors.name}</p>}

              <label htmlFor="signup-email">Email address</label>
              <input id="signup-email" type="email" autoComplete="email" placeholder="you@glowngrace.in" value={form.email} onChange={(event) => update('email', event.target.value)} aria-invalid={errors.email ? true : undefined} required />
              {errors.email && <p className="login-error" role="alert">{errors.email}</p>}

              <label htmlFor="signup-phone">Mobile number <span className="login-optional">optional</span></label>
              <input id="signup-phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" value={form.phone} onChange={(event) => update('phone', event.target.value)} />

              <label htmlFor="signup-password">Password</label>
              <input id="signup-password" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={form.password} onChange={(event) => update('password', event.target.value)} aria-invalid={errors.password ? true : undefined} required />
              {errors.password && <p className="login-error" role="alert">{errors.password}</p>}

              <label htmlFor="signup-confirm-password">Confirm password</label>
              <input id="signup-confirm-password" type="password" autoComplete="new-password" placeholder="Type it once more" value={form.confirmPassword} onChange={(event) => update('confirmPassword', event.target.value)} aria-invalid={errors.confirmPassword ? true : undefined} required />
              {errors.confirmPassword && <p className="login-error" role="alert">{errors.confirmPassword}</p>}

              {error && <p className="login-error" role="alert">{error}</p>}
              <button className="button button-dark button-full" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Request my account'}</button>
            </form>
          )}

          <p className="login-footnote">Already registered? <Link to="/login">Sign in instead</Link></p>
          <p className="login-footnote"><Link to="/login">Forgot your password?</Link></p>
          <Link className="login-back-link" to="/">← Back to Glow &amp; Grace</Link>
          <p className="login-security-note">Your request stays inactive until an administrator approves it. Nothing is shared with anyone else.</p>
        </div>
      </div>
    </section>
  );
}
