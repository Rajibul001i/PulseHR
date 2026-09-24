import { useEffect, useRef, useState } from 'react';
import { get, post } from '../api';
import { CorrectionForm, CorrectionQueue, MyCorrections, MyDutyTime, dhakaTime } from '../components/AttendanceTools';

interface GridRow {
  employee_id: string;
  full_name: string;
  work_date: string;
  status: string;
  late_minutes: number;
  ot_hours: number;
  check_in?: string | null;
  check_out?: string | null;
}

function monthBounds(iso: string): { from: string; to: string; days: string[] } {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (d: number) => `${iso}-${String(d).padStart(2, '0')}`;
  return {
    from: pad(1),
    to: pad(last),
    days: Array.from({ length: last }, (_, i) => pad(i + 1)),
  };
}

export function Attendance({ role }: { role: string }) {
  const now = new Date();
  const [month, setMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [rows, setRows] = useState<GridRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [managed, setManaged] = useState<{ employee_id: string; full_name: string }[]>([]);
  const [preset, setPreset] = useState<{ employeeId: string; workDate: string } | null>(null);
  const [hasOwnRecord, setHasOwnRecord] = useState(role !== 'HR_ADMIN');
  const fixRef = useRef<HTMLDivElement>(null);
  const canFix = role === 'MANAGER' || role === 'HR_ADMIN';

  useEffect(() => {
    // Managers and HR fix attendance for the people they manage (the API scopes the list).
    if (canFix) get<{ employee_id: string; full_name: string }[]>('/shifts/overview').then(setManaged).catch(() => setManaged([]));
    get<{ employee: unknown }>('/me').then((m) => setHasOwnRecord(!!m.employee)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  const refresh = () => {
    setRefreshKey((k) => k + 1);
    void load();
  };

  function pickCell(employeeId: string, workDate: string) {
    setPreset({ employeeId, workDate });
    fixRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const { from, to, days } = monthBounds(month);
  const todayDhaka = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

  async function load() {
    try {
      const path = role === 'EMPLOYEE' ? '/attendance/mine' : '/attendance/grid';
      setRows(await get<GridRow[]>(`${path}?from=${from}&to=${to}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, role]);

  async function punch(kind: 'check-in' | 'check-out') {
    setError(null);
    try {
      const res = await post<Record<string, unknown>>(`/attendance/${kind}`);
      setMessage(
        kind === 'check-in'
          ? `Checked in for ${res.workDate}${res.shift ? ` on the ${res.shift} shift` : ''} (${res.lateMinutes ? `${res.lateMinutes} min late` : 'on time'})`
          : `Checked out — ${res.hoursWorked}h worked, ${res.otHours}h overtime`,
      );
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Group into a per-employee row of daily cells.
  const byEmployee = new Map<string, { name: string; cells: Map<string, GridRow> }>();
  for (const r of rows) {
    const key = r.employee_id ?? 'me';
    if (!byEmployee.has(key)) byEmployee.set(key, { name: r.full_name ?? 'Me', cells: new Map() });
    byEmployee.get(key)!.cells.set(r.work_date, r);
  }

  return (
    <>
      <h1>Attendance</h1>
      <p className="page-sub">
        Business dates are derived in Asia/Dhaka; the weekend is Friday and Saturday.
      </p>
      {error && <p className="error content-in">{error}</p>}
      {message && <p className="notice">{message}</p>}

      <MyDutyTime />

      <div className="card">
        <div className="row">
          <div style={{ maxWidth: 190 }}>
            <label htmlFor="mo">Month</label>
            <input id="mo" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div style={{ flex: 2 }} />
          <div style={{ flex: 0, minWidth: 230 }}>
            <button className="primary sm" onClick={() => punch('check-in')}>
              Check in
            </button>{' '}
            <button className="sm" onClick={() => punch('check-out')}>
              Check out
            </button>
          </div>
        </div>
      </div>

      {canFix && (
        <div ref={fixRef} style={{ marginTop: 14 }}>
          <CorrectionQueue refreshKey={refreshKey} onDecided={refresh} />
          <CorrectionForm employees={managed} preset={preset} onDone={refresh} />
        </div>
      )}
      {hasOwnRecord && (
        <details className="card" style={{ marginTop: 14 }}>
          <summary className="stat-label" style={{ cursor: 'pointer' }}>
            My attendance is wrong — ask for a correction
          </summary>
          <div style={{ marginTop: 10 }}>
            <CorrectionForm onDone={refresh} />
            <MyCorrections refreshKey={refreshKey} />
          </div>
        </details>
      )}

      <div className="card att-grid">
        <table>
          <thead>
            <tr>
              <th className="name">Employee</th>
              {days.map((d) => (
                <th key={d}>{d.slice(-2)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...byEmployee.entries()].map(([id, row]) => (
              <tr key={id}>
                <td className="name">{row.name}</td>
                {days.map((d) => {
                  const cell = row.cells.get(d);
                  const late = cell?.status === 'PRESENT' && Number(cell.late_minutes) > 15;
                  const title = cell
                    ? `${d} · ${cell.status}${
                        cell.status === 'PRESENT'
                          ? ` · ${dhakaTime(cell.check_in)}–${dhakaTime(cell.check_out)} · ${cell.late_minutes} min late`
                          : ''
                      }`
                    : d;
                  const className = `cell ${late ? 'late' : (cell?.status ?? '')}`;
                  return (
                    <td key={d}>
                      {canFix && id !== 'me' && d <= todayDhaka ? (
                        <button type="button" className={className} title={`${title} · click to fix`} aria-label={`Fix ${row.name}, ${d}`} onClick={() => pickCell(id, d)} />
                      ) : (
                        <span className={className} title={title} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {byEmployee.size === 0 && (
              <tr>
                <td className="notice">No attendance records for this month.</td>
              </tr>
            )}
          </tbody>
        </table>

        {canFix && <p className="stat-note">Hover a day to see its times. Click a day to fix it.</p>}
        <div className="legend">
          <span>
            <i className="cell PRESENT" /> Present
          </span>
          <span>
            <i className="cell late" /> Late (&gt;15 min)
          </span>
          <span>
            <i className="cell ABSENT" /> Unplanned absence
          </span>
          <span>
            <i className="cell ON_LEAVE" /> On leave
          </span>
          <span>
            <i className="cell WEEKEND" /> Weekend (Fri/Sat)
          </span>
        </div>
      </div>
    </>
  );
}
