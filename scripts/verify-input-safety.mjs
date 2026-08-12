import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyModifierTransition, desktopPresenceHeld, isBellyControlActive, isNativeInteractiveTarget, removePointerDrag } from '../src/sim/inputSafety.js'

assert.equal(isBellyControlActive(1), true, 'positive emergency reverse travel must activate')
assert.equal(isBellyControlActive(-1), true, 'Raymond 8210 negative-scale emergency reverse must activate')
assert.equal(isBellyControlActive(.2), false, 'the neutral threshold must not activate')
assert.equal(isBellyControlActive(Number.NaN), false, 'invalid input must fail safe to inactive')

assert.equal(isNativeInteractiveTarget({ tagName: 'BUTTON' }), true, 'button keyboard semantics must remain native')
assert.equal(isNativeInteractiveTarget({ tagName: 'INPUT' }), true, 'editable keyboard semantics must remain native')
assert.equal(isNativeInteractiveTarget({ tagName: 'DIV', isContentEditable: false }), false, 'plain simulator surfaces may accept controls')

const pointerDrags = new Map([
  [11, { presenceOnly: true }],
  [12, { object: { name: 'travel' } }],
])
assert.equal(desktopPresenceHeld(new Set(), pointerDrags), true, 'one touch may hold modeled presence while another operates a control')
assert.equal(removePointerDrag(pointerDrags, 12)?.object?.name, 'travel', 'only the released pointer interaction may be removed')
assert.equal(desktopPresenceHeld(new Set(), pointerDrags), true, 'releasing a second touch must not release the first presence touch')
assert.equal(removePointerDrag(pointerDrags, 11)?.presenceOnly, true, 'the presence pointer must remain independently releasable')
assert.equal(desktopPresenceHeld(new Set(), pointerDrags), false, 'releasing the presence touch must release presence')
assert.equal(desktopPresenceHeld(new Set(['ShiftLeft']), pointerDrags), true, 'the keyboard training presence hold remains independent')

const dualAxisControl = { object: { userData: { control: { action2: 'reach', shift2: 'sideshift' } } } }
const manual = { reach: .8, sideshift: 0 }
assert.equal(applyModifierTransition(manual, [dualAxisControl], true), true)
assert.equal(manual.reach, 0, 'pressing the modifier must clear reach even when the held thumb control does not move')
manual.sideshift = -.7
assert.equal(applyModifierTransition(manual, [dualAxisControl], false), false)
assert.equal(manual.sideshift, 0, 'releasing the modifier must clear sideshift even when the held thumb control does not move')

const simulatorSource = readFileSync(new URL('../src/components/Simulator.jsx', import.meta.url), 'utf8')
assert.doesNotMatch(simulatorSource, /XRControllerModelFactory/u, 'runtime controller models must not use the CDN-backed factory')
assert.doesNotMatch(simulatorSource, /XRHandModelFactory/u, 'runtime hand models must not bundle the CDN-backed mesh default')
assert.doesNotMatch(simulatorSource, /createHandModel\([^\n]+['"]mesh['"]\)/u, 'runtime hand models must not use the CDN-backed mesh path')
assert.doesNotMatch(simulatorSource, /https?:\/\//u, 'Simulator runtime source must not contain external request URLs')
assert.match(simulatorSource, /timer\.connect\(document\)/u, 'the fixed-step timer must reject hidden-tab elapsed time')
assert.match(simulatorSource, /document\.hidden[\s\S]{0,120}simulationAccumulator = 0/u, 'hiding the document must discard pending simulation backlog')
assert.match(
  simulatorSource,
  /Math\.abs\(choose\('sideshift'\)\)/u,
  'a sideshift command without presence must enter the same violation detector as every other hydraulic command',
)

console.log('Input safety helpers, multi-pointer presence, emergency reverse polarity, and self-hosted XR source checks passed')
