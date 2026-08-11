import { useEffect, useState, type FormEvent } from 'react';
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { get, post, tokens } from '../api';
import { EmptyState, TableSkeleton } from '../components/Feedback';
import { useToast } from '../components/Toast';
import '../components/recruitment-board.css';

interface VacancyDto {
  id: string;
  title: string;
  requirements: string;
  deadline: string;
  status: string;
}

interface CandidateDto {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  cv_filename: string;
  reference_code: string;
  stage: string;
  converted_employee_id: string | null;
  applied_at: string;
}

interface CandidateDetail {
  candidate: CandidateDto;
  stageHistory: { from_stage: string | null; to_stage: string; reason: string | null; created_at: string }[];
  evaluations: { interview_date: string; comments: string; score: number; created_at: string }[];
}

const STAGE_RANK: Record<string, number> = {
  APPLIED: 0,
  SHORTLISTED: 1,
  INTERVIEW: 2,
  OFFER: 3,
  HIRED: 4,
  REJECTED: 4,
};

// F7.3 / US-36: "the five stages" -- Hired and Rejected share one visual column since the
// story names them together, but each card still carries its real, distinct stage value.
const COLUMNS: { key: string; label: string; stages: string[] }[] = [
  { key: 'APPLIED', label: 'Applied', stages: ['APPLIED'] },
  { key: 'SHORTLISTED', label: 'Shortlisted', stages: ['SHORTLISTED'] },
  { key: 'INTERVIEW', label: 'Interview', stages: ['INTERVIEW'] },
  { key: 'OFFER', label: 'Offer', stages: ['OFFER'] },
  { key: 'HIRED_REJECTED', label: 'Hired / Rejected', stages: ['HIRED', 'REJECTED'] },
];

