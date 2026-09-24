import { useEffect, useState, type FormEvent } from 'react';
import { get, post } from '../api';
import { EmptyState, TableSkeleton } from '../components/Feedback';
import { useToast } from '../components/Toast';

interface Shift {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  grace_minutes: number;
  work_days: string | null;
  is_active: number;
  assigned: number;
}

interface OverviewRow {
  employee_id: string;
  full_name: string;
  employee_code: string;
  department_name: string | null;
  shift_name: string | null;
  start_time: string | null;
  end_time: string | null;
  next_from: string | null;
  next_shift_name: string | null;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ORG_WEEK = [0, 1, 2, 3, 4]; // Sunday–Thursday, the Bangladeshi working week
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const daysLabel = (wd: string | null) =>
  wd ? wd.split(',').map((d) => DAYS[Number(d)]).join(', ') : 'Organisation week (Sun–Thu)';

function DayPicker({ value, onChange, idPrefix }: { value: number[]; onChange: (v: number[]) => void; idPrefix: string }) {
  return (
    <div className="row-tight" role="group" aria-label="Working days">
      {DAYS.map((d, i) => (
        <label key={d} htmlFor={`${idPrefix}-${i}`} style={{ display: 'inline-flex', gap: 4, alignItems: 'center', margin: 0 }}>
          <input
            id={`${idPrefix}-${i}`}
            type="checkbox"
            style={{ width: 'auto' }}
            checked={value.includes(i)}
            onChange={() => onChange(value.includes(i) ? value.filter((x) => x !== i) : [...value, i].sort())}
          />
          {d}
        </label>
      ))}
    </div>
  );
}

function NewShift({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', startTime: '09:00', endTime: '17:00', breakMinutes: '60', graceMinutes: '10' });
  const [days, setDays] = useState<number[]>(ORG_WEEK);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const sameAsOrg = days.join(',') === ORG_WEEK.join(',');
      await post('/shifts', {
        name: form.name,
        startTime: form.startTime,
        endTime: form.endTime,
        breakMinutes: Number(form.breakMinutes),
        graceMinutes: Number(form.graceMinutes),
        workDays: sameAsOrg ? null : days,
      });
      toast.success(`${form.name} shift added.`);
      setForm({ ...form, name: '' });
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 14 }}>
      <div className="stat-label" style={{ marginBottom: 8 }}>
        New shift
      </div>
      <div className="row">
        <div style={{ flex: 2 }}>
          <label htmlFor="ns-name">Name</label>
          <input id="ns-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Night (US clients)" />
        </div>
        <div>
          <label htmlFor="ns-start">Starts</label>
          <input id="ns-start" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="ns-end">Ends</label>
          <input id="ns-end" type="time" value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="ns-break">Break (min)</label>
          <input id="ns-break" type="number" min="0" max="240" value={form.breakMinutes} onChange={(e) => setForm({ ...form, breakMinutes: e.target.value })} />
        </div>
        <div>
          <label htmlFor="ns-grace">Late after (min)</label>
          <input id="ns-grace" type="number" min="0" max="120" value={form.graceMinutes} onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })} />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10, alignItems: 'center' }}>
        <div style={{ flex: 4 }}>
          <DayPicker value={days} onChange={setDays} idPrefix="ns-day" />
        </div>
        <div style={{ flex: 0, minWidth: 110 }}>
          <button className="primary">Add shift</button>
        </div>
      </div>
      <p className="stat-note" style={{ marginBottom: 0 }}>
        An end time earlier than the start runs overnight; attendance counts on the day it starts. Overtime is paid for hours worked past 8 in a day
        (Labour Act §100, §108).
      </p>
    </form>
  );
}

