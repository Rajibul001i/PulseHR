/**
 * PulseHR API — interactive requests only.
 *
 * ADR-004 / P0-6: payroll runs and the nightly attrition batch do NOT execute here. Node
 * runs JavaScript on a single thread, so a payroll run over thousands of employees inside
 * this process would block the event loop and hang every other request. They are jobs
 * (src/jobs/*), enqueued here and executed by the worker.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { z } from 'zod';
import {
  businessDate,
  checkApproval,
  checkSeats,
  entitledFeatures,
  PLAN_FEATURES,
  TIER_PRICE_PAISA,
  dhakaMinutesOfDay,
  requestedDays,
  structureInForce,
  type LeaveType,
} from '@pulsehr/core';
import { openDb, one, run, transaction } from './db.js';
import {
  authenticate,
  checkLoginRateLimit,
  clearLoginRateLimit,
  consumePasswordResetToken,
  consumeRefreshToken,
  hashPassword,
  issueAccessToken,
  issuePasswordResetToken,
  issueRefreshToken,
  requireRole,
  revokeAllSessions,
  verifyPassword,
  type Principal,
} from './auth.js';
import { Repo } from './repo.js';
import { enqueue, jobStatus } from './jobs/queue.js';
// Side-effecting imports: each module calls registerHandler() at load time. Without these,
// PAYROLL_RUN and ATTRITION_SCORING jobs enqueue successfully and then fail immediately
// with "No handler registered" — the queue has no other way to learn these handlers exist.
import './jobs/runPayroll.js';
import './jobs/scoreAll.js';
import { requireFeature, subscriptionOf } from './entitlement.js';

openDb();

const app = express();
app.use(cors());
// Default 100kb is fine for every other route; F2.5 document uploads are base64 in the
// JSON body (no multipart parser exists anywhere else in this API, so this keeps the whole
// surface uniformly JSON rather than introducing a second request-parsing path for one
// feature). Base64 adds ~33% overhead, so 8mb here backs the 5mb file limit enforced below.
app.use(express.json({ limit: '8mb' }));

const repoOf = (req: Request): Repo => {
  const p = req.principal!;
  return new Repo(p.organisationId, p.userId);
};

/** Small wrapper so a thrown error becomes a clean 400 rather than an unhandled rejection. */
const handler =
  (fn: (req: Request, res: Response) => void) =>
  (req: Request, res: Response, next: NextFunction): void => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };

/* ================================== auth ================================== */

app.post(
  '/api/auth/login',
  handler((req, res) => {
    const { email, password } = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body);

    if (!checkLoginRateLimit(email)) {
      res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
      return;
    }

    const user = one(
      `SELECT u.*, e.id AS employee_id FROM app_user u
         LEFT JOIN employee e ON e.user_id = u.id
        WHERE u.email = ?`,
      email,
    );

    // Same response for unknown user and wrong password — do not confirm which emails exist.
    if (!user || !user.is_active || !verifyPassword(password, String(user.password_hash))) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    clearLoginRateLimit(email);
    const principal: Principal = {
      userId: String(user.id),
      organisationId: String(user.organisation_id),
      role: user.role as Principal['role'],
      employeeId: user.employee_id ? String(user.employee_id) : null,
    };

    res.json({
      accessToken: issueAccessToken(principal),
      refreshToken: issueRefreshToken(principal.userId, principal.organisationId),
      user: { email, role: principal.role, employeeId: principal.employeeId },
    });
  }),
);

app.post(
  '/api/auth/refresh',
  handler((req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string() }).parse(req.body);
    const principal = consumeRefreshToken(refreshToken);
    if (!principal) {
      res.status(401).json({ error: 'Invalid or revoked refresh token' });
      return;
    }
    res.json({
      accessToken: issueAccessToken(principal),
      refreshToken: issueRefreshToken(principal.userId, principal.organisationId),
    });
  }),
);

app.post(
  '/api/auth/logout',
  authenticate,
  handler((req, res) => {
    const n = revokeAllSessions(req.principal!.userId);
    res.json({ revokedSessions: n });
  }),
);

