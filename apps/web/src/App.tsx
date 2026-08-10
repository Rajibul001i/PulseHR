import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { get, post, type PlanFeatureKey, type Role, type SubscriptionDto } from './api';
import { signedOut, type RootState } from './store';
import { fetchSubscription, TIER_LABEL, trialDaysLeft } from './subscription';
import { ToastProvider, useToast } from './components/Toast';
import { EmptyState, TableSkeleton } from './components/Feedback';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Attendance } from './pages/Attendance';
import { Leave } from './pages/Leave';
import { Payslips } from './pages/Payslips';
import { AtRisk } from './pages/AtRisk';
import { Plan } from './pages/Plan';

interface Notice {
  id: string;
  title: string;
  body: string;
  published_at: string;
}

function Noticeboard() {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  useEffect(() => {
    get<Notice[]>('/notices')
      .then(setNotices)
      .catch(() => setNotices([]));
  }, []);

  return (
    <>
      <h1>Noticeboard</h1>
      <p className="page-sub">Central, auditable internal communication.</p>
      {notices === null && <TableSkeleton rows={3} cols={1} />}
      {notices?.map((n) => (
        <div className="card content-in" key={n.id}>
          <strong>{n.title}</strong>
          <div className="stat-note">{new Date(n.published_at).toLocaleString()}</div>
          <p style={{ marginBottom: 0 }}>{n.body}</p>
        </div>
      ))}
      {notices?.length === 0 && (
        <EmptyState
          icon="📋"
          title="No notices yet"
          body="Company announcements posted by HR will appear here, newest first."
        />
      )}
    </>
  );
}

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

        {sub && (
          <div className="plan-chip">
            <div className="plan-chip-tier">{TIER_LABEL[sub.tier]}</div>
            <div className="plan-chip-seats">
              {sub.seats.seatsUsed}/{sub.seats.seatLimit} seats
            </div>
            <div className="bar sm">
              <i
                style={{
                  width: `${Math.min(100, (sub.seats.seatsUsed / Math.max(1, sub.seats.seatLimit)) * 100)}%`,
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

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard role={role} subscription={sub} />} />
          <Route path="/attendance" element={<Attendance role={role} />} />
          <Route path="/leave" element={<Leave role={role} />} />
          <Route path="/payslips" element={<Payslips role={role} />} />
          <Route path="/notices" element={<Noticeboard />} />
          <Route path="/at-risk/:id" element={<AtRisk />} />
          <Route path="/plan" element={<Plan />} />
          <Route
            path="/okr"
            element={
              <ComingSoon
                title="Performance (OKR)"
                body="Quarterly objectives and key results. Feature 6 — scheduled for Increment 3."
              />
            }
          />
          <Route
            path="/ats"
            element={
              <ComingSoon
                title="Recruitment (ATS)"
                body="Kanban hiring pipeline from application to offer. Feature 7 — scheduled for Increment 3."
              />
            }
          />
        </Routes>
      </main>
    </div>
  );
}

function ComingSoon({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h1>{title}</h1>
      <EmptyState icon="🚧" title="Not built yet" body={body} />
    </>
  );
}

export function App() {
  const authenticated = useSelector((s: RootState) => s.auth.authenticated);
  return (
    <ToastProvider>{authenticated ? <Shell /> : <Login />}</ToastProvider>
  );
}
