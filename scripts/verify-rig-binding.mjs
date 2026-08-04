// Integration check: run the simulator's OWN binding code against the exported
// GLBs and assert every control the assessment scores is actually reachable.
//   node scripts/verify-rig-binding.mjs
//
// verify-models.mjs reads the glTF JSON. This goes a step further and exercises
// src/sim/vehicleFactory.js itself, so a change to mapRig or the control
// metadata reader that silently stops binding a node is caught here rather than
// discovered by a trainee whose thumb ball does nothing.
import { readFileSync } from 'node:fs'

// vehicleFactory builds a canvas telemetry texture on any mesh named *screen*.
// Stub just enough DOM for that to run headless.
const stubContext = new Proxy({}, { get: () => () => {} })
globalThis.document = globalThis.document || {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubContext }),
}
globalThis.self = globalThis.self || globalThis

const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
const { controlMeshes, __mapRigForTest } = await import('../src/sim/vehicleFactory.js')

// What each profile's operator must physically be able to command, and the
// pivots the animation loop writes to. Both reach trucks are asserted in the
// detail the practical assessment depends on.
const EXPECT = {
  crown_rr5725: {
    profile: { manufacturer: 'Crown', family: 'reach', stance: 'Variable side stance', model: 'RR 5725-45' },
    actions: ['steer', 'travel', 'lift', 'reach', 'tilt', 'sideshift', 'horn', 'brake', 'presence', 'belly'],
    pivots: ['steerPivot', 'travelPivot', 'liftPivot', 'reachPivot', 'tiltPivot', 'carriage', 'reachGroup', 'driveWheel'],
    modifiers: 1,
    // The Multi-Task handle and its thumb ball are each ONE part on two axes.
    dualAxis: {
      mt_grip: { action: 'travel', motion: 'fore-aft', action2: 'lift', motion2: 'vertical' },
      mt_thumb_ball: { action: 'tilt', motion: 'vertical', action2: 'reach', motion2: 'fore-aft', shift2: 'sideshift' },
    },
    inverted: ['brake'],
    // rig_liftPivot must ride INSIDE rig_travelPivot, and rig_reachPivot inside
    // rig_tiltPivot, or the handle and ball come apart when both axes move.
    nesting: [['rig_liftPivot', 'rig_travelPivot'], ['rig_reachPivot', 'rig_tiltPivot'], ['rig_tiltPivot', 'rig_liftPivot']],
  },
  raymond_7500: {
    profile: { manufacturer: 'Raymond', family: 'reach', stance: 'Universal stance', model: '7500' },
    actions: ['steer', 'travel', 'lift', 'reach', 'tilt', 'sideshift', 'horn', 'presence'],
    pivots: ['steerPivot', 'travelPivot', 'liftPivot', 'reachPivot', 'tiltPivot', 'sideshiftPivot', 'secondaryTravelPivot', 'carriage', 'reachGroup', 'driveWheel'],
    modifiers: 0,
    // Raymond is deliberately single-axis: no control may declare a second axis.
    dualAxis: {},
    inverted: [],
    nesting: [],
  },
}

const loader = new GLTFLoader()

function parse(path) {
  const buffer = readFileSync(path)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  return new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject))
}

let failed = 0
for (const [truck, expect] of Object.entries(EXPECT)) {
  const problems = []
  let gltf
  try {
    gltf = await parse(`public/models/${truck}.glb`)
  } catch (error) {
    console.log(`FAIL ${truck}: GLTFLoader could not parse the export: ${error.message}`)
    failed += 1
    continue
  }

  // The mapping under test is the production function, not a copy of it.
  const rig = __mapRigForTest(gltf.scene, expect.profile)
  const controls = controlMeshes(rig)

  if (rig) {
    expect.pivots.forEach((pivot) => { if (!rig[pivot]) problems.push(`rig.${pivot} did not bind`) })

    const commandable = new Set()
    let modifiers = 0
    controls.forEach((mesh) => {
      const control = mesh.userData.control
      if (!control) { modifiers += mesh.userData.modifier ? 1 : 0; return }
      commandable.add(control.action)
      if (control.action2) commandable.add(control.action2)
      if (control.shift2) commandable.add(control.shift2)
    })
    expect.actions.forEach((action) => {
      if (!commandable.has(action)) problems.push(`no control commands '${action}'`)
    })
    if (modifiers !== expect.modifiers) {
      problems.push(`expected ${expect.modifiers} modifier switch(es), found ${modifiers}`)
    }

    const byName = new Map(controls.map((mesh) => [mesh.name, mesh.userData.control]))
    Object.entries(expect.dualAxis).forEach(([name, want]) => {
      const got = byName.get(name)
      if (!got) { problems.push(`${name} is not an interactive control`); return }
      Object.entries(want).forEach(([key, value]) => {
        if (got[key] !== value) problems.push(`${name}.${key} is ${got[key]}, expected ${value}`)
      })
    })
    if (!Object.keys(expect.dualAxis).length) {
      controls.forEach((mesh) => {
        if (mesh.userData.control?.action2) {
          problems.push(`${mesh.name} declares a second axis on a single-axis truck`)
        }
      })
    }

    expect.inverted.forEach((action) => {
      const mesh = controls.find((candidate) => candidate.userData.control?.action === action)
      if (!mesh?.userData.control?.inverted) problems.push(`'${action}' should be reverse-acting`)
    })

    const index = new Map()
    rig.root.traverse((object) => index.set(object.name, object))
    expect.nesting.forEach(([child, ancestor]) => {
      let node = index.get(child)
      if (!node) { problems.push(`${child} missing`); return }
      for (node = node.parent; node; node = node.parent) if (node.name === ancestor) return
      problems.push(`${child} is not nested inside ${ancestor}`)
    })
  }

  if (problems.length) { failed += 1; console.log(`FAIL ${truck}: ${problems.join(' | ')}`) }
  else console.log(`PASS ${truck}  bound ${controls.length} controls, ${expect.pivots.length} pivots`)
}

console.log(failed ? `\n${failed} model(s) failed rig binding` : '\nSimulator binds every control on every model')
process.exit(failed ? 1 : 0)
