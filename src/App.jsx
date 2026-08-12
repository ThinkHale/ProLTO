import { useCallback, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, Cuboid, FileCheck2, Gauge, Gamepad2, HelpCircle, LayoutDashboard, Monitor, RotateCcw, Settings, ShieldCheck, Users, Warehouse } from 'lucide-react'
import { equipmentFamilies, getEquipment } from './data/equipment.js'
import Simulator from './components/Simulator.jsx'
import KnowledgeAssessment from './components/KnowledgeAssessment.jsx'
import EvaluatorPanel from './components/EvaluatorPanel.jsx'

const initialTelemetry = { speed: 0, signedSpeed: 0, fork: 0, reach: 0, tilt: 0, load: 0, stability: 100, heading: 0, steerAngle: 0, xr: false }
const initialChecks = { inspection: false, controls: false, horn: false, travel: false, load: false, stack: false, pedestrian: false, shutdown: false }
const initialEngineStatus = { phase: 'loading', message: 'Loading simulator', xrSupported: false, error: null }

function readinessFailure(status) {
  if (status.phase !== 'failed') return null
  const details = `${status.code || ''} ${status.message || ''} ${status.error || ''}`
  if (/context lost/iu.test(details)) return 'The graphics device reset. The simulator will rebuild automatically if the browser restores it.'
  if (/timed out/iu.test(details)) return 'A required local model or lighting asset did not load before the safety timeout.'
  if (/MODEL_(?:LOAD|PARSE|PROFILE|IDENTITY|RIG)/u.test(details)) return `The selected equipment model failed its readiness contract${status.code ? ` (${status.code})` : ''}.`
  if (/WebGL/iu.test(details)) return 'This browser could not create the required WebGL graphics context.'
  return 'A required simulator component failed to initialize.'
}

