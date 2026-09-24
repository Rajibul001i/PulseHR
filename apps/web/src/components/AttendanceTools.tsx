import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, get, post } from '../api';
import { useToast } from './Toast';
import { Picker, employeeOptions } from './Combobox';

/** An instant shown as Dhaka wall-clock time, e.g. "09:05". */
export const dhakaTime = (iso: string | null | undefined): string =>
  iso
    ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
    : '—';

const todayDhaka = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });

interface DutyTime {
  today: {
    name: string;
    startTime: string;
    endTime: string;
    breakMinutes: number;
    graceMinutes: number;
    scheduledHours: number;
    overnight: boolean;
  } | null;
  roster: { date: string; status: 'WORK' | 'OFF' | 'HOLIDAY' | 'LEAVE'; shift: { name: string; startTime: string; endTime: string } | null }[];
}

export interface Correction {
  id: string;
  employee_id: string;
  full_name: string;
  work_date: string;
  requested_check_in: string;
  requested_check_out: string | null;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  decision_reason: string | null;
  previous_check_in: string | null;
  previous_check_out: string | null;
  requested_by: string;
  created_at: string;
  current_check_in: string | null;
  current_check_out: string | null;
  current_status: string | null;
}

/** What the record held: before the correction if decided, as it stands now if pending. */
function recorded(c: Correction): string {
  const [inAt, outAt, status] =
    c.status === 'PENDING' ? [c.current_check_in, c.current_check_out, c.current_status] : [c.previous_check_in, c.previous_check_out, null];
  if (!inAt && !outAt) return status === 'ABSENT' ? 'Marked absent' : 'No record';
  return `${dhakaTime(inAt)}–${outAt ? dhakaTime(outAt) : 'no check-out'}`;
}

/* ------------------------------- duty time ------------------------------- */

