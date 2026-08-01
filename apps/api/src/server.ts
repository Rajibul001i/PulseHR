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
  dhakaMinutesOfDay,
  requestedDays,
  structureInForce,
  type LeaveType,
} from '@pulsehr/core';
import { openDb, one, transaction } from './db.js';
import {
  authenticate,
  checkLoginRateLimit,
  clearLoginRateLimit,
  consumeRefreshToken,
  issueAccessToken,
  issueRefreshToken,
  requireRole,
  revokeAllSessions,
  verifyPassword,
  type Principal,
} from './auth.js';
import { Repo } from './repo.js';
import { enqueue, jobStatus } from './jobs/queue.js';

openDb();

const app = express();
app.use(cors());
app.use(express.json());

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

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth')) return next();
  return authenticate(req, res, next);
});

/* ================================ employees =============================== */

app.get(
  '/api/employees',
  handler((req, res) => {
    res.json(repoOf(req).listEmployees());
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
    const SHIFT_START = 9 * 60;
    const lateMinutes = Math.max(0, minutes - SHIFT_START);

    const repo = repoOf(req);
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

app.get(
  '/api/attendance/grid',
  handler((req, res) => {
    const { from, to } = z
      .object({ from: z.string(), to: z.string() })
      .parse({ from: req.query.from, to: req.query.to });
    res.json(repoOf(req).attendanceGrid(from, to));
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
    const { decision } = z.object({ decision: z.enum(['APPROVE', 'REJECT']) }).parse(req.body);
    const repo = repoOf(req);
    const requestId = req.params.id!;

    const result = transaction(() => {
      const request = repo.getLeaveRequest(requestId);
      if (!request) return { status: 404 as const, body: { error: 'Not found' } };

      if (decision === 'REJECT') {
        repo.setLeaveStatus(requestId, 'REJECTED', req.principal!.userId);
        repo.audit('LEAVE_REJECTED', 'leave_request', requestId);
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

app.get(
  '/api/jobs/:id',
  handler((req, res) => {
    const status = jobStatus(req.params.id!);
    if (!status) {
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
  handler((req, res) => {
    const limit = Number(req.query.limit ?? 20);
    res.json(repoOf(req).latestScores(limit));
  }),
);

app.get(
  '/api/attrition/scores/:id',
  requireRole('HR_ADMIN'),
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
