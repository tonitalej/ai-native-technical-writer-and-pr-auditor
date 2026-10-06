import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/Button';

export function SignupPage() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }
    if (displayName.trim().length > 100) {
      setError('Display name must be 100 characters or fewer.');
      return;
    }
    setPending(true);
    const name = displayName.trim();
    const result = await signUp({
      email: email.trim(),
      password,
      ...(name ? { options: { data: { display_name: name } } } : {}),
    });
    setPending(false);
    if (result.error) {
      setError('Could not create the account. If you already have one, sign in.');
      return;
    }
    if (!result.data.session) {
      setConfirm(true);
    }
  }

  if (confirm) {
    return (
      <div className="auth-wrap">
        <section className="auth-card">
          <h1>Check your email to confirm your account</h1>
          <p className="muted">After you confirm it, sign in to connect a repository.</p>
          <Link to="/login">Back to sign in</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <p className="kicker">PR Auditor</p>
        <h1>Create an account</h1>
        <label className="field">
          <span>Email</span>
          <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        </label>
        <label className="field">
          <span>Display name (optional)</span>
          <input value={displayName} maxLength={100} onChange={(event) => setDisplayName(event.target.value)} autoComplete="nickname" />
        </label>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <Button type="submit" pending={pending}>Create account</Button>
        <p className="muted">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
