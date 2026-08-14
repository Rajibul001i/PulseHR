import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LogoMark } from '../components/Logo';

interface PublicVacancy {
  id: string;
  title: string;
  requirements: string;
  deadline: string;
  organisation_name: string;
}

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);
  return res.json() as Promise<T>;
}

let fontsInjected = false;
/**
 * The careers pages carry a real display/mono type pairing the dense internal app
 * deliberately doesn't (see styles.css's .careers-page block). Loaded on mount, not in
 * index.html, so an HR admin who never visits a public careers link never pays for it.
 */
function useCareersFonts() {
  useEffect(() => {
    if (fontsInjected) return;
    fontsInjected = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href =
      'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }, []);
}

/** Whole days between today and an ISO deadline date, floored at 0 (never negative on a
 *  page that only ever lists vacancies the API has already filtered to still-open). */
function daysUntil(deadlineIso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadline = new Date(`${deadlineIso}T00:00:00`);
  return Math.max(0, Math.round((deadline.getTime() - today.getTime()) / 86_400_000));
}

/** 0 (calm) .. 1 (closing very soon) — drives both the chip state and the pulse spike height. */
function urgencyOf(days: number): number {
  return Math.max(0, Math.min(1, (21 - days) / 18));
}

function deadlineLabel(days: number): string {
  if (days === 0) return 'Closes today';
  if (days === 1) return 'Closes tomorrow';
  return `Closes in ${days}d`;
}

/**
 * An ECG-style waveform: one beat per open role, spike height driven by that role's real
 * urgency (closer deadline = taller, more coral-leaning spike) — a functional signal, not
 * decoration, and the one visual idea this whole redesign is built around.
 */
function pulsePath(urgencies: number[]): string {
  if (urgencies.length === 0) return 'M 0 30 L 800 30';
  const segment = 800 / urgencies.length;
  let d = 'M 0 30';
  urgencies.forEach((u, i) => {
    const x0 = i * segment;
    const peakHeight = 10 + u * 16;
    d += ` L ${x0 + segment * 0.18} 30`;
    d += ` L ${x0 + segment * 0.34} 30`;
    d += ` L ${x0 + segment * 0.46} ${30 - peakHeight}`;
    d += ` L ${x0 + segment * 0.58} ${30 + peakHeight * 0.45}`;
    d += ` L ${x0 + segment * 0.72} 30`;
    d += ` L ${x0 + segment} 30`;
  });
  return d;
}

function PulseHeader({
  orgName,
  count,
  urgencies,
  compact,
  children,
}: {
  orgName: string | null;
  count?: number;
  urgencies?: number[];
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="careers-header">
      <div className="careers-header-top">
        <div className="careers-brand-mark">
          <LogoMark size={22} />
        </div>
        <span className="careers-powered-by">Powered by PulseHR</span>
      </div>
      <div className="careers-org-block">
        {children ?? (
          <>
            <h1 className="careers-org-name">{orgName ?? 'Loading…'}</h1>
            {typeof count === 'number' && (
              <p className="careers-eyebrow">
                <span className="careers-eyebrow-dot" />
                {count === 0 ? 'No positions open right now' : `${count} position${count === 1 ? '' : 's'} open now`}
              </p>
            )}
          </>
        )}
      </div>
      {!compact && (
        <svg className="careers-pulse" viewBox="0 0 800 60" preserveAspectRatio="none" aria-hidden="true">
          <path className="careers-pulse-line" d={pulsePath(urgencies?.length ? urgencies : [0.15, 0.4, 0.1])} />
        </svg>
      )}
    </div>
  );
}

function CareersFooter({ orgName }: { orgName: string | null }) {
  return (
    <div className="careers-footer">
      <LogoMark size={14} />
      {orgName ? `${orgName}'s hiring is run on PulseHR` : 'Hiring run on PulseHR'}
    </div>
  );
}

/**
 * F7.1 / US-34 — "reachable on a public link with no login." This page (and CareersApply
 * below) lives outside the authenticated Shell entirely; App.tsx routes here before checking
 * auth state, the same way /reset-password does.
 */
export function CareersList() {
  useCareersFonts();
  const { orgId } = useParams<{ orgId: string }>();
  const [vacancies, setVacancies] = useState<PublicVacancy[] | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    // Fetched independently of the vacancy list -- an org with zero open positions right
    // now must still identify itself, not get stuck showing "Loading…" forever.
    publicGet<{ name: string }>(`/public/organisations/${orgId}`)
      .then((org) => setOrgName(org.name))
      .catch(() => {});
    publicGet<PublicVacancy[]>(`/public/vacancies?org=${orgId}`)
      .then(setVacancies)
      .catch((e: Error) => setError(e.message));
  }, [orgId]);

  const urgencies = vacancies?.map((v) => urgencyOf(daysUntil(v.deadline))) ?? [];

  return (
    <div className="careers-page">
      <PulseHeader orgName={orgName} count={vacancies?.length} urgencies={urgencies} />
      <div className="careers-body">
        {error && (
          <div className="careers-error-box">
            <p>{error}</p>
          </div>
        )}
        {vacancies === null && !error && <div className="careers-loading">Loading open positions…</div>}
        {vacancies?.length === 0 && (
          <div className="careers-empty">
            <p>No open positions right now — check back soon.</p>
          </div>
        )}
        {vacancies && vacancies.length > 0 && (
          <div className="careers-list">
            {vacancies.map((v) => {
              const days = daysUntil(v.deadline);
              const urgent = urgencyOf(days) >= 0.7;
              return (
                <Link className="careers-row" key={v.id} to={`/careers/${orgId}/${v.id}`}>
                  <div className="careers-row-main">
                    <h2 className="careers-row-title">{v.title}</h2>
                    <p className="careers-row-desc">{v.requirements}</p>
                  </div>
                  <span className={`careers-chip${urgent ? ' urgent' : ''}`}>{deadlineLabel(days)}</span>
                  <span className="careers-row-arrow" aria-hidden="true">→</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <CareersFooter orgName={orgName} />
    </div>
  );
}

export function CareersApply() {
  useCareersFonts();
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
      <div className="careers-page">
        <PulseHeader orgName={vacancy?.organisation_name ?? null} compact />
        <div className="careers-body">
          <div className="careers-confirm">
            <div className="careers-confirm-check" aria-hidden="true">✓</div>
            <h1>Application received</h1>
            <p className="careers-confirm-sub">{vacancy?.organisation_name ?? 'The employer'} has your application.</p>
            <div className="careers-ref-stamp">
              <span className="careers-ref-label">Reference</span>
              {referenceCode}
            </div>
            <p className="careers-confirm-note">
              Keep this reference for your records — it's the fastest way to ask about your application's status.
            </p>
          </div>
        </div>
        <CareersFooter orgName={vacancy?.organisation_name ?? null} />
      </div>
    );
  }

  const days = vacancy ? daysUntil(vacancy.deadline) : 0;
  const urgent = vacancy ? urgencyOf(days) >= 0.7 : false;

  return (
    <div className="careers-page">
      <PulseHeader orgName={vacancy?.organisation_name ?? null} compact>
        <Link className="careers-back" to={`/careers/${orgId}`}>
          ← All positions
        </Link>
        {vacancy && (
          <div className="careers-detail-meta">
            <div>
              <p className="careers-detail-org">{vacancy.organisation_name}</p>
              <h1 className="careers-detail-title">{vacancy.title}</h1>
            </div>
            <span className={`careers-chip${urgent ? ' urgent' : ''}`}>{deadlineLabel(days)}</span>
          </div>
        )}
      </PulseHeader>
      <div className="careers-body">
        {error && !vacancy && (
          <div className="careers-error-box">
            <p>{error}</p>
          </div>
        )}
        {vacancy && (
          <>
            <p className="careers-requirements">{vacancy.requirements}</p>

            <form className="careers-form-panel" onSubmit={submit}>
              <p className="careers-form-eyebrow">Application</p>
              {error && <p className="careers-form-error">{error}</p>}

              <div className="careers-field-row">
                <span className="careers-field-num">01</span>
                <div className="careers-field-body">
                  <label htmlFor="ap-name">Full name</label>
                  <input
                    id="ap-name"
                    type="text"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="careers-field-row">
                <span className="careers-field-num">02</span>
                <div className="careers-field-body">
                  <label htmlFor="ap-email">Email</label>
                  <input
                    id="ap-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="careers-field-row">
                <span className="careers-field-num">03</span>
                <div className="careers-field-body">
                  <label htmlFor="ap-phone">
                    Phone <span className="optional">(optional)</span>
                  </label>
                  <input id="ap-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div className="careers-field-row">
                <span className="careers-field-num">04</span>
                <div className="careers-field-body">
                  <label htmlFor="ap-cv">CV — PDF, JPEG or PNG, up to 5MB</label>
                  <input id="ap-cv" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={onFile} required />
                </div>
              </div>

              <button className="careers-submit" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit application'}
              </button>
            </form>
          </>
        )}
      </div>
      <CareersFooter orgName={vacancy?.organisation_name ?? null} />
    </div>
  );
}
