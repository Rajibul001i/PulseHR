/**
 * Verifies BUG-12: is the payslip duplicate guard real, or only enforced in application code?
 *
 * The schema declares UNIQUE (employee_id, period_year, period_month, adjusts_payslip_id).
 * In SQLite — and in PostgreSQL — NULLs compare as DISTINCT inside a UNIQUE index, so two
 * ordinary payslips (both with adjusts_payslip_id = NULL) for the same employee and period
 * do NOT violate that constraint. The constraint looks like it protects the invariant and
 * does not.
 */
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('apps/api/pulsehr.db');

const dupes = db
  .prepare(
    `SELECT employee_id, period_year, period_month, COUNT(*) AS n
       FROM payslip WHERE adjusts_payslip_id IS NULL
      GROUP BY 1,2,3 HAVING n > 1`,
  )
  .all();

console.log('total payslips        :', db.prepare('SELECT COUNT(*) AS n FROM payslip').get().n);
console.log('duplicate employee+period pairs:', dupes.length);

const p = db.prepare('SELECT * FROM payslip LIMIT 1').get();
if (!p) {
  console.log('no payslips to test against — run `npm run job:payroll -- 2026 7` first');
  process.exit(0);
}

const cols = [
  'id', 'organisation_id', 'employee_id', 'period_year', 'period_month',
  'salary_structure_id', 'engine_version', 'days_in_period', 'lwp_days',
  'payable_days', 'ot_hours', 'ot_hourly_rate', 'gross', 'total_deductions',
  'net_pay', 'issued_at', 'issued_by',
];

try {
  db.prepare(
    `INSERT INTO payslip (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
  ).run('dup-test', ...cols.slice(1).map((c) => p[c]));

  console.log('\nRESULT: DB CONSTRAINT IS INEFFECTIVE');
  console.log('  A second payslip for the same employee and period was accepted.');
  console.log('  The UNIQUE index does not protect the invariant, because NULL != NULL.');
  console.log('  Only the application-level check in runPayroll() prevents duplicates.');
  db.prepare('DELETE FROM payslip WHERE id = ?').run('dup-test');
  process.exit(1);
} catch (e) {
  console.log('\nRESULT: DB constraint held —', String(e.message).split('\n')[0]);
  process.exit(0);
}
