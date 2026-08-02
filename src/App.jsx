import { useCallback, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, Cuboid, FileCheck2, Gauge, Gamepad2, HelpCircle, LayoutDashboard, Monitor, Play, RotateCcw, Settings, ShieldCheck, Users, Warehouse } from 'lucide-react'
import { equipmentFamilies, getEquipment } from './data/equipment.js'
import Simulator from './components/Simulator.jsx'
import KnowledgeAssessment from './components/KnowledgeAssessment.jsx'
import EvaluatorPanel from './components/EvaluatorPanel.jsx'

const initialTelemetry = { speed: 0, signedSpeed: 0, fork: 0, reach: 0, tilt: 0, load: 0, stability: 100, xr: false }
const initialChecks = { inspection: false, controls: false, horn: false, travel: false, load: false, stack: false, pedestrian: false, shutdown: false }

export default function App() {
  const [familyId, setFamilyId] = useState('reach')
  const [manufacturer, setManufacturer] = useState('Crown')
  const [telemetry, setTelemetry] = useState(initialTelemetry)
  const [events, setEvents] = useState([])
  const [checks, setChecks] = useState(initialChecks)
  const [knowledgeScore, setKnowledgeScore] = useState(null)
  const [showKnowledge, setShowKnowledge] = useState(false)
  const [running, setRunning] = useState(false)
  const [candidateName, setCandidateName] = useState('Jordan Lee')
  const [activeNav, setActiveNav] = useState('Overview')
  const [notice, setNotice] = useState(null)
  const simulatorRef = useRef(null)
  const profile = useMemo(() => getEquipment(manufacturer, familyId), [manufacturer, familyId])
  const family = equipmentFamilies.find((item) => item.id === familyId)

  const deductions = events.reduce((sum, event) => sum + event.deduction, 0)
  const practicalPercent = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100)
  const score = Math.max(0, Math.round((knowledgeScore ?? 0) * .3 + practicalPercent * .7 - deductions))
  const evaluatorState = { profile, family, events, checks, deductions }

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
    setEvents((current) => [...current, { ...event, id: `${event.type}-${Date.now()}`, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }])
  }, [])

  const selectEquipment = (nextFamily) => {
    setFamilyId(nextFamily); setTelemetry(initialTelemetry); setEvents([]); setChecks(initialChecks); setRunning(false)
  }

  const enterVR = async () => {
    try {
      const entered = await simulatorRef.current?.enterVR()
      if (!entered) setNotice('Immersive VR is unavailable in this browser. Open the deployed HTTPS site in Meta Quest Browser, or continue in desktop mode.')
    } catch (error) {
      setNotice(`VR session could not start: ${error.message}. Continue in desktop mode or verify headset permissions.`)
    }
  }

  const navItems = [
    ['Overview', LayoutDashboard], ['Equipment', Warehouse], ['Assessments', ClipboardCheck], ['Candidate Records', Users],
  ]

  return (
    <main className="app-shell">
      <nav className="sidebar" aria-label="Main navigation">
        <div className="wordmark">Pro<span>LTO</span></div>
        <div className="nav-list">
          {navItems.map(([label, Icon]) => <button key={label} className={activeNav === label ? 'active' : ''} onClick={() => { setActiveNav(label); if (label === 'Assessments') setShowKnowledge(true); if (label === 'Equipment') setNotice('Use the equipment and manufacturer selectors across the top to load a truck-specific profile.') }}><Icon size={20} /><span>{label}</span></button>)}
        </div>
        <div className="sidebar-foot"><button><Settings size={19}/><span>Settings</span></button><div><ShieldCheck size={18}/><span>Evaluator mode</span></div></div>
      </nav>

      <section className="workspace">
        <header className="equipment-header">
          <div className="family-picker">
            {equipmentFamilies.map((item) => <button key={item.id} className={familyId === item.id ? 'selected' : ''} onClick={() => selectEquipment(item.id)}><Cuboid size={19}/><span>{item.label}</span><small>{item.classLabel}</small></button>)}
          </div>
          <label className="manufacturer-select"><span>Manufacturer</span><select value={manufacturer} onChange={(e) => { setManufacturer(e.target.value); selectEquipment(familyId) }}><option>Crown</option><option>Raymond</option></select></label>
        </header>

        <div className="main-grid">
          <div className="simulator-column">
            <Simulator ref={simulatorRef} profile={profile} running={running} onRunningChange={setRunning} onTelemetry={handleTelemetry} onSafetyEvent={handleSafetyEvent} />
            <div className="telemetry-bar">
              <div><Gauge /><span>Speed<strong>{telemetry.speed.toFixed(1)} <i>mph</i></strong></span></div>
              <div><FileCheck2 /><span>Fork height<strong>{Math.round(telemetry.fork)} <i>in</i></strong></span></div>
              <div><Cuboid /><span>Load<strong>{Math.round(telemetry.load).toLocaleString()} <i>lb</i></strong></span></div>
              <div><ShieldCheck /><span>Stability<strong>{Math.round(telemetry.stability)} <i>%</i></strong></span></div>
            </div>
            <div className="launch-bar">
              <div><span>Readiness check</span><b><i /> Scene loaded</b><b><i /> Controls mapped</b><b><i /> Evaluator connected</b></div>
              <div><button className="vr-button" onClick={enterVR}><Gamepad2 size={20}/> Enter VR</button><button className="desktop-button" onClick={() => setRunning(true)}><Monitor size={19}/> Desktop Mode</button><button className="reset-button" onClick={() => { simulatorRef.current?.reset(); setEvents([]); setChecks(initialChecks); setRunning(false) }} aria-label="Reset assessment"><RotateCcw size={19}/></button></div>
            </div>
          </div>
          <EvaluatorPanel state={evaluatorState} score={score} knowledgeScore={knowledgeScore} onToggleCheck={(id) => setChecks((current) => ({ ...current, [id]: !current[id] }))} candidateName={candidateName} onCandidateChange={setCandidateName}/>
        </div>
      </section>

      <button className="knowledge-fab" onClick={() => setShowKnowledge(true)}><HelpCircle size={19}/><span>Knowledge test</span>{knowledgeScore !== null && <b>{knowledgeScore}%</b>}</button>
      {showKnowledge && <KnowledgeAssessment onClose={() => setShowKnowledge(false)} onComplete={setKnowledgeScore} previousScore={knowledgeScore}/>} 
      {notice && <div className="notice" role="status"><div><strong>ProLTO</strong><p>{notice}</p></div><button onClick={() => setNotice(null)}>Dismiss</button></div>}
    </main>
  )
}
