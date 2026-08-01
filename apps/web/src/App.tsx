import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { NavLink, Route, Routes } from 'react-router-dom';
import { get, post, type Role } from './api';
import { signedOut, type RootState } from './store';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Attendance } from './pages/Attendance';
import { Leave } from './pages/Leave';
import { Payslips } from './pages/Payslips';
import { AtRisk } from './pages/AtRisk';

interface Notice {
  id: string;
  title: string;
  body: string;
  published_at: string;
}

function Noticeboard() {
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    get<Notice[]>('/notices').then(setNotices).catch(() => setNotices([]));
  }, []);
  return (
    <>
      <h1>Noticeboard</h1>
      <p className="page-sub">Central, auditable internal communication.</p>
      {notices.map((n) => (
        <div className="card" key={n.id}>
          <strong>{n.title}</strong>
          <div className="stat-note">{new Date(n.published_at).toLocaleString()}</div>
          <p style={{ marginBottom: 0 }}>{n.body}</p>
        </div>
      ))}
      {notices.length === 0 && <p className="notice">No notices.</p>}
    </>
  );
}

export function App() {
  const auth = useSelector((s: RootState) => s.auth);
  const dispatch = useDispatch();

  if (!auth.authenticated) return <Login />;

  const role = (auth.role ?? 'EMPLOYEE') as Role;

  async function logout() {
    try {
      // Revokes every refresh session server-side (ADR-006) — not just a local clear.
      await post('/auth/logout');
    } catch {
      /* the local sign-out must succeed regardless */
    }
    dispatch(signedOut());
  }

  return (
    <div className="shell">
      <aside className="sidebar no-print">
        <div className="brand">
          Pulse<span>HR</span>
        </div>
        <div className="brand-sub">Predictive HRIS</div>

        <nav className="nav">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/attendance">Attendance</NavLink>
          <NavLink to="/leave">Leave</NavLink>
          <NavLink to="/payslips">Payslips</NavLink>
          <NavLink to="/notices">Noticeboard</NavLink>
        </nav>

        <div className="sidebar-foot">
          <div>{auth.email}</div>
          <div style={{ marginBottom: 10 }}>{role.replace('_', ' ')}</div>
          <button className="sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard role={role} />} />
          <Route path="/attendance" element={<Attendance role={role} />} />
          <Route path="/leave" element={<Leave role={role} />} />
          <Route path="/payslips" element={<Payslips role={role} />} />
          <Route path="/notices" element={<Noticeboard />} />
          <Route path="/at-risk/:id" element={<AtRisk />} />
        </Routes>
      </main>
    </div>
  );
}
