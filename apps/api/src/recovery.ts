/**
 * Self-service password recovery (F1.4): employee ID → last 4 NID digits → SMS code → new
 * password. See migration 015 for why, and for the limits that keep it from being guessed.
 *
 * Every step is checked on the server against the recovery row; the browser only ever holds
 * the random recovery token. The last step hands back an ordinary reset token, which
 * /api/auth/reset-password consumes exactly as it does for the emailed link.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { issuePasswordResetToken } from './auth.js';
import { nowIso, one, run, uuid, type Row } from './db.js';
import { maskPhone, sendSms, smsConfigured } from './sms.js';

export const RECOVERY_TTL_MINUTES = 15;
export const OTP_TTL_MINUTES = 5;
export const MAX_TRIES = 5; // wrong NID digits, and wrong codes, per recovery
export const MAX_RECOVERIES_PER_HOUR = 5;
export const RESEND_AFTER_SECONDS = 60;
export const MAX_SENDS = 3;

export type Failure = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Failure => ({ ok: false, status, error });

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The National ID as stored: a salted hash and the last 4 digits, never the number (P1-4). */
export function nidRecord(nid: string): { nidHash: string; nidLast4: string } {
  const digits = nid.replace(/\D/g, '');
  const salt = randomBytes(16).toString('hex');
  return { nidHash: `${salt}:${sha256(`${salt}:${digits}`)}`, nidLast4: digits.slice(-4) };
}

/** Bangladeshi NIDs are 10 digits (smart card), 13 or 17 (older laminated cards). */
export const NID_RE = /^(\d{10}|\d{13}|\d{17})$/;

/* --------------------------------- steps ---------------------------------- */

export async function startRecovery(organisationId: string, employeeCode: string): Promise<{ ok: true; recoveryToken: string } | Failure> {
  const who = await one(
    `SELECT u.id AS user_id
       FROM employee e JOIN app_user u ON u.id = e.user_id
      WHERE e.organisation_id = ? AND UPPER(e.employee_code) = UPPER(?)
        AND e.employment_status = 'ACTIVE' AND u.is_active = 1`,
    organisationId,
    employeeCode.trim(),
  );
  if (!who) return fail(404, 'No active PulseHR login matches that employee ID.');

  const recent = await one(
    'SELECT COUNT(*) AS n FROM account_recovery WHERE user_id = ? AND created_at > ?',
    who.user_id,
    inMinutes(-60),
  );
  if (Number(recent?.n ?? 0) >= MAX_RECOVERIES_PER_HOUR) {
    return fail(429, 'Too many recovery attempts for this account. Try again in an hour, or ask HR to reset your password.');
  }

  const recoveryToken = randomBytes(32).toString('hex');
  await run(
    `INSERT INTO account_recovery (id, organisation_id, user_id, token_hash, stage, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'NID', ?, ?)`,
    uuid(),
    organisationId,
    who.user_id,
    sha256(recoveryToken),
    inMinutes(RECOVERY_TTL_MINUTES),
    nowIso(),
  );
  return { ok: true, recoveryToken };
}

async function load(recoveryToken: string, stage: 'NID' | 'OTP'): Promise<Row | Failure> {
  const r = await one('SELECT * FROM account_recovery WHERE token_hash = ?', sha256(recoveryToken));
  if (!r || String(r.expires_at) < nowIso()) return fail(410, 'This recovery has expired. Please start again.');
  if (r.stage === 'LOCKED') return fail(429, 'Too many wrong attempts. Please start again.');
  if (r.stage !== stage) return fail(409, 'This step is already done. Please start again.');
  return r;
}
const isFailure = (x: Row | Failure): x is Failure => (x as Failure).ok === false;

