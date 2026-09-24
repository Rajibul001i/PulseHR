import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../api';
import { useToast } from './Toast';

interface DepartmentRisk {
  department: string;
  scored: number;
  average_score: number;
  low: number;
  moderate: number;
  elevated: number;
  high: number;
}

interface Contest {
  id: string;
  full_name: string;
  department_name: string | null;
  score: number;
  band: string;
  scored_on: string;
  contested_at: string;
  contest_outcome: string | null;
}

interface BiasAudit {
  runOn: string;
  scoresOn: string | null;
  flagged: boolean;
  report: {
    subjects: number;
    threshold: number;
    minGroupSize: number;
    notes: string[];
    dimensions: {
      dimension: string;
      rawGap: number | null;
      adjustedGap: number | null;
      flagged: boolean;
      groups: { group: string; n: number; meanScore: number; compared: boolean }[];
    }[];
  };
}

const DIMENSION_LABEL: Record<string, string> = { gender: 'Gender', department: 'Department', tenure: 'Tenure band' };

async function waitForJob(jobId: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const job = await get<{ state: string }>(`/jobs/${jobId}`);
    if (job.state === 'DONE' || job.state === 'FAILED') return job.state;
  }
  return 'TIMEOUT';
}

/**
 * HR-only panels under the at-risk list: F9.5 department risk (aggregates only), the queue
 * of contested scores (spec §9), and the latest quarterly bias audit.
 */
export function RiskInsights() {
  const toast = useToast();
  const [departments, setDepartments] = useState<DepartmentRisk[] | null>(null);
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [audit, setAudit] = useState<BiasAudit | null | undefined>(undefined);
  const [auditing, setAuditing] = useState(false);

  async function load() {
    get<DepartmentRisk[]>('/attrition/departments').then(setDepartments).catch(() => setDepartments([]));
    get<Contest[]>('/attrition/contests').then(setContests).catch(() => setContests([]));
    get<BiasAudit | null>('/attrition/bias-audit').then(setAudit).catch(() => setAudit(null));
  }

  useEffect(() => {
    void load();
  }, []);

  async function runAudit() {
    setAuditing(true);
    try {
      const { jobId } = await post<{ jobId: string }>('/attrition/bias-audit/runs');
      const state = await waitForJob(jobId);
      if (state === 'DONE') toast.success('Bias audit complete.');
      else toast.error('The bias audit did not finish.');
      setAudit(await get<BiasAudit | null>('/attrition/bias-audit'));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAuditing(false);
    }
  }

  const open = contests?.filter((c) => !c.contest_outcome) ?? [];

  return (
    <>
      <h2>Risk by department</h2>
      <p className="stat-note" style={{ marginTop: -6 }}>
        Averages and counts only. No names, so this view can be shared with management.
      </p>
      <div className="card table-card content-in">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th className="num">Scored</th>
              <th className="num">Average</th>
              <th className="num">Low</th>
              <th className="num">Moderate</th>
              <th className="num">Elevated</th>
              <th className="num">High</th>
            </tr>
          </thead>
          <tbody>
            {departments?.map((d) => (
              <tr key={d.department}>
                <td>{d.department}</td>
                <td className="num">{d.scored}</td>
                <td className="num">
                  <strong>{d.average_score}</strong>
                </td>
                <td className="num">{d.low}</td>
                <td className="num">{d.moderate}</td>
                <td className="num">{d.elevated}</td>
                <td className="num">{d.high}</td>
              </tr>
            ))}
            {departments?.length === 0 && (
              <tr>
                <td colSpan={7} className="notice">
                  No scores yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <div className="card content-in">
          <div className="stat-label">Contested scores</div>
          <div className="stat-value">{contests === null ? '…' : open.length}</div>
          <div className="stat-note">
            {open.length === 0 ? 'Nothing waiting for review.' : 'Waiting for HR review. Open one to record the outcome.'}
          </div>
          {open.length > 0 && (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18 }}>
              {open.map((c) => (
                <li key={c.id}>
                  <Link to={`/at-risk/${c.id}`}>{c.full_name}</Link>{' '}
                  <span className="stat-note">
                    · scored {c.scored_on} · contested {c.contested_at.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card content-in">
          <div className="row-tight" style={{ justifyContent: 'space-between' }}>
            <div className="stat-label">Quarterly bias audit</div>
            <button className="sm" onClick={runAudit} disabled={auditing}>
              {auditing ? 'Running…' : 'Run now'}
            </button>
          </div>
          {audit === undefined ? (
            <p className="stat-note">Loading…</p>
          ) : audit === null ? (
            <p className="stat-note">
              Not run yet. It runs automatically on the first day of each quarter.
            </p>
          ) : (
            <>
              <div className="stat-value" style={{ fontSize: 20 }}>
                <span className={`badge ${audit.flagged ? 'HIGH' : 'LOW'}`}>
                  {audit.flagged ? 'Re-weighting required' : 'No gap above threshold'}
                </span>
              </div>
              <div className="stat-note">
                Run {audit.runOn} on {audit.report.subjects} scores · gaps above {audit.report.threshold} points,
                after controlling for tenure, are flagged
              </div>
              <table style={{ marginTop: 10 }}>
                <tbody>
                  {audit.report.dimensions.map((d) => (
                    <tr key={d.dimension}>
                      <td>{DIMENSION_LABEL[d.dimension] ?? d.dimension}</td>
                      <td className="num">
                        {d.dimension === 'tenure'
                          ? `raw gap ${d.rawGap ?? '—'} (by design)`
                          : `gap ${d.adjustedGap ?? '—'}`}
                      </td>
                      <td className="num">
                        {d.flagged ? <span className="badge HIGH">Flagged</span> : <span className="badge LOW">OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {audit.report.notes.map((n) => (
                <p className="stat-note" key={n} style={{ marginBottom: 0 }}>
                  {n}
                </p>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}
