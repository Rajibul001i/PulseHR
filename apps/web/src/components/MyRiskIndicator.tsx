import { useState, type FormEvent } from 'react';
import { ApiError, get, isUpgradeRequired, post, type Contribution } from '../api';
import { useToast } from './Toast';

interface OwnScore {
  score: {
    id: string;
    score: number;
    band: string;
    scored_on: string;
    contested: number;
    contest_outcome: string | null;
    contest_review_note: string | null;
  };
  contributions: Contribution[];
  responsibleUse: string;
}

/**
 * Spec §9: employees are told behavioural analytics run, may request their own score with
 * its contributions, and may contest it. Nothing loads until the employee asks.
 */
export function MyRiskIndicator() {
  const toast = useToast();
  const [data, setData] = useState<OwnScore | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'none' | 'unavailable'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function request() {
    setState('loading');
    try {
      setData(await get<OwnScore>('/me/attrition-score'));
      setState('idle');
    } catch (err) {
      if (isUpgradeRequired(err)) setState('unavailable');
      else if (err instanceof ApiError && err.status === 404) setState('none');
      else {
        toast.error((err as Error).message);
        setState('idle');
      }
    }
  }

  async function contest(e: FormEvent) {
    e.preventDefault();
    if (!data) return;
    setBusy(true);
    try {
      await post('/me/attrition-score/contest', { scoreId: data.score.id, note });
      toast.success('Sent to HR for review.');
      setData(await get<OwnScore>('/me/attrition-score'));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (state === 'unavailable') return null;

  return (
    <>
      <h2>My retention indicator</h2>
      <div className="card" style={{ maxWidth: 720 }}>
        <p className="notice" style={{ marginTop: 0 }}>
          PulseHR reads attendance, leave and goal activity to help HR notice when someone may be unhappy, so they
          can offer a conversation. It is never used for termination, promotion, appraisal or pay. You can see
          your own indicator and what produced it, and contest it if something is wrong.
        </p>
        {!data && (
          <button onClick={request} disabled={state === 'loading'}>
            {state === 'loading' ? 'Loading…' : 'Show my indicator'}
          </button>
        )}
        {state === 'none' && <p className="stat-note">You haven't been scored yet.</p>}

        {data && (
          <>
            <div className="row-tight" style={{ marginBottom: 10 }}>
              <span className="stat-value" style={{ fontSize: 26 }}>
                {data.score.score}
                <span style={{ fontSize: 14, color: 'var(--muted)' }}> / 100</span>
              </span>
              <span className={`badge ${data.score.band}`}>{data.score.band}</span>
              <span className="stat-note">scored {data.score.scored_on}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Signal</th>
                  <th className="num">Points</th>
                  <th className="num">Max</th>
                </tr>
              </thead>
              <tbody>
                {data.contributions.map((c) => (
                  <tr key={c.feature_key}>
                    <td>{c.label}</td>
                    <td className="num">{c.points.toFixed(1)}</td>
                    <td className="num" style={{ color: 'var(--muted)' }}>
                      {c.weight}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {Number(data.score.contested) === 1 ? (
              <p className="notice" style={{ marginBottom: 0 }}>
                {data.score.contest_outcome
                  ? `HR reviewed your contest: score ${data.score.contest_outcome === 'UPHELD' ? 'upheld' : 'corrected'}. ${data.score.contest_review_note ?? ''}`
                  : 'You contested this score. HR will review it.'}
              </p>
            ) : (
              <form onSubmit={contest} style={{ marginTop: 14 }}>
                <label htmlFor="contest-reason">Something wrong? Tell HR why (at least 10 characters)</label>
                <div className="row-tight">
                  <input
                    id="contest-reason"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    minLength={10}
                    required
                    style={{ flex: 1 }}
                    placeholder="e.g. my late arrivals were a road closure, now resolved"
                  />
                  <button className="primary" disabled={busy}>
                    {busy ? 'Sending…' : 'Contest'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </>
  );
}