export default function App() {
  const [familyId, setFamilyId] = useState('reach')
  const [manufacturer, setManufacturer] = useState('Crown')
  const [telemetry, setTelemetry] = useState(initialTelemetry)
  const [events, setEvents] = useState([])
  const [checks, setChecks] = useState(initialChecks)
  const [knowledgeScore, setKnowledgeScore] = useState(null)
  const [showKnowledge, setShowKnowledge] = useState(false)
  const [running, setRunning] = useState(false)
  const [candidateName, setCandidateName] = useState('')
  const [activeNav, setActiveNav] = useState('Overview')
  const [notice, setNotice] = useState(null)
  const [engineStatus, setEngineStatus] = useState(initialEngineStatus)
  const [simulatorRevision, setSimulatorRevision] = useState(0)
  const simulatorRef = useRef(null)
  const eventSequenceRef = useRef(0)
  const transitionSequenceRef = useRef(0)
  const profile = useMemo(() => getEquipment(manufacturer, familyId), [manufacturer, familyId])
  const family = equipmentFamilies.find((item) => item.id === familyId)

  const deductions = events.reduce((sum, event) => sum + event.deduction, 0)
  const practicalPercent = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100)
  const score = Math.max(0, Math.round((knowledgeScore ?? 0) * .3 + practicalPercent * .7 - deductions))
  const evaluatorState = { profile, family, events, checks, deductions }
  const assessmentHasEvidence = running || events.length > 0 || knowledgeScore !== null || Object.values(checks).some(Boolean)

  const handleTelemetry = useCallback((next) => {
    setTelemetry(next)
    setChecks((current) => ({
      ...current,
      controls: current.controls || Math.abs(next.signedSpeed) > .2 || next.fork > 2,
      travel: current.travel || Math.abs(next.signedSpeed) > 1.5,
      load: current.load || next.load > 0,
      horn: current.horn || next.horn,
    }))
  }, [])

  const handleSafetyEvent = useCallback((event) => {
    eventSequenceRef.current += 1
    setEvents((current) => [...current, { ...event, id: `${event.type}-${Date.now()}-${eventSequenceRef.current}`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }])
  }, [])

  const handleLifecycleChange = useCallback((next) => {
    setEngineStatus((current) => ({
      ...current,
      ...next,
      error: next.error ?? null,
      code: next.code ?? null,
    }))
  }, [])

  const resetAssessmentData = () => {
    setTelemetry(initialTelemetry)
    setEvents([])
    setChecks(initialChecks)
    setKnowledgeScore(null)
    setRunning(false)
  }

  const closeKnowledge = useCallback(() => setShowKnowledge(false), [])

  const selectNavigation = (label) => {
    if (label === 'Assessments') {
      setActiveNav(label)
      setShowKnowledge(true)
      return
    }
    if (label === 'Equipment') {
      setActiveNav(label)
      setNotice('Use the equipment and manufacturer selectors across the top to load a truck-specific reference profile.')
      return
    }
    if (label === 'Candidate Records') {
      setNotice('Candidate records are not persisted in this reference build. Export and identity-management controls require an approved records system before deployment.')
      return
    }
    setActiveNav('Overview')
  }

  const selectEquipment = async (nextFamily) => {
    const transition = ++transitionSequenceRef.current
    if (nextFamily === familyId) return
    if (assessmentHasEvidence && !window.confirm('Switch equipment? This permanently clears the current score, checklist, knowledge result, and safety events. The candidate name is preserved.')) return
    try {
      await simulatorRef.current?.exitVR()
    } catch (error) {
      setNotice(`Equipment was not changed because the active VR session could not close: ${error.message}`)
      return
    }
    if (transition !== transitionSequenceRef.current) return
    setFamilyId(nextFamily)
    resetAssessmentData()
    setEngineStatus((current) => ({ ...current, phase: 'loading', message: 'Loading simulator', error: null, code: null }))
  }

  const selectManufacturer = async (nextManufacturer) => {
    const transition = ++transitionSequenceRef.current
    if (nextManufacturer === manufacturer) return
    if (assessmentHasEvidence && !window.confirm('Switch manufacturer? This permanently clears the current score, checklist, knowledge result, and safety events. The candidate name is preserved.')) return
    try {
      await simulatorRef.current?.exitVR()
    } catch (error) {
      setNotice(`Manufacturer was not changed because the active VR session could not close: ${error.message}`)
      return
    }
    if (transition !== transitionSequenceRef.current) return
    setManufacturer(nextManufacturer)
    resetAssessmentData()
    setEngineStatus((current) => ({ ...current, phase: 'loading', message: 'Loading simulator', error: null, code: null }))
  }

  const enterVR = async () => {
    setNotice(null)
    try {
      const entered = await simulatorRef.current?.enterVR()
      if (!entered) setNotice('Immersive VR is unavailable in this browser. Open the deployed HTTPS site in Meta Quest Browser, or continue in desktop mode.')
    } catch (error) {
      if (error.name === 'AbortError') return
      setNotice(`VR session could not start: ${error.message}. Continue in desktop mode or verify headset permissions.`)
    }
  }

  const exitVR = async () => {
    try {
      await simulatorRef.current?.exitVR()
    } catch (error) {
      setNotice(`VR session could not close cleanly: ${error.message}`)
    }
  }

  const resetAssessment = async () => {
    const candidate = candidateName.trim() || 'the unnamed candidate'
    if (!window.confirm(`Restart the current assessment for ${candidate}? This permanently clears the current score, checklist, knowledge result, and safety events. The candidate name is preserved.`)) return
    const transition = ++transitionSequenceRef.current
    try {
      await simulatorRef.current?.exitVR()
    } catch (error) {
      setNotice(`Assessment was not restarted because the active VR session could not close: ${error.message}`)
      return
    }
    if (transition !== transitionSequenceRef.current) return
    simulatorRef.current?.reset()
    resetAssessmentData()
  }

  const retrySimulator = async () => {
    const transition = ++transitionSequenceRef.current
    try {
      await simulatorRef.current?.exitVR()
    } catch (error) {
      setNotice(`Simulator was not retried because the active VR session could not close: ${error.message}`)
      return
    }
    if (transition !== transitionSequenceRef.current) return
    setRunning(false)
    setEngineStatus((current) => ({ ...current, phase: 'loading', message: 'Retrying simulator', error: null, code: null }))
    setSimulatorRevision((current) => current + 1)
  }

  const engineReady = engineStatus.phase === 'ready'
  const xrRunning = engineStatus.phase === 'xr-running'
  const engineBusy = ['loading', 'xr-requesting', 'xr-ending'].includes(engineStatus.phase)
  const failureMessage = readinessFailure(engineStatus)
  const sceneReadiness = engineStatus.phase === 'failed'
    ? 'Scene failed'
    : engineStatus.phase === 'loading'
      ? 'Scene loading'
      : 'Reference scene ready'
  const inputReadiness = engineStatus.phase === 'failed'
    ? 'Controls unavailable'
    : engineStatus.phase === 'loading'
      ? 'Controls loading'
      : 'Reference controls mapped'
  const modeReadiness = xrRunning
    ? 'XR running'
    : engineStatus.phase === 'xr-requesting'
      ? 'XR requesting'
      : engineStatus.phase === 'xr-ending'
        ? 'XR ending'
        : engineStatus.xrSupported
          ? 'Desktop and XR available'
          : 'Desktop available'

  const navItems = [
    ['Overview', LayoutDashboard], ['Equipment', Warehouse], ['Assessments', ClipboardCheck], ['Candidate Records', Users],
  ]

  return (
    <main className="app-shell">
      <nav className="sidebar" aria-label="Main navigation">
        <div className="wordmark">Pro<span>LTO</span></div>
        <div className="nav-list">
          {navItems.map(([label, Icon]) => <button key={label} className={activeNav === label ? 'active' : ''} aria-current={activeNav === label ? 'page' : undefined} onClick={() => selectNavigation(label)}><Icon size={20} /><span>{label}</span></button>)}
        </div>
        <div className="sidebar-foot"><button onClick={() => setNotice('Settings are fixed for this reference build. Site-specific controls require an approved configuration and validation pass before deployment.')}><Settings size={19}/><span>Settings</span></button><div><ShieldCheck size={18}/><span>Evaluator mode</span></div></div>
      </nav>

      <section className="workspace">
        <header className="equipment-header">
          <div className="family-picker">
            {equipmentFamilies.map((item) => <button key={item.id} className={familyId === item.id ? 'selected' : ''} aria-pressed={familyId === item.id} onClick={() => selectEquipment(item.id)}><Cuboid size={19}/><span>{item.label}</span><small>{item.classLabel}</small></button>)}
          </div>
          <label className="manufacturer-select"><span>Manufacturer</span><select value={manufacturer} onChange={(event) => selectManufacturer(event.target.value)}><option>Crown</option><option>Raymond</option></select></label>
        </header>

        <div className="main-grid">
          <div className="simulator-column">
            <Simulator key={`${profile.assetId}-${simulatorRevision}`} ref={simulatorRef} profile={profile} running={running} onRunningChange={setRunning} onTelemetry={handleTelemetry} onSafetyEvent={handleSafetyEvent} onLifecycleChange={handleLifecycleChange} />
            <div className="telemetry-bar" data-heading={telemetry.heading ?? 0} data-steer-angle={telemetry.steerAngle ?? 0} data-fork-height={telemetry.fork ?? 0}>
              <div><Gauge /><span>Speed<strong>{telemetry.speed.toFixed(1)} <i>mph</i></strong></span></div>
              <div><FileCheck2 /><span>Fork height<strong>{Math.round(telemetry.fork)} <i>in</i></strong></span></div>
              <div><Cuboid /><span>Load<strong>{Math.round(telemetry.load).toLocaleString()} <i>lb</i></strong></span></div>
              <div><ShieldCheck /><span>Stability<strong>{Math.round(telemetry.stability)} <i>%</i></strong></span></div>
            </div>
            <div className="launch-bar">
              <div aria-live="polite"><span>Readiness check</span><b className={engineStatus.phase === 'failed' ? 'failed' : engineStatus.phase === 'loading' ? 'pending' : 'ready'}><i /> {sceneReadiness}</b><b className={engineStatus.phase === 'failed' ? 'failed' : engineStatus.phase === 'loading' ? 'pending' : 'ready'}><i /> {inputReadiness}</b><b className={engineBusy ? 'pending' : engineStatus.phase === 'failed' ? 'failed' : 'ready'}><i /> {modeReadiness}</b>{failureMessage && <p className="readiness-error" role="alert">{failureMessage}</p>}</div>
              <div>
                {engineStatus.phase === 'failed' && <button className="desktop-button" onClick={retrySimulator}><RotateCcw size={19}/> Retry simulator</button>}
                {xrRunning
                  ? <><button className="vr-button" onClick={exitVR}><Gamepad2 size={20}/> Exit VR</button><button className="desktop-button" onClick={() => simulatorRef.current?.recenterVR()}><RotateCcw size={19}/> Recenter VR</button></>
                  : <button className="vr-button" onClick={enterVR} disabled={!engineReady || engineBusy || !engineStatus.xrSupported} title={engineStatus.xrSupported ? 'Enter immersive VR' : 'Immersive WebXR is unavailable in this browser'}><Gamepad2 size={20}/> {engineStatus.phase === 'xr-requesting' ? 'Requesting VR' : engineStatus.xrSupported ? 'Enter VR' : 'VR unavailable'}</button>}
                <button className="desktop-button" onClick={() => simulatorRef.current?.startDesktop()} disabled={!engineReady || xrRunning || engineBusy}><Monitor size={19}/> {running ? 'Focus Desktop' : 'Desktop Mode'}</button>
                <button className="reset-button" onClick={resetAssessment} disabled={engineStatus.phase === 'loading'} aria-label="Restart current candidate assessment and exit VR" title="Restart current candidate assessment"><RotateCcw size={19}/></button>
              </div>
            </div>
          </div>
          <EvaluatorPanel state={evaluatorState} score={score} knowledgeScore={knowledgeScore} onToggleCheck={(id) => setChecks((current) => ({ ...current, [id]: !current[id] }))} candidateName={candidateName} onCandidateChange={setCandidateName}/>
        </div>
      </section>

      <button className="knowledge-fab" onClick={() => setShowKnowledge(true)}><HelpCircle size={19}/><span>Knowledge test</span>{knowledgeScore !== null && <b>{knowledgeScore}%</b>}</button>
      {showKnowledge && <KnowledgeAssessment onClose={closeKnowledge} onComplete={setKnowledgeScore} previousScore={knowledgeScore}/>}
      {notice && <div className="notice" role="status"><div><strong>ProLTO</strong><p>{notice}</p></div><button onClick={() => setNotice(null)}>Dismiss</button></div>}
    </main>
  )
}
