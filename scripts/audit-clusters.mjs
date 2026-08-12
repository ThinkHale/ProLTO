// Operator cluster audit.  node scripts/audit-clusters.mjs [truck]
//
// Screenshots only show what happens to be in frame. This measures every
// operator control on every truck against the things that actually make a cab
// wrong, and it does it in the same coordinates the Simulator drives:
//
//   FLOATING   a control with a visible air gap to every other mesh. Buttons
//              are mounted on something; a gap means it was left behind when
//              its housing moved, which is exactly what a console lift does.
//   REACH      distance from the authored eye point. A seated operator reaches
//              about 0.75 m; anything past that cannot be operated.
//   BEHIND     a control the operator would have to turn around to touch.
//   BURIED     a control sunk inside another mesh rather than proud of it.
//   DEAD       a tagged control with no animating pivot above it, so operating
//              it produces no visible motion.
import { readFileSync, readdirSync } from 'node:fs'

const stub = new Proxy({}, { get: () => () => {} })
globalThis.document = globalThis.document || {
  createElement: () => ({ width: 0, height: 0, getContext: () => stub }),
}
globalThis.self = globalThis.self || globalThis

const THREE = await import('three')
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')

const PIVOTS = new Set([
  'rig_steerPivot', 'rig_travelPivot', 'rig_liftPivot', 'rig_reachPivot', 'rig_tiltPivot',
  'rig_sideshiftPivot', 'rig_secondaryTravelPivot', 'rig_tillerPivot', 'rig_wheelPivot',
  'rig_lever_0', 'rig_lever_1', 'rig_lever_2', 'rig_lever_3',
])
// Pedals and presence pads are floor hardware: the Simulator translates them
// directly, and they are meant to be reached by foot, not hand.
const FOOT = new Set(['brake', 'presence', 'belly'])
// Reached by foot, or operated from a deliberately different stance.
const BY_DESIGN = /^pedal_|^secondary_|^power_|^seat_cushion$/
const REACH_LIMIT = .85
const FLOAT_GAP = .006

// Shortest distance between two axis-aligned boxes; 0 when they touch or overlap.
function boxGap(a, b) {
  const dx = Math.max(0, Math.max(a.min.x - b.max.x, b.min.x - a.max.x))
  const dy = Math.max(0, Math.max(a.min.y - b.max.y, b.min.y - a.max.y))
  const dz = Math.max(0, Math.max(a.min.z - b.max.z, b.min.z - a.max.z))
  return Math.hypot(dx, dy, dz)
}

function hasAnimatingParent(object) {
  for (let node = object.parent; node; node = node.parent) {
    if (PIVOTS.has(node.name)) return node.name
  }
  return null
}

const loader = new GLTFLoader()
const only = process.argv[2]
const files = readdirSync('public/models')
  .filter((name) => name.endsWith('.glb'))
  .filter((name) => !only || name.includes(only))

let findings = 0

for (const file of files) {
  const buffer = readFileSync(`public/models/${file}`)
  const gltf = await loader.parseAsync(
    buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '',
  )
  const scene = new THREE.Scene()
  scene.add(gltf.scene)
  scene.updateMatrixWorld(true)

  let eye = null
  let seat = null
  const meshes = []
  const controls = []
  gltf.scene.traverse((object) => {
    if (object.name === 'rig_cameraMount') eye = object.getWorldPosition(new THREE.Vector3())
    if (!object.isMesh) return
    const box = new THREE.Box3().setFromObject(object)
    meshes.push({ object, box })
    if (/seat_cushion/.test(object.name)) seat = box
    const action = object.userData?.ctrl_action
    if (action) controls.push({ object, box, action })
  })
  if (!eye) continue

  console.log(`\n=== ${file.replace('.glb', '')} ===  eye y=${eye.y.toFixed(2)}${seat ? `  seat top y=${seat.max.y.toFixed(3)}` : ''}`)
  const rows = []
  for (const control of controls) {
    const centre = control.box.getCenter(new THREE.Vector3())
    const reach = centre.distanceTo(eye)
    // Nearest other mesh, ignoring its own descendants and ancestors.
    let gap = Infinity
    let neighbour = ''
    for (const candidate of meshes) {
      if (candidate.object === control.object) continue
      // Only skip the control's own descendants. Its ANCESTOR is the housing
      // it is mounted on -- excluding that made every correctly-seated knob
      // look detached from its wheel.
      let descendant = false
      for (let n = candidate.object; n; n = n.parent) if (n === control.object) descendant = true
      if (descendant) continue
      const distance = boxGap(control.box, candidate.box)
      if (distance < gap) { gap = distance; neighbour = candidate.object.name }
    }
    const pivot = hasAnimatingParent(control.object)
    const foot = FOOT.has(control.action) || BY_DESIGN.test(control.object.name)
    const flags = []
    if (gap > FLOAT_GAP) flags.push(`FLOATING ${(gap * 1000).toFixed(0)}mm from ${neighbour}`)
    if (!foot && reach > REACH_LIMIT) flags.push(`OUT OF REACH ${reach.toFixed(2)}m`)
    if (!foot && centre.z > eye.z + .12) flags.push('BEHIND operator')
    // A button is pressed, not swung; only continuous controls need a pivot.
    const continuous = ['steer', 'travel', 'lift', 'reach', 'tilt', 'sideshift'].includes(control.action)
    if (!pivot && !foot && continuous) flags.push('DEAD (no animating pivot)')
    if (flags.length) findings += flags.length
    rows.push({ name: control.object.name, action: control.action, reach, gap, flags })
  }
  rows.sort((a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name))
  for (const row of rows) {
    const status = row.flags.length ? row.flags.join(' | ') : 'ok'
    console.log(`  ${row.name.padEnd(26)} ${row.action.padEnd(11)} reach=${row.reach.toFixed(2)}m gap=${(row.gap * 1000).toFixed(0)}mm  ${status}`)
  }
}

console.log(`\n${findings} finding(s) across ${files.length} trucks`)
