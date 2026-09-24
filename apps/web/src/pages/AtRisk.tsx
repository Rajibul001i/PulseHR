import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, type Contribution } from '../api';
import { useToast } from '../components/Toast';

interface ScoreDetail {
  score: {
    id: string;
    employee_id: string;
    score: number;
    band: string;
    scored_on: string;
    engine_version: string;
    contested: number;
    contest_note: string | null;
    contested_at: string | null;
    contest_outcome: 'UPHELD' | 'CORRECTED' | null;
    contest_review_note: string | null;
    contest_reviewed_at: string | null;
  };
  contributions: Contribution[];
  responsibleUse: string;
}

/**
 * The explainability view.
 *
 * spec §9: a bare number is never displayed. The API returns the score and its feature
 * contributions together or not at all, and this page renders both — an HR manager must
 * always be able to answer "why is this person at 72?".
 */
/** Spec §9: an employee may contest their score; HR reviews it and records the outcome. */
function ContestPanel({ score, onReviewed }: { score: ScoreDetail['score']; onReviewed: () => void }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState<'UPHELD' | 'CORRECTED'>('UPHELD');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/attrition/scores/${score.id}/contest-review`, { outcome, note });
      toast.success('Review recorded.');
      onReviewed();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="stat-label">Contested by the employee</div>
      <p style={{ marginBottom: 4 }}>“{score.contest_note}”</p>
      <p className="stat-note">Contested {score.contested_at?.slice(0, 10)}</p>
      {score.contest_outcome ? (
        <p className="notice" style={{ marginBottom: 0 }}>
          Reviewed {score.contest_reviewed_at?.slice(0, 10)}:{' '}
          <strong>{score.contest_outcome === 'UPHELD' ? 'score upheld' : 'score corrected'}</strong>. {score.contest_review_note}
        </p>
      ) : (
        <form onSubmit={submit} className="row" style={{ marginTop: 8 }}>
          <div style={{ flex: 0, minWidth: 190 }}>
            <label htmlFor="contest-outcome">Outcome</label>
            <select id="contest-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="UPHELD">Score upheld</option>
              <option value="CORRECTED">Score corrected</option>
            </select>
          </div>
          <div style={{ flex: 3 }}>
            <label htmlFor="contest-note">What HR found (the employee's reason is on record above)</label>
            <input id="contest-note" value={note} onChange={(e) => setNote(e.target.value)} required minLength={5} />
          </div>
          <div style={{ flex: 0, minWidth: 140 }}>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Record review'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function AtRisk() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ScoreDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    get<ScoreDetail>(`/attrition/scores/${id}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <p className="error content-in">{error}</p>;
  if (!data) return <p className="notice">Loading…</p>;

  const max = Math.max(...data.contributions.map((c) => c.weight), 1);

  return (
    <div className="content-in">
      <p className="page-sub">
        <Link to="/">← Dashboard</Link>
      </p>
      <h1>Risk score breakdown</h1>
      <p className="page-sub">
        Scored {data.score.scored_on} · engine {data.score.engine_version}
      </p>

      <div className="guard">{data.responsibleUse}</div>

      {Number(data.score.contested) === 1 && <ContestPanel score={data.score} onReviewed={() => void load()} />}

      <div className="grid grid-2">
        <div className="card">
          <div className="stat-label">Composite score</div>
          <div className="stat-value">
            {data.score.score}
            <span style={{ fontSize: 15, color: 'var(--muted)' }}> / 100</span>
          </div>
          <div style={{ marginTop: 8 }}>
            <span className={`badge ${data.score.band}`}>{data.score.band}</span>
          </div>
          <p className="stat-note" style={{ marginTop: 12 }}>
            Estimated probability of <strong>voluntary</strong> separation within 90 days.
            Involuntary separations are excluded by design.
          </p>
        </div>

        <div className="card">
          <div className="stat-label">What this is</div>
          <p className="notice" style={{ marginTop: 8 }}>
            A transparent expert-weighted scorecard, not a trained model. Weights come from HR
            interviews and are versioned. It is replaced by a fitted model only once 80 labelled
            separation events exist — 10 per predictor.
          </p>
        </div>
      </div>

      <h2>Contributing factors</h2>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Signal</th>
              <th style={{ width: '32%' }}>Contribution</th>
              <th className="num">Points</th>
              <th className="num">Max</th>
            </tr>
          </thead>
          <tbody>
            {data.contributions.map((c) => (
              <tr key={c.feature_key}>
                <td>
                  {c.label}
                  <div className="stat-note">{c.feature_key}</div>
                </td>
                <td>
                  <div className="bar">
                    <i style={{ transform: `scaleX(${c.points / max})` }} />
                  </div>
                </td>
                <td className="num">{c.points.toFixed(1)}</td>
                <td className="num" style={{ color: 'var(--muted)' }}>
                  {c.weight}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="notice">
        Performance-review scores are deliberately excluded from this model. The proposal
        identifies reviews as the artifact most affected by favouritism — feeding them in would
        launder that bias into an output that looks objective.
      </p>
    </div>
  );
}
