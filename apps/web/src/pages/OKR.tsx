import { useEffect, useState, type FormEvent } from 'react';
import { get, post, type Me } from '../api';
import { EmptyState, TableSkeleton } from '../components/Feedback';
import { useToast } from '../components/Toast';

interface EmployeeSummary {
  id: string;
  full_name: string;
  employee_code: string;
  manager_id: string | null;
}

interface KeyResultDto {
  id: string;
  title: string;
  target_value: number;
  current_value: number;
  unit: string | null;
  comment: string | null;
}

interface ObjectiveDto {
  id: string;
  employee_id: string;
  quarter: string;
  title: string;
  weight_pct: number;
  closed_at: string | null;
  keyResults: KeyResultDto[];
  completionPct: number;
}

interface ReviewScoreDto {
  id: string;
  quarter: string;
  score: number;
  published_at: string | null;
}

function currentQuarter(d = new Date()): string {
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

/** F6 Performance Management — quarterly objectives/key results (US-30/31) and manager
 *  review scores (US-32/33). */
export function OKR({ role }: { role: string }) {
  const toast = useToast();
  const canSetObjectives = role === 'MANAGER' || role === 'HR_ADMIN';

  const [me, setMe] = useState<Me | null>(null);
  const [employees, setEmployees] = useState<EmployeeSummary[]>([]);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [quarter, setQuarter] = useState(currentQuarter());
  const [objectives, setObjectives] = useState<ObjectiveDto[] | null>(null);
  const [scores, setScores] = useState<ReviewScoreDto[] | null>(null);

  const [objForm, setObjForm] = useState({
    title: '',
    weightPct: 20,
    krTitle: '',
    krTarget: 100,
    krUnit: '',
  });
  const [scoreForm, setScoreForm] = useState(4);

  useEffect(() => {
    get<Me>('/me').then((res) => {
      setMe(res);
      const emp = res.employee as Record<string, unknown> | null;
      if (emp) setViewingId(String(emp.id));
    });
    // HR_ADMIN has no employee record of their own, so nothing above ever sets viewingId for
    // that role. Without a fallback, the <select> below has no option matching its '' value,
    // so the browser silently displays the first option anyway while viewingId genuinely
    // stays null -- objectives/scores then never fetch (both effects are gated on it), and
    // the page looks like it's showing someone's OKRs while actually stuck loading forever.
    if (canSetObjectives) {
      get<EmployeeSummary[]>('/employees').then((list) => {
        setEmployees(list);
        if (list.length > 0) setViewingId((v) => v ?? list[0]!.id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadObjectives() {
    if (!viewingId) return;
    setObjectives(null);
    try {
      setObjectives(await get<ObjectiveDto[]>(`/okr/objectives?employeeId=${viewingId}&quarter=${quarter}`));
    } catch (err) {
      toast.error((err as Error).message);
      setObjectives([]);
    }
  }

  async function loadScores() {
    if (!viewingId) return;
    setScores(null);
    try {
      setScores(await get<ReviewScoreDto[]>(`/okr/review-scores?employeeId=${viewingId}`));
    } catch (err) {
      toast.error((err as Error).message);
      setScores([]);
    }
  }

  useEffect(() => {
    void loadObjectives();
    void loadScores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingId, quarter]);

  const myEmployeeId = me?.employee ? String((me.employee as Record<string, unknown>).id) : null;
  const viewingSelf = viewingId === myEmployeeId;
  const weightUsed = objectives?.reduce((s, o) => s + o.weight_pct, 0) ?? 0;

  const pickableEmployees =
    role === 'HR_ADMIN'
      ? employees
      : employees.filter((e) => e.manager_id === myEmployeeId || e.id === myEmployeeId);

  async function updateProgress(kr: KeyResultDto, currentValue: number, comment: string) {
    try {
      await post(`/okr/key-results/${kr.id}/progress`, { currentValue, comment: comment || undefined });
      toast.success('Progress updated.');
      await loadObjectives();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function createObjective(e: FormEvent) {
    e.preventDefault();
    if (!viewingId) return;
    try {
      await post('/okr/objectives', {
        employeeId: viewingId,
        quarter,
        title: objForm.title,
        weightPct: objForm.weightPct,
        keyResults: [{ title: objForm.krTitle, targetValue: objForm.krTarget, unit: objForm.krUnit || undefined }],
      });
      toast.success('Objective set.');
      setObjForm({ ...objForm, title: '', krTitle: '' });
      await loadObjectives();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function closeQuarter() {
    if (!window.confirm(`Close ${quarter} org-wide? Every objective in it becomes read-only.`)) return;
    try {
      await post(`/okr/quarters/${quarter}/close`);
      toast.success(`${quarter} closed.`);
      await loadObjectives();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function recordScore(e: FormEvent) {
    e.preventDefault();
    if (!viewingId) return;
    try {
      await post('/okr/review-scores', { employeeId: viewingId, quarter, score: scoreForm });
      toast.success('Review score recorded (draft — publish it below to share with the employee).');
      await loadScores();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function publishScore(id: string) {
    try {
      await post(`/okr/review-scores/${id}/publish`);
      toast.success('Score published — the employee can now see it.');
      await loadScores();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (!me) return <TableSkeleton rows={3} cols={3} />;

  return (
    <div className="view-fade">
      <h1>Performance (OKR)</h1>
      <p className="page-sub">Quarterly objectives, key results and manager review scores.</p>

      <div className="card">
        <div className="row-tight" style={{ alignItems: 'flex-end' }}>
          {pickableEmployees.length > 0 && (
            <div style={{ minWidth: 220 }}>
              <label htmlFor="okr-emp-picker">Employee</label>
              <select
                id="okr-emp-picker"
                value={viewingId ?? ''}
                onChange={(e) => setViewingId(e.target.value)}
              >
                {myEmployeeId && !pickableEmployees.some((e) => e.id === myEmployeeId) && (
                  <option value={myEmployeeId}>Myself</option>
                )}
                {pickableEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.full_name} ({e.employee_code})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ minWidth: 140 }}>
            <label htmlFor="okr-quarter">Quarter</label>
            <input
              id="okr-quarter"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              pattern="\d{4}-Q[1-4]"
              placeholder="2026-Q3"
            />
          </div>
          {role === 'HR_ADMIN' && (
            <button type="button" className="sm danger" onClick={closeQuarter}>
              Close {quarter} org-wide
            </button>
          )}
        </div>
      </div>

      <h2>Objectives — {quarter}</h2>
      {objectives === null ? (
        <TableSkeleton rows={2} cols={3} />
      ) : objectives.length === 0 ? (
        <EmptyState icon="🎯" title="No objectives set" body="Objectives for this employee and quarter will appear here once set." />
      ) : (
        objectives.map((o) => (
          <div className="card content-in" key={o.id} style={{ marginBottom: 12 }}>
            <div className="row-tight" style={{ alignItems: 'baseline' }}>
              <strong style={{ flex: 1 }}>{o.title}</strong>
              <span className="stat-note">weight {o.weight_pct}%</span>
              <span className={`badge ${o.completionPct >= 100 ? 'HIGH' : o.completionPct >= 50 ? 'MODERATE' : 'LOW'}`}>
                {o.completionPct}% complete
              </span>
              {o.closed_at && <span className="stat-note">🔒 closed</span>}
            </div>
            <table style={{ marginTop: 10 }}>
              <tbody>
                {o.keyResults.map((kr) => (
                  <KeyResultRow
                    key={kr.id}
                    kr={kr}
                    editable={viewingSelf && !o.closed_at}
                    onUpdate={(v, c) => updateProgress(kr, v, c)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}

      {canSetObjectives && viewingId && (
        <>
          <h2>Set a new objective</h2>
          <p className="page-sub">
            {weightUsed}/100% of this employee's weight is already allocated for {quarter}.
          </p>
          <form className="card" onSubmit={createObjective}>
            <div className="row">
              <div style={{ flex: 2 }}>
                <label htmlFor="obj-title">Objective title</label>
                <input
                  id="obj-title"
                  value={objForm.title}
                  onChange={(e) => setObjForm({ ...objForm, title: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="obj-weight">Weight %</label>
                <input
                  id="obj-weight"
                  type="number"
                  min={1}
                  max={100}
                  value={objForm.weightPct}
                  onChange={(e) => setObjForm({ ...objForm, weightPct: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="row">
              <div style={{ flex: 2 }}>
                <label htmlFor="kr-title">Key result</label>
                <input
                  id="kr-title"
                  value={objForm.krTitle}
                  onChange={(e) => setObjForm({ ...objForm, krTitle: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="kr-target">Target value</label>
                <input
                  id="kr-target"
                  type="number"
                  value={objForm.krTarget}
                  onChange={(e) => setObjForm({ ...objForm, krTarget: Number(e.target.value) })}
                />
              </div>
              <div>
                <label htmlFor="kr-unit">Unit (optional)</label>
                <input
                  id="kr-unit"
                  value={objForm.krUnit}
                  onChange={(e) => setObjForm({ ...objForm, krUnit: e.target.value })}
                  placeholder="count, %, ..."
                />
              </div>
              <div style={{ flex: 0, minWidth: 150, alignSelf: 'flex-end' }}>
                <button className="primary">Set objective</button>
              </div>
            </div>
          </form>
        </>
      )}

      <h2>Review score trend</h2>
      {scores === null ? (
        <TableSkeleton rows={1} cols={3} />
      ) : scores.length === 0 ? (
        <EmptyState icon="📈" title="No review scores yet" body="Quarterly review scores appear here once recorded." />
      ) : (
        <div className="card table-card">
          <table>
            <thead>
              <tr>
                <th>Quarter</th>
                <th className="num">Score</th>
                <th>Status</th>
                {canSetObjectives && <th />}
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.id}>
                  <td>{s.quarter}</td>
                  <td className="num">{s.score.toFixed(1)} / 5</td>
                  <td>{s.published_at ? <span className="badge LOW">Published</span> : <span className="stat-note">Draft</span>}</td>
                  {canSetObjectives && (
                    <td className="num">
                      {!s.published_at && (
                        <button className="sm" onClick={() => publishScore(s.id)}>
                          Publish
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canSetObjectives && viewingId && (
        <form className="card" onSubmit={recordScore} style={{ marginTop: 12 }}>
          <div className="row">
            <div>
              <label htmlFor="score-val">Record a review score for {quarter} (1-5)</label>
              <input
                id="score-val"
                type="number"
                min={1}
                max={5}
                step={0.5}
                value={scoreForm}
                onChange={(e) => setScoreForm(Number(e.target.value))}
              />
            </div>
            <div style={{ flex: 0, minWidth: 110, alignSelf: 'flex-end' }}>
              <button className="primary">Save score</button>
            </div>
          </div>
        </form>
      )}
    </div>
  );
}

function KeyResultRow({
  kr,
  editable,
  onUpdate,
}: {
  kr: KeyResultDto;
  editable: boolean;
  onUpdate: (value: number, comment: string) => void;
}) {
  const [value, setValue] = useState(kr.current_value);
  const [comment, setComment] = useState(kr.comment ?? '');
  const overTarget = value > kr.target_value;

  return (
    <tr>
      <td>{kr.title}</td>
      <td className="num">
        {kr.current_value} / {kr.target_value} {kr.unit ?? ''}
      </td>
      {editable ? (
        <td>
          <div className="row-tight">
            <input
              type="number"
              style={{ width: 90 }}
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
            />
            {overTarget && (
              <input
                placeholder="Comment required — over target"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ flex: 1 }}
              />
            )}
            <button type="button" className="sm" onClick={() => onUpdate(value, comment)}>
              Update
            </button>
          </div>
        </td>
      ) : (
        <td className="stat-note">{kr.comment ?? ''}</td>
      )}
    </tr>
  );
}
