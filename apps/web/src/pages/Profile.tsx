import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { get, post, tokens, type Me } from '../api';
import { useToast } from '../components/Toast';
import { StatSkeleton, EmptyState } from '../components/Feedback';

interface EmployeeSummary {
  id: string;
  full_name: string;
  employee_code: string;
}

interface DocumentRow {
  id: string;
  category: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_email: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  APPOINTMENT_LETTER: 'Appointment letter',
  NID_COPY: 'NID copy',
  CERTIFICATE: 'Certificate',
  OTHER: 'Other',
};

/**
 * F2.2 / US-09 (self-service contact) + F2.5 / US-12 (HR document attachments) share this
 * page: both are about one employee's profile, and F2.5 has no directory UI of its own yet.
 */
export function Profile({ role }: { role: string }) {
  const toast = useToast();
  const isHrAdmin = role === 'HR_ADMIN';

  const [me, setMe] = useState<Me | null>(null);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');
  const [busy, setBusy] = useState(false);

  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [category, setCategory] = useState('APPOINTMENT_LETTER');
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    get<Me>('/me').then((res) => {
      setMe(res);
      const emp = res.employee as Record<string, unknown> | null;
      setPhone(String(emp?.phone ?? ''));
      setAddress(String(emp?.address ?? ''));
      setEmergencyContact(String(emp?.emergency_contact ?? ''));
      if (emp) setViewingId(String(emp.id));
    });
    if (isHrAdmin) get<EmployeeSummary[]>('/employees').then(setEmployees);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!viewingId) return;
    setDocuments(null);
    get<DocumentRow[]>(`/employees/${viewingId}/documents`)
      .then(setDocuments)
      .catch(() => setDocuments([]));
  }, [viewingId]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post('/me/contact', { phone, address, emergencyContact });
      toast.success('Contact details updated.');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file || !viewingId) return;

    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const contentBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      await post(`/employees/${viewingId}/documents`, {
        category,
        filename: file.name,
        mimeType: file.type,
        contentBase64,
      });
      toast.success(`${file.name} uploaded.`);
      setDocuments(await get<DocumentRow[]>(`/employees/${viewingId}/documents`));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  // Plain <a href> can't carry the Bearer token, so the download goes through fetch and an
  // object URL instead of a direct link.
  async function viewDocument(docId: string, filename: string) {
    const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
    try {
      const res = await fetch(`${API_BASE}/employees/${viewingId}/documents/${docId}`, {
        headers: { Authorization: `Bearer ${tokens.access}` },
      });
      if (!res.ok) throw new Error(`Could not load ${filename} (${res.status})`);
      window.open(URL.createObjectURL(await res.blob()), '_blank');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (!me) return <StatSkeleton />;

  const emp = me.employee as Record<string, unknown> | null;
  const viewingSelf = viewingId === (emp ? String(emp.id) : null);

  if (!emp && !isHrAdmin) {
    return (
      <>
        <h1>My profile</h1>
        <EmptyState
          icon="🪪"
          title="No employee record"
          body="This account isn't linked to an employee record, so there's no profile to edit here."
        />
      </>
    );
  }

  return (
    <div className="content-in">
      <h1>{viewingSelf || !isHrAdmin ? 'My profile' : 'Employee profile'}</h1>
      <p className="page-sub">
        {viewingSelf || !isHrAdmin
          ? 'Update your contact details. HR sees the change immediately — no approval step.'
          : 'Attach verification documents to this employee\'s record (F2.5).'}
      </p>

      {isHrAdmin && employees.length > 0 && (
        <div className="field" style={{ maxWidth: 320, marginBottom: 18 }}>
          <label htmlFor="emp-picker">Viewing</label>
          <select id="emp-picker" value={viewingId ?? ''} onChange={(e) => setViewingId(e.target.value)}>
            {emp && (
              <option value={String(emp.id)}>
                {String(emp.full_name)} (me)
              </option>
            )}
            {employees
              .filter((e) => !emp || e.id !== String(emp.id))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name} — {e.employee_code}
                </option>
              ))}
          </select>
        </div>
      )}

      {viewingSelf && emp && (
        <>
          <div className="grid grid-3" style={{ marginBottom: 18 }}>
            <div className="card">
              <div className="stat-label">Designation</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{String(emp.designation ?? '—')}</div>
              <div className="stat-note">Read-only — HR manages this</div>
            </div>
            <div className="card">
              <div className="stat-label">Department</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{String(emp.department_name ?? '—')}</div>
              <div className="stat-note">Read-only — HR manages this</div>
            </div>
            <div className="card">
              <div className="stat-label">Employee code</div>
              <div className="stat-value" style={{ fontSize: 18 }}>{String(emp.employee_code ?? '—')}</div>
              <div className="stat-note">Read-only</div>
            </div>
          </div>

          <form className="card" onSubmit={submit} style={{ maxWidth: 480 }}>
            <div className="field">
              <label htmlFor="phone">Phone</label>
              <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01700000000" />
            </div>
            <div className="field">
              <label htmlFor="address">Address</label>
              <input id="address" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="emergency">Emergency contact</label>
              <input
                id="emergency"
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                placeholder="Name and phone number"
              />
            </div>
            <button className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </>
      )}

      <h2>Documents</h2>
      {isHrAdmin && viewingId && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row">
            <div style={{ minWidth: 180 }}>
              <label htmlFor="doc-category">Type</label>
              <select id="doc-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label htmlFor="doc-file">File (PDF, JPG or PNG, up to 5MB)</label>
              <input id="doc-file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={upload} disabled={uploading} />
            </div>
          </div>
        </div>
      )}

      {documents === null ? (
        <StatSkeleton />
      ) : documents.length === 0 ? (
        <EmptyState icon="📎" title="No documents yet" body="Appointment letters, NID copies and certificates uploaded here will appear in this list." />
      ) : (
        <div className="card content-in">
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>File</th>
                <th>Uploaded</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>{CATEGORY_LABEL[d.category] ?? d.category}</td>
                  <td>{d.filename} <span className="stat-note">({Math.ceil(d.size_bytes / 1024)} KB)</span></td>
                  <td>{new Date(d.created_at).toLocaleDateString()}</td>
                  <td>{d.uploaded_by_email}</td>
                  <td className="num">
                    <button className="sm" onClick={() => viewDocument(d.id, d.filename)}>
                      View →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