// F1.4 / US-05. Acceptance criteria: link sent only to the registered address, expires in
// 30 minutes, single-use (all enforced in auth.ts's token functions).
app.post(
  '/api/auth/forgot-password',
  handler((req, res) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const user = one('SELECT id, is_active FROM app_user WHERE email = ?', email);

    // Prototype shortcut: no email provider is configured anywhere in this project (no
    // SMTP/API-key secret exists), so the token a real deployment would email is returned
    // directly here instead of being sent. A production build would hand this token to an
    // email provider (e.g. Resend, SES) and never put it in an HTTP response.
    let demoResetToken: string | undefined;
    if (user && user.is_active) {
      demoResetToken = issuePasswordResetToken(String(user.id));
    }

    // Same response whether or not the email is registered — do not confirm which
    // accounts exist (same anti-enumeration principle as /auth/login above).
    res.json({ message: 'If that email is registered, a reset link has been issued.', demoResetToken });
  }),
);

app.post(
  '/api/auth/reset-password',
  handler((req, res) => {
    const { token, password } = z
      .object({ token: z.string().min(1), password: z.string().min(8) })
      .parse(req.body);

    const userId = consumePasswordResetToken(token);
    if (!userId) {
      res.status(400).json({ error: 'This reset link is invalid, expired, or already used.' });
      return;
    }

    run('UPDATE app_user SET password_hash = ? WHERE id = ?', hashPassword(password), userId);
    // A password reset must kill every existing session — the old password may be
    // compromised, which is presumably why a reset was requested at all.
    revokeAllSessions(userId);
    res.json({ ok: true });
  }),
);

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  return authenticate(req, res, next);
});

/* ================================ employees =============================== */

app.get(
  '/api/employees',
  handler((req, res) => {
    // BUG-06 / US-11 (F2.4): ?q= was accepted and silently ignored, returning the whole
    // directory. Search now filters on name, code, designation and department.
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    res.json(repoOf(req).listEmployees(q || undefined));
  }),
);

app.get(
  '/api/employees/:id',
  handler((req, res) => {
    const repo = repoOf(req);
    const emp = repo.getEmployee(req.params.id!);
    if (!emp) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json({ ...emp, balances: repo.balances(String(emp.id)) });
  }),
);

// F2.5 / US-12. Upload is HR-only (the story is written from the Administrator's
// perspective); viewing is HR-only OR the employee themselves -- "visible to the employee
// and to Administrators, not to other employees" is the third acceptance criterion.
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

function canSeeEmployeeDocuments(req: Request, employeeId: string): boolean {
  const p = req.principal!;
  return p.role === 'HR_ADMIN' || p.employeeId === employeeId;
}

app.post(
  '/api/employees/:id/documents',
  requireRole('HR_ADMIN'),
  handler((req, res) => {
    const { category, filename, mimeType, contentBase64 } = z
      .object({
        category: z.enum(['APPOINTMENT_LETTER', 'NID_COPY', 'CERTIFICATE', 'OTHER']),
        filename: z.string().min(1),
        mimeType: z.string(),
        contentBase64: z.string().min(1),
      })
      .parse(req.body);

    if (!ALLOWED_DOCUMENT_TYPES.has(mimeType)) {
      res.status(415).json({ error: `Unsupported file type: ${mimeType}. PDF, JPG and PNG only.` });
      return;
    }
    const content = Buffer.from(contentBase64, 'base64');
    if (content.byteLength > MAX_DOCUMENT_BYTES) {
      res.status(413).json({ error: `File exceeds the ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB limit.` });
      return;
    }
    const repo = repoOf(req);
    if (!repo.getEmployee(req.params.id!)) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const id = repo.addEmployeeDocument({ employeeId: req.params.id!, category, filename, mimeType, content });
    res.status(201).json({ id });
  }),
);

app.get(
  '/api/employees/:id/documents',
  handler((req, res) => {
    if (!canSeeEmployeeDocuments(req, req.params.id!)) {
      res.status(403).json({ error: 'Not permitted' });
      return;
    }
    res.json(repoOf(req).listEmployeeDocuments(req.params.id!));
  }),
);

app.get(
  '/api/employees/:id/documents/:docId',
  handler((req, res) => {
    if (!canSeeEmployeeDocuments(req, req.params.id!)) {
      res.status(403).json({ error: 'Not permitted' });
      return;
    }
    const doc = repoOf(req).getEmployeeDocument(req.params.docId!);
    if (!doc || doc.employee_id !== req.params.id) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.setHeader('Content-Type', String(doc.mime_type));
    res.setHeader('Content-Disposition', `inline; filename="${String(doc.filename).replace(/"/g, '')}"`);
    res.send(doc.content);
  }),
);

// F4.4 / US-21+US-22.
app.get(
  '/api/notifications',
  handler((req, res) => {
    res.json(repoOf(req).listNotifications(req.principal!.userId));
  }),
);