export function MyDutyTime() {
  const [data, setData] = useState<DutyTime | null | undefined>(undefined);

  useEffect(() => {
    get<DutyTime>('/me/shift')
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (data === null) return null; // no employee record (an HR admin account)
  const t = data?.today;
  return (
    <div className="card content-in" style={{ marginBottom: 14 }}>
      <div className="row-tight" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="stat-label">My duty time today</div>
          {data === undefined ? (
            <div className="stat-note">Loading…</div>
          ) : t ? (
            <>
              <div className="stat-value" style={{ fontSize: 22 }}>
                {t.startTime}–{t.endTime} <span style={{ fontSize: 14, color: 'var(--muted)' }}>{t.name}</span>
              </div>
              <div className="stat-note">
                {t.scheduledHours} hours after a {t.breakMinutes}-minute break · late after {t.graceMinutes} minutes
                {t.overnight ? ' · ends the next morning' : ''}
              </div>
            </>
          ) : (
            <div className="stat-note">No shift assigned yet. Your department's office hours apply.</div>
          )}
        </div>
      </div>
      {data && (
        <div className="roster" aria-label="Next 14 days">
          {data.roster.map((d) => (
            <div key={d.date} className={`roster-day ${d.status}`} title={d.shift ? `${d.shift.name} ${d.shift.startTime}–${d.shift.endTime}` : d.status}>
              <div className="roster-date">
                {weekday(d.date)} {d.date.slice(8)}
              </div>
              <div className="roster-time">
                {d.status === 'WORK' ? (d.shift ? `${d.shift.startTime}–${d.shift.endTime}` : 'Office hours') : d.status === 'OFF' ? 'Off' : d.status === 'HOLIDAY' ? 'Holiday' : 'Leave'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------- correction form ----------------------------- */

/**
 * One form, two uses: an employee requesting a fix to their own record (it waits for
 * approval), and a manager or HR fixing someone else's (it applies at once).
 */
export function CorrectionForm({
  employees,
  preset,
  onDone,
}: {
  employees?: { employee_id: string; full_name: string; employee_code?: string; department_name?: string | null }[];
  preset?: { employeeId: string; workDate: string } | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const forOthers = !!employees;
  const [form, setForm] = useState({ employeeId: '', workDate: '', checkIn: '09:00', checkOut: '17:00', reason: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preset) setForm((f) => ({ ...f, employeeId: preset.employeeId, workDate: preset.workDate }));
  }, [preset]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await post<{ status: string }>('/attendance/corrections', {
        ...(forOthers ? { employeeId: form.employeeId } : {}),
        workDate: form.workDate,
        checkIn: form.checkIn,
        checkOut: form.checkOut || null,
        reason: form.reason,
      });
      toast.success(res.status === 'APPROVED' ? 'Attendance corrected.' : 'Request sent for approval.');
      setForm((f) => ({ ...f, reason: '' }));
      onDone();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const id = forOthers ? 'fix' : 'req';
  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="stat-label" style={{ marginBottom: 8 }}>
        {forOthers ? 'Fix a check-in or check-out' : 'Ask for a correction'}
      </div>
      <div className="row">
        {forOthers && (
          <div style={{ flex: 2 }}>
            <label htmlFor={`${id}-emp`}>Employee</label>
            <Picker
              id={`${id}-emp`}
              options={employeeOptions(employees!)}
              value={form.employeeId}
              onChange={(employeeId) => setForm({ ...form, employeeId })}
              placeholder="Type a name…"
              required
            />
          </div>
        )}
        <div>
          <label htmlFor={`${id}-date`}>Date</label>
          <input id={`${id}-date`} type="date" max={todayDhaka()} value={form.workDate} onChange={(e) => setForm({ ...form, workDate: e.target.value })} required />
        </div>
        <div>
          <label htmlFor={`${id}-in`}>Check-in</label>
          <input id={`${id}-in`} type="time" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} required />
        </div>
        <div>
          <label htmlFor={`${id}-out`}>Check-out</label>
          <input id={`${id}-out`} type="time" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <div style={{ flex: 4 }}>
          <label htmlFor={`${id}-reason`}>Reason (kept on record)</label>
          <input
            id={`${id}-reason`}
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            minLength={5}
            required
            placeholder={forOthers ? 'e.g. card reader was down; confirmed with the team lead' : 'e.g. forgot to check out, left at 17:30'}
          />
        </div>
        <div style={{ flex: 0, minWidth: 150 }}>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : forOthers ? 'Save correction' : 'Send request'}
          </button>
        </div>
      </div>
      <p className="stat-note" style={{ marginBottom: 0 }}>
        A check-out earlier than the check-in counts as the next morning (a night shift). Months whose payroll has been issued can't be changed.
      </p>
    </form>
  );
}

/* ------------------------------ lists ------------------------------------ */

function times(c: Correction) {
  return `${dhakaTime(c.requested_check_in)}–${c.requested_check_out ? dhakaTime(c.requested_check_out) : '—'}`;
}

export function MyCorrections({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<Correction[] | null>(null);
  useEffect(() => {
    get<Correction[]>('/attendance/corrections?mine=1')
      .then(setRows)
      .catch(() => setRows([]));
  }, [refreshKey]);
  if (!rows || rows.length === 0) return null;
  return (
    <div className="card table-card" style={{ marginBottom: 14 }}>
      <div className="stat-label" style={{ marginBottom: 8 }}>
        My correction requests
      </div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Requested</th>
            <th>Reason</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>{c.work_date}</td>
              <td>{times(c)}</td>
              <td className="notice">{c.reason}</td>
              <td>
                <span className={`badge ${c.status}`}>{c.status}</span>
                {c.decision_reason && <div className="stat-note">{c.decision_reason}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CorrectionQueue({ refreshKey, onDecided }: { refreshKey: number; onDecided: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<Correction[] | null>(null);

  const load = () =>
    get<Correction[]>('/attendance/corrections')
      .then(setRows)
      .catch(() => setRows([]));
  useEffect(() => {
    void load();
  }, [refreshKey]);

  async function decide(c: Correction, decision: 'APPROVE' | 'REJECT') {
    let reason: string | undefined;
    if (decision === 'REJECT') {
      reason = window.prompt(`Reason for rejecting ${c.full_name}'s request (they will see this):`) ?? '';
      if (!reason.trim()) return;
    }
    try {
      await post(`/attendance/corrections/${c.id}/decision`, { decision, reason });
      toast.success(decision === 'APPROVE' ? `${c.full_name}'s attendance for ${c.work_date} corrected.` : 'Request rejected.');
      await load();
      onDecided();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const pending = rows?.filter((r) => r.status === 'PENDING') ?? [];
  const recent = rows?.filter((r) => r.status !== 'PENDING').slice(0, 8) ?? [];

  return (
    <div className="card table-card" style={{ marginBottom: 14 }}>
      <div className="stat-label" style={{ marginBottom: 8 }}>
        Corrections to review {pending.length > 0 && <span className="badge PENDING">{pending.length}</span>}
      </div>
      {rows !== null && pending.length === 0 && <p className="stat-note">Nothing waiting for review.</p>}
      {(pending.length > 0 || recent.length > 0) && (
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Date</th>
              <th>Recorded</th>
              <th>Requested</th>
              <th>Reason</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...pending, ...recent].map((c) => (
              <tr key={c.id}>
                <td>{c.full_name}</td>
                <td>{c.work_date}</td>
                <td className="stat-note">{recorded(c)}</td>
                <td>{times(c)}</td>
                <td className="notice">{c.reason}</td>
                <td className="num">
                  {c.status === 'PENDING' ? (
                    <>
                      <button className="sm" onClick={() => decide(c, 'APPROVE')}>
                        Approve
                      </button>{' '}
                      <button className="sm danger" onClick={() => decide(c, 'REJECT')}>
                        Reject
                      </button>
                    </>
                  ) : (
                    <span className={`badge ${c.status}`}>{c.status}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