/** A wrong answer: count it, and lock the recovery on the fifth. */
async function wrong(r: Row, column: 'nid_attempts' | 'otp_attempts', what: string): Promise<Failure> {
  const tries = Number(r[column]) + 1;
  const locked = tries >= MAX_TRIES;
  await run(`UPDATE account_recovery SET ${column} = ?, stage = ? WHERE id = ?`, tries, locked ? 'LOCKED' : r.stage, r.id);
  if (locked) return fail(429, `Too many wrong ${what}. For your security this recovery is locked; please start again.`);
  const left = MAX_TRIES - tries;
  const msg = what === 'codes' ? 'That code isn’t right.' : 'Those digits don’t match our records.';
  return fail(400, `${msg} ${left} ${left === 1 ? 'try' : 'tries'} left.`);
}

export interface OtpSent {
  ok: true;
  phone: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Only in demo mode, when no SMS gateway is configured. */
  demoOtp?: string;
}

async function sendOtp(r: Row, phone: string): Promise<OtpSent | Failure> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  if (smsConfigured()) {
    try {
      await sendSms(phone, `Your PulseHR verification code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. Never share it with anyone.`);
    } catch {
      return fail(502, 'We couldn’t send the SMS just now. Please try again in a minute.');
    }
  }
  await run(
    `UPDATE account_recovery
        SET stage = 'OTP', otp_hash = ?, otp_expires_at = ?, otp_attempts = 0,
            otp_sends = otp_sends + 1, otp_sent_at = ?
      WHERE id = ?`,
    sha256(`${r.id}:${code}`),
    inMinutes(OTP_TTL_MINUTES),
    nowIso(),
    r.id,
  );
  return {
    ok: true,
    phone: maskPhone(phone),
    expiresInSeconds: OTP_TTL_MINUTES * 60,
    resendAfterSeconds: RESEND_AFTER_SECONDS,
    ...(smsConfigured() ? {} : { demoOtp: code }),
  };
}

const contactOf = (r: Row) => one('SELECT nid_last4, phone FROM employee WHERE user_id = ?', r.user_id);

export async function verifyNid(recoveryToken: string, last4: string): Promise<OtpSent | Failure> {
  const r = await load(recoveryToken, 'NID');
  if (isFailure(r)) return r;
  const emp = await contactOf(r);
  if (!emp?.nid_last4) return fail(400, 'No National ID is on record for you. Ask HR to add it, then try again.');
  if (!sameText(last4, String(emp.nid_last4))) return wrong(r, 'nid_attempts', 'NID digits');
  if (!emp.phone) return fail(400, 'No phone number is on record for you. Ask HR to add one, then try again.');
  return sendOtp(r, String(emp.phone));
}

export async function resendOtp(recoveryToken: string): Promise<OtpSent | Failure> {
  const r = await load(recoveryToken, 'OTP');
  if (isFailure(r)) return r;
  if (Number(r.otp_sends) >= MAX_SENDS) return fail(429, 'No more codes can be sent for this recovery. Please start again.');
  const wait = Math.ceil((new Date(String(r.otp_sent_at)).getTime() + RESEND_AFTER_SECONDS * 1000 - Date.now()) / 1000);
  if (wait > 0) return fail(429, `Please wait ${wait} seconds before asking for a new code.`);
  const emp = await contactOf(r);
  return sendOtp(r, String(emp?.phone ?? ''));
}

export async function verifyOtp(recoveryToken: string, code: string): Promise<{ ok: true; resetToken: string; email: string } | Failure> {
  const r = await load(recoveryToken, 'OTP');
  if (isFailure(r)) return r;
  if (String(r.otp_expires_at) < nowIso()) return fail(400, 'This code has expired. Ask for a new one.');
  if (!sameText(sha256(`${r.id}:${code}`), String(r.otp_hash))) return wrong(r, 'otp_attempts', 'codes');
  await run(`UPDATE account_recovery SET stage = 'DONE' WHERE id = ?`, r.id);
  // Identity is proven by now, so the sign-in email can be shown: people who sign in by
  // employee ID on paper often don't remember which address their login uses.
  const user = await one('SELECT email FROM app_user WHERE id = ?', r.user_id);
  return { ok: true, resetToken: await issuePasswordResetToken(String(r.user_id)), email: String(user?.email ?? '') };
}
