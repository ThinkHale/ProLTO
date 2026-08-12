import { AlertTriangle, CheckCircle2, Circle, ShieldCheck } from 'lucide-react'

const checklist = [
  ['inspection', 'Pre-operation inspection'],
  ['controls', 'Seat / controls adjustment'],
  ['horn', 'Horn at blind intersection'],
  ['travel', 'Controlled travel and braking'],
  ['load', 'Load engagement and handling'],
  ['stack', 'Stacking / placement'],
  ['pedestrian', 'Pedestrian awareness'],
  ['shutdown', 'Shutdown procedure'],
]

export default function EvaluatorPanel({ state, score, knowledgeScore, onToggleCheck, candidateName, onCandidateChange }) {
  const completed = checklist.filter(([id]) => state.checks[id]).length
  const progress = Math.round((completed / checklist.length) * 100)
  const initials = candidateName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'ID'
  return (
    <aside className="evaluator-panel">
      <section className="candidate-summary panel-section">
        <div className="candidate-line"><div className="avatar" aria-hidden="true">{initials}</div><div><input value={candidateName} onChange={(e) => onCandidateChange(e.target.value)} aria-label="Candidate name" placeholder="Candidate name"/><span>Candidate assessment</span></div><i>Live</i></div>
        <p>{state.profile.manufacturer} {state.profile.model}</p>
        <strong>{state.family.classLabel} {state.family.label}</strong>
        <div className="progress-label" id="assessment-progress-label"><span>Assessment progress</span><b>{progress}%</b></div>
        <div className="progress" role="progressbar" aria-labelledby="assessment-progress-label" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
      </section>

      <section className="panel-section event-section">
        <header><h2>Safety Events</h2><span className={state.events.length ? 'warning-count' : 'clear-count'}>{state.events.length ? <AlertTriangle size={17} /> : <ShieldCheck size={17} />}{state.events.length}</span></header>
        <div className="event-list">
          {state.events.length === 0 && <p className="empty-state">No unsafe events observed</p>}
          {state.events.slice(-4).reverse().map((event) => <div className="event-row" key={event.id}><span>{event.time}</span><b>{event.label}</b><i className={event.severity}>{event.severity}</i></div>)}
        </div>
      </section>

      <section className="panel-section checklist-section">
        <header><h2>Observation Checklist</h2><span>{completed} / {checklist.length}</span></header>
        {checklist.map(([id, label]) => <button key={id} aria-pressed={state.checks[id]} onClick={() => onToggleCheck(id)}>{state.checks[id] ? <CheckCircle2 size={17} /> : <Circle size={17} />}<span>{label}</span></button>)}
      </section>

      <section className="panel-section score-section">
        <div><span>Overall evidence score</span><strong>{score}</strong><i>/100</i></div>
        <dl>
          <div><dt>Knowledge</dt><dd>{knowledgeScore === null ? 'Not taken' : `${knowledgeScore}%`}</dd></div>
          <div><dt>Practical</dt><dd>{Math.round((completed / checklist.length) * 100)}%</dd></div>
          <div><dt>Safety deductions</dt><dd>-{state.deductions}</dd></div>
        </dl>
        <p>Decision support only. A qualified evaluator must complete the workplace evaluation.</p>
      </section>
    </aside>
  )
}
