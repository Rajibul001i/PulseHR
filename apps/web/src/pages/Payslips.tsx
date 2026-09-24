import { useEffect, useState } from 'react';
import { formatBDT } from '@pulsehr/core';
import { get, post, tokens, type PayslipDto, type PayslipLineDto } from '../api';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface EmployeeSummary {
  id: string;
  full_name: string;
  employee_code: string;
}

interface SummaryRow {
  department: string;
  headcount: number;
  gross: number;
  deductions: number;
  net: number;
}

/** F5.5 — salary expenditure per department for one month, for management reporting. */
function PayrollSummary() {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [period, setPeriod] = useState(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}`);
  const [data, setData] = useState<{ departments: SummaryRow[]; total: Omit<SummaryRow, 'department'> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const [year, month] = period.split('-').map(Number);
    setData(null);
    setError(null);
    get<{ departments: SummaryRow[]; total: Omit<SummaryRow, 'department'> }>(`/payroll/summary?year=${year}&month=${month}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [period]);

  return (
    <>
      <div className="row-tight" style={{ justifyContent: 'space-between', marginTop: 26 }}>
        <h2 style={{ margin: 0 }}>Payroll by department</h2>
        <div className="row-tight">
          <label htmlFor="summary-month" className="stat-note">
            Month
          </label>
          <input
            id="summary-month"
            type="month"
            value={period}
            onChange={(e) => e.target.value && setPeriod(e.target.value)}
            style={{ width: 170 }}
          />
        </div>
      </div>
      {error && <p className="error content-in">{error}</p>}
      <div className="card table-card" style={{ marginTop: 10 }}>
        <table>
          <thead>
            <tr>
              <th>Department</th>
              <th className="num">Payslips</th>
              <th className="num">Gross</th>
              <th className="num">Deductions</th>
              <th className="num">Net pay</th>
            </tr>
          </thead>
          <tbody>
            {data?.departments.map((d) => (
              <tr key={d.department}>
                <td>{d.department}</td>
                <td className="num">{d.headcount}</td>
                <td className="num">{formatBDT(d.gross)}</td>
                <td className="num">{formatBDT(d.deductions)}</td>
                <td className="num">{formatBDT(d.net)}</td>
              </tr>
            ))}
            {data && data.departments.length > 0 && (
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                <td className="num">{data.total.headcount}</td>
                <td className="num">{formatBDT(data.total.gross)}</td>
                <td className="num">{formatBDT(data.total.deductions)}</td>
                <td className="num">{formatBDT(data.total.net)}</td>
              </tr>
            )}
            {data && data.departments.length === 0 && (
              <tr>
                <td colSpan={5} className="notice">
                  No payroll has been run for this month yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Payslips({ role }: { role: string }) {
  const isHrAdmin = role === 'HR_ADMIN';
  const [list, setList] = useState<PayslipDto[]>([]);
  const [open, setOpen] = useState<{ payslip: PayslipDto; lines: PayslipLineDto[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  // HR_ADMIN has no employee record of their own, so "my payslips" doesn't apply to them —
  // GET /payroll/payslips with no employeeId 400s. The route already accepts an explicit
  // ?employeeId=, same as Profile.tsx's document viewer, so give HR the same "Viewing"
  // picker instead of either leaking that 400 to the screen or hiding the section outright.
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);

  useEffect(() => {
    if (isHrAdmin) {
      get<EmployeeSummary[]>('/employees').then((list) => {
        setEmployees(list);
        if (list.length > 0) setViewingId((v) => v ?? list[0]!.id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load(employeeId?: string) {
    if (isHrAdmin && !employeeId) return; // waiting on the employee list / picker above
    try {
      const query = employeeId ? `?employeeId=${employeeId}` : '';
      setList(await get<PayslipDto[]>(`/payroll/payslips${query}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    if (isHrAdmin) {
      if (viewingId) void load(viewingId);
    } else {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingId]);

  async function runPayroll() {
    setRunning(true);
    setRunMsg(null);
    setError(null);
    const now = new Date();
    try {
      // ADR-004 / P0-6: 202 Accepted + a job id. Payroll never runs in the request path —
      // Node is single-threaded for JS and would block every other request.
      const { jobId } = await post<{ jobId: string }>('/payroll/runs', {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
      });
      setRunMsg('Payroll queued…');
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const job = await get<{ state: string; result?: { issued: number; skipped: unknown[] }; error?: string }>(
          `/jobs/${jobId}`,
        );
        if (job.state === 'DONE') {
          setRunMsg(`Issued ${job.result?.issued ?? 0} payslip(s), skipped ${job.result?.skipped?.length ?? 0}.`);
          break;
        }
        if (job.state === 'FAILED') {
          setError(job.error ?? 'Payroll run failed');
          break;
        }
      }
      await load(isHrAdmin ? (viewingId ?? undefined) : undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function openPayslip(id: string) {
    try {
      setOpen(await get<{ payslip: PayslipDto; lines: PayslipLineDto[] }>(`/payroll/payslips/${id}`));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // F5.3 / US-27 — a real generated PDF from the server, not a browser print of the page.
  // A plain <a href> can't carry the Bearer token, so this fetches the PDF and downloads it
  // via a blob URL instead.
  const [downloading, setDownloading] = useState(false);
  async function downloadPdf(id: string, year: number, month: number) {
    setDownloading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
      const res = await fetch(`${API_BASE}/payroll/payslips/${id}/pdf`, {
        headers: { Authorization: `Bearer ${tokens.access}` },
      });
      if (!res.ok) throw new Error(`Could not generate the PDF (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip-${year}-${String(month).padStart(2, '0')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  if (open) {
    const p = open.payslip;
    return (
      <div className="view-fade">
        <p className="page-sub no-print">
          <button className="sm" onClick={() => setOpen(null)}>
            ← Back
          </button>{' '}
          <button
            className="sm primary"
            onClick={() => downloadPdf(p.id, p.period_year, p.period_month)}
            disabled={downloading}
          >
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>{' '}
          <button className="sm" onClick={() => window.print()}>
            Print
          </button>
        </p>

        <div className="card payslip-print">
          <h1 style={{ color: '#111' }}>Payslip</h1>
          <p style={{ color: '#555', marginTop: 0 }}>
            {MONTHS[p.period_month - 1]} {p.period_year}
          </p>

          <table style={{ marginBottom: 22 }}>
            <tbody>
              <tr>
                <td>Days in period</td>
                <td className="num">{p.days_in_period}</td>
                <td>Leave without pay</td>
                <td className="num">{p.lwp_days}</td>
              </tr>
              <tr>
                <td>Payable days</td>
                <td className="num">{p.payable_days}</td>
                <td>Overtime hours</td>
                <td className="num">{p.ot_hours}</td>
              </tr>
              <tr>
                <td>Overtime hourly rate</td>
                <td className="num">{formatBDT(p.ot_hourly_rate)}</td>
                <td>Engine version</td>
                <td className="num">{p.engine_version}</td>
              </tr>
            </tbody>
          </table>

          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th className="num">Earnings</th>
                <th className="num">Deductions</th>
              </tr>
            </thead>
            <tbody>
              {open.lines.map((l, i) => (
                <tr key={`${l.code}-${i}`}>
                  <td>{l.label}</td>
                  <td className="num">{l.sign === 1 ? formatBDT(l.amount) : ''}</td>
                  <td className="num">{l.sign === -1 ? formatBDT(l.amount) : ''}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Total</td>
                <td className="num">{formatBDT(p.gross)}</td>
                <td className="num">{formatBDT(p.total_deductions)}</td>
              </tr>
              <tr style={{ fontWeight: 700, fontSize: 17 }}>
                <td>Net pay</td>
                <td className="num" colSpan={2}>
                  {formatBDT(p.net_pay)}
                </td>
              </tr>
            </tbody>
          </table>

          <p style={{ color: '#666', fontSize: 12, marginTop: 22 }}>
            Overtime is calculated at 2× the ordinary rate of basic wage per the Bangladesh Labour
            Act 2006 §108. This payslip is immutable; corrections are issued as a separate
            adjustment payslip.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="view-fade">
      <h1>Payslips</h1>
      <p className="page-sub">Immutable and line-itemised — every figure is reproducible.</p>
      {error && <p className="error content-in">{error}</p>}
      {runMsg && <p className="notice content-in">{runMsg}</p>}

      {role === 'HR_ADMIN' && (
        <div className="card">
          <div className="row">
            <div style={{ flex: 3 }}>
              <span className="notice">
                Payroll runs in the background, so the rest of PulseHR stays responsive while it
                processes. This can take a moment for a large team.
              </span>
            </div>
            <div style={{ flex: 0, minWidth: 170 }}>
              <button className="primary sm" onClick={runPayroll} disabled={running}>
                {running ? 'Running…' : 'Run payroll'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isHrAdmin && <PayrollSummary />}

      {isHrAdmin && <h2>Payslips by employee</h2>}
      {isHrAdmin && employees.length > 0 && (
        <div className="field" style={{ maxWidth: 320, marginBottom: 14 }}>
          <label htmlFor="payslip-emp-picker">Viewing</label>
          <select
            id="payslip-emp-picker"
            value={viewingId ?? ''}
            onChange={(e) => setViewingId(e.target.value)}
          >
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name} — {e.employee_code}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="card table-card">
        <table>
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">Payable days</th>
              <th className="num">LWP</th>
              <th className="num">OT hours</th>
              <th className="num">Gross</th>
              <th className="num">Deductions</th>
              <th className="num">Net pay</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td>
                  {MONTHS[p.period_month - 1]} {p.period_year}
                </td>
                <td className="num">{p.payable_days}</td>
                <td className="num">{p.lwp_days}</td>
                <td className="num">{p.ot_hours}</td>
                <td className="num">{formatBDT(p.gross)}</td>
                <td className="num">{formatBDT(p.total_deductions)}</td>
                <td className="num">
                  <strong>{formatBDT(p.net_pay)}</strong>
                </td>
                <td className="num">
                  <button className="sm" onClick={() => openPayslip(p.id)}>
                    View
                  </button>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="notice">
                  No payslips yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