app.post(
  '/api/notifications/read',
  handler((req, res) => {
    const { ids } = z.object({ ids: z.array(z.string()).optional() }).parse(req.body ?? {});
    repoOf(req).markNotificationsRead(req.principal!.userId, ids);
    res.json({ ok: true });
  }),
);

app.get(
  '/api/me',
  handler((req, res) => {
    const p = req.principal!;
    const repo = repoOf(req);
    if (!p.employeeId) {
      res.json({ principal: p, employee: null });
      return;
    }
    const emp = repo.getEmployee(p.employeeId);
    res.json({
      principal: p,
      employee: emp,
      balances: repo.balances(p.employeeId),
    });
  }),
);

// F2.2 / US-09. Salary, designation and department are deliberately not accepted here --
// Repo.updateOwnContact() only ever touches phone/address/emergency_contact, so there is no
// request-body path to those fields at all, not just a validation check that could be
// bypassed.
app.post(
  '/api/me/contact',
  handler((req, res) => {
    const p = req.principal!;
    if (!p.employeeId) {
      res.status(400).json({ error: 'No employee record linked to this user' });
      return;
    }
    const fields = z
      .object({
        phone: z.string().min(1).optional(),
        address: z.string().min(1).optional(),
        emergencyContact: z.string().min(1).optional(),
      })
      .parse(req.body);

    repoOf(req).updateOwnContact(p.employeeId, fields);
    res.json(repoOf(req).getEmployee(p.employeeId));
  }),
);

/* =============================== attendance =============================== */

app.post(
  '/api/attendance/check-in',
  handler((req, res) => {
    const p = req.principal!;
    if (!p.employeeId) {
      res.status(400).json({ error: 'No employee record linked to this user' });
      return;
    }
    const now = new Date();
    // ADR-005: the business date is derived in Asia/Dhaka, never from raw UTC.
    const workDate = businessDate(now);
    const minutes = dhakaMinutesOfDay(now);
    const repo = repoOf(req);

    // BUG-08: a second check-in used to silently overwrite the original timestamp,
    // destroying the evidence the lateness signal and payroll both depend on.
    const today = repo.attendanceBetween(p.employeeId, workDate, workDate)[0];
    if (today?.check_in) {
      res.status(409).json({
        error: 'Already checked in today',
        workDate,
        checkIn: String(today.check_in),
      });
      return;
    }

    // BUG-07: office start time is per-department (class diagram: Department.officeStartTime),
    // not a global 09:00.
    const SHIFT_START = repo.officeStartMinutesFor(p.employeeId);
    const lateMinutes = Math.max(0, minutes - SHIFT_START);

    repo.upsertAttendance(p.employeeId, workDate, {
      check_in: now.toISOString(),
      late_minutes: lateMinutes,
      status: 'PRESENT',
    });
    repo.audit('CHECK_IN', 'attendance', p.employeeId, { workDate, lateMinutes });
    res.json({ workDate, lateMinutes, checkIn: now.toISOString() });
  }),
);

app.post(
  '/api/attendance/check-out',
  handler((req, res) => {
    const p = req.principal!;
    if (!p.employeeId) {
      res.status(400).json({ error: 'No employee record linked to this user' });
      return;
    }
    const now = new Date();
    const workDate = businessDate(now);
    const repo = repoOf(req);
    const existing = repo.attendanceBetween(p.employeeId, workDate, workDate)[0];
    if (!existing?.check_in) {
      res.status(400).json({ error: 'No check-in recorded for today' });
      return;
    }
    const worked = (now.getTime() - new Date(String(existing.check_in)).getTime()) / 3_600_000;
    const otHours = Math.max(0, Math.round((worked - 8) * 100) / 100);
    repo.upsertAttendance(p.employeeId, workDate, {
      check_out: now.toISOString(),
      ot_hours: otHours,
    });
    res.json({ workDate, hoursWorked: Math.round(worked * 100) / 100, otHours });
  }),
);

/**
 * BUG-02 / BUG-01 (SQA-2026-08-10).
 *
 * This route previously had no role guard at all: any authenticated EMPLOYEE could read
 * the entire company's attendance — 620 rows of colleagues' records in the seeded demo —
 * despite the API contract stating MANAGER+HR. And a MANAGER saw all 20 employees rather
 * than their own department, contradicting US-04's acceptance criterion.
 */
