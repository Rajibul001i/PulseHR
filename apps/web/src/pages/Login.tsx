import { useState, type FormEvent } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { post, tokens, type Role } from '../api';
import { signedIn } from '../store';
import { Logo } from '../components/Logo';

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: { email: string; role: Role; employeeId: string | null };
}

interface ForgotResponse {
  message: string;
  demoResetToken?: string;
}

export function Login() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('hr@meridian.test');
  const [password, setPassword] = useState('Passw0rd!');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotResult, setForgotResult] = useState<ForgotResponse | null>(null);
  // The live demo's API is on Render's free tier, which sleeps after 15 minutes idle and
  // takes 30-60s to wake on the next request. Without this, "Signing in..." on a button for
  // a full minute with nothing else on the page reads exactly like the app is frozen -- this
  // says what's actually happening instead of leaving that to be guessed at.
  const [slowHint, setSlowHint] = useState(false);

  async function withSlowHint<T>(fn: () => Promise<T>): Promise<T> {
    const timer = setTimeout(() => setSlowHint(true), 4000);
    try {
      return await fn();
    } finally {
      clearTimeout(timer);
      setSlowHint(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await withSlowHint(() => post<LoginResponse>('/auth/login', { email, password }));
      tokens.set(res.accessToken, res.refreshToken);
      dispatch(signedIn(res.user));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setForgotResult(null);
    try {
      const res = await withSlowHint(() => post<ForgotResponse>('/auth/forgot-password', { email }));
      setForgotResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function backToLogin() {
    setMode('login');
    setForgotResult(null);
    setError(null);
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <Logo compact tagline="Predictive HR Information System" />

        {mode === 'login' ? (
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
            {busy && slowHint && (
              <p className="notice content-in" style={{ textAlign: 'center', margin: '10px 0 0' }}>
                Waking up the demo server — it sleeps when idle and can take up to a minute to
                respond on the first request. Still working, not stuck.
              </p>
            )}
            <p style={{ textAlign: 'center', margin: '12px 0 0' }}>
              <button
                type="button"
                className="sm"
                style={{ border: 'none', background: 'none', color: 'var(--accent)' }}
                onClick={() => setMode('forgot')}
              >
                Forgot password?
              </button>
            </p>
            {error && <p className="error content-in">{error}</p>}
          </form>
        ) : (
          <form className="card" onSubmit={submitForgot}>
            <p className="page-sub" style={{ margin: '0 0 14px' }}>
              Enter the email on your account and we'll send a reset link — F1.4, US-05.
            </p>
            <div className="field">
              <label htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={Boolean(forgotResult)}
              />
            </div>

            {!forgotResult && (
              <button className="primary" style={{ width: '100%' }} disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
            )}
            {busy && slowHint && (
              <p className="notice content-in" style={{ textAlign: 'center', margin: '10px 0 0' }}>
                Waking up the demo server — it sleeps when idle and can take up to a minute to
                respond on the first request. Still working, not stuck.
              </p>
            )}

            {forgotResult && (
              <div className="notice content-in" style={{ marginTop: 4 }}>
                <p>{forgotResult.message}</p>
                {forgotResult.demoResetToken && (
                  <>
                    <p className="error" style={{ margin: '8px 0' }}>
                      No email service is configured for this demo — a real deployment would
                      email this link instead of showing it here.
                    </p>
                    <button
                      type="button"
                      className="primary sm"
                      onClick={() => navigate(`/reset-password?token=${forgotResult.demoResetToken}`)}
                    >
                      Continue to reset your password →
                    </button>
                  </>
                )}
              </div>
            )}

            <p style={{ textAlign: 'center', margin: '14px 0 0' }}>
              <button
                type="button"
                className="sm"
                style={{ border: 'none', background: 'none', color: 'var(--accent)' }}
                onClick={backToLogin}
              >
                ← Back to sign in
              </button>
            </p>
            {error && <p className="error content-in">{error}</p>}
          </form>
        )}

        {mode === 'login' && (
          <p className="notice">
            Demo accounts (password <code>Passw0rd!</code>):
            <br />
            <code>hr@meridian.test</code> — HR Admin
            <br />
            <code>shabnam.rahman@meridian.test</code> — Manager
            <br />
            <code>farhana.akter@meridian.test</code> — Employee
          </p>
        )}
      </div>
    </div>
  );
}
