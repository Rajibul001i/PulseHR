import { useEffect, useState, type FormEvent } from 'react';
import { get, post } from '../api';
import { Picker } from './Combobox';

/**
 * Forgot password, in four steps: employee ID → last 4 NID digits → SMS code → new password.
 * Every check happens on the server (apps/api/src/recovery.ts); this screen only holds the
 * recovery token between steps.
 */

type Step = 'id' | 'nid' | 'otp' | 'password' | 'done';
const STEPS: { key: Exclude<Step, 'done'>; label: string }[] = [
  { key: 'id', label: 'Employee ID' },
  { key: 'nid', label: 'NID' },
  { key: 'otp', label: 'Phone code' },
  { key: 'password', label: 'New password' },
];

interface OtpSent {
  phone: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  demoOtp?: string;
}

const link = { border: 'none', background: 'none', color: 'var(--accent)', padding: 0 } as const;

export function AccountRecovery({ onBack, onUseEmail, onDone }: { onBack: () => void; onUseEmail: () => void; onDone: (email: string) => void }) {
  const [step, setStep] = useState<Step>('id');
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId] = useState('');
  const [employeeCode, setEmployeeCode] = useState('');
  const [nid, setNid] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryToken, setRecoveryToken] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<OtpSent | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<{ id: string; name: string }[]>('/auth/organisations')
      .then((rows) => {
        setOrgs(rows);
        if (rows.length === 1) setOrgId(rows[0]!.id);
      })
      .catch(() => setOrgs([]));
  }, []);

  // Count down to when a new code may be requested.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function attempt(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      // A locked or expired recovery can't continue; send them back to the start.
      if (/start again/i.test(message)) {
        setStep('id');
        setNid('');
        setCode('');
      }
    } finally {
      setBusy(false);
    }
  }

  const codeSent = (res: OtpSent) => {
    setSent(res);
    setResendIn(res.resendAfterSeconds);
    setCode('');
    setStep('otp');
  };

  const submitId = (e: FormEvent) => {
    e.preventDefault();
    if (!orgId) return setError('Choose your company.');
    void attempt(async () => {
      const res = await post<{ recoveryToken: string }>('/auth/recovery/start', { organisationId: orgId, employeeCode });
      setRecoveryToken(res.recoveryToken);
      setStep('nid');
    });
  };

  const submitNid = (e: FormEvent) => {
    e.preventDefault();
    void attempt(async () => codeSent(await post<OtpSent>('/auth/recovery/nid', { recoveryToken, nidLast4: nid })));
  };

  const resend = () => void attempt(async () => codeSent(await post<OtpSent>('/auth/recovery/resend', { recoveryToken })));

  const submitOtp = (e: FormEvent) => {
    e.preventDefault();
    void attempt(async () => {
      const res = await post<{ resetToken: string; email: string }>('/auth/recovery/otp', { recoveryToken, code });
      setResetToken(res.resetToken);
      setEmail(res.email);
      setStep('password');
    });
  };

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('The two passwords don’t match.');
    void attempt(async () => {
      await post('/auth/reset-password', { token: resetToken, password });
      setStep('done');
    });
  };

  const at = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="card">
      <h2 style={{ margin: '0 0 4px' }}>Reset your password</h2>
      {step !== 'done' && (
        <ol className="stepper" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i < at ? 'done' : i === at ? 'current' : ''} aria-current={i === at ? 'step' : undefined}>
              <span className="stepper-dot">{i < at ? '✓' : i + 1}</span>
              <span className="stepper-label">{s.label}</span>
            </li>
          ))}
        </ol>
      )}

      {step === 'id' && (
        <form onSubmit={submitId}>
          <div className="field">
            <label htmlFor="rec-org">Company</label>
            <Picker id="rec-org" options={orgs.map((o) => ({ id: o.id, label: o.name }))} value={orgId} onChange={setOrgId} placeholder="Type your company name…" required />
          </div>
          <div className="field">
            <label htmlFor="rec-code">Employee ID</label>
            <input
              id="rec-code"
              value={employeeCode}
              onChange={(e) => setEmployeeCode(e.target.value.toUpperCase())}
              placeholder="e.g. EMP-0001"
              autoComplete="username"
              autoFocus
              required
            />
            <div className="stat-note">It's on your ID card and your payslips.</div>
          </div>
          <button className="primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
      )}

      {step === 'nid' && (
        <form onSubmit={submitNid}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>
            To confirm it's you, enter the <strong>last 4 digits of your National ID (NID)</strong>.
          </p>
          <div className="field">
            <label htmlFor="rec-nid">Last 4 digits of your NID</label>
            <input
              id="rec-nid"
              className="code-input"
              value={nid}
              onChange={(e) => setNid(e.target.value.replace(/\D/g, '').slice(0, 4))}
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              placeholder="••••"
              autoComplete="off"
              autoFocus
              required
            />
          </div>
          <button className="primary" style={{ width: '100%' }} disabled={busy || nid.length !== 4}>
            {busy ? 'Checking…' : 'Verify and send code'}
          </button>
        </form>
      )}

      {step === 'otp' && sent && (
        <form onSubmit={submitOtp}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>
            We sent a 6-digit code by SMS to <strong>{sent.phone}</strong>. It expires in {Math.round(sent.expiresInSeconds / 60)} minutes.
          </p>
          {sent.demoOtp && (
            <div className="banner warn" style={{ marginBottom: 12 }}>
              Demo: no SMS gateway is set up, so the code is shown here instead: <strong style={{ letterSpacing: "0.15em" }}>{sent.demoOtp}</strong>
            </div>
          )}
          <div className="field">
            <label htmlFor="rec-otp">Code</label>
            <input
              id="rec-otp"
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="••••••"
              autoFocus
              required
            />
          </div>
          <button className="primary" style={{ width: '100%' }} disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Verify code'}
          </button>
          <p className="stat-note" style={{ textAlign: 'center', margin: '10px 0 0' }}>
            Didn't get it?{' '}
            {resendIn > 0 ? (
              <>Send a new code in {resendIn}s</>
            ) : (
              <button type="button" className="sm" style={link} onClick={resend} disabled={busy}>
                Send a new code
              </button>
            )}
          </p>
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={submitPassword}>
          <p className="page-sub" style={{ margin: '0 0 12px' }}>
            Verified. Choose a new password for <strong>{email}</strong>.
          </p>
          <div className="field">
            <label htmlFor="rec-pass">New password</label>
            <input id="rec-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete="new-password" autoFocus required />
            <div className="stat-note">At least 8 characters.</div>
          </div>
          <div className="field">
            <label htmlFor="rec-pass2">Confirm new password</label>
            <input id="rec-pass2" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} autoComplete="new-password" required />
          </div>
          <button className="primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      )}

      {step === 'done' && (
        <div className="content-in">
          <p>Your password has been changed, and you've been signed out everywhere else.</p>
          <p className="stat-note">
            Sign in with <strong>{email}</strong> and your new password.
          </p>
          <button className="primary" style={{ width: '100%' }} onClick={() => onDone(email)}>
            Go to sign in
          </button>
        </div>
      )}

      {error && <p className="error content-in">{error}</p>}

      {step !== 'done' && (
        <div className="row-tight" style={{ justifyContent: 'space-between', marginTop: 14 }}>
          <button type="button" className="sm" style={link} onClick={onBack}>
            ← Back to sign in
          </button>
          {step === 'id' && (
            <button type="button" className="sm" style={link} onClick={onUseEmail}>
              No employee ID? Use email
            </button>
          )}
        </div>
      )}
    </div>
  );
}