app.get(
  '/api/attendance/grid',
  requireRole('MANAGER', 'HR_ADMIN'),
  handler((req, res) => {
    const { from, to } = z
      .object({ from: z.string(), to: z.string() })
      .parse({ from: req.query.from, to: req.query.to });

    const p = req.principal!;
    const repo = repoOf(req);

    // US-04: "A Manager opening the attendance report sees only their own department."
    if (p.role === 'MANAGER') {
      const me = p.employeeId ? repo.getEmployee(p.employeeId) : undefined;
      const departmentId = me?.department_id ? String(me.department_id) : null;
      res.json(repo.attendanceGrid(from, to, { departmentId }));
      return;
    }

    res.json(repo.attendanceGrid(from, to));
  }),
);

app.get(
  '/api/attendance/mine',
  handler((req, res) => {
    const p = req.principal!;
    const { from, to } = req.query as { from?: string; to?: string };
    if (!p.employeeId || !from || !to) {
      res.status(400).json({ error: 'from and to are required' });
      return;
    }
    res.json(repoOf(req).attendanceBetween(p.employeeId, from, to));
  }),
);

/* ================================= leave ================================== */

app.get(
  '/api/leave/requests',
  handler((req, res) => {
    const p = req.principal!;
    const repo = repoOf(req);
    // An employee sees only their own; managers and HR see the queue.
    if (p.role === 'EMPLOYEE') {
      res.json(repo.leaveRequests({ employeeId: p.employeeId ?? '__none__' }));
      return;
    }
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(repo.leaveRequests(status ? { status } : {}));
  }),
);

app.get(
  '/api/leave/balances',
  handler((req, res) => {
    const p = req.principal!;
    const employeeId = (req.query.employeeId as string) ?? p.employeeId;
    if (!employeeId) {
      res.status(400).json({ error: 'employeeId required' });
      return;
    }
    if (p.role === 'EMPLOYEE' && employeeId !== p.employeeId) {
      res.status(403).json({ error: 'Cannot view another employee’s balances' });
      return;
    }
    res.json(repoOf(req).balances(employeeId));
  }),
);

app.post(
  '/api/leave/requests',
  handler((req, res) => {
    const body = z
      .object({
        leaveType: z.enum(['EARNED', 'CASUAL', 'SICK', 'FESTIVAL', 'MATERNITY', 'LWP']),
        startDate: z.string(),
        endDate: z.string(),
        reason: z.string().default(''),
      })
      .parse(req.body);

    const p = req.principal!;
    if (!p.employeeId) {
      res.status(400).json({ error: 'No employee record linked to this user' });
      return;
    }

    // BUG-10 (F4.1): a request dated 2020 was accepted. Leave is applied for, not
    // back-filled — retroactive entries are an HR adjustment, not a self-service action.
    const today = businessDate(new Date());
    if (body.startDate < today) {
      res.status(400).json({
        error: `Leave cannot start in the past (${body.startDate} is before ${today})`,
        code: 'START_DATE_IN_PAST',
      });
      return;
    }

    const days = requestedDays(body.startDate, body.endDate);
    const repo = repoOf(req);
    const id = repo.createLeaveRequest({
      employeeId: p.employeeId,
      leaveType: body.leaveType as LeaveType,
      startDate: body.startDate,
      endDate: body.endDate,
      days,
      status: 'PENDING',
      reason: body.reason,
    });
    repo.audit('LEAVE_REQUESTED', 'leave_request', id, body);

    // F4.4 / US-22: "notified when a request enters my queue." Only the direct manager --
    // the story is written from the Manager's perspective, not "every HR admin too."
    const managerUserId = repo.managerUserIdFor(p.employeeId);
    if (managerUserId) {
      repo.notify(
        managerUserId,
        'LEAVE_PENDING',
        `A ${body.leaveType.toLowerCase()} leave request (${days} day${days === 1 ? '' : 's'}) is waiting for your decision.`,
        'leave_request',
        id,
      );
    }

    res.status(201).json({ id, days });
  }),
);

/**
 * P0-7 — the approval transaction.
 *
 * The balance check MUST happen inside the transaction, not before it. Two managers
 * approving overlapping requests, or one employee submitting two requests that each fit
 * the balance individually but not together, would otherwise drive the balance negative.
 * Neither source document mentions concurrency control at all — despite the proposal
 * choosing PostgreSQL specifically for ACID.
 */
