import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, type AtRiskRow, type LeaveRequestDto, type Me } from '../api';

export function Dashboard({ role }: { role: string }) {
  const [me, setMe] = useState<Me | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskRow[] | null>(null);
  const [pending, setPending] = useState<LeaveRequestDto[]>([]);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isHr = role === 'HR_ADMIN';

  async function load() {
    try {
      setMe(await get<Me>('/me'));
      if (isHr) setAtRisk(await get<AtRiskRow[]>('/attrition/at-risk?limit=8'));
      if (role !== 'EMPLOYEE') {
        setPending(await get<LeaveRequestDto[]>('/leave/requests?status=PENDING'));
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  async function rescore() {
    setScoring(true);
    try {
      // ADR-004: this enqueues a job; it does not run scoring in the request path.
      const { jobId } = await post<{ jobId: string }>('/attrition/runs');
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const job = await get<{ state: string }>(`/jobs/${jobId}`);
        if (job.state === 'DONE' || job.state === 'FAILED') break;
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScoring(false);
    }
  }

  const balances = me?.balances ?? {};
  const bands = (atRisk ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.band] = (acc[r.band] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <h1>Dashboard</h1>
      <p className="page-sub">
        {me?.employee ? String(me.employee.full_name) : 'HR Administrator'} · {role.replace('_', ' ')}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="grid grid-4">
        <div className="card">
          <div className="stat-label">Earned leave</div>
          <div className="stat-value">{balances.EARNED ?? '—'}</div>
          <div className="stat-note">§117 · accrued 1 per 18 days worked</div>
        </div>
        <div className="card">
          <div className="stat-label">Casual leave</div>
          <div className="stat-value">{balances.CASUAL ?? '—'}</div>
          <div className="stat-note">§115 · 10 days/year, lapses</div>
        </div>
        <div className="card">
          <div className="stat-label">Sick leave</div>
          <div className="stat-value">{balances.SICK ?? '—'}</div>
          <div className="stat-note">§116 · 14 days/year</div>
        </div>
        <div className="card">
          <div className="stat-label">{role === 'EMPLOYEE' ? 'My requests' : 'Pending approvals'}</div>
          <div className="stat-value">{pending.length || (role === 'EMPLOYEE' ? '—' : 0)}</div>
          <div className="stat-note">
            {role === 'EMPLOYEE' ? 'See Leave' : <Link to="/leave">Review queue →</Link>}
          </div>
        </div>
      </div>

      {isHr && (
        <>
          <h2>Attrition risk — top signals</h2>

          {/* spec §9: the prohibited-use notice is part of the UI contract, not a footnote. */}
          <div className="guard">
            <strong>Advisory only.</strong> These scores support retention conversations. Using a
            score in a termination, promotion, appraisal or pay decision is a prohibited use. Every
            view of this list is written to the audit log.
          </div>

          <div className="card">
            <div className="row no-print" style={{ marginBottom: 14 }}>
              <div style={{ flex: 2 }}>
                <span className="notice">
                  {atRisk?.length
                    ? `Scored ${atRisk[0]!.scored_on} · ${Object.entries(bands)
                        .map(([b, n]) => `${n} ${b.toLowerCase()}`)
                        .join(', ')}`
                    : 'No scores yet — run the nightly batch.'}
                </span>
              </div>
              <div style={{ flex: 0, minWidth: 150 }}>
                <button className="primary sm" onClick={rescore} disabled={scoring}>
                  {scoring ? 'Scoring…' : 'Run scoring batch'}
                </button>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th className="num">Score</th>
                  <th>Band</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(atRisk ?? []).map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.full_name}
                      <div className="stat-note">{r.designation}</div>
                    </td>
                    <td>{r.department_name ?? '—'}</td>
                    <td className="num">{r.score}</td>
                    <td>
                      <span className={`badge ${r.band}`}>{r.band}</span>
                    </td>
                    <td className="num">
                      <Link to={`/at-risk/${r.id}`}>Why? →</Link>
                    </td>
                  </tr>
                ))}
                {atRisk?.length === 0 && (
                  <tr>
                    <td colSpan={5} className="notice">
                      No scores yet. Run the scoring batch.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