export function Shifts({ role }: { role: string }) {
  const toast = useToast();
  const isHr = role === 'HR_ADMIN';
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [people, setPeople] = useState<OverviewRow[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [assign, setAssign] = useState({ shiftId: '', effectiveFrom: today() });
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ breakMinutes: '', graceMinutes: '', days: [] as number[] });

  async function load() {
    const [s, p] = await Promise.all([get<Shift[]>('/shifts'), get<OverviewRow[]>('/shifts/overview')]);
    setShifts(s);
    setPeople(p);
  }
  useEffect(() => {
    void load();
  }, []);

  async function doAssign(e: FormEvent) {
    e.preventDefault();
    try {
      await post('/shifts/assign', { employeeIds: selected, shiftId: assign.shiftId, effectiveFrom: assign.effectiveFrom });
      const name = shifts?.find((s) => s.id === assign.shiftId)?.name;
      toast.success(`${selected.length} ${selected.length === 1 ? 'person' : 'people'} on ${name} from ${assign.effectiveFrom}. They have been notified.`);
      setSelected([]);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function saveEdit(s: Shift) {
    try {
      await post(`/shifts/${s.id}`, {
        breakMinutes: Number(edit.breakMinutes),
        graceMinutes: Number(edit.graceMinutes),
        workDays: edit.days.join(',') === ORG_WEEK.join(',') ? null : edit.days,
      });
      toast.success(`${s.name} updated.`);
      setEditing(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function toggleActive(s: Shift) {
    try {
      await post(`/shifts/${s.id}`, { isActive: !Number(s.is_active) });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const allSelected = !!people?.length && selected.length === people.length;

  return (
    <div className="view-fade">
      <h1>Shifts</h1>
      <p className="page-sub">
        Who works when. Lateness is measured from each person's shift start, after its grace period.
        {role === 'MANAGER' && ' You can assign shifts to people in your department.'}
      </p>

      {isHr && <NewShift onDone={() => void load()} />}

      <h2>Shifts</h2>
      {shifts === null ? (
        <TableSkeleton rows={3} cols={6} />
      ) : shifts.length === 0 ? (
        <EmptyState icon="🕘" title="No shifts yet" body={isHr ? 'Add the first shift above.' : 'HR has not defined any shifts yet.'} />
      ) : (
        <div className="card table-card content-in">
          <table>
            <thead>
              <tr>
                <th>Shift</th>
                <th>Hours</th>
                <th className="num">Break</th>
                <th className="num">Late after</th>
                <th>Working days</th>
                <th className="num">People</th>
                {isHr && <th />}
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) =>
                editing === s.id ? (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>
                      {s.start_time}–{s.end_time}
                    </td>
                    <td className="num">
                      <label htmlFor={`e-break-${s.id}`} className="sr-only">Break minutes</label>
                      <input id={`e-break-${s.id}`} type="number" min="0" style={{ width: 70 }} value={edit.breakMinutes} onChange={(e) => setEdit({ ...edit, breakMinutes: e.target.value })} />
                    </td>
                    <td className="num">
                      <label htmlFor={`e-grace-${s.id}`} className="sr-only">Grace minutes</label>
                      <input id={`e-grace-${s.id}`} type="number" min="0" style={{ width: 70 }} value={edit.graceMinutes} onChange={(e) => setEdit({ ...edit, graceMinutes: e.target.value })} />
                    </td>
                    <td colSpan={2}>
                      <DayPicker value={edit.days} onChange={(days) => setEdit({ ...edit, days })} idPrefix={`e-day-${s.id}`} />
                    </td>
                    <td className="num">
                      <button className="sm primary" onClick={() => saveEdit(s)}>
                        Save
                      </button>{' '}
                      <button className="sm" onClick={() => setEditing(null)}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} style={Number(s.is_active) ? undefined : { opacity: 0.55 }}>
                    <td>
                      {s.name} {!Number(s.is_active) && <span className="badge NEUTRAL">Retired</span>}
                    </td>
                    <td>
                      {s.start_time}–{s.end_time}
                      {s.end_time <= s.start_time && <div className="stat-note">ends next morning</div>}
                    </td>
                    <td className="num">{s.break_minutes} min</td>
                    <td className="num">{s.grace_minutes} min</td>
                    <td>{daysLabel(s.work_days)}</td>
                    <td className="num">{s.assigned}</td>
                    {isHr && (
                      <td className="num">
                        <button
                          className="sm"
                          onClick={() => {
                            setEditing(s.id);
                            setEdit({
                              breakMinutes: String(s.break_minutes),
                              graceMinutes: String(s.grace_minutes),
                              days: s.work_days ? s.work_days.split(',').map(Number) : ORG_WEEK,
                            });
                          }}
                        >
                          Edit
                        </button>{' '}
                        <button className="sm" onClick={() => toggleActive(s)}>
                          {Number(s.is_active) ? 'Retire' : 'Restore'}
                        </button>
                      </td>
                    )}
                  </tr>
                ),
              )}
            </tbody>
          </table>
          {isHr && <p className="stat-note" style={{ marginBottom: 0 }}>
            Start and end times can't be edited, because past lateness was measured against them. For different hours, add a new shift and assign it
            from a date.
          </p>}
        </div>
      )}

      <h2>Who works which shift</h2>
      <form className="card row" onSubmit={doAssign} style={{ marginBottom: 10 }}>
        <div style={{ flex: 2 }}>
          <label htmlFor="as-shift">Assign the selected people to</label>
          <select id="as-shift" value={assign.shiftId} onChange={(e) => setAssign({ ...assign, shiftId: e.target.value })} required>
            <option value="">Choose a shift…</option>
            {shifts
              ?.filter((s) => Number(s.is_active))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.start_time}–{s.end_time})
                </option>
              ))}
          </select>
        </div>
        <div>
          <label htmlFor="as-from">Starting</label>
          <input id="as-from" type="date" min={today()} value={assign.effectiveFrom} onChange={(e) => setAssign({ ...assign, effectiveFrom: e.target.value })} required />
        </div>
        <div style={{ flex: 0, minWidth: 170 }}>
          <button className="primary" disabled={selected.length === 0}>
            Assign {selected.length || ''} {selected.length === 1 ? 'person' : 'people'}
          </button>
        </div>
      </form>

      {people === null ? (
        <TableSkeleton rows={6} cols={5} />
      ) : (
        <div className="card table-card content-in">
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <label htmlFor="sel-all" className="sr-only">Select everyone</label>
                  <input id="sel-all" type="checkbox" style={{ width: 'auto' }} checked={allSelected} onChange={() => setSelected(allSelected ? [] : people.map((p) => p.employee_id))} />
                </th>
                <th>Employee</th>
                <th>Department</th>
                <th>Current shift</th>
                <th>Next change</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.employee_id}>
                  <td>
                    <label htmlFor={`sel-${p.employee_id}`} className="sr-only">Select {p.full_name}</label>
                    <input
                      id={`sel-${p.employee_id}`}
                      type="checkbox"
                      style={{ width: 'auto' }}
                      checked={selected.includes(p.employee_id)}
                      onChange={() => setSelected((s) => (s.includes(p.employee_id) ? s.filter((x) => x !== p.employee_id) : [...s, p.employee_id]))}
                    />
                  </td>
                  <td>
                    {p.full_name}
                    <div className="stat-note">{p.employee_code}</div>
                  </td>
                  <td>{p.department_name ?? '—'}</td>
                  <td>{p.shift_name ? `${p.shift_name} · ${p.start_time}–${p.end_time}` : <span className="stat-note">Office hours (no shift)</span>}</td>
                  <td>{p.next_from ? `${p.next_shift_name} from ${p.next_from}` : <span className="stat-note">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