export function Recruitment({ role }: { role: string }) {
  const toast = useToast();
  const isHrAdmin = role === 'HR_ADMIN';
  const canEvaluate = role === 'MANAGER' || role === 'HR_ADMIN';

  const [vacancies, setVacancies] = useState<VacancyDto[] | null>(null);
  const [vacancyId, setVacancyId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateDto[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CandidateDetail | null>(null);

  const [vacForm, setVacForm] = useState({ title: '', requirements: '', deadline: '' });

  async function loadVacancies() {
    const list = await get<VacancyDto[]>('/vacancies');
    setVacancies(list);
    if (!vacancyId && list.length > 0) setVacancyId(list[0]!.id);
  }

  useEffect(() => {
    loadVacancies().catch((err: Error) => toast.error(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadCandidates() {
    if (!vacancyId) return;
    setCandidates(null);
    try {
      setCandidates(await get<CandidateDto[]>(`/candidates?vacancyId=${vacancyId}`));
    } catch (err) {
      toast.error((err as Error).message);
      setCandidates([]);
    }
  }

  useEffect(() => {
    void loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vacancyId]);

  async function openCandidate(id: string) {
    setOpenId(id);
    setDetail(await get<CandidateDetail>(`/candidates/${id}`));
  }

  async function createVacancy(e: FormEvent) {
    e.preventDefault();
    try {
      await post('/vacancies', vacForm);
      toast.success('Vacancy published.');
      setVacForm({ title: '', requirements: '', deadline: '' });
      await loadVacancies();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function moveStage(candidateId: string, toStage: string, fromStage: string) {
    let reason: string | undefined;
    if (STAGE_RANK[toStage]! < STAGE_RANK[fromStage]!) {
      reason = window.prompt('Moving this candidate backwards requires a reason:') ?? '';
      if (!reason.trim()) return;
    }
    try {
      await post(`/candidates/${candidateId}/stage`, { toStage, reason });
      toast.success(`Moved to ${toStage.toLowerCase()}.`);
      await loadCandidates();
      if (openId === candidateId) await openCandidate(candidateId);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function onDragEnd(e: DragEndEvent) {
    const candidateId = String(e.active.id);
    const overKey = e.over?.id ? String(e.over.id) : null;
    if (!overKey || !isHrAdmin) return;
    const candidate = candidates?.find((c) => c.id === candidateId);
    if (!candidate) return;

    let toStage = overKey;
    if (overKey === 'HIRED_REJECTED') {
      const hired = window.confirm('Mark this candidate Hired? Cancel marks them Rejected instead.');
      toStage = hired ? 'HIRED' : 'REJECTED';
    }
    if (toStage === candidate.stage) return;
    void moveStage(candidateId, toStage, candidate.stage);
  }

  return (
    <div className="view-fade">
      <h1>Recruitment (ATS)</h1>
      <p className="page-sub">Publish vacancies, track applicants through the pipeline.</p>

      {isHrAdmin && (
        <>
          <h2>Publish a vacancy</h2>
          <form className="card" onSubmit={createVacancy}>
            <div className="row">
              <div style={{ flex: 2 }}>
                <label htmlFor="vac-title">Title</label>
                <input
                  id="vac-title"
                  value={vacForm.title}
                  onChange={(e) => setVacForm({ ...vacForm, title: e.target.value })}
                  required
                />
              </div>
              <div style={{ flex: 3 }}>
                <label htmlFor="vac-req">Requirements</label>
                <input
                  id="vac-req"
                  value={vacForm.requirements}
                  onChange={(e) => setVacForm({ ...vacForm, requirements: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="vac-deadline">Deadline</label>
                <input
                  id="vac-deadline"
                  type="date"
                  value={vacForm.deadline}
                  onChange={(e) => setVacForm({ ...vacForm, deadline: e.target.value })}
                  required
                />
              </div>
              <div style={{ flex: 0, minWidth: 110, alignSelf: 'flex-end' }}>
                <button className="primary">Publish</button>
              </div>
            </div>
          </form>
        </>
      )}

      <h2>Vacancies</h2>
      {vacancies === null ? (
        <TableSkeleton rows={2} cols={3} />
      ) : vacancies.length === 0 ? (
        <EmptyState icon="💼" title="No vacancies yet" body="Publish one above to start receiving applications." />
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Deadline</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {vacancies.map((v) => (
                <tr key={v.id}>
                  <td>{v.title}</td>
                  <td>{v.deadline}</td>
                  <td>{v.status}</td>
                  <td className="num">
                    <button className="sm" onClick={() => setVacancyId(v.id)} disabled={v.id === vacancyId}>
                      {v.id === vacancyId ? 'Viewing' : 'View pipeline'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vacancyId && (
        <>
          <h2>Pipeline</h2>
          {isHrAdmin && <p className="page-sub">Drag a card to move it. Moving backwards asks for a reason.</p>}
          {candidates === null ? (
            <TableSkeleton rows={2} cols={5} />
          ) : (
            <DndContext onDragEnd={onDragEnd}>
              <div className="board">
                {COLUMNS.map((col) => (
                  <BoardColumn
                    key={col.key}
                    id={col.key}
                    label={col.label}
                    candidates={candidates.filter((c) => col.stages.includes(c.stage))}
                    onOpen={openCandidate}
                    draggable={isHrAdmin}
                  />
                ))}
              </div>
            </DndContext>
          )}
        </>
      )}

      {openId && detail && (
        <CandidateDetailPanel
          detail={detail}
          canEvaluate={canEvaluate}
          isHrAdmin={isHrAdmin}
          onClose={() => setOpenId(null)}
          onRefresh={() => openCandidate(openId)}
          onCandidatesChanged={loadCandidates}
        />
      )}
    </div>
  );
}

function BoardColumn({
  id,
  label,
  candidates,
  onOpen,
  draggable,
}: {
  id: string;
  label: string;
  candidates: CandidateDto[];
  onOpen: (id: string) => void;
  draggable: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`board-col${isOver ? ' drop-over' : ''}`}>
      <div className="board-col-head">
        {label} · {candidates.length}
      </div>
      {candidates.map((c) => (
        <BoardCard key={c.id} candidate={c} onOpen={onOpen} draggable={draggable} />
      ))}
    </div>
  );
}

function BoardCard({
  candidate,
  onOpen,
  draggable,
}: {
  candidate: CandidateDto;
  onOpen: (id: string) => void;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: candidate.id,
    disabled: !draggable,
  });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? { ...listeners, ...attributes } : {})}
      className={`board-card${isDragging ? ' dragging' : ''}`}
      onClick={() => onOpen(candidate.id)}
    >
      <strong>{candidate.full_name}</strong>
      <div className="stat-note">{candidate.reference_code}</div>
      <span className="stage-tag">{candidate.stage}</span>
    </div>
  );
}

function CandidateDetailPanel({
  detail,
  canEvaluate,
  isHrAdmin,
  onClose,
  onRefresh,
  onCandidatesChanged,
}: {
  detail: CandidateDetail;
  canEvaluate: boolean;
  isHrAdmin: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onCandidatesChanged: () => void;
}) {
  const toast = useToast();
  const { candidate, stageHistory, evaluations } = detail;

  const [evalForm, setEvalForm] = useState({ interviewDate: '', comments: '', score: 4 });
  const [convertForm, setConvertForm] = useState({ employeeCode: '', designation: '', hireDate: '' });

  async function viewCv() {
    try {
      const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';
      const res = await fetch(`${API_BASE}/candidates/${candidate.id}/cv`, {
        headers: { Authorization: `Bearer ${tokens.access}` },
      });
      if (!res.ok) throw new Error(`Could not load the CV (${res.status})`);
      window.open(URL.createObjectURL(await res.blob()), '_blank');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submitEvaluation(e: FormEvent) {
    e.preventDefault();
    try {
      await post(`/candidates/${candidate.id}/evaluations`, evalForm);
      toast.success('Evaluation recorded.');
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function convert(e: FormEvent) {
    e.preventDefault();
    try {
      await post(`/candidates/${candidate.id}/convert`, { ...convertForm, departmentId: null });
      toast.success('Converted to an employee profile.');
      onRefresh();
      onCandidatesChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div className="card content-in" style={{ marginTop: 16 }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <strong style={{ flex: 1 }}>{candidate.full_name}</strong>
        <span className="badge LOW">{candidate.stage}</span>
        <button className="sm" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="stat-note">
        {candidate.email} {candidate.phone ? `· ${candidate.phone}` : ''} · ref {candidate.reference_code}
      </p>
      <p>
        <button className="sm" onClick={viewCv}>
          View CV ({candidate.cv_filename})
        </button>
      </p>

      <h3>Stage history</h3>
      <table>
        <tbody>
          {stageHistory.map((h, i) => (
            <tr key={i}>
              <td>{h.from_stage ?? '—'} → {h.to_stage}</td>
              <td className="stat-note">{h.reason ?? ''}</td>
              <td className="stat-note">{new Date(h.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {evaluations.length > 0 && (
        <>
          <h3>Evaluations</h3>
          <table>
            <tbody>
              {evaluations.map((ev, i) => (
                <tr key={i}>
                  <td>{ev.interview_date}</td>
                  <td className="num">{ev.score}/5</td>
                  <td>{ev.comments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {canEvaluate && candidate.stage === 'INTERVIEW' && (
        <>
          <h3>Record an evaluation</h3>
          <form className="row" onSubmit={submitEvaluation}>
            <div>
              <label htmlFor="ev-date">Interview date</label>
              <input
                id="ev-date"
                type="date"
                value={evalForm.interviewDate}
                onChange={(e) => setEvalForm({ ...evalForm, interviewDate: e.target.value })}
                required
              />
            </div>
            <div style={{ flex: 2 }}>
              <label htmlFor="ev-comments">Panel comments</label>
              <input
                id="ev-comments"
                value={evalForm.comments}
                onChange={(e) => setEvalForm({ ...evalForm, comments: e.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="ev-score">Score (1-5)</label>
              <input
                id="ev-score"
                type="number"
                min={1}
                max={5}
                value={evalForm.score}
                onChange={(e) => setEvalForm({ ...evalForm, score: Number(e.target.value) })}
              />
            </div>
            <div style={{ flex: 0, minWidth: 90, alignSelf: 'flex-end' }}>
              <button className="primary sm">Save</button>
            </div>
          </form>
        </>
      )}

      {isHrAdmin && candidate.stage === 'HIRED' && !candidate.converted_employee_id && (
        <>
          <h3>Convert to employee</h3>
          <form className="row" onSubmit={convert}>
            <div>
              <label htmlFor="cv-code">Employee code</label>
              <input
                id="cv-code"
                value={convertForm.employeeCode}
                onChange={(e) => setConvertForm({ ...convertForm, employeeCode: e.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="cv-designation">Designation</label>
              <input
                id="cv-designation"
                value={convertForm.designation}
                onChange={(e) => setConvertForm({ ...convertForm, designation: e.target.value })}
                required
              />
            </div>
            <div>
              <label htmlFor="cv-hire-date">Hire date</label>
              <input
                id="cv-hire-date"
                type="date"
                value={convertForm.hireDate}
                onChange={(e) => setConvertForm({ ...convertForm, hireDate: e.target.value })}
                required
              />
            </div>
            <div style={{ flex: 0, minWidth: 90, alignSelf: 'flex-end' }}>
              <button className="primary sm">Convert</button>
            </div>
          </form>
        </>
      )}
      {candidate.converted_employee_id && <p className="notice">Already converted to an employee profile.</p>}
    </div>
  );
}
