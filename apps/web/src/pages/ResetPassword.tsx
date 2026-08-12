import { useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { post } from '../api';
import { Logo } from '../components/Logo';

/** F1.4 / US-05 — reached from the link a "forgot password" request issues. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setBusy(true);
    try {
      await post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <Logo compact tagline="Reset your password" />

        {!token ? (
          <div className="card content-in">
            <p className="error">This reset link is missing its token.</p>
            <a href="/">← Back to sign in</a>
          </div>
        ) : done ? (
          <div className="card content-in">
            <p>Your password has been reset. Every existing session was signed out, so sign
              in again with the new password.</p>
            <a href="/">Go to sign in →</a>
          </div>
        ) : (
          <form className="card" onSubmit={submit}>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <div className="field">
              <label htmlFor="confirm-password">Confirm new password</label>
              <input
                id="confirm-password"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <button className="primary" style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
            {error && <p className="error content-in">{error}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
