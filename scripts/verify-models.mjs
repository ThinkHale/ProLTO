// Verify every exported truck satisfies the rig contract in assets-src/lib/rig.py.
// A missing node silently disables the motion it drives, so this runs as a gate.
//   node scripts/verify-models.mjs
import { readFileSync, existsSync } from 'node:fs'

const REQUIRED = {
  crown_rr5725: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_reachGroup', 'rig_steerPivot', 'rig_travelPivot', 'rig_driveWheel', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'reach', 'horn', 'brake', 'presence'] },
  raymond_7500: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_reachGroup', 'rig_steerPivot', 'rig_travelPivot', 'rig_driveWheel', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'reach', 'horn', 'presence'] },
  crown_sp1500: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_platform', 'rig_steerPivot', 'rig_travelPivot', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'horn', 'presence'] },
  raymond_5300: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_platform', 'rig_steerPivot', 'rig_travelPivot', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'horn', 'presence'] },
  crown_pe4500: { nodes: ['rig_root', 'rig_carriage', 'rig_tillerPivot', 'rig_headGroup', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'horn', 'belly', 'presence'] },
  raymond_8210: { nodes: ['rig_root', 'rig_carriage', 'rig_tillerPivot', 'rig_headGroup', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'lift', 'horn', 'belly'] },
  crown_sc6200: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_wheelPivot', 'rig_lever_0', 'rig_lever_1', 'rig_lever_2', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'brake', 'lift', 'tilt', 'sideshift', 'horn', 'presence'] },
  raymond_4460: { nodes: ['rig_root', 'rig_mast', 'rig_carriage', 'rig_wheelPivot', 'rig_lever_0', 'rig_lever_1', 'rig_lever_2', 'rig_cameraMount', 'rig_xrOrigin'], controls: ['steer', 'travel', 'brake', 'lift', 'tilt', 'sideshift', 'horn', 'presence'] },
}

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
  const actions = new Set(controls.map((node) => node.extras.ctrl_action))

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
  const camera = nodes.find((node) => node.name === 'rig_cameraMount')
  const eye = camera?.translation?.[1]

  if (problems.length) { failed += 1; console.log(`FAIL ${truck}: ${problems.join(' | ')}`) }
  else console.log(`PASS ${truck}  meshes=${meshes} tris=${Math.round(tris / 1000)}k controls=${controls.length} eye=${eye === undefined ? 'n/a' : eye.toFixed(2)}m`)
}

console.log(failed ? `\n${failed} model(s) failed the rig contract` : '\nAll models satisfy the rig contract')
process.exit(failed ? 1 : 0)