app.post(
  '/api/leave/requests/:id/decision',
  requireRole('MANAGER', 'HR_ADMIN'),
  handler((req, res) => {
    const { decision, reason } = z
      .object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().optional() })
      .parse(req.body);
    const repo = repoOf(req);
    const requestId = req.params.id!;

    // US-19 (F4.2): "a rejection cannot be submitted without a reason." Enforced here, not
    // just in the UI -- a client-side-only check is not a check.
    if (decision === 'REJECT' && !reason?.trim()) {
      res.status(400).json({ error: 'A reason is required to reject a leave request.' });
      return;
    }

    // F4.4 / US-21+US-22: notify the employee of the outcome, and clear the manager's
    // "waiting for you" notification for this request -- both decisions close it out.
    function notifyDecision(request: { employeeId: string; leaveType: string }, status: 'APPROVED' | 'REJECTED') {
      repo.clearPendingNotificationsFor('leave_request', requestId);
      const employeeUserId = repo.getEmployee(request.employeeId)?.user_id;
      if (employeeUserId) {
        const verb = status === 'APPROVED' ? 'approved' : 'rejected';
        const reasonSuffix = status === 'REJECTED' && reason ? ` Reason: ${reason}` : '';
        repo.notify(
          String(employeeUserId),
          'LEAVE_DECIDED',
          `Your ${request.leaveType.toLowerCase()} leave request was ${verb}.${reasonSuffix}`,
          'leave_request',
          requestId,
        );
      }
    }

    const result = transaction(() => {
      const request = repo.getLeaveRequest(requestId);
      if (!request) return { status: 404 as const, body: { error: 'Not found' } };

      if (decision === 'REJECT') {
        repo.setLeaveStatus(requestId, 'REJECTED', req.principal!.userId, reason);
        repo.audit('LEAVE_REJECTED', 'leave_request', requestId, { reason });
        notifyDecision(request, 'REJECTED');
        return { status: 200 as const, body: { status: 'REJECTED' } };
      }

      // Re-read the ledger INSIDE the transaction — this is the whole point.
      const ledger = repo.ledgerFor(request.employeeId);
      const approved = repo.approvedLeaveFor(request.employeeId);
      const check = checkApproval(request, ledger, approved);

      if (!check.ok) {
        return {
          status: 409 as const,
          body: { error: check.message, code: check.code, balance: check.balanceBefore },
        };
      }

      repo.setLeaveStatus(requestId, 'APPROVED', req.principal!.userId);
      if (request.leaveType !== 'LWP') {
        repo.appendLedger(
          request.employeeId,
          request.leaveType,
          -request.days,
          request.startDate,
          `Approved leave ${request.startDate}..${request.endDate}`,
          requestId,
        );
      }
      repo.audit('LEAVE_APPROVED', 'leave_request', requestId, {
        balanceBefore: check.balanceBefore,
        balanceAfter: check.balanceAfter,
      });
      notifyDecision(request, 'APPROVED');
      return {
        status: 200 as const,
        body: { status: 'APPROVED', balanceAfter: check.balanceAfter },
      };
    });

    res.status(result.status).json(result.body);
  }),
);

/* ================================ payroll ================================= */

app.get(
  '/api/payroll/payslips',
  handler((req, res) => {
    const p = req.principal!;
    const employeeId = (req.query.employeeId as string) ?? p.employeeId;
    if (!employeeId) {
      res.status(400).json({ error: 'employeeId required' });
      return;
    }
    if (p.role === 'EMPLOYEE' && employeeId !== p.employeeId) {
      res.status(403).json({ error: 'Cannot view another employee’s payslips' });
      return;
    }
    res.json(repoOf(req).payslipsFor(employeeId));
  }),
);

app.get(
  '/api/payroll/payslips/:id',
  handler((req, res) => {
    const p = req.principal!;
    const found = repoOf(req).payslipWithLines(req.params.id!);
    if (!found) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    if (p.role === 'EMPLOYEE' && String(found.payslip.employee_id) !== p.employeeId) {
      res.status(403).json({ error: 'Not your payslip' });
      return;
    }
    res.json(found);
  }),
);

/** ADR-004: enqueue, do not execute. Returns 202 with a job id. */
app.post(
  '/api/payroll/runs',
  requireRole('HR_ADMIN'),
  handler((req, res) => {
    const { year, month } = z
      .object({ year: z.number().int(), month: z.number().int().min(1).max(12) })
      .parse(req.body);
    const p = req.principal!;
    const jobId = enqueue('PAYROLL_RUN', {
      organisationId: p.organisationId,
      userId: p.userId,
      year,
      month,
    });
    res.status(202).json({ jobId, status: 'QUEUED' });
  }),
);

