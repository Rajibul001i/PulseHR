import { useEffect, useState, type FormEvent } from 'react';
import { get, post, type LeaveRequestDto } from '../api';

const TYPES = ['EARNED', 'CASUAL', 'SICK', 'LWP'] as const;

export function Leave({ role }: { role: string }) {
  const [requests, setRequests] = useState<LeaveRequestDto[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    leaveType: 'EARNED' as (typeof TYPES)[number],
    startDate: '',
    endDate: '',
    reason: '',
  });

  const canDecide = role === 'MANAGER' || role === 'HR_ADMIN';

  async function load() {
    try {
      setRequests(await get<LeaveRequestDto[]>('/leave/requests'));
      try {
        setBalances(await get<Record<string, number>>('/leave/balances'));
      } catch {
        setBalances({}); // an HR admin has no employee record of their own
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await post('/leave/requests', form);
      setMessage('Request submitted.');
      setForm({ ...form, startDate: '', endDate: '', reason: '' });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function decide(id: string, decision: 'APPROVE' | 'REJECT') {
    setError(null);
    setMessage(null);
    try {
      const res = await post<{ status: string; balanceAfter?: number }>(
        `/leave/requests/${id}/decision`,
        { decision },
      );
      setMessage(
        res.balanceAfter === undefined
          ? `Request ${res.status.toLowerCase()}.`
          : `Approved. Remaining balance: ${res.balanceAfter} day(s).`,
      );
      await load();
    } catch (err) {
      // A 409 here is the concurrency guard doing its job (P0-7).
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h1>Leave</h1>
      <p className="page-sub">
        Balances are derived from an append-only ledger, never stored as a mutable column.
      </p>
      {error && <p className="error">{error}</p>}
      {message && <p className="notice">{message}</p>}

      {Object.keys(balances).length > 0 && (
        <div className="grid grid-4">
          {Object.entries(balances).map(([type, days]) => (
            <div className="card" key={type}>
              <div className="stat-label">{type}</div>
              <div className="stat-value">{days}</div>
              <div className="stat-note">days available</div>
            </div>
          ))}
        </div>
      )}

      <h2>Request leave</h2>
      <form className="card" onSubmit={submit}>
        <div className="row">
          <div>
            <label htmlFor="lt">Type</label>
            <select
              id="lt"
              value={form.leaveType}
              onChange={(e) => setForm({ ...form, leaveType: e.target.value as typeof form.leaveType })}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sd">From</label>
            <input
              id="sd"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              required
            />
          </div>
          <div>
            <label htmlFor="ed">To</label>
            <input
              id="ed"
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              required
            />
          </div>
          <div style={{ flex: 2 }}>
            <label htmlFor="rs">Reason</label>
            <input id="rs" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div style={{ flex: 0, minWidth: 110 }}>
            <button className="primary">Submit</button>
          </div>
        </div>
      </form>

      <h2>{canDecide ? 'Requests' : 'My requests'}</h2>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>From</th>
              <th>To</th>
              <th className="num">Days</th>
              <th>Reason</th>
              <th>Status</th>
              {canDecide && <th />}
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>{r.leaveType}</td>
                <td>{r.startDate}</td>
                <td>{r.endDate}</td>
                <td className="num">{r.days}</td>
                <td className="notice">{r.reason || '—'}</td>
                <td>
                  <span className={`badge ${r.status}`}>{r.status}</span>
                </td>
                {canDecide && (
                  <td className="num">
                    {r.status === 'PENDING' && (
                      <>
                        <button className="sm" onClick={() => decide(r.id, 'APPROVE')}>
                          Approve
                        </button>{' '}
                        <button className="sm danger" onClick={() => decide(r.id, 'REJECT')}>
                          Reject
                        </button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={canDecide ? 7 : 6} className="notice">
                  No requests.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
