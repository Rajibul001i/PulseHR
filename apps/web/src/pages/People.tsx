import { useEffect, useState, type FormEvent } from 'react';
import { formatBDT } from '@pulsehr/core';
import { get, post } from '../api';
import { EmptyState, TableSkeleton } from '../components/Feedback';
import { useToast } from '../components/Toast';
import { Picker, SearchBox, employeeOptions, filterOptions, type ComboOption } from '../components/Combobox';

interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  designation: string;
  department_id: string | null;
  department_name: string | null;
  manager_id: string | null;
  gender: string | null;
  hire_date: string;
  employment_status: 'ACTIVE' | 'RESIGNED' | 'TERMINATED';
  separation_date: string | null;
  user_id: string | null;
}

interface Department {
  id: string;
  name: string;
  officeStartTime: string;
  headcount: number;
}

interface SalaryStructure {
  id: string;
  effectiveFrom: string;
  basic: number;
  houseRent: number;
  medical: number;
  conveyance: number;
  food: number;
  dearness: number;
  providentFundPct: number;
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

const EMPTY_SALARY = { basic: '', houseRent: '', medical: '', conveyance: '', food: '', dearness: '', providentFundPct: '' };
type SalaryForm = typeof EMPTY_SALARY;
const SALARY_FIELDS: [keyof SalaryForm, string][] = [
  ['basic', 'Basic (BDT)'],
  ['houseRent', 'House rent'],
  ['medical', 'Medical'],
  ['conveyance', 'Conveyance'],
  ['food', 'Food'],
  ['dearness', 'Dearness'],
  ['providentFundPct', 'Provident fund %'],
];
const salaryPayload = (s: SalaryForm) =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));