/**
 * BUG-11 (SQA-2026-08-10) — cross-tenant leak.
 *
 * Job ids were global. A holder of any job id could read that job regardless of which
 * organisation enqueued it, exposing another tenant's payroll run summary — including
 * total net pay. Now scoped to the caller's organisation, and a foreign id returns 404
 * rather than 403 so it does not confirm the job exists.
 */
app.get(
  '/api/jobs/:id',
  handler((req, res) => {
    const status = jobStatus(req.params.id!);
    if (!status || status.payload.organisationId !== req.principal!.organisationId) {
      res.status(404).json({ error: 'Unknown job' });
      return;
    }
    res.json(status);
  }),
);

/** Preview a payslip without issuing it — used by the UI to show the calculation. */
app.get(
  '/api/payroll/preview',
  requireRole('HR_ADMIN'),
  handler((req, res) => {
    const employeeId = String(req.query.employeeId ?? '');
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    const repo = repoOf(req);
    const structures = repo.salaryStructures(employeeId);
    if (structures.length === 0) {
      res.status(404).json({ error: 'No salary structure for this employee' });
      return;
    }
    const periodStart = `${year}-${String(month).padStart(2, '0')}-01`;
    res.json({ structure: structureInForce(structures, periodStart) });
  }),
);

/* ============================= subscription =============================== */

/**
 * BUG-16 — nothing in the API knew which plan a tenant was on. The UI reads this once at
 * sign-in and renders navigation, gates and upgrade prompts from the same entitlement
 * matrix the API enforces, so the two can never disagree.
 */
app.get(
  '/api/subscription',
  handler((req, res) => {
    const p = req.principal!;
    const subscription = subscriptionOf(p.organisationId);
    const today = businessDate(new Date());
    const org = repoOf(req).subscription();
    res.json({
      organisation: org?.name ?? null,
      tier: subscription.tier,
      status: subscription.status,
      trialEndsOn: subscription.trialEndsOn,
      seats: checkSeats(subscription),
      entitlements: entitledFeatures(subscription, today),
      catalogue: PLAN_FEATURES,
      pricePaisa: TIER_PRICE_PAISA[subscription.tier],
    });
  }),
);

app.get(
  '/api/departments',
  handler((req, res) => {
    res.json(repoOf(req).departments());
  }),
);

/* =============================== attrition ================================ */

/**
 * HR role only — spec §9. This is a hard requirement, not a display preference.
 *
 * A line manager who can see that a report is flagged "likely to quit" produces two
 * predictable harms: retaliation (quietly sidelining them) and self-fulfilling prophecy
 * (being treated as a flight risk causes the exit). Neither source document addresses
 * this at all.
 */
app.get(
  '/api/attrition/at-risk',
  requireRole('HR_ADMIN'),
  requireFeature('attrition_full'),
  handler((req, res) => {
    const limit = Number(req.query.limit ?? 20);
    res.json(repoOf(req).latestScores(limit));
  }),
);

app.get(
  '/api/attrition/scores/:id',
  requireRole('HR_ADMIN'),
  requireFeature('attrition_full'),
  handler((req, res) => {
    const found = repoOf(req).scoreWithContributions(req.params.id!);
    if (!found) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    // A bare number is never returned. Contributions travel with the score, always.
    res.json({
      ...found,
      responsibleUse:
        'Advisory for retention outreach only. Using this score in a termination, ' +
        'promotion, appraisal or pay decision is a prohibited use.',
    });
  }),
);

app.post(
  '/api/attrition/runs',
  requireRole('HR_ADMIN'),
  requireFeature('attrition_full'),
  handler((req, res) => {
    const p = req.principal!;
    const jobId = enqueue('ATTRITION_SCORING', {
      organisationId: p.organisationId,
      userId: p.userId,
    });
    res.status(202).json({ jobId, status: 'QUEUED' });
  }),
);

/* ================================ notices ================================= */

app.get(
  '/api/notices',
  handler((req, res) => {
    res.json(repoOf(req).notices());
  }),
);

app.post(
  '/api/notices',
  requireRole('HR_ADMIN'),
  handler((req, res) => {
    const { title, body } = z
      .object({ title: z.string().min(1), body: z.string().min(1) })
      .parse(req.body);
    const id = repoOf(req).createNotice(title, body, req.principal!.userId);
    res.status(201).json({ id });
  }),
);

/* ================================ errors ================================== */

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Validation failed', issues: err.issues });
    return;
  }
  console.error('[api]', err);
  res.status(400).json({ error: err.message });
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`PulseHR API listening on http://localhost:${PORT}`);
});

export { app };
