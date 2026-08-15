import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { post, type PlanFeatureKey, type Role, type SubscriptionDto } from './api';
import { signedOut, type RootState } from './store';
import { fetchSubscription, TIER_LABEL, trialDaysLeft } from './subscription';
import { ToastProvider, useToast } from './components/Toast';
import { NotificationBell } from './components/NotificationBell';
import { Logo } from './components/Logo';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { Profile } from './pages/Profile';
import { Attendance } from './pages/Attendance';
import { Leave } from './pages/Leave';
import { Payslips } from './pages/Payslips';
import { AtRisk } from './pages/AtRisk';
import { Plan } from './pages/Plan';
import { OKR } from './pages/OKR';
import { Recruitment } from './pages/Recruitment';
import { CareersList, CareersApply } from './pages/Careers';
import { Notices } from './pages/Notices';

/* ------------------------------- theme ---------------------------------- */

type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('pulsehr.theme') as Theme | null;
    if (saved) return saved;
    // Follow the OS by default — dark-only reads as a hobby project, and HR staff in a
    // bright office want light mode.
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('pulsehr.theme', theme);
  }, [theme]);

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

type AccentPalette = 'pulse' | 'classic' | 'violet';
const PALETTES: { key: AccentPalette; label: string; swatch: string }[] = [
  { key: 'pulse', label: 'Pulse', swatch: '#2dd4bf' },
  { key: 'classic', label: 'Classic', swatch: '#3b82f6' },
  { key: 'violet', label: 'Violet', swatch: '#a78bfa' },
];

/** An axis independent of light/dark mode -- which accent colour the UI uses. Defaults to
 *  "pulse", the brand-aligned teal, rather than the legacy blue. */
function usePalette(): [AccentPalette, (p: AccentPalette) => void] {
  const [palette, setPalette] = useState<AccentPalette>(() => {
    const saved = localStorage.getItem('pulsehr.palette') as AccentPalette | null;
    return saved ?? 'pulse';
  });

  useEffect(() => {
    document.documentElement.dataset.palette = palette;
    localStorage.setItem('pulsehr.palette', palette);
  }, [palette]);

  return [palette, setPalette];
}

/** Click-outside-to-close via a document listener, not a full-page scrim -- a scrim here
 *  would sit above the rest of the sidebar (no stacking context at desktop width) and
 *  swallow the first click on anything else, the same bug fixed on NotificationBell. */
