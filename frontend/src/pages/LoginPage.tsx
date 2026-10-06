import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/ui/Button';

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/repositories';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result = await signIn({ email: email.trim(), password });
    setPending(false);
    if (result.error || !result.data.session) {
      setError('Invalid email or password');
      return;
    }
    navigate(from, { replace: true });
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <p className="kicker">PR Auditor</p>
        <h1>Sign in</h1>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" />
        </label>
        {error ? <p className="error-text" role="alert">{error}</p> : null}
        <Button type="submit" pending={pending}>Sign in</Button>
        <p className="muted">
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
