import { useEffect, useState, type FormEvent } from 'react';
import { get, post } from '../api';
import { EmptyState, TableSkeleton } from '../components/Feedback';
import { useToast } from '../components/Toast';

interface Notice {
  id: string;
  title: string;
  body: string;
  published_at: string;
  audience_type: 'COMPANY' | 'DEPARTMENTS';
  is_urgent: number;
  read: boolean;
}

interface Department {
  id: string;
  name: string;
}

interface ReadReport {
  read: { id: string; full_name: string; employee_code: string }[];
  unread: { id: string; full_name: string; employee_code: string }[];
}

/**
 * F8 Digital Noticeboard. F8.1's audience targeting had never actually been built despite
 * being marked done (see docs/13-sqa-defect-report.md S10) -- there was no create form at
 * all, only the read-only list. This closes F8.1, F8.2 (urgent pinning) and F8.3 (read
 * tracking) together since they all live on the same notice entity.
 */
export function Notices({ role }: { role: string }) {
  const toast = useToast();
  const isHrAdmin = role === 'HR_ADMIN';

  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState({
    title: '',
    body: '',
    audienceType: 'COMPANY' as 'COMPANY' | 'DEPARTMENTS',
    departmentIds: [] as string[],
    isUrgent: false,
  });
  const [reportFor, setReportFor] = useState<string | null>(null);
  const [report, setReport] = useState<ReadReport | null>(null);

  async function load() {
    try {
      setNotices(await get<Notice[]>('/notices'));
    } catch (err) {
      toast.error((err as Error).message);
      setNotices([]);
    }
  }

  useEffect(() => {
    void load();
    if (isHrAdmin) get<Department[]>('/departments').then(setDepartments).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openNotice(n: Notice) {
    if (!n.read) {
      try {
        await post(`/notices/${n.id}/read`);
        await load();
      } catch {
        /* read-tracking is best-effort; failing to record it shouldn't block reading */
      }
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await post('/notices', form);
      toast.success('Notice published.');
      setForm({ title: '', body: '', audienceType: 'COMPANY', departmentIds: [], isUrgent: false });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function toggleUrgent(n: Notice) {
    try {
      await post(`/notices/${n.id}/urgent`, { isUrgent: !n.is_urgent });
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function viewReport(n: Notice) {
    setReportFor(n.id);
    setReport(null);
    try {
      setReport(await get<ReadReport>(`/notices/${n.id}/report`));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function toggleDept(id: string) {
    setForm((f) => ({
      ...f,
      departmentIds: f.departmentIds.includes(id)
        ? f.departmentIds.filter((d) => d !== id)
        : [...f.departmentIds, id],
    }));
  }

  return (
    <div className="view-fade">
      <h1>Noticeboard</h1>
      <p className="page-sub">Central, auditable internal communication.</p>

      {isHrAdmin && (
        <form className="card" onSubmit={submit} style={{ marginBottom: 18 }}>
          <div className="field">
            <label htmlFor="n-title">Title</label>
            <input id="n-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div className="field">
            <label htmlFor="n-body">Body</label>
            <textarea
              id="n-body"
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              required
            />
          </div>
          <div className="row-tight" style={{ alignItems: 'flex-end' }}>
            <div style={{ minWidth: 200 }}>
              <label htmlFor="n-audience">Audience</label>
              <select
                id="n-audience"
                value={form.audienceType}
                onChange={(e) => setForm({ ...form, audienceType: e.target.value as 'COMPANY' | 'DEPARTMENTS' })}
              >
                <option value="COMPANY">Whole company</option>
                <option value="DEPARTMENTS">Selected departments</option>
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 9 }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={form.isUrgent}
                onChange={(e) => setForm({ ...form, isUrgent: e.target.checked })}
              />
              Mark urgent (pins to the top)
            </label>
            <button className="primary">Publish</button>
          </div>
          {form.audienceType === 'DEPARTMENTS' && (
            <div style={{ marginTop: 10 }}>
              {departments.map((d) => (
                <label key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 14 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    checked={form.departmentIds.includes(d.id)}
                    onChange={() => toggleDept(d.id)}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          )}
        </form>
      )}

      {notices === null && <TableSkeleton rows={3} cols={1} />}
      {notices?.map((n, i) => (
        <div
          key={n.id}
          className={`card content-in${n.read ? '' : ' notice-unread'}`}
          style={{ animationDelay: `${Math.min(i, 3) * 30}ms`, cursor: 'pointer' }}
          onClick={() => openNotice(n)}
        >
          <div className="row-tight" style={{ alignItems: 'baseline' }}>
            <strong style={{ flex: 1 }}>
              {n.is_urgent ? '📌 ' : ''}
              {n.title}
              {!n.read && <span className="notice-new-tag" style={{ marginLeft: 8 }}>new</span>}
            </strong>
            {isHrAdmin && (
              <>
                <button
                  type="button"
                  className="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleUrgent(n);
                  }}
                >
                  {n.is_urgent ? 'Unpin' : 'Pin urgent'}
                </button>
                <button
                  type="button"
                  className="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    viewReport(n);
                  }}
                >
                  Who's read this?
                </button>
              </>
            )}
          </div>
          <div className="stat-note">
            {new Date(n.published_at).toLocaleString()} · {n.audience_type === 'COMPANY' ? 'Whole company' : 'Selected departments'}
          </div>
          <p style={{ marginBottom: 0 }}>{n.body}</p>

          {reportFor === n.id && report && (
            <div className="card" style={{ marginTop: 10, background: 'var(--surface-2)' }} onClick={(e) => e.stopPropagation()}>
              <p className="stat-note">
                Read: {report.read.length} · Unread: {report.unread.length}
              </p>
              {report.unread.length > 0 && (
                <p className="stat-note">Still unread: {report.unread.map((e) => e.full_name).join(', ')}</p>
              )}
            </div>
          )}
        </div>
      ))}
      {notices?.length === 0 && (
        <EmptyState
          icon="📋"
          title="No notices yet"
          body="Company announcements posted by HR will appear here, newest first."
        />
      )}
    </div>
  );
}
