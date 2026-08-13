/**
 * Authentication & authorisation.
 *
 * ADR-006 / P1-19. The source proposal says "secure JWT-based authentication" and stops
 * there. A stateless JWT CANNOT BE REVOKED before it expires — for an HRIS that is
 * disqualifying, because a terminated employee's access to salary and personnel data must
 * stop immediately, not in an hour.
 *
 * So: 15-minute access token + a server-side refresh session row that can be killed.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import { all, nowIso, one, run, uuid } from './db.js';

const JWT_SECRET = process.env.PULSEHR_JWT_SECRET ?? 'dev-only-secret-change-in-production';
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TTL_DAYS = 7;
const SCRYPT_N = 16384; // NFR-15

export type Role = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';

export interface Principal {
  userId: string;
  organisationId: string;
  role: Role;
  employeeId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}

/*
 * scrypt, not scryptSync (load-test finding, 13 Aug 2026 — docs/17-load-test-report.md).
 * scryptSync runs on the main thread and blocks the event loop for its whole duration; under
 * concurrent logins that serialised EVERY request in flight behind whatever hash happened to
 * be running, not just other logins. The async form offloads the same computation to libuv's
 * threadpool -- same N (NFR-15), same cost per hash, same security property. This does not
 * make login itself faster (scrypt is deliberately slow; that is the point of it) -- it stops
 * login load from stalling unrelated requests on other tenants while it runs.
 */
const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number },
) => Promise<Buffer>;

/* ------------------------------- passwords ------------------------------- */

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, 64, { N: SCRYPT_N });
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(plain, Buffer.from(saltHex, 'hex'), 64, { N: SCRYPT_N });
  const expected = Buffer.from(keyHex, 'hex');
  // Constant-time: a length mismatch must not short-circuit into a timing oracle.
  if (key.length !== expected.length) return false;
  return timingSafeEqual(key, expected);
}

/* -------------------------------- tokens --------------------------------- */

export function issueAccessToken(p: Principal): string {
  return jwt.sign(
    { sub: p.userId, org: p.organisationId, role: p.role, emp: p.employeeId },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
}

/** Refresh tokens are stored HASHED — a database leak must not hand over live sessions. */
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueRefreshToken(userId: string, organisationId: string): string {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000).toISOString();
  run(
    `INSERT INTO session (id, organisation_id, user_id, refresh_token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    uuid(),
    organisationId,
    userId,
    hashRefreshToken(token),
    expires,
    nowIso(),
  );
  return token;
}

export function consumeRefreshToken(token: string): Principal | null {
  const row = one(
    `SELECT s.id, s.user_id, s.organisation_id, s.expires_at, s.revoked_at,
            u.role, u.is_active, e.id AS employee_id
       FROM session s
       JOIN app_user u ON u.id = s.user_id
       LEFT JOIN employee e ON e.user_id = u.id
      WHERE s.refresh_token_hash = ?`,
    hashRefreshToken(token),
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (String(row.expires_at) < nowIso()) return null;
  if (!row.is_active) return null;

  // Rotate: a refresh token is single-use.
  run('UPDATE session SET revoked_at = ? WHERE id = ?', nowIso(), row.id);

  return {
    userId: String(row.user_id),
    organisationId: String(row.organisation_id),
    role: row.role as Role,
    employeeId: row.employee_id ? String(row.employee_id) : null,
  };
}

/** The kill switch. Called on logout, password change, role change, and termination. */
export function revokeAllSessions(userId: string): number {
  const open = all('SELECT id FROM session WHERE user_id = ? AND revoked_at IS NULL', userId);
  run('UPDATE session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', nowIso(), userId);
  return open.length;
}

/* --------------------------- password reset (F1.4) ------------------------ */
// US-05 acceptance criteria: a link sent only to the registered address, expiring 30
// minutes after issue, usable once. Stored hashed for the same reason refresh tokens are
// (auth.ts:69) — a DB leak must not hand over the ability to take over every account.

const RESET_TTL_MINUTES = 30;

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issuePasswordResetToken(userId: string): string {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_TTL_MINUTES * 60_000).toISOString();
  run(
    `INSERT INTO password_reset_token (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    uuid(),
    userId,
    hashResetToken(token),
    expires,
    nowIso(),
  );
  return token;
}

/** Returns the user id the token belongs to, or null if invalid, expired, or already used. */
export function consumePasswordResetToken(token: string): string | null {
  const row = one(
    'SELECT id, user_id, expires_at, used_at FROM password_reset_token WHERE token_hash = ?',
    hashResetToken(token),
  );
  if (!row) return null;
  if (row.used_at) return null; // single-use
  if (String(row.expires_at) < nowIso()) return null; // 30-minute expiry

  run('UPDATE password_reset_token SET used_at = ? WHERE id = ?', nowIso(), row.id);
  return String(row.user_id);
}

/* ------------------------------ middleware ------------------------------- */

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as jwt.JwtPayload;
    req.principal = {
      userId: String(payload.sub),
      organisationId: String(payload.org),
      role: payload.role as Role,
      employeeId: payload.emp ? String(payload.emp) : null,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.principal) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.principal.role)) {
      res.status(403).json({ error: `Requires role: ${roles.join(' or ')}` });
      return;
    }
    next();
  };
}

/* --------------------------- login rate limiting -------------------------- */

const attempts = new Map<string, { count: number; resetAt: number }>();
/**
 * BUG-03 / US-02: "Six consecutive failed attempts lock the account for a cool-down
 * period." Six failures are therefore permitted and the SEVENTH is refused. The previous
 * value of 5 locked one attempt early, failing the story's acceptance criterion.
 *
 * BUG-25 (load-test finding, docs/17-load-test-report.md): the original single
 * check-and-increment function counted every login CALL, not every FAILURE — so several
 * concurrent requests for the same email with the CORRECT password could each increment the
 * counter before any of them finished and cleared it, tripping a 429 with zero wrong
 * passwords involved. Split into a read-only lockout check (`isLockedOut`) and an explicit
 * `recordFailedLogin`, called only on an actual bad password — a successful login, however
 * many arrive concurrently, never touches the counter at all.
 */
const MAX_ATTEMPTS = 6;
const WINDOW_MS = 15 * 60_000;

export function isLockedOut(email: string): boolean {
  const entry = attempts.get(email);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    attempts.delete(email);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedLogin(email: string): void {
  const now = Date.now();
  const entry = attempts.get(email);
  if (!entry || now > entry.resetAt) {
    attempts.set(email, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearLoginRateLimit(email: string): void {
  attempts.delete(email);
}