function PaletteSwitcher({ palette, onChange }: { palette: AccentPalette; onChange: (p: AccentPalette) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const active = PALETTES.find((p) => p.key === palette) ?? PALETTES[0]!;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div className="palette-switcher" ref={wrapRef}>
      <button
        className="sm"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Accent colour: ${active.label}`}
        aria-expanded={open}
      >
        <span className="palette-swatch" style={{ background: active.swatch }} aria-hidden="true" />
      </button>
      {open && (
        <div className="palette-menu">
          {PALETTES.map((p) => (
            <button
              key={p.key}
              className={`palette-menu-item${p.key === palette ? ' active' : ''}`}
              onClick={() => {
                onChange(p.key);
                setOpen(false);
              }}
            >
              <span className="palette-swatch" style={{ background: p.swatch }} aria-hidden="true" />
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- nav ----------------------------------- */

interface NavItem {
  to: string;
  label: string;
  /** When set, the item is gated behind this plan feature. */
  feature?: PlanFeatureKey;
  roles?: Role[];
}

/*
 * Plan & billing deliberately isn't in this list. It's an account-level concern (checked
 * rarely, by HR_ADMIN only) rather than a daily-use workspace tool like Attendance or Leave
 * -- mixing it into the same list as the things people click every day is exactly the kind
 * of "everything is a peer of everything else" flattening that makes a sidebar feel messy.
 * It gets its own entry point instead: the plan-chip already shown to every role becomes a
 * link to it for HR_ADMIN (see Shell below), the same pattern a settings/account menu would
 * use in a product that has one. The route itself is unchanged and still reachable -- every
 * "locked feature" link elsewhere still points at /plan.
 */
const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/profile', label: 'My profile' },
  { to: '/attendance', label: 'Attendance', feature: 'attendance' },
  { to: '/leave', label: 'Leave', feature: 'leave' },
  { to: '/payslips', label: 'Payslips', feature: 'payroll' },
  { to: '/notices', label: 'Noticeboard', feature: 'noticeboard' },
  { to: '/okr', label: 'Performance', feature: 'okr' },
  { to: '/ats', label: 'Recruitment', feature: 'ats' },
];

/** The account-level summary shown in the sidebar. For HR_ADMIN it's the entry point into
 *  Plan & billing (see the comment on NAV above) -- for every other role it's read-only,
 *  since only HR_ADMIN can act on billing. */
function PlanChip({ sub, days, linked }: { sub: SubscriptionDto; days: number | null; linked: boolean }) {
  const body = (
    <>
      <div className="plan-chip-tier">{TIER_LABEL[sub.tier]}</div>
      <div className="plan-chip-seats">
        {sub.seats.seatsUsed}/{sub.seats.seatLimit} seats
      </div>
      <div className="bar sm">
        <i
          style={{
            transform: `scaleX(${Math.min(1, sub.seats.seatsUsed / Math.max(1, sub.seats.seatLimit))})`,
            background: sub.seats.approachingLimit ? 'var(--elevated)' : 'var(--accent)',
          }}
        />
      </div>
      {days !== null && <div className="plan-chip-trial">Trial · {days}d left</div>}
      {linked && (
        <div className="plan-chip-manage">
          Manage plan <span aria-hidden="true">&rarr;</span>
        </div>
      )}
    </>
  );

  if (!linked) return <div className="plan-chip">{body}</div>;
  return (
    <NavLink to="/plan" className="plan-chip plan-chip-link">
      {body}
    </NavLink>
  );
}

function Shell() {
  const auth = useSelector((s: RootState) => s.auth);
  const dispatch = useDispatch();
  const toast = useToast();
  const location = useLocation();
  const [theme, toggleTheme] = useTheme();
  const [palette, setPalette] = usePalette();
  const [sub, setSub] = useState<SubscriptionDto | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const role = (auth.role ?? 'EMPLOYEE') as Role;

  useEffect(() => {
    fetchSubscription()
      .then(setSub)
      .catch(() => setSub(null));
  }, []);

  // Close the mobile drawer on navigation — otherwise it covers the page you just opened.
  useEffect(() => setNavOpen(false), [location.pathname]);

  async function logout() {
    try {
      await post('/auth/logout');
    } catch {
      /* the local sign-out must succeed regardless */
    }
    dispatch(signedOut());
    toast.info('Signed out. All sessions revoked.');
  }

  const days = trialDaysLeft(sub);
  const visible = NAV.filter((i) => !i.roles || i.roles.includes(role));

  return (
    <div className="shell">
      <button
        className="nav-toggle no-print"
        aria-label="Toggle navigation"
        aria-expanded={navOpen}
        onClick={() => setNavOpen((o) => !o)}
      >
        ☰
      </button>

      <div
        className={`scrim no-print ${navOpen ? 'open' : ''}`}
        onClick={() => setNavOpen(false)}
      />

      <aside className={`sidebar no-print ${navOpen ? 'open' : ''}`}>
        <Logo tagline="Predictive HRIS" />

        <div style={{ marginBottom: 14 }}>
          <NotificationBell />
        </div>

        {sub && (
          <PlanChip sub={sub} days={days} linked={role === 'HR_ADMIN'} />
        )}

        <nav className="nav">
          {visible.map((item) => {
            const locked = Boolean(item.feature && sub && !sub.entitlements.includes(item.feature));
            if (locked) {
              // Locked items stay VISIBLE. Hiding them means the customer never learns the
              // feature exists and never upgrades. docs/12-ui-modernisation.md §2.1.
              return (
                <NavLink to="/plan" className="locked" key={item.to} title={`Included in a higher plan`}>
                  {item.label}
                  <span className="lock" aria-label="requires an upgrade">
                    🔒
                  </span>
                </NavLink>
              );
            }
            return (
              <NavLink to={item.to} end={item.to === '/'} key={item.to}>
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="truncate">{auth.email}</div>
          <div style={{ marginBottom: 10 }}>{role.replace('_', ' ')}</div>
          <div className="row-tight">
            <button className="sm" onClick={toggleTheme} aria-label="Toggle colour theme">
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <PaletteSwitcher palette={palette} onChange={setPalette} />
            <button className="sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard role={role} subscription={sub} />} />
          <Route path="/profile" element={<Profile role={role} />} />
          <Route path="/attendance" element={<Attendance role={role} />} />
          <Route path="/leave" element={<Leave role={role} />} />
          <Route path="/payslips" element={<Payslips role={role} />} />
          <Route path="/notices" element={<Notices role={role} />} />
          <Route path="/at-risk/:id" element={<AtRisk />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/okr" element={<OKR role={role} />} />
          <Route path="/ats" element={<Recruitment role={role} />} />
        </Routes>
      </main>
    </div>
  );
}

export function App() {
  const authenticated = useSelector((s: RootState) => s.auth.authenticated);
  const location = useLocation();

  // Reachable regardless of auth state -- a reset link may be clicked with a stale session
  // still in localStorage, and resetting a forgotten password shouldn't require signing in.
  if (location.pathname === '/reset-password') {
    return (
      <ToastProvider>
        <ResetPassword />
      </ToastProvider>
    );
  }

  // F7.1/F7.2 · US-34/US-35 — the public careers pages, reachable with no login, checked
  // before the auth gate the same way /reset-password is above. A real <Routes> block (not
  // just a manual pathname check) so CareersList/CareersApply get real route params from
  // useParams() -- rendering them directly without a matching <Route> would leave orgId and
  // vacancyId undefined.
  if (location.pathname.startsWith('/careers/')) {
    return (
      <ToastProvider>
        <Routes>
          <Route path="/careers/:orgId" element={<CareersList />} />
          <Route path="/careers/:orgId/:vacancyId" element={<CareersApply />} />
        </Routes>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>{authenticated ? <Shell /> : <Login />}</ToastProvider>
  );
}
