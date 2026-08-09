/**
 * API client.
 *
 * Handles the 15-minute access token expiry transparently (ADR-006): on a 401 it spends
 * the refresh token once, retries, and gives up cleanly if the session was revoked.
 */

const ACCESS_KEY = 'pulsehr.access';
const REFRESH_KEY = 'pulsehr.refresh';

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(access: string, refresh: string) {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (tokens.access) headers.set('Authorization', `Bearer ${tokens.access}`);
  return fetch(`/api${path}`, { ...init, headers });
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!tokens.refresh) return false;
  // De-duplicate: several concurrent 401s must not each burn a refresh token.
  refreshing ??= (async () => {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: tokens.refresh }),
    });
    if (!res.ok) {
      tokens.clear();
      return false;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    tokens.set(data.accessToken, data.refreshToken);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await raw(path, init);

  if (res.status === 401 && tokens.refresh) {
    if (await tryRefresh()) res = await raw(path, init);
  }

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }
    const message =
      body && typeof body === 'object' && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

/* ------------------------------ shared types ------------------------------ */

export type Role = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';
export type RiskBand = 'LOW' | 'MODERATE' | 'ELEVATED' | 'HIGH';

export type Tier = 'STARTER' | 'GROWTH' | 'ENTERPRISE';
export type PlanStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

export type PlanFeatureKey =
  | 'attendance'
  | 'leave'
  | 'payroll'
  | 'noticeboard'
  | 'okr'
  | 'ats'
  | 'attrition_watchlist'
  | 'attrition_full'
  | 'api_access'
  | 'bias_audit';

export interface PlanFeatureDto {
  key: PlanFeatureKey;
  label: string;
  minimumTier: Tier;
  pitch: string;
}

export interface SubscriptionDto {
  organisation: string | null;
  tier: Tier;
  status: PlanStatus;
  trialEndsOn: string | null;
  seats: {
    withinLimit: boolean;
    seatsUsed: number;
    seatLimit: number;
    remaining: number;
    approachingLimit: boolean;
  };
  entitlements: PlanFeatureKey[];
  catalogue: PlanFeatureDto[];
  pricePaisa: number;
}

/**
 * The body of a 402 Payment Required.
 *
 * 402 is deliberately distinct from 403: 403 means "you will never have this", 402 means
 * "your organisation could buy this". Only the second renders an upgrade prompt.
 */
export interface UpgradeRequired {
  error: string;
  code: string;
  feature?: PlanFeatureKey;
  featureLabel?: string;
  currentTier: Tier;
  requiredTier?: Tier;
  upgrade?: { tier: Tier; pitch?: string };
}

export function isUpgradeRequired(err: unknown): err is ApiError & { body: UpgradeRequired } {
  return err instanceof ApiError && err.status === 402;
}

export interface Me {
  principal: { userId: string; organisationId: string; role: Role; employeeId: string | null };
  employee: Record<string, unknown> | null;
  balances?: Record<string, number>;
}

export interface LeaveRequestDto {
  id: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string;
}

export interface AtRiskRow {
  id: string;
  employee_id: string;
  full_name: string;
  designation: string;
  department_name: string | null;
  score: number;
  band: RiskBand;
  scored_on: string;
}

export interface Contribution {
  feature_key: string;
  label: string;
  normalised: number;
  weight: number;
  points: number;
}

export interface PayslipDto {
  id: string;
  period_year: number;
  period_month: number;
  gross: number;
  total_deductions: number;
  net_pay: number;
  lwp_days: number;
  payable_days: number;
  days_in_period: number;
  ot_hours: number;
  ot_hourly_rate: number;
  engine_version: string;
}

export interface PayslipLineDto {
  code: string;
  label: string;
  amount: number;
  sign: number;
}
