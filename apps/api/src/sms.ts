/**
 * Outgoing SMS — the one-time code for password recovery.
 *
 * Configured by PULSEHR_SMS_URL: an HTTPS endpoint of the SMS gateway, which receives
 * `POST {"to": "+8801…", "message": "…"}` (PULSEHR_SMS_TOKEN, if set, goes in the
 * Authorization header as a bearer token). Bangladeshi gateways (SSL Wireless, BulkSMSBD,
 * Twilio, …) are wired in with a small relay that accepts that shape.
 *
 * Without it the API runs in demo mode, as with email: nothing is sent and the code is
 * returned to the caller so the flow can still be walked through. Once a gateway is
 * configured the code is only ever sent by SMS, never returned.
 */

type Sender = (to: string, message: string) => Promise<void>;
let testSender: Sender | null = null;

export function smsConfigured(): boolean {
  return testSender !== null || !!process.env.PULSEHR_SMS_URL;
}

/** For tests: capture messages instead of calling a gateway. */
export function useSmsSenderForTests(s: Sender | null): void {
  testSender = s;
}

/** A Bangladeshi mobile number in international form: 017… → +88017…. */
export function toInternational(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('880')) return `+${digits}`;
  if (digits.startsWith('0')) return `+88${digits}`;
  return `+${digits}`;
}

/** Enough of the number to recognise it, not enough to learn it: +88017•••••321. */
export function maskPhone(phone: string): string {
  const intl = toInternational(phone);
  return `${intl.slice(0, 6)}${'•'.repeat(Math.max(0, intl.length - 9))}${intl.slice(-3)}`;
}

export async function sendSms(to: string, message: string): Promise<void> {
  if (testSender) return testSender(toInternational(to), message);
  const url = process.env.PULSEHR_SMS_URL;
  if (!url) throw new Error('SMS is not configured.');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.PULSEHR_SMS_TOKEN ? { Authorization: `Bearer ${process.env.PULSEHR_SMS_TOKEN}` } : {}),
    },
    body: JSON.stringify({ to: toInternational(to), message }),
  });
  if (!res.ok) throw new Error(`SMS gateway answered ${res.status}`);
}
