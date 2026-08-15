/**
 * Monthly payroll run.
 *
 * Runs in the worker, never in the API (ADR-004 / P0-6). Month-end payroll is CPU- and
 * database-bound; executing it in the request path would block Node's single JavaScript
 * thread and hang the whole application.
 *
 * Run directly:  npm run job:payroll -- 2026 7
 */

import { pathToFileURL } from 'node:url';
import {
  calculatePayslip,
  firstOfMonth,
  lastOfMonth,
  structureInForce,
  type Payslip,
} from '@pulsehr/core';
import { all, openDb, transaction } from '../db.js';
import { Repo } from '../repo.js';
import { registerHandler } from './queue.js';

export interface PayrollRunSummary {
  year: number;
  month: number;
  issued: number;
  skipped: Array<{ employeeId: string; name: string; reason: string }>;
  totalNetPaisa: number;
}

export async function runPayroll(
  organisationId: string,
  userId: string,
  year: number,
  month: number,
): Promise<PayrollRunSummary> {
  const repo = new Repo(organisationId, userId);
  const periodStart = firstOfMonth(year, month);
  const periodEnd = lastOfMonth(year, month);

  const employees = await all(
    `SELECT * FROM employee WHERE organisation_id = ? AND employment_status = 'ACTIVE'`,
    organisationId,
  );

  const summary: PayrollRunSummary = { year, month, issued: 0, skipped: [], totalNetPaisa: 0 };

  for (const employee of employees) {
    const employeeId = String(employee.id);
    const name = String(employee.full_name);

    // Idempotent: a re-run does not double-issue. Payslips are immutable (P0-8).
    const existing = await all(
      `SELECT id FROM payslip WHERE employee_id = ? AND period_year = ? AND period_month = ?
         AND adjusts_payslip_id IS NULL`,
      employeeId,
      year,
      month,
    );
    if (existing.length > 0) {
      summary.skipped.push({ employeeId, name, reason: 'Already issued for this period' });
      continue;
    }

    const structures = await repo.salaryStructures(employeeId);
    if (structures.length === 0) {
      summary.skipped.push({ employeeId, name, reason: 'No salary structure' });
      continue;
    }

    let salary;
    try {
      salary = structureInForce(structures, periodStart);
    } catch (err) {
      summary.skipped.push({ employeeId, name, reason: (err as Error).message });
      continue;
    }

    // LWP days and overtime come from attendance for the period.
    const attendance = await repo.attendanceBetween(employeeId, periodStart, periodEnd);
    const lwpDays = attendance.filter((a) => a.status === 'ABSENT').length;
    const otHours = attendance.reduce((sum, a) => sum + Number(a.ot_hours ?? 0), 0);

    let payslip: Payslip;
    try {
      payslip = calculatePayslip({
        organisationId,
        employeeId,
        periodYear: year,
        periodMonth: month,
        salary,
        lwpDays,
        otHours: Math.round(otHours * 100) / 100,
      });
    } catch (err) {
      // A run that breaches §102, or fails its balance assertion, is skipped with a
      // named reason rather than silently paying a wrong number.
      summary.skipped.push({ employeeId, name, reason: (err as Error).message });
      continue;
    }

    await transaction(async () => {
      const id = await repo.insertPayslip(payslip, userId);
      await repo.audit('PAYSLIP_ISSUED', 'payslip', id, {
        period: `${year}-${month}`,
        netPay: payslip.netPay,
      });
    });

    summary.issued += 1;
    summary.totalNetPaisa += payslip.netPay;
  }

  await repo.audit('PAYROLL_RUN', 'payslip', null, summary);
  return summary;
}

registerHandler('PAYROLL_RUN', (payload) =>
  runPayroll(
    String(payload.organisationId),
    String(payload.userId),
    Number(payload.year),
    Number(payload.month),
  ),
);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await openDb();
  const year = Number(process.argv[2] ?? new Date().getFullYear());
  const month = Number(process.argv[3] ?? new Date().getMonth() + 1);
  const orgs = await all('SELECT id, name FROM organisation');
  for (const org of orgs) {
    const summary = await runPayroll(String(org.id), 'system', year, month);
    console.log(`[payroll] ${org.name} ${year}-${month}:`, {
      issued: summary.issued,
      skipped: summary.skipped.length,
      totalNet: (summary.totalNetPaisa / 100).toLocaleString('en-BD'),
    });
    for (const s of summary.skipped.slice(0, 5)) console.log(`  skipped ${s.name}: ${s.reason}`);
  }
}
