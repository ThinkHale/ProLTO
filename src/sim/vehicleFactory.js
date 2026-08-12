import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MODEL_CONTRACTS } from '../data/modelContracts.js'
import { fetchArrayBuffer } from './assetFetch.js'
import { createVehicleRig as createProceduralRig } from './proceduralFactory.js'
import { createWheelArticulation } from './wheelArticulation.js'

// Blender-authored fleet assets (assets-src/trucks/*.py -> public/models/*.glb).
// Node names + ctrl_* extras are the contract; see assets-src/lib/rig.py.
const loader = new GLTFLoader()
const MODEL_LOAD_TIMEOUT_MS = 15000

async function loadGltfAsset(url, options = {}) {
  const buffer = await fetchArrayBuffer(url, {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? MODEL_LOAD_TIMEOUT_MS,
  })
  const resourcePath = url.slice(0, url.lastIndexOf('/') + 1)
  return loader.parseAsync(buffer, resourcePath)
}

export class AssetReadinessError extends Error {
  constructor(code, message, options = {}) {
    super(message, options)
    this.name = 'AssetReadinessError'
    this.code = code
    this.assetId = options.assetId || null
  }
}

function equipmentKey(profile) {
  return `${profile?.manufacturer || 'unknown'}:${profile?.family || 'unknown'}`
}

function profileContract(profile) {
  const assetId = profile?.assetId
  const contract = assetId ? MODEL_CONTRACTS[assetId] : null
  if (!assetId || !contract) {
    throw new AssetReadinessError(
      'MODEL_PROFILE_INVALID',
      `${equipmentKey(profile)} has no recognized assetId`,
      { assetId },
    )
  }
  if (contract.profileKey !== equipmentKey(profile)) {
    throw new AssetReadinessError(
      'MODEL_PROFILE_INVALID',
      `${assetId} belongs to ${contract.profileKey}, not ${equipmentKey(profile)}`,
      { assetId },
    )
  }
  if (!profile.assetSpec || typeof profile.assetSpec !== 'string') {
    throw new AssetReadinessError(
      'MODEL_PROFILE_INVALID',
      `${equipmentKey(profile)} has no expected assetSpec`,
      { assetId },
    )
  }
  return contract
}

function commandableActions(index) {
  const actions = new Set()
  index.forEach((object) => {
    const extras = object.userData
    if (!extras?.ctrl_action) return
    actions.add(extras.ctrl_action)
    if (extras.ctrl_action2) actions.add(extras.ctrl_action2)
    if (extras.ctrl_shift2) actions.add(extras.ctrl_shift2)
  })
  return actions
}

function validateVehicleAsset(index, profile, duplicateNames = []) {
  const contract = profileContract(profile)
  const assetId = profile.assetId
  const rigProblems = []
  if (duplicateNames.length) rigProblems.push(`duplicate node names: ${duplicateNames.join(', ')}`)
  contract.nodes.forEach((name) => {
    if (!index.has(name)) rigProblems.push(`missing required node ${name}`)
  })
  Object.entries(contract.indexedNodes || {}).forEach(([prefix, count]) => {
    for (let indexValue = 0; indexValue < count; indexValue += 1) {
      const name = `${prefix}${indexValue}`
      if (!index.has(name)) rigProblems.push(`missing required articulated node ${name}`)
    }
  })
  const actions = commandableActions(index)
  contract.controls.forEach((action) => {
    if (!actions.has(action)) rigProblems.push(`no control commands ${action}`)
  })

  const root = index.get('rig_root')
  const actualSpec = root?.userData?.spec ?? null
  const actualConfigurationId = root?.userData?.control_configuration ?? null
  const expectedConfigurationId = profile.configurationId ?? null
  const identityProblems = []
  if (actualSpec !== profile.assetSpec) {
    identityProblems.push(`spec is ${JSON.stringify(actualSpec)}, expected ${JSON.stringify(profile.assetSpec)}`)
  }
  if (actualConfigurationId !== expectedConfigurationId) {
    identityProblems.push(
      `control configuration is ${JSON.stringify(actualConfigurationId)}, expected ${JSON.stringify(expectedConfigurationId)}`,
    )
  }

  if (identityProblems.length || rigProblems.length) {
    const problems = [...identityProblems, ...rigProblems]
    throw new AssetReadinessError(
      identityProblems.length ? 'MODEL_IDENTITY_MISMATCH' : 'MODEL_RIG_INVALID',
      `${assetId} failed readiness: ${problems.join('; ')}`,
      { assetId },
    )
  }

  return Object.freeze({
    assetId,
    assetSpec: actualSpec,
    configurationId: actualConfigurationId,
    validationStatus: profile.validationStatus,
  })
}

