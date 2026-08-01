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

import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
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

/* ------------------------------- passwords ------------------------------- */

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(plain, salt, 64, { N: SCRYPT_N });
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const key = scryptSync(plain, Buffer.from(saltHex, 'hex'), 64, { N: SCRYPT_N });
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
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60_000;

export function checkLoginRateLimit(email: string): boolean {
  const now = Date.now();
  const entry = attempts.get(email);
  if (!entry || now > entry.resetAt) {
    attempts.set(email, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

export function clearLoginRateLimit(email: string): void {
  attempts.delete(email);
}
