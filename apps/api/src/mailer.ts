/**
 * Outgoing email — F1.4 password reset.
 *
 * Configured by PULSEHR_SMTP_URL (e.g. smtps://user:pass@smtp.example.com:465) and
 * PULSEHR_MAIL_FROM. PULSEHR_APP_URL is the web app's address, used to build the link.
 * Without an SMTP server the API runs in demo mode: nothing is sent, and the reset token is
 * returned to the caller instead so the flow can still be demonstrated. Once SMTP is
 * configured the token is only ever emailed, never returned.
 */

import nodemailer, { type Transporter } from 'nodemailer';

let transport: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transport === undefined) {
    const url = process.env.PULSEHR_SMTP_URL;
    transport = url ? nodemailer.createTransport(url) : null;
  }
  return transport;
}

export function emailConfigured(): boolean {
  return getTransport() !== null;
}

/** For tests: send through any nodemailer transport (e.g. jsonTransport) instead of SMTP. */
export function useTransportForTests(t: Transporter): void {
  transport = t;
}

export async function sendPasswordResetEmail(to: string, token: string, appUrl: string): Promise<void> {
  const t = getTransport();
  if (!t) throw new Error('Email is not configured.');
  const link = `${appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  await t.sendMail({
    from: process.env.PULSEHR_MAIL_FROM ?? 'PulseHR <no-reply@pulsehr.local>',
    to,
    subject: 'Reset your PulseHR password',
    text:
      `Someone asked to reset the password for this PulseHR account.\n\n` +
      `Open this link within 30 minutes to choose a new password:\n${link}\n\n` +
      `The link works once. If you didn't ask for this, you can ignore this email.`,
  });
}
