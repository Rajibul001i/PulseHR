import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { post, type PlanFeatureKey, type Role, type SubscriptionDto } from './api';
import { signedOut, type RootState } from './store';
import { fetchSubscription, TIER_LABEL, trialDaysLeft } from './subscription';
import { ToastProvider, useToast } from './components/Toast';
import { CommandPalette } from './components/CommandPalette';
import { NotificationBell } from './components/NotificationBell';
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

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

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

/* -------------------------------- nav ----------------------------------- */

interface NavItem {
  to: string;
  label: string;
  /** When set, the item is gated behind this plan feature. */
  feature?: PlanFeatureKey;
  roles?: Role[];
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/profile', label: 'My profile' },
  { to: '/attendance', label: 'Attendance', feature: 'attendance' },
  { to: '/leave', label: 'Leave', feature: 'leave' },
  { to: '/payslips', label: 'Payslips', feature: 'payroll' },
  { to: '/notices', label: 'Noticeboard', feature: 'noticeboard' },
  { to: '/okr', label: 'Performance', feature: 'okr' },
  { to: '/ats', label: 'Recruitment', feature: 'ats' },
  { to: '/plan', label: 'Plan & billing', roles: ['HR_ADMIN'] },
];

function Shell() {
  const auth = useSelector((s: RootState) => s.auth);
  const dispatch = useDispatch();
  const toast = useToast();
  const location = useLocation();
  const [theme, toggleTheme] = useTheme();
  const [sub, setSub] = useState<SubscriptionDto | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

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
        <div className="brand">
          Pulse<span>HR</span>
        </div>
        <div className="brand-sub">Predictive HRIS</div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button className="cmdk-trigger no-print" style={{ marginBottom: 0, flex: 1 }} onClick={() => setPaletteOpen(true)}>
            <span>Jump to…</span>
            <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <NotificationBell />
        </div>

        {sub && (
          <div className="plan-chip">
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
          </div>
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
            <button className="sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        nav={NAV}
        role={role}
        subscription={sub}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={logout}
      />

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