function allowsProceduralFallback(env) {
  return env?.DEV === true && env?.VITE_ALLOW_PROCEDURAL_FALLBACK === 'true'
}

function telemetryTexture(manufacturer) {
  const crown = manufacturer === 'Crown'
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 320
  const context = canvas.getContext('2d')
  context.fillStyle = '#0b1416'
  context.fillRect(0, 0, 512, 320)
  context.fillStyle = crown ? '#9cc8c3' : '#a9c4a6'
  context.fillRect(14, 14, 484, 292)
  context.fillStyle = '#10292b'
  context.font = '700 36px Arial'
  context.fillText(crown ? 'CROWN' : 'RAYMOND', 26, 56)
  context.font = '700 74px Arial'
  context.fillText('0.0', 32, 152)
  context.font = '600 25px Arial'
  context.fillText('MPH', 208, 148)
  context.strokeStyle = '#10292b'
  context.lineWidth = 8
  context.strokeRect(362, 36, 104, 50)
  context.fillRect(466, 50, 12, 22)
  context.fillRect(373, 47, 76, 28)
  context.font = '600 24px Arial'
  context.fillText('PARK', 34, 236)
  context.fillText('FORKS 0 in', 200, 236)
  context.fillStyle = '#173a3b'
  context.fillRect(26, 262, 460, 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

function attachControlMetadata(object) {
  const extras = object.userData
  if (!extras) return
  // A held modifier switch commands nothing itself. The Crown Multi-Task back
  // switch re-maps the thumb ball's reach axis to sideshift while held.
  if (extras.ctrl_modifier) {
    object.userData.modifier = { label: extras.ctrl_label || 'Modifier switch' }
  } else if (extras.ctrl_action) {
    object.userData.control = {
      action: extras.ctrl_action,
      label: extras.ctrl_label || extras.ctrl_action,
      axis: extras.ctrl_axis || 'vertical',
      spring: !!extras.ctrl_spring,
      motion: extras.ctrl_motion || extras.ctrl_axis || 'vertical',
      scale: Number.isFinite(extras.ctrl_scale) ? extras.ctrl_scale : 1,
      // Second orthogonal axis on the SAME physical part. The Crown handle
      // travels fore-aft and lifts vertically; its thumb ball tilts vertically
      // and reaches fore-aft. See assets-src/lib/rig.py.
      action2: extras.ctrl_action2 || null,
      motion2: extras.ctrl_motion2 || null,
      shift2: extras.ctrl_shift2 || null,
      detents: Number.isFinite(extras.ctrl_detents) ? extras.ctrl_detents : 2,
      // Reverse-acting pedal: pressed = released, lifted = applied.
      inverted: !!extras.ctrl_inverted,
    }
  } else return
  if (object.material) {
    object.material = object.material.clone()
    object.userData.baseEmissive = object.material.emissive?.getHex?.() || 0
  }
}

function collectIndexed(index, prefix) {
  const found = []
  for (let i = 0; i < 8; i += 1) {
    const node = index.get(`${prefix}${i}`)
    if (node) found.push(node)
  }
  return found
}

const FORK_BLADE = /^(?:forks?_[LR]|fork_[01])$/
// Must match the screen mesh name built by parts.cage_display.
export const FORKCAM_DISPLAY = 'forkcam_display'

// Measure the fork blades from the art instead of trusting a parallel table of
// hand-tuned constants. Those constants had drifted: the Raymond 7500 and Crown
// SC 6200 blades rest 0.12 and 0.14 m off the floor, but a GMA pallet's fork
// pocket only spans 0.025 to 0.13 m, so on those two trucks the forks could not
// physically enter a pallet on the ground and no amount of approach would pick
// one up. Deriving the geometry means the physics tracks whatever the modeler
// actually built, and `clearance` lets the simulator scale fork travel so that
// zero means blades on the floor rather than blades at their authored rest.
function measureForks(gltfScene) {
  gltfScene.updateMatrixWorld(true)
  const blades = []
  gltfScene.traverse((object) => { if (object.isMesh && FORK_BLADE.test(object.name)) blades.push(object) })
  if (blades.length < 2) return null
  const box = new THREE.Box3()
  const perBlade = blades.map((blade) => {
    const bounds = new THREE.Box3().setFromObject(blade)
    box.union(bounds)
    return bounds
  })
  const centers = perBlade.map((bounds) => (bounds.min.x + bounds.max.x) / 2).sort((a, b) => a - b)
  return {
    clearance: box.min.y,
    bladeBottom: box.min.y,
    length: box.max.z - box.min.z,
    spread: Math.abs(centers[centers.length - 1] - centers[0]),
    tineWidth: perBlade[0].max.x - perBlade[0].min.x,
    // Forward is -Z, so the heel (shank end, against the carriage) is the MAX z
    // and the tips are the min. The heel is where the load backrest sits, and
    // that plane is what has to stop the truck once a pallet is fully entered.
    heelZ: box.max.z,
    tipZ: box.min.z,
    // Carriage face spans the outer edges of the tines plus the backrest.
    faceHalfWidth: Math.max(box.max.x, -box.min.x),
  }
}

function recordRests(rig) {
  if (rig.carriage) rig.carriage.userData.rest = rig.carriage.position.clone()
  if (rig.reachGroup) rig.reachGroup.userData.rest = rig.reachGroup.position.clone()
  if (rig.levers) rig.levers.forEach((lever) => { lever.userData.restRX = lever.rotation.x })
  return rig
}

// Bolts, ribs, and label plates cost a shadow-map draw each and contribute
// nothing legible. Only parts big enough to read as a shadow cast one.
const SHADOW_CASTER_SIZE = .12
const shadowSize = new THREE.Vector3()

function castsUsefulShadow(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
  mesh.geometry.boundingBox.getSize(shadowSize)
  return Math.max(shadowSize.x, shadowSize.y, shadowSize.z) >= SHADOW_CASTER_SIZE
}

function mapRig(gltfScene, profile) {
  if (!gltfScene?.traverse) {
    throw new AssetReadinessError(
      'MODEL_PARSE_FAILED',
      `${profile?.assetId || equipmentKey(profile)} did not contain a glTF scene`,
      { assetId: profile?.assetId },
    )
  }
  const index = new Map()
  const duplicateNames = []
  gltfScene.traverse((object) => {
    if (!object.name) return
    if (index.has(object.name)) duplicateNames.push(object.name)
    index.set(object.name, object)
  })
  const assetIdentity = validateVehicleAsset(index, profile, duplicateNames)

  gltfScene.traverse((object) => {
    attachControlMetadata(object)
    if (object.isMesh) {
      object.castShadow = castsUsefulShadow(object)
      object.receiveShadow = true
      // Any mesh a truck module names as a display face gets the live cluster
      // texture, unlit so it reads as an emissive panel at any exposure. The
      // fork camera monitor is excluded: the Simulator binds a render target to
      // it instead of a painted canvas.
      if (object.name !== FORKCAM_DISPLAY && /screen/i.test(object.name)) {
        object.material = new THREE.MeshBasicMaterial({ map: telemetryTexture(profile.manufacturer), toneMapped: false })
      }
    }
  })
  const get = (name) => index.get(name) || null
  const mast = get('rig_mast')
  const carriage = get('rig_carriage')
  const walkie = profile.family === 'pallet' && profile.stance.includes('Walk')
  const rig = {
    root: gltfScene,
    body: gltfScene,
    mast,
    carriage,
    reachGroup: get('rig_reachGroup'),
    platform: get('rig_platform'),
    cameraMount: get('rig_cameraMount') || gltfScene,
    xrOrigin: get('rig_xrOrigin'),
    // Reach trucks carry a fork-mounted camera and a monitor on the guard
    // header. Both ride the reach group so the view tracks lift and reach, which
    // is the whole point when placing a load into a top slot. See
    // assets-src/lib/parts.py cage_display.
    forkCam: get('rig_forkCam'),
    forkCamDisplay: get(FORKCAM_DISPLAY),
    controls: gltfScene,
    steerPivot: get('rig_steerPivot'),
    travelPivot: get('rig_travelPivot'),
    liftPivot: get('rig_liftPivot'),
    reachPivot: get('rig_reachPivot'),
    tiltPivot: get('rig_tiltPivot'),
    sideshiftPivot: get('rig_sideshiftPivot'),
    secondaryTravelPivot: get('rig_secondaryTravelPivot'),
    tillerPivot: get('rig_tillerPivot'),
    headGroup: get('rig_headGroup'),
    wheelPivot: get('rig_wheelPivot'),
    driveWheel: get('rig_driveWheel'),
    loadWheels: collectIndexed(index, 'rig_loadWheel_'),
    frontWheels: collectIndexed(index, 'rig_frontWheel_'),
    rearWheels: collectIndexed(index, 'rig_rearWheel_'),
    levers: collectIndexed(index, 'rig_lever_'),
    gates: collectIndexed(index, 'rig_gate_'),
    family: profile.family,
    walkie,
    assetSource: 'gltf',
    assetIdentity,
    specification: assetIdentity.assetSpec,
    // reach trucks tilt at the fork carriage; counterbalance tilts the mast
    tiltGroup: profile.family === 'reach' ? carriage : profile.family === 'counterbalance' ? mast : null,
  }
  if (!rig.loadWheels.length) rig.loadWheels = null
  if (!rig.levers.length) rig.levers = null
  rig.forkMetrics = measureForks(gltfScene)
  if (!rig.forkMetrics) {
    throw new AssetReadinessError(
      'MODEL_RIG_INVALID',
      `${profile.assetId} has no measurable fork pair`,
      { assetId: profile.assetId },
    )
  }
  recordRests(rig)
  try {
    rig.wheelArticulation = createWheelArticulation(rig)
  } catch (error) {
    throw new AssetReadinessError(
      'MODEL_RIG_INVALID',
      `${profile.assetId} wheel articulation failed readiness: ${error?.message || error}`,
      { assetId: profile.assetId, cause: error },
    )
  }
  return rig
}

async function loadVehicleRig(profile, options = {}) {
  const env = options.env ?? import.meta.env
  const loadAsset = options.loadAsset || ((url) => loadGltfAsset(url, options))
  const asset = profile?.assetId
  const baseUrl = env?.BASE_URL ?? import.meta.env?.BASE_URL ?? '/'
  let url = `${baseUrl}models/${asset}.glb`
  try {
    const contract = profileContract(profile)
    if (!/^[a-f0-9]{12}$/u.test(contract.contentRevision || '')) {
      throw new AssetReadinessError(
        'MODEL_PROFILE_INVALID',
        `${asset} has no valid content revision`,
        { assetId: asset },
      )
    }
    url += `?v=${contract.contentRevision}`
    const gltf = await loadAsset(url)
    return mapRig(gltf.scene, profile)
  } catch (error) {
    const readinessError = error instanceof AssetReadinessError
      ? error
      : new AssetReadinessError(
          'MODEL_LOAD_FAILED',
          `${asset || equipmentKey(profile)} could not load ${url}: ${error?.message || error}`,
          { assetId: asset, cause: error },
        )
    if (!allowsProceduralFallback(env)) {
      console.error(`ProLTO asset readiness failure [${readinessError.code}]: ${readinessError.message}`)
      throw readinessError
    }
    console.warn(
      `ProLTO DEVELOPMENT ONLY procedural fallback [${readinessError.code}] for ${asset}: ${readinessError.message}`,
    )
    const rig = recordRests(createProceduralRig(profile))
    rig.assetSource = 'procedural-development'
    rig.assetIdentity = Object.freeze({
      assetId: asset,
      assetSpec: null,
      configurationId: null,
      validationStatus: 'development-fallback',
      fallbackCause: readinessError.code,
    })
    rig.specification = `Development fallback for ${profile.manufacturer} ${profile.model}`
    return rig
  }
}

export function createVehicleRig(profile, options = {}) {
  return loadVehicleRig(profile, options)
}

// Exposed so scripts/verify-rig-binding.mjs can assert the real mapping against
// the real exports without standing up a browser and a WebGL context.
export const __mapRigForTest = mapRig
export const __loadVehicleRigForTest = loadVehicleRig
export const __validateVehicleAssetForTest = validateVehicleAsset
export const __allowsProceduralFallbackForTest = allowsProceduralFallback

export function controlMeshes(rig) {
  const result = []
  rig.root.traverse((object) => {
    if (object.userData.control || object.userData.modifier) result.push(object)
  })
  return result
}
