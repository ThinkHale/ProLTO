// Verify every exported truck satisfies the rig contract in assets-src/lib/rig.py.
// A missing node silently disables the motion it drives, so this runs as a gate.
//   node scripts/verify-models.mjs
import { readFileSync, existsSync } from 'node:fs'

const REQUIRED = {
  crown_rr5725: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_reachGroup', 'rig_steerPivot', 'rig_travelPivot', 'rig_liftPivot', 'rig_tiltPivot', 'rig_reachPivot', 'rig_driveWheel', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'reach', 'tilt', 'sideshift', 'horn', 'brake', 'presence'] },
  raymond_7500: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_reachGroup', 'rig_steerPivot', 'rig_travelPivot', 'rig_liftPivot', 'rig_tiltPivot', 'rig_reachPivot', 'rig_sideshiftPivot', 'rig_secondaryTravelPivot', 'rig_driveWheel', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'reach', 'tilt', 'sideshift', 'horn', 'presence'] },
  crown_sp1500: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_platform', 'rig_steerPivot', 'rig_travelPivot', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'horn', 'presence'] },
  raymond_5300: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_platform', 'rig_steerPivot', 'rig_travelPivot', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'horn', 'presence'] },
  crown_pe4500: { nodes: ['rig_root', 'rig_carriage', 'rig_tillerPivot', 'rig_headGroup', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'horn', 'belly', 'presence'] },
  raymond_8210: { nodes: ['rig_root', 'rig_carriage', 'rig_tillerPivot', 'rig_headGroup', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'horn', 'belly'] },
  crown_sc6200: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_wheelPivot', 'rig_lever_0', 'rig_lever_1', 'rig_lever_2', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'brake', 'lift', 'tilt', 'sideshift', 'horn', 'presence'] },
  raymond_4460: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_wheelPivot', 'rig_lever_0', 'rig_lever_1', 'rig_lever_2', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'brake', 'lift', 'tilt', 'sideshift', 'horn', 'presence'] },
}
const CONTROL_MOTIONS = new Set(['radial', 'horizontal', 'vertical', 'fore-aft', 'button', 'pedal'])

function readGlb(path) {
  const buffer = readFileSync(path)
  if (buffer.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a GLB')
  return JSON.parse(buffer.slice(20, 20 + buffer.readUInt32LE(12)).toString('utf8'))
}

let failed = 0
for (const [truck, contract] of Object.entries(REQUIRED)) {
  const path = `public/models/${truck}.glb`
  if (!existsSync(path)) { console.log(`FAIL ${truck}: missing ${path}`); failed += 1; continue }
  const gltf = readGlb(path)
  const nodes = gltf.nodes || []
  const names = new Set(nodes.map((node) => node.name))
  const controls = nodes.filter((node) => node.extras?.ctrl_action)
  // A function is reachable if any control commands it on EITHER of its axes.
  // The Crown Multi-Task handle lifts on the second axis of the travel handle,
  // and reaches on the second axis of the thumb ball, so an action-name scan
  // that only reads ctrl_action would wrongly report them as missing.
  const actions = new Set()
  controls.forEach((node) => {
    actions.add(node.extras.ctrl_action)
    if (node.extras.ctrl_action2) actions.add(node.extras.ctrl_action2)
    if (node.extras.ctrl_shift2) actions.add(node.extras.ctrl_shift2)
  })

  const missingNodes = contract.nodes.filter((name) => !names.has(name))
  const missingControls = contract.controls.filter((action) => !actions.has(action))
  const meshes = (gltf.meshes || []).length
  const tris = (gltf.accessors || [])
    .filter((accessor, index) => (gltf.meshes || []).some((mesh) => mesh.primitives.some((primitive) => primitive.indices === index)))
    .reduce((sum, accessor) => sum + accessor.count / 3, 0)

  const problems = []
  if (missingNodes.length) problems.push(`missing nodes: ${missingNodes.join(', ')}`)
  if (missingControls.length) problems.push(`missing controls: ${missingControls.join(', ')}`)
  if (names.has('qa_floor')) problems.push('QA floor leaked into export')
  controls.forEach((node) => {
    const extras = node.extras
    const motion = extras.ctrl_motion || extras.ctrl_axis
    if (!CONTROL_MOTIONS.has(motion)) problems.push(`${node.name} has invalid motion ${motion || 'undefined'}`)
    if (!Number.isFinite(extras.ctrl_scale) || extras.ctrl_scale === 0) problems.push(`${node.name} has invalid ctrl_scale`)
    if (/lower|reverse/i.test(extras.ctrl_label || '') && extras.ctrl_axis === 'button' && extras.ctrl_scale > 0) {
      problems.push(`${node.name} negative button has positive ctrl_scale`)
    }
    // A second axis is only meaningful if it is genuinely orthogonal to the
    // first and declares its own motion, otherwise one drag drives both.
    if (extras.ctrl_action2) {
      const motion2 = extras.ctrl_motion2
      if (!CONTROL_MOTIONS.has(motion2)) problems.push(`${node.name} has invalid motion2 ${motion2 || 'undefined'}`)
      else if (motion2 === motion) problems.push(`${node.name} secondary axis duplicates the primary axis`)
    }
    if (extras.ctrl_shift2 && !extras.ctrl_action2) {
      problems.push(`${node.name} declares ctrl_shift2 with no ctrl_action2 to re-map`)
    }
  })
  const modifiers = nodes.filter((node) => node.extras?.ctrl_modifier)
  // A shifted axis is unreachable unless the truck carries a modifier switch.
  if (controls.some((node) => node.extras.ctrl_shift2) && !modifiers.length) {
    problems.push('a control declares ctrl_shift2 but the truck has no modifier switch')
  }
  const camera = nodes.find((node) => node.name === 'rig_cameraMount')
  const eye = camera?.translation?.[1]

  if (problems.length) { failed += 1; console.log(`FAIL ${truck}: ${problems.join(' | ')}`) }
  else console.log(`PASS ${truck}  meshes=${meshes} tris=${Math.round(tris / 1000)}k controls=${controls.length} eye=${eye === undefined ? 'n/a' : eye.toFixed(2)}m`)
}

console.log(failed ? `\n${failed} model(s) failed the rig contract` : '\nAll models satisfy the rig contract')
process.exit(failed ? 1 : 0)
