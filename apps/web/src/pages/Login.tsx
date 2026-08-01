import { useState, type FormEvent } from 'react';
import { useDispatch } from 'react-redux';
import { post, tokens, type Role } from '../api';
import { signedIn } from '../store';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { email: string; role: Role; employeeId: string | null };
}

export function Login() {
  const dispatch = useDispatch();
  const [email, setEmail] = useState('hr@meridian.test');
  const [password, setPassword] = useState('Passw0rd!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await post<LoginResponse>('/auth/login', { email, password });
      tokens.set(res.accessToken, res.refreshToken);
      dispatch(signedIn(res.user));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand" style={{ padding: 0 }}>
          Pulse<span>HR</span>
        </div>
        <div className="brand-sub" style={{ padding: '2px 0 22px' }}>
          Predictive HR Information System
        </div>

        <form className="card" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {error && <p className="error">{error}</p>}
        </form>

        <p className="notice">
          Demo accounts (password <code>Passw0rd!</code>):
          <br />
          <code>hr@meridian.test</code> — HR Admin
          <br />
          <code>shabnam.rahman@meridian.test</code> — Manager
          <br />
          <code>farhana.akter@meridian.test</code> — Employee
        </p>
      </div>
    </div>
  );
}
