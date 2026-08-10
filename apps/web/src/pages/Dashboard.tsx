import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  get,
  isUpgradeRequired,
  post,
  type AtRiskRow,
  type LeaveRequestDto,
  type Me,
  type SubscriptionDto,
  type UpgradeRequired,
} from '../api';
import { StatSkeleton, TableSkeleton, EmptyState, UpgradePrompt } from '../components/Feedback';
import { useToast } from '../components/Toast';

export function Dashboard({
  role,
  subscription,
}: {
  role: string;
  subscription: SubscriptionDto | null;
}) {
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);
  const [atRisk, setAtRisk] = useState<AtRiskRow[] | null>(null);
  const [gated, setGated] = useState<UpgradeRequired | null>(null);
  const [pending, setPending] = useState<LeaveRequestDto[]>([]);
  const [scoring, setScoring] = useState(false);
  const [loading, setLoading] = useState(true);

  const isHr = role === 'HR_ADMIN';

  const load = useCallback(async () => {
    try {
      setMe(await get<Me>('/me'));
      if (role !== 'EMPLOYEE') {
        setPending(await get<LeaveRequestDto[]>('/leave/requests?status=PENDING'));
      }
      if (isHr) {
        try {
          setAtRisk(await get<AtRiskRow[]>('/attrition/at-risk?limit=8'));
          setGated(null);
        } catch (err) {
          // 402 is not an error state — it is a sales surface. See docs/11 §4.
          if (isUpgradeRequired(err)) setGated(err.body);
          else throw err;
        }
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [role, isHr, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function rescore() {
    setScoring(true);
    try {
      // ADR-004: enqueue a job; scoring never runs in the request path.
      const { jobId } = await post<{ jobId: string }>('/attrition/runs');
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 250));
        const job = await get<{ state: string }>(`/jobs/${jobId}`);
        if (job.state === 'DONE') {
          toast.success('Scoring batch complete.');
          break;
        }
        if (job.state === 'FAILED') {
          toast.error('Scoring batch failed.');
          break;
        }
      }
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setScoring(false);
    }
  }

  const balances = me?.balances ?? {};

  return (
    <>
      <h1>Dashboard</h1>
      <p className="page-sub">
        {me?.employee ? String(me.employee.full_name) : 'HR Administrator'} ·{' '}
        {role.replace('_', ' ')}
        {subscription && ` · ${subscription.organisation}`}
      </p>

      {subscription?.seats.approachingLimit && (
        <div className="banner warn">
          <strong>{subscription.seats.remaining} seat
          {subscription.seats.remaining === 1 ? '' : 's'} remaining.</strong>{' '}
          <Link to="/plan">Review your plan</Link> before onboarding more employees.
        </div>
      )}

      {loading ? (
        <StatSkeleton />
      ) : (
        <div className="grid grid-4 content-in">
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
            <div className="stat-label">
              {role === 'EMPLOYEE' ? 'My requests' : 'Pending approvals'}
            </div>
            <div className="stat-value">{pending.length || (role === 'EMPLOYEE' ? '—' : 0)}</div>
            <div className="stat-note">
              {role === 'EMPLOYEE' ? 'See Leave' : <Link to="/leave">Review queue →</Link>}
            </div>
          </div>
        </div>
      )}

      {isHr && (
        <>
          <h2>Attrition risk</h2>

          {gated ? (
            <UpgradePrompt detail={gated} />
          ) : (
            <>
              <div className="guard">
                <strong>Advisory only.</strong> These scores support retention conversations.
                Using a score in a termination, promotion, appraisal or pay decision is a
                prohibited use. Every view of this list is written to the audit log.
              </div>

              {atRisk === null ? (
                <TableSkeleton rows={5} cols={5} />
              ) : atRisk.length === 0 ? (
                <EmptyState
                  icon="📊"
                  title="No scores yet"
                  body="The nightly batch has not run for this organisation. Run it now to see which employees are showing early signs of leaving."
                  action={
                    <button className="primary" onClick={rescore} disabled={scoring}>
                      {scoring ? 'Scoring…' : 'Run scoring batch'}
                    </button>
                  }
                />
              ) : (
                <div className="card content-in">
                  <div className="row no-print" style={{ marginBottom: 14 }}>
                    <div style={{ flex: 2 }}>
                      <span className="notice">Scored {atRisk[0]!.scored_on}</span>
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
                      {atRisk.map((r) => (
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
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