function SalaryInputs({ value, onChange, idPrefix }: { value: SalaryForm; onChange: (v: SalaryForm) => void; idPrefix: string }) {
  return (
    <div className="form-grid">
      {SALARY_FIELDS.map(([key, label]) => (
        <div key={key}>
          <label htmlFor={`${idPrefix}-${key}`}>{label}</label>
          <input
            id={`${idPrefix}-${key}`}
            type="number"
            min="0"
            step="any"
            required={key === 'basic'}
            value={value[key]}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ add employee ------------------------------ */

function AddEmployee({
  departments,
  managers,
  onDone,
}: {
  departments: Department[];
  managers: Employee[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    employeeCode: '',
    fullName: '',
    designation: '',
    departmentId: '',
    managerId: '',
    hireDate: today(),
    gender: '',
  });
  const [salary, setSalary] = useState<SalaryForm>(EMPTY_SALARY);
  const [withLogin, setWithLogin] = useState(true);
  const [account, setAccount] = useState({ email: '', role: 'EMPLOYEE', temporaryPassword: '' });
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/employees', {
        ...form,
        departmentId: form.departmentId || null,
        managerId: form.managerId || null,
        gender: form.gender || null,
        salary: salaryPayload(salary),
        account: withLogin ? account : null,
      });
      toast.success(`${form.fullName} added.`);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <form className="card content-in" onSubmit={submit} style={{ marginBottom: 18 }}>
      <h2 style={{ marginTop: 0 }}>Add employee</h2>
      <div className="row">
        <div>
          <label htmlFor="ne-code">Employee code</label>
          <input id="ne-code" value={form.employeeCode} onChange={set('employeeCode')} required />
        </div>
        <div style={{ flex: 2 }}>
          <label htmlFor="ne-name">Full name</label>
          <input id="ne-name" value={form.fullName} onChange={set('fullName')} required minLength={2} />
        </div>
        <div style={{ flex: 2 }}>
          <label htmlFor="ne-designation">Designation</label>
          <input id="ne-designation" value={form.designation} onChange={set('designation')} required />
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <div>
          <label htmlFor="ne-dept">Department</label>
          <select id="ne-dept" value={form.departmentId} onChange={set('departmentId')}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ne-manager">Line manager</label>
          <Picker id="ne-manager" options={employeeOptions(managers)} value={form.managerId} onChange={(id) => setForm({ ...form, managerId: id })} noneLabel="None" />
        </div>
        <div>
          <label htmlFor="ne-hire">Hire date</label>
          <input id="ne-hire" type="date" value={form.hireDate} onChange={set('hireDate')} required />
        </div>
        <div>
          <label htmlFor="ne-gender">Gender (bias audit only)</label>
          <select id="ne-gender" value={form.gender} onChange={set('gender')}>
            <option value="">Not recorded</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
          </select>
        </div>
      </div>

      <h3>Starting salary</h3>
      <SalaryInputs value={salary} onChange={setSalary} idPrefix="ne-salary" />

      <h3>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 'inherit', color: 'inherit' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={withLogin} onChange={(e) => setWithLogin(e.target.checked)} />
          Create a PulseHR login
        </label>
      </h3>
      {withLogin && (
        <div className="row">
          <div style={{ flex: 2 }}>
            <label htmlFor="ne-email">Work email</label>
            <input id="ne-email" type="email" value={account.email} onChange={(e) => setAccount({ ...account, email: e.target.value })} required />
          </div>
          <div>
            <label htmlFor="ne-role">Role</label>
            <select id="ne-role" value={account.role} onChange={(e) => setAccount({ ...account, role: e.target.value })}>
              <option value="EMPLOYEE">Employee</option>
              <option value="MANAGER">Manager</option>
              <option value="HR_ADMIN">HR admin</option>
            </select>
          </div>
          <div>
            <label htmlFor="ne-password">Temporary password</label>
            <input
              id="ne-password"
              type="text"
              minLength={8}
              value={account.temporaryPassword}
              onChange={(e) => setAccount({ ...account, temporaryPassword: e.target.value })}
              required
            />
          </div>
        </div>
      )}
      <p className="stat-note">Casual and sick leave are granted on joining, pro-rated for the rest of the year.</p>
      <div className="row-tight">
        <button className="primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add employee'}
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ----------------------------- manage employee ---------------------------- */

function ManageEmployee({
  employee,
  departments,
  managers,
  onChanged,
  onClose,
}: {
  employee: Employee;
  departments: Department[];
  managers: Employee[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const active = employee.employment_status === 'ACTIVE';
  const [edit, setEdit] = useState({
    designation: employee.designation,
    employeeCode: employee.employee_code,
    departmentId: employee.department_id ?? '',
    managerId: employee.manager_id ?? '',
    gender: employee.gender ?? '',
  });
  const [structures, setStructures] = useState<SalaryStructure[] | null>(null);
  const [newSalary, setNewSalary] = useState<SalaryForm>(EMPTY_SALARY);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [separation, setSeparation] = useState({ status: 'RESIGNED', separationDate: today(), separationType: 'VOLUNTARY' });

  const loadSalary = () => get<SalaryStructure[]>(`/employees/${employee.id}/salary`).then(setStructures).catch(() => setStructures([]));
  useEffect(() => {
    void loadSalary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee.id]);

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action();
      toast.success(message);
      onChanged();
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    }
  }

  const saveEmployment = (e: FormEvent) => {
    e.preventDefault();
    void run(
      () =>
        post(`/employees/${employee.id}/employment`, {
          ...edit,
          departmentId: edit.departmentId || null,
          managerId: edit.managerId || null,
          gender: edit.gender || null,
        }),
      'Employment details saved.',
    );
  };

  const addSalary = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => post(`/employees/${employee.id}/salary`, { effectiveFrom, ...salaryPayload(newSalary) }), 'New salary structure added.');
    if (ok) {
      setNewSalary(EMPTY_SALARY);
      setEffectiveFrom('');
      void loadSalary();
    }
  };

  const separate = (e: FormEvent) => {
    e.preventDefault();
    const verb = separation.status === 'RESIGNED' ? 'resignation' : 'termination';
    if (!window.confirm(`Record the ${verb} of ${employee.full_name}? Their login stops working immediately.`)) return;
    void run(() => post(`/employees/${employee.id}/separate`, separation), `${employee.full_name}'s ${verb} recorded. Access removed.`);
  };

  return (
    <div className="card content-in" style={{ marginBottom: 18 }}>
      <div className="row-tight" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>
          {employee.full_name}{' '}
          <span className={`badge ${employee.employment_status}`}>{employee.employment_status}</span>
        </h2>
        <button className="sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="stat-note">
        {employee.employee_code} · joined {employee.hire_date}
        {employee.separation_date && ` · left ${employee.separation_date}`}
        {!employee.user_id && ' · no PulseHR login'}
      </p>

      <h3>Employment details</h3>
      <form className="row" onSubmit={saveEmployment}>
        <div style={{ flex: 2 }}>
          <label htmlFor="me-designation">Designation</label>
          <input id="me-designation" value={edit.designation} onChange={(e) => setEdit({ ...edit, designation: e.target.value })} disabled={!active} />
        </div>
        <div>
          <label htmlFor="me-code">Code</label>
          <input id="me-code" value={edit.employeeCode} onChange={(e) => setEdit({ ...edit, employeeCode: e.target.value })} disabled={!active} />
        </div>
        <div>
          <label htmlFor="me-dept">Department</label>
          <select id="me-dept" value={edit.departmentId} onChange={(e) => setEdit({ ...edit, departmentId: e.target.value })} disabled={!active}>
            <option value="">None</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="me-manager">Line manager</label>
          <Picker
            id="me-manager"
            options={employeeOptions(managers.filter((m) => m.id !== employee.id))}
            value={edit.managerId}
            onChange={(id) => setEdit({ ...edit, managerId: id })}
            noneLabel="None"
            disabled={!active}
          />
        </div>
        <div>
          <label htmlFor="me-gender">Gender</label>
          <select id="me-gender" value={edit.gender} onChange={(e) => setEdit({ ...edit, gender: e.target.value })} disabled={!active}>
            <option value="">Not recorded</option>
            <option value="F">Female</option>
            <option value="M">Male</option>
          </select>
        </div>
        {active && (
          <div style={{ flex: 0, minWidth: 90 }}>
            <button className="primary">Save</button>
          </div>
        )}
      </form>

      <h3>Salary history</h3>
      <p className="stat-note" style={{ marginTop: -6 }}>
        A salary is never edited. A new structure takes over from its effective date, so past payroll still reproduces.
      </p>
      {structures === null ? (
        <TableSkeleton rows={2} cols={5} />
      ) : (
        <div className="table-card">
          <table>
            <thead>
              <tr>
                <th>From</th>
                <th className="num">Basic</th>
                <th className="num">House rent</th>
                <th className="num">Other allowances</th>
                <th className="num">PF %</th>
              </tr>
            </thead>
            <tbody>
              {structures.map((s) => (
                <tr key={s.id}>
                  <td>{s.effectiveFrom}</td>
                  <td className="num">{formatBDT(s.basic)}</td>
                  <td className="num">{formatBDT(s.houseRent)}</td>
                  <td className="num">{formatBDT(s.medical + s.conveyance + s.food + s.dearness)}</td>
                  <td className="num">{s.providentFundPct}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {active && (
        <form onSubmit={addSalary} style={{ marginTop: 12 }}>
          <div className="row">
            <div style={{ flex: 0, minWidth: 170 }}>
              <label htmlFor="ms-from">Effective from</label>
              <input id="ms-from" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
            </div>
          </div>
          <SalaryInputs value={newSalary} onChange={setNewSalary} idPrefix="ms" />
          <button className="primary sm" style={{ marginTop: 10 }}>
            Add salary structure
          </button>
        </form>
      )}

      {active && (
        <>
          <h3>Record a separation</h3>
          <form className="row" onSubmit={separate}>
            <div>
              <label htmlFor="sep-status">Reason</label>
              <select id="sep-status" value={separation.status} onChange={(e) => setSeparation({ ...separation, status: e.target.value })}>
                <option value="RESIGNED">Resigned</option>
                <option value="TERMINATED">Terminated</option>
              </select>
            </div>
            <div>
              <label htmlFor="sep-type">Initiated by</label>
              <select id="sep-type" value={separation.separationType} onChange={(e) => setSeparation({ ...separation, separationType: e.target.value })}>
                <option value="VOLUNTARY">The employee (voluntary)</option>
                <option value="INVOLUNTARY">The company (involuntary)</option>
              </select>
            </div>
            <div>
              <label htmlFor="sep-date">Last working day</label>
              <input id="sep-date" type="date" value={separation.separationDate} onChange={(e) => setSeparation({ ...separation, separationDate: e.target.value })} required />
            </div>
            <div style={{ flex: 0, minWidth: 170 }}>
              <button className="danger">Record and remove access</button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

/* ------------------------------- departments ------------------------------ */

function Departments({ departments, onChanged }: { departments: Department[]; onChanged: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', officeStartTime: '09:00' });
  const [times, setTimes] = useState<Record<string, string>>({});

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await post('/departments', form);
      toast.success(`${form.name} added.`);
      setForm({ name: '', officeStartTime: '09:00' });
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function saveTime(d: Department) {
    try {
      await post(`/departments/${d.id}`, { officeStartTime: times[d.id] });
      toast.success(`${d.name} now starts at ${times[d.id]}. Lateness is measured from this time.`);
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <form className="card row" onSubmit={add} style={{ marginBottom: 14 }}>
        <div style={{ flex: 2 }}>
          <label htmlFor="nd-name">New department</label>
          <input id="nd-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </div>
        <div>
          <label htmlFor="nd-time">Office start time</label>
          <input id="nd-time" type="time" value={form.officeStartTime} onChange={(e) => setForm({ ...form, officeStartTime: e.target.value })} required />
        </div>
        <div style={{ flex: 0, minWidth: 90 }}>
          <button className="primary">Add</button>
        </div>
      </form>
      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th className="num">Headcount</th>
              <th>Office start time</th>
            </tr>
          </thead>
          <tbody>
            {departments.map((d) => {
              const value = times[d.id] ?? d.officeStartTime;
              return (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td className="num">{d.headcount}</td>
                  <td>
                    <div className="row-tight">
                      <label htmlFor={`dt-${d.id}`} className="sr-only">
                        Office start time for {d.name}
                      </label>
                      <input
                        id={`dt-${d.id}`}
                        type="time"
                        value={value}
                        onChange={(e) => setTimes({ ...times, [d.id]: e.target.value })}
                        style={{ width: 130 }}
                      />
                      {value !== d.officeStartTime && (
                        <button className="sm" onClick={() => saveTime(d)}>
                          Save
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------------------------- page ---------------------------------- */

/** HR administration: the employee directory (F2.4), adding (F1.1/F2.1), editing (F2.2),
 *  salary structures (F5.1), separation (F1.5) and departments (F2.3). */
export function People() {
  const [tab, setTab] = useState<'employees' | 'departments'>('employees');
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  // The whole directory, unaffected by the search: suggestions, managers and "Manage" use it.
  const [everyone, setEveryone] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [search, setSearch] = useState('');
  const [showLeavers, setShowLeavers] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load(q = search) {
    const [all, depts] = await Promise.all([get<Employee[]>('/employees'), get<Department[]>('/departments')]);
    const list = q.trim() ? await get<Employee[]>(`/employees?q=${encodeURIComponent(q.trim())}`) : all;
    setEveryone(all);
    setEmployees(list);
    setDepartments(depts);
  }

  useEffect(() => {
    void load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = employees?.filter((e) => showLeavers || e.employment_status === 'ACTIVE') ?? null;
  const managers = everyone.filter((e) => e.employment_status === 'ACTIVE');
  const selected = everyone.find((e) => e.id === selectedId) ?? null;

  // Suggestions: matching people (open them straight away), then matching departments.
  const suggest = (q: string): ComboOption[] => {
    const pool = everyone.filter((e) => showLeavers || e.employment_status === 'ACTIVE');
    const people = filterOptions(employeeOptions(pool), q, 6);
    const depts = departments
      .filter((d) => d.name.toLowerCase().includes(q.toLowerCase().trim()))
      .slice(0, 3)
      .map((d) => ({ id: `dept:${d.name}`, label: `Everyone in ${d.name}`, detail: `${d.headcount} people` }));
    return [...people, ...depts];
  };
  const pickSuggestion = (o: ComboOption) => {
    if (o.id.startsWith('dept:')) {
      const name = o.id.slice(5);
      setSearch(name);
      void load(name);
      return;
    }
    setSelectedId(o.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="view-fade">
      <h1>People</h1>
      <p className="page-sub">Employee records, salaries, departments and separations. Every change is audited.</p>

      <div className="segmented" role="group" aria-label="Section">
        <button aria-pressed={tab === 'employees'} onClick={() => setTab('employees')}>
          Employees
        </button>
        <button aria-pressed={tab === 'departments'} onClick={() => setTab('departments')}>
          Departments
        </button>
      </div>

      {tab === 'departments' ? (
        <Departments departments={departments} onChanged={() => void load()} />
      ) : (
        <>
          {adding && (
            <AddEmployee
              departments={departments}
              managers={managers}
              onDone={() => {
                setAdding(false);
                void load();
              }}
            />
          )}
          {selected && (
            <ManageEmployee
              key={selected.id + selected.employment_status}
              employee={selected}
              departments={departments}
              managers={managers}
              onChanged={() => void load()}
              onClose={() => setSelectedId(null)}
            />
          )}

          <div className="row-tight" style={{ marginBottom: 12, justifyContent: 'space-between' }}>
            <form
              className="row-tight"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                void load(search);
              }}
            >
              <SearchBox
                id="people-search"
                label="Search employees"
                placeholder="Name, code, designation or department"
                value={search}
                onChange={setSearch}
                onSubmit={(q) => void load(q)}
                suggest={suggest}
                onPick={pickSuggestion}
                style={{ width: 320 }}
              />
              <button className="sm">Search</button>
              <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', margin: 0 }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={showLeavers} onChange={(e) => setShowLeavers(e.target.checked)} />
                Show people who have left
              </label>
            </form>
            {!adding && (
              <button className="primary sm" onClick={() => setAdding(true)}>
                Add employee
              </button>
            )}
          </div>

          {visible === null ? (
            <TableSkeleton rows={6} cols={5} />
          ) : visible.length === 0 ? (
            <EmptyState icon="🧑‍💼" title="No one matches" body="Try another search, or add an employee." />
          ) : (
            <div className="card table-card content-in">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Department</th>
                    <th>Joined</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.id}>
                      <td>{e.employee_code}</td>
                      <td>
                        {e.full_name}
                        <div className="stat-note">{e.designation}</div>
                      </td>
                      <td>{e.department_name ?? '—'}</td>
                      <td>{e.hire_date}</td>
                      <td>
                        <span className={`badge ${e.employment_status}`}>{e.employment_status}</span>
                      </td>
                      <td className="num">
                        <button
                          className="sm"
                          onClick={() => {
                            setSelectedId(e.id);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
