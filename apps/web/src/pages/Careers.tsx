import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

interface PublicVacancy {
  id: string;
  title: string;
  requirements: string;
  deadline: string;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

/**
 * F7.1 / US-34 — "reachable on a public link with no login." This page (and CareersApply
 * below) lives outside the authenticated Shell entirely; App.tsx routes here before checking
 * auth state, the same way /reset-password does.
 */
export function CareersList() {
  const { orgId } = useParams<{ orgId: string }>();
  const [vacancies, setVacancies] = useState<PublicVacancy[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    publicGet<PublicVacancy[]>(`/public/vacancies?org=${orgId}`)
      .then(setVacancies)
      .catch((e: Error) => setError(e.message));
  }, [orgId]);

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ maxWidth: 520 }}>
        <div className="brand" style={{ padding: 0 }}>
          Pulse<span>HR</span>
        </div>
        <div className="brand-sub" style={{ padding: '2px 0 22px' }}>
          Careers
        </div>
        <h1>Open positions</h1>
        {error && <p className="error">{error}</p>}
        {vacancies === null && !error && <p className="notice">Loading…</p>}
        {vacancies?.length === 0 && <p className="notice">No open positions right now — check back soon.</p>}
        {vacancies?.map((v) => (
          <div className="card content-in" key={v.id} style={{ marginBottom: 12 }}>
            <strong>{v.title}</strong>
            <p className="stat-note">Apply by {v.deadline}</p>
            <p>{v.requirements}</p>
            <Link to={`/careers/${orgId}/${v.id}`}>
              <button className="primary sm">Apply</button>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CareersApply() {
  const { orgId, vacancyId } = useParams<{ orgId: string; vacancyId: string }>();
  const [vacancy, setVacancy] = useState<PublicVacancy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [referenceCode, setReferenceCode] = useState<string | null>(null);

  const [form, setForm] = useState({ fullName: '', email: '', phone: '' });
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!orgId || !vacancyId) return;
    publicGet<PublicVacancy>(`/public/vacancies/${vacancyId}?org=${orgId}`)
      .then(setVacancy)
      .catch((e: Error) => setError(e.message));
  }, [orgId, vacancyId]);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Attach your CV (PDF, JPEG or PNG) before submitting.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${API_BASE}/public/vacancies/${vacancyId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organisationId: orgId,
          fullName: form.fullName,
          email: form.email,
          phone: form.phone || undefined,
          cvFilename: file.name,
          cvMimeType: file.type,
          cvContentBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      // US-35: "The applicant receives a confirmation carrying a reference number."
      setReferenceCode(body.referenceCode);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (referenceCode) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Application received</h1>
          <p>
            Thank you — your application has entered our pipeline. Keep this reference for your
            records:
          </p>
          <p style={{ fontSize: 22, fontWeight: 700 }}>{referenceCode}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <p className="page-sub">
          <Link to={`/careers/${orgId}`}>← All positions</Link>
        </p>
        {error && !vacancy && <p className="error">{error}</p>}
        {vacancy && (
          <>
            <h1>{vacancy.title}</h1>
            <p className="stat-note">Apply by {vacancy.deadline}</p>
            <p>{vacancy.requirements}</p>

            <form className="card" onSubmit={submit}>
              {error && <p className="error">{error}</p>}
              <div className="field">
                <label htmlFor="ap-name">Full name</label>
                <input
                  id="ap-name"
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="ap-email">Email</label>
                <input
                  id="ap-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="ap-phone">Phone (optional)</label>
                <input id="ap-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="ap-cv">CV (PDF, JPEG or PNG, up to 5MB)</label>
                <input id="ap-cv" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={onFile} required />
              </div>
              <button className="primary" disabled={submitting} style={{ width: '100%' }}>
                {submitting ? 'Submitting…' : 'Submit application'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
