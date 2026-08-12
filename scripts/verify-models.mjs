// Verify every exported truck satisfies its profile identity, rig, transform,
// and immutable binary contract. A mismatch blocks readiness instead of letting
// the simulator continue with a different visual asset.
//   node scripts/verify-models.mjs
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { equipmentProfiles } from '../src/data/equipment.js'
import { MODEL_CONTRACTS } from '../src/data/modelContracts.js'

const MANIFEST_PATH = 'public/models/truck-manifest.json'
const CONTROL_MOTIONS = new Set(['radial', 'horizontal', 'vertical', 'fore-aft', 'button', 'pedal'])
const TRIANGLE_MODES = new Set([4, 5, 6])
const PROFILE_METADATA = [
  'assetId', 'assetSpec', 'configurationId', 'validationStatus',
  'referenceManualRevision', 'sourceRevision', 'serialRange',
  'mastConfiguration', 'installedOptions', 'modeledOptions', 'excludedOptions',
]

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readGlb(buffer, path) {
  if (buffer.length < 20 || buffer.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error(`${path} is not a binary glTF file`)
  }
  if (buffer.readUInt32LE(4) !== 2) throw new Error(`${path} is not glTF 2.0`)
  if (buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error(`${path} header length does not match its file size`)
  }
  const jsonLength = buffer.readUInt32LE(12)
  if (buffer.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${path} has no leading JSON chunk`)
  if (20 + jsonLength > buffer.length) throw new Error(`${path} JSON chunk extends beyond the file`)
  return JSON.parse(buffer.slice(20, 20 + jsonLength).toString('utf8').replace(/\0+$/u, '').trim())
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function vector(node, property, fallback, problems) {
  const value = node?.[property] ?? fallback
  if (!Array.isArray(value) || value.length !== fallback.length || value.some((entry) => !Number.isFinite(entry))) {
    problems.push(`${node?.name || 'unnamed node'} has invalid ${property}`)
    return fallback
  }
  return value
}

function renderedTriangleCount(gltf, problems) {
  const uses = new Array((gltf.meshes || []).length).fill(0)
  ;(gltf.nodes || []).forEach((node) => {
    if (Number.isInteger(node.mesh) && node.mesh >= 0 && node.mesh < uses.length) uses[node.mesh] += 1
  })
  let triangles = 0
  let primitives = 0
  ;(gltf.meshes || []).forEach((mesh, meshIndex) => {
    const instances = uses[meshIndex]
    if (!instances) return
    ;(mesh.primitives || []).forEach((primitive, primitiveIndex) => {
      const mode = primitive.mode ?? 4
      if (!TRIANGLE_MODES.has(mode)) {
        problems.push(`${mesh.name || `mesh ${meshIndex}`} primitive ${primitiveIndex} uses unsupported mode ${mode}`)
        return
      }
      const accessorIndex = Number.isInteger(primitive.indices)
        ? primitive.indices
        : primitive.attributes?.POSITION
      const count = gltf.accessors?.[accessorIndex]?.count
      if (!Number.isFinite(count)) {
        problems.push(`${mesh.name || `mesh ${meshIndex}`} primitive ${primitiveIndex} has no countable indices or positions`)
        return
      }
      const perInstance = mode === 4 ? Math.floor(count / 3) : Math.max(0, count - 2)
      triangles += perInstance * instances
      primitives += instances
    })
  })
  return { triangles, primitives }
}

function actionsFrom(nodes) {
  const actions = new Set()
  nodes.forEach((node) => {
    const extras = node.extras
    if (!extras?.ctrl_action) return
    actions.add(extras.ctrl_action)
    if (extras.ctrl_action2) actions.add(extras.ctrl_action2)
    if (extras.ctrl_shift2) actions.add(extras.ctrl_shift2)
  })
  return actions
}

function parentIndex(nodes, problems) {
  const parents = new Map()
  nodes.forEach((node, nodeIndex) => {
    ;(node.children || []).forEach((childIndex) => {
      if (parents.has(childIndex)) problems.push(`${nodes[childIndex]?.name || childIndex} has more than one parent`)
      parents.set(childIndex, nodeIndex)
    })
  })
  return parents
}

function hasAncestor(nodeIndex, ancestorName, nodes, parents) {
  for (let current = parents.get(nodeIndex); current !== undefined; current = parents.get(current)) {
    if (nodes[current]?.name === ancestorName) return true
  }
  return false
}

function checkProfileMetadata(profileKey, profile, assetIds) {
  const problems = []
  PROFILE_METADATA.forEach((field) => {
    if (!Object.hasOwn(profile, field)) problems.push(`${profileKey} omits metadata field ${field}`)
  })
  if (!/^Reference configuration:/u.test(profile.model || '')) {
    problems.push(`${profileKey} model copy must identify a reference configuration`)
  }
  if (profile.validationStatus !== 'reference-only-unverified') {
    problems.push(`${profileKey} validationStatus must remain reference-only-unverified until physical validation`)
  }
  if (!Array.isArray(profile.modeledOptions) || !Array.isArray(profile.excludedOptions)) {
    problems.push(`${profileKey} modeledOptions and excludedOptions must be arrays`)
  }
  if (profile.serialRange !== null || profile.installedOptions !== null) {
    problems.push(`${profileKey} must not claim unverified serial or installed-option data`)
  }
  if (profileKey === 'Raymond:order-picker') {
    if (profile.mastConfiguration !== 'three-stage, 240 in nominal lift') {
      problems.push(`${profileKey} must identify the published 3000 lb / 240 in three-stage configuration`)
    }
    if (!profile.knownFidelityBlockers?.some((blocker) => /third stage/iu.test(blocker))) {
      problems.push(`${profileKey} must disclose that the GLB does not model its third mast stage`)
    }
  } else if (profile.mastConfiguration !== null) {
    problems.push(`${profileKey} must not claim unverified mast data`)
  }
  if (assetIds.has(profile.assetId)) problems.push(`${profileKey} duplicates assetId ${profile.assetId}`)
  assetIds.add(profile.assetId)
  return problems
}

let failed = 0
const assetIds = new Set()
const profileProblems = new Map()
Object.entries(equipmentProfiles).forEach(([profileKey, profile]) => {
  profileProblems.set(profileKey, checkProfileMetadata(profileKey, profile, assetIds))
})

if (!existsSync(MANIFEST_PATH)) {
  console.log(`FAIL manifest: missing ${MANIFEST_PATH}`)
  process.exit(1)
}
const manifest = readJson(MANIFEST_PATH)
if (manifest.schemaVersion !== 1 || manifest.algorithm !== 'sha256' || !manifest.assets) {
  console.log(`FAIL manifest: ${MANIFEST_PATH} has an unsupported schema`)
  process.exit(1)
}

for (const [assetId, contract] of Object.entries(MODEL_CONTRACTS)) {
  const problems = [...(profileProblems.get(contract.profileKey) || [])]
  const profile = equipmentProfiles[contract.profileKey]
  if (!profile) problems.push(`missing equipment profile ${contract.profileKey}`)
  else if (profile.assetId !== assetId) {
    problems.push(`${contract.profileKey} selects ${profile.assetId}, expected ${assetId}`)
  }

  const path = `public/models/${assetId}.glb`
  if (!existsSync(path)) {
    console.log(`FAIL ${assetId}: missing ${path}`)
    failed += 1
    continue
  }

  let buffer
  let gltf
  try {
    buffer = readFileSync(path)
    gltf = readGlb(buffer, path)
  } catch (error) {
    console.log(`FAIL ${assetId}: ${error.message}`)
    failed += 1
    continue
  }

  const manifestEntry = manifest.assets[assetId]
  if (!manifestEntry) problems.push(`missing SHA-256 manifest entry in ${MANIFEST_PATH}`)
  else {
    if (manifestEntry.file !== `${assetId}.glb`) problems.push(`manifest file is ${manifestEntry.file}`)
    if (manifestEntry.bytes !== buffer.length) {
      problems.push(`manifest size is ${manifestEntry.bytes}, file is ${buffer.length} bytes`)
    }
    const digest = sha256(buffer)
    if (manifestEntry.sha256 !== digest) {
      problems.push(`SHA-256 changed to ${digest}; review the export and update the manifest intentionally`)
    }
    if (contract.contentRevision !== digest.slice(0, 12)) {
      problems.push(`runtime content revision is ${contract.contentRevision}, expected ${digest.slice(0, 12)}`)
    }
  }

  const nodes = gltf.nodes || []
  const named = new Map()
  nodes.forEach((node, nodeIndex) => {
    if (!node.name) return
    if (named.has(node.name)) problems.push(`duplicate node name ${node.name}`)
    else named.set(node.name, { node, nodeIndex })
  })

  contract.nodes.forEach((name) => {
    if (!named.has(name)) problems.push(`missing required node ${name}`)
  })
  contract.articulatedNodes.forEach((name) => {
    const entry = named.get(name)
    if (!entry) {
      problems.push(`missing required articulated node ${name}`)
      return
    }
    vector(entry.node, 'translation', [0, 0, 0], problems)
    vector(entry.node, 'rotation', [0, 0, 0, 1], problems)
    const scale = vector(entry.node, 'scale', [1, 1, 1], problems)
    if (scale.some((value) => Math.abs(value) < 1e-6)) problems.push(`${name} has a zero scale axis`)
  })
  Object.entries(contract.indexedNodes || {}).forEach(([prefix, count]) => {
    for (let index = 0; index < count; index += 1) {
      const name = `${prefix}${index}`
      if (!named.has(name)) problems.push(`missing required articulated node ${name}`)
    }
  })
  if (assetId === 'raymond_5300') {
    const unexpectedThirdStage = ['mast_rail_s2_L', 'mast_rail_s2_R'].filter((name) => named.has(name))
    if (unexpectedThirdStage.length) {
      problems.push(
        `Raymond 5300 third-stage geometry appeared (${unexpectedThirdStage.join(', ')}); review and replace the recorded fidelity blocker`,
      )
    }
  }

  const actions = actionsFrom(nodes)
  contract.controls.forEach((action) => {
    if (!actions.has(action)) problems.push(`no control commands ${action}`)
  })

  const root = named.get('rig_root')?.node
  const actualSpec = root?.extras?.spec ?? null
  const actualConfigurationId = root?.extras?.control_configuration ?? null
  if (profile && actualSpec !== profile.assetSpec) {
    problems.push(`rig_root spec is ${JSON.stringify(actualSpec)}, profile expects ${JSON.stringify(profile.assetSpec)}`)
  }
  if (profile && actualConfigurationId !== (profile.configurationId ?? null)) {
    problems.push(
      `rig_root control_configuration is ${JSON.stringify(actualConfigurationId)}, profile expects ${JSON.stringify(profile.configurationId ?? null)}`,
    )
  }
  const rootScale = vector(root, 'scale', [1, 1, 1], problems)
  if (rootScale.some((value) => Math.abs(value - 1) > 1e-6)) problems.push('rig_root must export at unit scale')

  if (named.has('qa_floor')) problems.push('QA floor leaked into export')
  const controls = nodes.filter((node) => node.extras?.ctrl_action)
  controls.forEach((node) => {
    const extras = node.extras
    const motion = extras.ctrl_motion || extras.ctrl_axis
    if (!CONTROL_MOTIONS.has(motion)) problems.push(`${node.name} has invalid motion ${motion || 'undefined'}`)
    if (!Number.isFinite(extras.ctrl_scale) || extras.ctrl_scale === 0) problems.push(`${node.name} has invalid ctrl_scale`)
    if (/lower|reverse/iu.test(extras.ctrl_label || '') && extras.ctrl_axis === 'button' && extras.ctrl_scale > 0) {
      problems.push(`${node.name} negative button has positive ctrl_scale`)
    }
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
  if (controls.some((node) => node.extras.ctrl_shift2) && !modifiers.length) {
    problems.push('a control declares ctrl_shift2 but the truck has no modifier switch')
  }

  const cameraEntry = named.get('rig_cameraMount')
  const xrEntry = named.get('rig_xrOrigin')
  const camera = vector(cameraEntry?.node, 'translation', [0, 0, 0], problems)
  const xrOrigin = vector(xrEntry?.node, 'translation', [0, 0, 0], problems)
  const [cameraMin, cameraMax] = contract.cameraHeightRange
  const [xrMin, xrMax] = contract.xrOriginHeightRange
  if (camera[1] < cameraMin || camera[1] > cameraMax) {
    problems.push(`camera height ${camera[1].toFixed(3)}m is outside ${cameraMin}-${cameraMax}m`)
  }
  if (xrOrigin[1] < xrMin || xrOrigin[1] > xrMax) {
    problems.push(`XR origin height ${xrOrigin[1].toFixed(3)}m is outside ${xrMin}-${xrMax}m`)
  }
  if ([...camera, ...xrOrigin].some((value) => Math.abs(value) > 10)) {
    problems.push('camera or XR origin is implausibly far from the truck origin')
  }
  const parents = parentIndex(nodes, problems)
  if (contract.movingOriginAncestor) {
    if (cameraEntry && !hasAncestor(cameraEntry.nodeIndex, contract.movingOriginAncestor, nodes, parents)) {
      problems.push(`rig_cameraMount must descend from ${contract.movingOriginAncestor}`)
    }
    if (xrEntry && !hasAncestor(xrEntry.nodeIndex, contract.movingOriginAncestor, nodes, parents)) {
      problems.push(`rig_xrOrigin must descend from ${contract.movingOriginAncestor}`)
    }
  }

  const counts = renderedTriangleCount(gltf, problems)
  if (problems.length) {
    failed += 1
    console.log(`FAIL ${assetId}:\n  - ${problems.join('\n  - ')}`)
  } else {
    console.log(
      `PASS ${assetId}  draws=${counts.primitives} tris=${counts.triangles.toLocaleString('en-US')} `
      + `controls=${controls.length} eye=${camera[1].toFixed(2)}m sha256=${manifestEntry.sha256.slice(0, 12)}`,
    )
  }
}

const unexpectedManifestAssets = Object.keys(manifest.assets).filter((assetId) => !MODEL_CONTRACTS[assetId])
if (unexpectedManifestAssets.length) {
  failed += 1
  console.log(`FAIL manifest: unexpected truck entries ${unexpectedManifestAssets.join(', ')}`)
}

console.log(failed ? `\n${failed} model readiness check(s) failed` : '\nAll truck models satisfy identity, rig, transform, and SHA-256 readiness gates')
process.exit(failed ? 1 : 0)
