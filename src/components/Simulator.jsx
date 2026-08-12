import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as THREE from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { Crosshair, Gamepad2, Headphones, Keyboard, MousePointer2, RotateCcw, Volume2 } from 'lucide-react'
import {
  colliderAtPose,
  createWarehouseLoadPhysics,
  forkConfigurationForProfile,
  forkTineCollidersForFrame,
} from '../sim/loadPhysics.js'
import { controlMeshes, createVehicleRig } from '../sim/vehicleFactory.js'
import { FACILITY, createWarehouse } from '../sim/warehouse.js'
import {
  acceptedMotion,
  advanceDriveSpeed,
  advanceSteerAngle,
  integrateSteering,
  PROVISIONAL_LONGITUDINAL_LIMITS,
  provisionalSteeringSpeedScale,
  steerLimits,
  tailSwingRadius,
} from '../sim/vehicleDynamics.js'
import { solveStability, stabilityWarning } from '../sim/stability.js'
import { applyFleetSurfacing } from '../sim/surfacing.js'
import { contactAssessment } from '../sim/safetyEvents.js'
import { applyModifierTransition, desktopPresenceHeld, isBellyControlActive, isNativeInteractiveTarget, removePointerDrag } from '../sim/inputSafety.js'
import { fetchArrayBuffer } from '../sim/assetFetch.js'
import {
  finishXRStartup,
  hasLocalFloorReferenceSpace,
  releaseRemovedXRInputSources,
  requestImmersiveSessionWithFallback,
  xrOriginHeight,
} from '../sim/xrLifecycle.js'

// Broad fail-safe bounds sit just inside the authored walls. Exact contact is
// resolved by the warehouse wall, column, rack, and fixture colliders below.
// Derived from the facility footprint so the two cannot drift apart.
const WORLD = {
  minX: FACILITY.minX + .4, maxX: FACILITY.maxX - .4,
  minZ: FACILITY.minZ + .4, maxZ: FACILITY.maxZ - .4,
}
const ZERO = { travel: 0, steer: 0, lift: 0, reach: 0, tilt: 0, sideshift: 0, brake: 0, horn: 0, presence: 0, belly: 0 }
// Simulator state carries operator-facing units (fork height in inches, load in
// pounds) because that is what the panels and the capacity plates read in. The
// physics modules are strictly SI, so conversion happens at the boundary.
const INCH = .0254
const POUND = .45359237
// `turnRate` is gone: yaw now comes from the steered-axle kinematics in
// src/sim/vehicleDynamics.js rather than a per-family fudge factor.
// Lock-to-lock revolutions of the operator's steering device. A sit-down truck's
// wheel makes roughly three and a half full turns between locks, and a reach
// truck's palm disc a bit over one. Sweeping only a fraction of a turn -- the
// old fixed 1.5 rad, about 86 degrees -- reads as the wheel rocking side to side
// rather than being steered. Half travel in radians is turns * PI.
const STEER_LOCK_TO_LOCK = { counterbalance: 3.5, reach: 1.25, 'order-picker': 1.25, pallet: 1 }
// Longitudinal limits are explicit SI accelerations, not exponential damping
// constants. These are conservative training defaults reconstructed from the
// current response envelope. Replace them with serial-specific measured curves
// before manufacturer-level replica certification.
const DYNAMICS = {
  reach: { ...PROVISIONAL_LONGITUDINAL_LIMITS.reach, liftRate: 30.6, reverseScale: .86 },
  'order-picker': { ...PROVISIONAL_LONGITUDINAL_LIMITS['order-picker'], liftRate: 40, reverseScale: .82 },
  pallet: { ...PROVISIONAL_LONGITUDINAL_LIMITS.pallet, liftRate: 4.2, reverseScale: .72 },
  counterbalance: { ...PROVISIONAL_LONGITUDINAL_LIMITS.counterbalance, liftRate: 43, reverseScale: .86 },
}
const FIXED_SIMULATION_STEP = 1 / 90
const MAX_SIMULATION_STEPS_PER_FRAME = 18
const SIMULATION_TIME_EPSILON = 1e-10
const DESKTOP_PIXEL_RATIO_CAP = 1.7
const DESKTOP_SHADOW_MAP_SIZE = 2048
const ENVIRONMENT_CONTENT_REVISION = '9b3d611cadc3'
const ENVIRONMENT_LOAD_TIMEOUT_MS = 15000
// Provisional until a GPU capture is completed on each supported Quest model.
const PROVISIONAL_QUEST_RENDER_TIER = {
  framebufferScaleFactor: .82,
  foveation: .8,
  shadowMapSize: 1024,
}
const DESKTOP_OPERATION_KEYS = new Set([
  'ShiftLeft', 'ShiftRight',
  'KeyW', 'KeyS', 'KeyA', 'KeyD',
  'KeyE', 'KeyQ', 'KeyR', 'KeyF',
  'KeyT', 'KeyG', 'KeyZ', 'KeyC', 'KeyB',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Home',
])

// Body envelopes stop the power unit and operator compartment while leaving
// the authored forks free to enter a pallet. Walk-behind equipment includes a
// second envelope for the exposed tiller and its operator-side travel arc.
const TRUCK_COLLIDERS = {
  reach: [
    { id: 'power-unit', offsetX: 0, offsetZ: .48, halfWidth: .69, halfLength: .92, minY: 0, maxY: 2.35 },
  ],
  'order-picker': [
    { id: 'power-unit', offsetX: 0, offsetZ: .58, halfWidth: .57, halfLength: .78, minY: 0, maxY: 1.08 },
  ],
  'pallet-rider': [
    { id: 'power-unit', offsetX: 0, offsetZ: .38, halfWidth: .5, halfLength: .58, minY: 0, maxY: 1.48 },
    { id: 'rider-platform', offsetX: 0, offsetZ: 1.02, halfWidth: .48, halfLength: .36, minY: 0, maxY: .45 },
  ],
  'pallet-walkie': [
    { id: 'power-unit', offsetX: 0, offsetZ: .35, halfWidth: .4, halfLength: .48, minY: 0, maxY: 1.05 },
    { id: 'tiller-sweep', offsetX: 0, offsetZ: 1.0, halfWidth: .25, halfLength: .55, minY: .18, maxY: 1.52 },
  ],
  counterbalance: [
    { id: 'counterbalance-body', offsetX: 0, offsetZ: .36, halfWidth: .61, halfLength: 1.12, minY: 0, maxY: 2.25 },
  ],
}

// The load backrest / carriage face. Every truck previously carried ONE body
// envelope behind the mast, so nothing at all occupied the space the mast,
// carriage and backrest actually fill. The forks are deliberately left free to
// enter a pallet, but with no carriage collider the whole front of the truck
// drove straight on through the load once they were in. This plate is what a
// fully-entered pallet stops against, and it tracks lift and reach.
const CARRIAGE_FACE_ID = 'carriage-face'
const BACKREST_HEIGHT = 1.15

function carriageFaceCollider(rig) {
  const metrics = rig.forkMetrics
  if (!metrics) return null
  return {
    id: CARRIAGE_FACE_ID,
    offsetX: 0,
    offsetZ: metrics.heelZ,
    halfWidth: Math.max(metrics.faceHalfWidth, metrics.spread * .5 + metrics.tineWidth),
    halfLength: .07,
    minY: 0,
    maxY: BACKREST_HEIGHT,
    // Load-end collider: like a carried pallet, it has to be able to nestle into
    // a rack bay past the beams it is placing onto, while still being stopped by
    // uprights and by stored loads.
    loadEnd: true,
  }
}

function truckColliders(profile, rig) {
  const base = profile.family !== 'pallet'
    ? TRUCK_COLLIDERS[profile.family]
    : rig.walkie ? TRUCK_COLLIDERS['pallet-walkie'] : TRUCK_COLLIDERS['pallet-rider']
  const face = carriageFaceCollider(rig)
  return face ? [...base, face] : base
}

// Resting head pose per family. Stand-up trucks look down into a near console;
// seated and walk-behind operators sit back from theirs.
const VIEWS = {
  reach: { fov: 70, pitch: -.65 },
  'order-picker': { fov: 70, pitch: -.6 },
  pallet: { fov: 72, pitch: -.35 },
  counterbalance: { fov: 74, pitch: -.62 },
}

const FALLBACK_XR_EYE_HEIGHT = {
  reach: 1.63,
  'order-picker': 1.63,
  pallet: 1.58,
  counterbalance: 1.18,
}

const clampInput = (value) => THREE.MathUtils.clamp(value, -1, 1)

function controlPrompt(profile) {
  if (profile.family === 'reach') return 'Operate the modeled steering and travel controls. The deadman or presence control must be held before movement.'
  if (profile.family === 'order-picker') return 'Use the opposing hand controls while holding the deadman control. Your eye point rises with the platform.'
  if (profile.family === 'pallet' && profile.stance.includes('Walk')) return 'Drag the tiller head to steer and use either butterfly throttle while staying beside the truck.'
  if (profile.family === 'pallet') return 'Operate the X10 handle from the rider platform while holding the presence control. Fork lift is limited to pallet clearance.'
  return 'Hold the presence control, turn the wheel, press the pedals, and manipulate each hydraulic lever. Account for rear counterweight swing.'
}

function createProceduralControllerVisual(index) {
  const group = new THREE.Group()
  group.name = `offline_xr_controller_${index}`
  const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x20292e, roughness: .54, metalness: .18 })
  const accentMaterial = new THREE.MeshStandardMaterial({ color: index ? 0x0f8c87 : 0xffad21, roughness: .42, metalness: .12 })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.026, .095, 5, 10), shellMaterial)
  body.rotation.x = Math.PI * .38
  body.position.set(0, -.018, .035)
  const guard = new THREE.Mesh(new THREE.TorusGeometry(.031, .006, 8, 20, Math.PI * 1.35), accentMaterial)
  guard.rotation.set(Math.PI * .5, 0, -.55)
  guard.position.set(0, .006, -.028)
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(.025, .014, .026), accentMaterial)
  trigger.position.set(0, -.002, -.04)
  group.add(body, guard, trigger)
  group.userData.dispose = () => {
    body.geometry.dispose()
    guard.geometry.dispose()
    trigger.geometry.dispose()
    shellMaterial.dispose()
    accentMaterial.dispose()
  }
  return group
}

function createProceduralHandSpheres(hand, index) {
  const geometry = new THREE.SphereGeometry(1, 10, 7)
  const material = new THREE.MeshStandardMaterial({
    color: index ? 0x8bd6d0 : 0xffc55f,
    roughness: .62,
    metalness: .04,
  })
  const meshes = new Map()
  const update = () => {
    Object.entries(hand.joints || {}).forEach(([name, joint]) => {
      let mesh = meshes.get(joint)
      if (!mesh) {
        mesh = new THREE.Mesh(geometry, material)
        mesh.name = `offline_hand_joint_${index}_${name}`
        joint.add(mesh)
        meshes.set(joint, mesh)
      }
      mesh.scale.setScalar(Math.max(joint.jointRadius || .008, .004))
    })
  }
  return {
    update,
    dispose() {
      meshes.forEach((mesh, joint) => joint.remove(mesh))
      meshes.clear()
      geometry.dispose()
      material.dispose()
    },
  }
}

function createXRStatusPanel() {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 320
  const context = canvas.getContext('2d')
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, toneMapped: false })
  const geometry = new THREE.PlaneGeometry(.64, .267)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.renderOrder = 10000
  mesh.position.set(0, -.3, -.74)
  mesh.visible = false
  const update = ({ inputCount = 0, floorTracked = true, message = 'Controls released' } = {}) => {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(5, 14, 19, .92)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = '#ffad21'
    context.lineWidth = 5
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)
    context.fillStyle = '#ffad21'
    context.font = '700 34px sans-serif'
    context.fillText('PROLTO VR TRAINING INPUT', 30, 51)
    context.fillStyle = '#eef5f6'
    context.font = '25px sans-serif'
    context.fillText(`Tracked inputs: ${inputCount}  |  Floor: ${floorTracked ? 'tracked' : 'fallback'}`, 30, 91)
    context.fillText('Trigger or pinch: hold modeled control', 30, 131)
    context.fillText('Squeeze: hold training presence proxy', 30, 171)
    context.fillText('Stick press: recenter  |  A/X: reset', 30, 211)
    context.fillText('Hold B/Y: exit VR  |  System menu also exits', 30, 251)
    context.fillStyle = '#84d5ce'
    context.font = '22px sans-serif'
    context.fillText(message.slice(0, 58), 30, 292)
    texture.needsUpdate = true
  }
  update()
  return {
    mesh,
    update,
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}

function disposeObjectResources(root) {
  const geometries = new Set()
  const materials = new Set()
  const textures = new Set()
  const instancedMeshes = new Set()
  const nestedValues = new Set()
  const collectTextures = (value) => {
    if (!value || typeof value !== 'object') return
    if (value.isTexture) {
      textures.add(value)
      return
    }
    if (nestedValues.has(value)) return
    nestedValues.add(value)
    if (Array.isArray(value)) value.forEach(collectTextures)
    else Object.values(value).forEach(collectTextures)
  }
  root?.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry)
    if (object.isInstancedMesh) instancedMeshes.add(object)
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
    objectMaterials.filter(Boolean).forEach((material) => materials.add(material))
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => {
    Object.values(material).forEach((value) => {
      if (value?.isTexture) textures.add(value)
    })
    collectTextures(material.uniforms)
    collectTextures(material.userData)
  })
  textures.forEach((texture) => texture.dispose())
  instancedMeshes.forEach((mesh) => mesh.dispose())
  materials.forEach((material) => material.dispose())
}

function hdrTextureFromBuffer(buffer) {
  const data = new HDRLoader().parse(buffer)
  const texture = new THREE.DataTexture(data.data, data.width, data.height)
  texture.type = data.type
  texture.colorSpace = data.colorSpace
  texture.minFilter = data.minFilter
  texture.magFilter = data.magFilter
  texture.generateMipmaps = data.generateMipmaps
  texture.flipY = data.flipY
  texture.needsUpdate = true
  return texture
}

const Simulator = forwardRef(function Simulator({ profile, onTelemetry, onSafetyEvent, running, onRunningChange, onLifecycleChange }, ref) {
  const mountRef = useRef(null)
  const engineRef = useRef(null)
  const runningRef = useRef(running)
  const previousRunningRef = useRef(running)
  const lifecycleCallbackRef = useRef(onLifecycleChange)
  const audioRef = useRef(true)
  const assistiveXRRef = useRef(false)
  const [xrSupported, setXrSupported] = useState(false)
  const [audioOn, setAudioOn] = useState(true)
  const [assistiveXR, setAssistiveXR] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [contextRevision, setContextRevision] = useState(0)
  const [engineReady, setEngineReady] = useState(false)
  const [enginePhase, setEnginePhase] = useState('loading')
  const [activeControl, setActiveControl] = useState('Cab controls armed')
  const [stability, setStability] = useState(100)
  // The bar is the normalized display; the label is driven by the RAW physical
  // margin, so the words stay true even though the bar is rescaled to be legible.
  const [stabilityState, setStabilityState] = useState('STABLE')
  const [presence, setPresence] = useState(false)
  lifecycleCallbackRef.current = onLifecycleChange

  const reportLifecycle = (next) => lifecycleCallbackRef.current?.(next)

  useImperativeHandle(ref, () => ({
    async enterVR() {
      const engine = engineRef.current
      if (!engine?.ready || !navigator.xr) return false
      if (engine.renderer.xr.isPresenting) return true
      if (engine.xrRequest) return engine.xrRequest
      engine.xrRequestCancelled = false
      const assertRequestActive = async (session = null) => {
        if (!engine.isDisposed() && !engine.xrRequestCancelled) return
        await session?.end().catch(() => {})
        const error = new Error('XR request cancelled because the simulator changed')
        error.name = 'AbortError'
        throw error
      }
      // Only `viewer` and `local` are guaranteed reference spaces for
      // immersive-vr; `local-floor` is NOT. It used to be a requiredFeature,
      // which made the whole request fail rather than degrade. Even as an
      // optional feature some runtimes reject a configuration outright, so walk
      // from the richest request down to a bare one and take the first that is
      // accepted. If even `{}` is refused, the runtime genuinely cannot open an
      // immersive-vr session and the message below says so instead of blaming
      // the feature list.
      const request = (async () => {
        engine.setLifecycle('xr-requesting', { message: 'Requesting headset permission' })
        const { session, refusal } = await requestImmersiveSessionWithFallback(
          navigator.xr,
          assertRequestActive,
          (configuration, error) => console.warn('ProLTO: XR configuration refused', configuration, error.name, error.message),
        )
        if (!session) {
          const supported = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false)
          await assertRequestActive()
          throw new Error(
            `${refusal?.name || 'Error'}: ${refusal?.message || 'no session'} `
            + `(immersive-vr reported ${supported ? 'supported' : 'UNSUPPORTED'}, `
            + `secure context ${window.isSecureContext ? 'yes' : 'NO'}). `
            + 'A headset must be connected and its runtime running before entering VR',
          )
        }
        const floorTracked = await hasLocalFloorReferenceSpace(session)
        await assertRequestActive(session)
        engine.prepareXR(session, floorTracked)
        try {
          await engine.renderer.xr.setSession(session)
        } catch (error) {
          engine.restoreDesktopCamera()
          await session.end().catch(() => {})
          await assertRequestActive()
          throw error
        }
        await assertRequestActive(session)
        finishXRStartup(engine.activeXRSession(), session, engine.markXRRunning)
        runningRef.current = true
        previousRunningRef.current = true
        onRunningChange(true)
        return true
      })()
      engine.xrRequest = request
      try {
        return await request
      } catch (error) {
        if (error.name === 'AbortError') {
          if (!engine.isDisposed() && engine.ready) engine.setLifecycle('ready', { message: 'Simulator ready. VR request cancelled' })
        } else engine.setLifecycle('ready', { message: 'Simulator ready. VR request failed', error: error.message })
        throw error
      } finally {
        if (engine.xrRequest === request) engine.xrRequest = null
      }
    },
    async exitVR() { return engineRef.current?.exitXR() ?? false },
    recenterVR() { return engineRef.current?.recenterXR() ?? false },
    reset() { engineRef.current?.reset() },
    startDesktop() {
      const engine = engineRef.current
      return engine?.startDesktop() ?? false
    },
    focusDesktop() { engineRef.current?.focusDesktop() },
  }))

  useEffect(() => {
    let active = true
    if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then((value) => {
      if (!active) return
      setXrSupported(value)
      reportLifecycle({ xrSupported: value })
    }).catch(() => {
      if (!active) return
      setXrSupported(false)
      reportLifecycle({ xrSupported: false })
    })
    else reportLifecycle({ xrSupported: false })
    return () => { active = false }
  }, [])
  useEffect(() => {
    const wasRunning = previousRunningRef.current
    runningRef.current = running
    if (running && !wasRunning) engineRef.current?.clearInteractions('Engage the physical presence control')
    if (!running && wasRunning) engineRef.current?.clearInteractions('Operator station exited')
    previousRunningRef.current = running
  }, [running])
  useEffect(() => { audioRef.current = audioOn }, [audioOn])
  useEffect(() => { assistiveXRRef.current = assistiveXR }, [assistiveXR])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    let disposed = false
    let graphicsContextLost = false
    const setLifecycle = (phase, details = {}) => {
      if (disposed) return
      setEnginePhase(phase)
      setEngineReady(phase === 'ready')
      lifecycleCallbackRef.current?.({ phase, ...details })
    }
    setLifecycle('loading', { message: `Loading ${profile.manufacturer} ${profile.model}` })
    setActiveControl('Cab controls armed')
    setPresence(false)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x6a7173)
    // Light haze only at the far end of the building, enough for depth without
    // graying out rack faces the operator is judging distance against.
    scene.fog = new THREE.Fog(0x767d7f, 34, 78)
    const view = { ...VIEWS[profile.family], ...profile.view }
    const defaultViewPitch = view.pitch
    const camera = new THREE.PerspectiveCamera(view.fov, mount.clientWidth / mount.clientHeight, .035, 90)
    camera.rotation.order = 'YXZ'
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    } catch (error) {
      setActiveControl('WebGL renderer unavailable')
      setLifecycle('failed', { message: 'WebGL renderer unavailable', error: error.message })
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, DESKTOP_PIXEL_RATIO_CAP))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // PBR Neutral preserves saturated manufacturer paint (Raymond red washes out
    // to salmon under AgX/ACES) while still rolling off highlights.
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = .98
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local-floor')
    const assetAbortController = new AbortController()
    let handleReadyContextLoss = null
    const webglContextLost = (event) => {
      event.preventDefault()
      if (disposed || graphicsContextLost) return
      graphicsContextLost = true
      assetAbortController.abort(new Error('Graphics context lost during simulator initialization'))
      handleReadyContextLoss?.()
      setActiveControl('Graphics context lost')
      setLifecycle('failed', {
        message: 'Graphics context lost',
        error: 'The GPU context was lost. Waiting for browser recovery.',
      })
    }
    const webglContextRestored = () => {
      if (disposed || !graphicsContextLost) return
      graphicsContextLost = false
      setLifecycle('loading', { message: 'Rebuilding graphics after context recovery', error: null })
      setContextRevision((current) => current + 1)
    }
    mount.appendChild(renderer.domElement)
    renderer.domElement.addEventListener('webglcontextlost', webglContextLost)
    renderer.domElement.addEventListener('webglcontextrestored', webglContextRestored)

    // Image-based lighting: PBR paint/clearcoat on the trucks needs a real
    // environment to reflect, or it reads as flat plastic.
    const pmrem = new THREE.PMREMGenerator(renderer)
    let pmremDisposed = false
    let environmentTarget = null
    const disposePmrem = () => {
      if (pmremDisposed) return
      pmremDisposed = true
      pmrem.dispose()
    }
    const environmentUrl = `${import.meta.env.BASE_URL}env/warehouse_1k.hdr?v=${ENVIRONMENT_CONTENT_REVISION}`
    const environmentReady = fetchArrayBuffer(environmentUrl, {
      signal: assetAbortController.signal,
      timeoutMs: ENVIRONMENT_LOAD_TIMEOUT_MS,
    }).then((buffer) => {
      if (disposed) return
      const hdr = hdrTextureFromBuffer(buffer)
      try {
        environmentTarget = pmrem.fromEquirectangular(hdr)
        scene.environment = environmentTarget.texture
        scene.environmentIntensity = .62
      } finally {
        hdr.dispose()
      }
    }).finally(disposePmrem)
    scene.add(new THREE.HemisphereLight(0xe7f3f4, 0x40484b, .8))
    // Key light stands in for the high-bay array: shadows follow the truck so
    // the 2k map stays dense enough to resolve mast and fork shadows.
    const sun = new THREE.DirectionalLight(0xfff4e2, 2.6)
    sun.position.set(-6, 13, 7)
    sun.castShadow = true
    sun.shadow.mapSize.set(DESKTOP_SHADOW_MAP_SIZE, DESKTOP_SHADOW_MAP_SIZE)
    sun.shadow.camera.left = -9
    sun.shadow.camera.right = 9
    sun.shadow.camera.top = 9
    sun.shadow.camera.bottom = -9
    sun.shadow.camera.far = 42
    sun.shadow.bias = -.0006
    sun.shadow.normalBias = .022
    scene.add(sun, sun.target)

    const warehouse = createWarehouse(scene)
    const disposers = []
    let ownedRig = null
    let ownedRigDisposed = false
    const disposeOwnedRig = () => {
      if (!ownedRig || ownedRigDisposed) return
      ownedRigDisposed = true
      disposeObjectResources(ownedRig.root)
    }
    setActiveControl('Loading equipment model...')
    const vehicleReady = createVehicleRig(profile, { signal: assetAbortController.signal }).then((rig) => {
      if (disposed) {
        disposeObjectResources(rig.root)
        return null
      }
      ownedRig = rig
      return rig
    })
    Promise.all([vehicleReady, environmentReady]).then(([rig]) => {
    if (disposed || !rig) return
    setActiveControl('Cab controls armed')
    // The exported fleet ships with flat Principled values and no image
    // textures at all. Surfacing injects baked roughness/relief/grime before
    // anything renders, so uniform plastic-looking panels never reach a frame.
    applyFleetSurfacing(rig.root)
    rig.root.position.set(0, 0, 11.5)
    const desktopCameraMount = rig.cameraMount
    desktopCameraMount.add(camera)
    camera.position.set(0, 0, 0)
    scene.add(rig.root)
    let xrOrigin = rig.xrOrigin
    if (!xrOrigin) {
      xrOrigin = new THREE.Group()
      xrOrigin.name = 'derived_xr_floor_origin'
      xrOrigin.position.copy(desktopCameraMount.position)
      xrOrigin.quaternion.copy(desktopCameraMount.quaternion)
      xrOrigin.position.y = Math.max(0, xrOrigin.position.y - FALLBACK_XR_EYE_HEIGHT[profile.family])
      desktopCameraMount.parent.add(xrOrigin)
    }
    const xrOriginRestPosition = xrOrigin.position.clone()
    const interactables = controlMeshes(rig)
    // interactables now also carries modifier switches, which have no .control.
    const presenceControl = interactables.find((object) => object.userData.control?.action === 'presence')
    if (presenceControl) presenceControl.userData.restY = presenceControl.position.y
    const brakeControl = interactables.find((object) => object.userData.control?.action === 'brake')
    // Crown RR 5700: the foot brake is reverse-acting. An operator correctly in
    // position is holding it down, so the brake is OFF while presence is held
    // and re-applies the instant presence is lost. See operator manual page 22.
    const reverseActingBrake = !!brakeControl?.userData.control?.inverted
    if (brakeControl) brakeControl.userData.restY = brakeControl.position.y
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const dynamics = DYNAMICS[profile.family]
    const requiresPresence = profile.family !== 'pallet' || !rig.walkie
    const manual = { ...ZERO }
    const steering = steerLimits(profile)
    // How far the blades sit above the floor at their authored rest. Fork travel
    // is rescaled by this so state.fork is height ABOVE THE FLOOR: zero means
    // blades on the ground, which is where a truck parks and the only place it
    // can enter a pallet lying on the deck.
    const forkClearance = rig.forkMetrics?.clearance ?? 0

    // Live fork camera feeding the guard-header monitor. Rendered at a quarter
    // rate and low resolution: it is a working aid glanced at while placing a
    // load, not a second full-quality viewport, and on a standalone headset a
    // full-rate second scene pass is not affordable.
    let forkCamera = null
    let forkCamTarget = null
    let forkCamTick = 0
    if (rig.forkCam && rig.forkCamDisplay) {
      forkCamTarget = new THREE.WebGLRenderTarget(320, 200, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true,
      })
      // A render target is drawn by the GPU with its origin at the BOTTOM left,
      // while the canvas textures on the instrument screens are flipped on
      // upload (flipY) so theirs ends up at the top. `flipY` does nothing to a
      // render target because nothing is uploaded, so the same planar UVs that
      // read correctly on the dash displays showed this feed upside down.
      // Inverting V through the texture transform is the fix that does work.
      forkCamTarget.texture.repeat.set(1, -1)
      forkCamTarget.texture.offset.set(0, 1)
      // Wide and close to level. At 68 degrees pitched 12.6 degrees down the
      // nearby floor filled the whole frame and the feed read as a flat colour;
      // a real fork camera is a wide-angle lens aimed down the blades, showing
      // the tips low in frame and the slot or pallet ahead of them.
      forkCamera = new THREE.PerspectiveCamera(78, 320 / 200, .04, 30)
      // Above the load AND angled down at the tips. Level from up here sees only
      // the aisle; steep from down at blade level sits inside the cartons. From
      // 1.2 m above the blades the tips are 53 degrees down at 0.9 m, so a 30
      // degree pitch puts them low in frame with the slot still above them.
      forkCamera.rotation.x = -.52
      rig.forkCam.add(forkCamera)
      rig.forkCamDisplay.material = new THREE.MeshBasicMaterial({
        map: forkCamTarget.texture, toneMapped: false,
      })
      disposers.push(() => {
        forkCamTarget.dispose()
        rig.forkCamDisplay.material.dispose()
      })
    }
    const renderForkCam = () => {
      if (!forkCamera || renderer.xr.isPresenting) return
      forkCamTick += 1
      if (forkCamTick % 4) return
      // The monitor must not appear in its own feed, and an XR frame has to be
      // suspended before rendering a non-XR camera to an offscreen target.
      const xrWasEnabled = renderer.xr.enabled
      rig.forkCamDisplay.visible = false
      renderer.xr.enabled = false
      renderer.setRenderTarget(forkCamTarget)
      renderer.render(scene, forkCamera)
      renderer.setRenderTarget(null)
      renderer.xr.enabled = xrWasEnabled
      rig.forkCamDisplay.visible = true
    }
    const steerSweep = Math.PI * (STEER_LOCK_TO_LOCK[profile.family] ?? 1)
    const state = {
      x: 0, z: 11.5, heading: 0, speed: 0, steer: 0, fork: 0, reach: 0, tilt: 0, sideshift: 0,
      // `steer` stays the normalized control position that drives the wheel and
      // tiller meshes. `steerAngle` is the real steered-wheel angle in radians
      // that the kinematics integrate. They are not interchangeable.
      steerAngle: 0, previousForwardSpeed: 0, yawRate: 0, turnRadius: Infinity,
      forwardSpeed: 0, smoothedAccel: 0, stabilityLowSince: 0,
      load: 0, horn: false, presence: !requiresPresence, presenceLatched: false, viewYaw: 0, viewPitch: defaultViewPitch, lastTelemetry: 0,
      eventLocks: {}, keys: new Set(), pointerDrags: new Map(), lookDrags: new Map(), xrDrags: new Map(), hovered: null,
      modifierHeld: false, squeezePresenceSources: new Set(), utilityButtons: new Map(),
    }
    let loadPhysics = null
    let applyHydraulicValues = () => {}
    let captureHydraulicConfiguration = () => ({ values: {}, colliders: [] })
    let commitHydraulicConfiguration = () => {}
    let activeXRSession = null
    let xrSessionEnd = null
    let xrVisibilityChange = null
    let xrInputSourcesChange = null
    let activeFloorTracked = true
    let clearInteractions = () => {}
    let audioContext = null
    const setShadowMapSize = (size) => {
      if (sun.shadow.mapSize.x === size && sun.shadow.mapSize.y === size) return
      sun.shadow.mapSize.set(size, size)
      if (sun.shadow.map) {
        sun.shadow.map.dispose()
        sun.shadow.map = null
      }
    }
    const xrPanel = createXRStatusPanel()
    camera.add(xrPanel.mesh)
    disposers.push(() => xrPanel.dispose())
    const updateXRPanel = (message = 'Controls released') => {
      const session = activeXRSession || renderer.xr.getSession()
      xrPanel.update({
        inputCount: session?.inputSources?.length || 0,
        floorTracked: activeFloorTracked,
        message,
      })
    }
    const removeXRSessionListeners = () => {
      if (!activeXRSession) return
      if (xrSessionEnd) activeXRSession.removeEventListener('end', xrSessionEnd)
      if (xrVisibilityChange) activeXRSession.removeEventListener('visibilitychange', xrVisibilityChange)
      if (xrInputSourcesChange) activeXRSession.removeEventListener('inputsourceschange', xrInputSourcesChange)
      xrSessionEnd = null
      xrVisibilityChange = null
      xrInputSourcesChange = null
    }
    const restoreDesktopCamera = () => {
      removeXRSessionListeners()
      activeXRSession = null
      xrPanel.mesh.visible = false
      setShadowMapSize(DESKTOP_SHADOW_MAP_SIZE)
      xrOrigin.position.copy(xrOriginRestPosition)
      desktopCameraMount.add(camera)
      camera.position.set(0, 0, 0)
      state.viewYaw = 0
      state.viewPitch = defaultViewPitch
      camera.rotation.set(defaultViewPitch, 0, 0)
    }
    const prepareXR = (session, floorTracked = true) => {
      if (activeXRSession) restoreDesktopCamera()
      clearInteractions('Entering VR, controls released')
      state.viewYaw = 0
      state.viewPitch = 0
      activeFloorTracked = floorTracked
      renderer.xr.setFramebufferScaleFactor(PROVISIONAL_QUEST_RENDER_TIER.framebufferScaleFactor)
      setShadowMapSize(PROVISIONAL_QUEST_RENDER_TIER.shadowMapSize)
      // Must be set before setSession, or three.js requests the wrong space.
      renderer.xr.setReferenceSpaceType(floorTracked ? 'local-floor' : 'local')
      xrOrigin.position.copy(xrOriginRestPosition)
      xrOrigin.position.y = xrOriginHeight(xrOriginRestPosition.y, floorTracked, FALLBACK_XR_EYE_HEIGHT[profile.family])
      xrOrigin.add(camera)
      // With a floor-relative space the headset's own tracked height supplies
      // eye height above the compartment floor, so the origin needs no offset.
      // Plain `local` puts the origin wherever the head was when the session
      // began, so the authored anthropometric eye height has to stand in.
      camera.position.set(0, 0, 0)
      camera.rotation.set(0, 0, 0)
      activeXRSession = session
      xrPanel.mesh.visible = true
      updateXRPanel('Hold squeeze for the training presence proxy')
      xrSessionEnd = () => {
        clearInteractions('XR session ended, controls released')
        restoreDesktopCamera()
        if (!disposed) {
          runningRef.current = false
          previousRunningRef.current = false
          onRunningChange(false)
          if (graphicsContextLost) {
            setLifecycle('failed', { message: 'Graphics context lost', error: 'The GPU context was lost. Waiting for browser recovery.' })
          } else {
            setLifecycle('ready', { message: 'Simulator ready' })
          }
        }
      }
      xrVisibilityChange = () => {
        simulationAccumulator = 0
        timer.reset()
        if (session.visibilityState === 'visible') {
          updateXRPanel('XR visible. Re-engage all controls')
          return
        }
        clearInteractions(`XR ${session.visibilityState || 'visibility'} state, controls released`)
        updateXRPanel('Tracking paused. Re-engage all controls')
      }
      xrInputSourcesChange = (event) => {
        const removedCount = releaseRemovedXRInputSources(
          state,
          event.removed,
          (controller) => endXRInteraction(controller, 'XR input removed, control released'),
        )
        refreshXRPresence('XR input removed, presence released')
        updateXRPanel(removedCount ? 'Input removed. Re-engage all controls' : 'Input source ready')
      }
      session.addEventListener('end', xrSessionEnd, { once: true })
      session.addEventListener('visibilitychange', xrVisibilityChange)
      session.addEventListener('inputsourceschange', xrInputSourcesChange)
    }
    const updatePresence = (engaged, label = engaged ? 'Presence control engaged' : 'Presence control released') => {
      state.presenceLatched = engaged
      state.presence = !requiresPresence || engaged
      setPresence(state.presence)
      setActiveControl(label)
      if (presenceControl?.material?.emissive) {
        presenceControl.userData.baseEmissive = engaged ? 0x123822 : 0x30110d
        presenceControl.material.emissive.setHex(presenceControl.userData.baseEmissive)
      }
    }
    const reset = () => {
      clearInteractions('Simulator reset, controls released')
      Object.assign(state, {
        x: 0, z: 11.5, heading: 0, speed: 0, steer: 0, fork: 0, reach: 0, tilt: 0, sideshift: 0, load: 0,
        steerAngle: 0, previousForwardSpeed: 0, yawRate: 0, turnRadius: Infinity,
        forwardSpeed: 0, smoothedAccel: 0, stabilityLowSince: 0,
        viewYaw: 0, viewPitch: defaultViewPitch,
      })
      simulationAccumulator = 0
      state.eventLocks = {}
      rig.root.position.set(0, 0, 11.5)
      rig.root.rotation.y = 0
      if (rig.carriage) {
        const rest = rig.carriage.userData.rest
        rig.carriage.position.y = (rest?.y || 0) - forkClearance
        rig.carriage.position.x = rest?.x || 0
      }
      if (rig.reachGroup) rig.reachGroup.position.z = rig.reachGroup.userData.rest?.z || 0
      if (rig.tiltGroup) rig.tiltGroup.rotation.x = 0
      else if (rig.mast) rig.mast.rotation.x = 0
      if (rig.tillerPivot) rig.tillerPivot.rotation.y = 0
      if (rig.steerPivot) rig.steerPivot.rotation.y = 0
      if (rig.travelPivot) rig.travelPivot.rotation.x = 0
      if (rig.liftPivot) rig.liftPivot.rotation.x = 0
      if (rig.tiltPivot) rig.tiltPivot.rotation.x = 0
      if (rig.reachPivot) rig.reachPivot.rotation.z = 0
      if (rig.sideshiftPivot) rig.sideshiftPivot.rotation.z = 0
      if (rig.secondaryTravelPivot) rig.secondaryTravelPivot.rotation.x = 0
      if (rig.wheelPivot) rig.wheelPivot.rotation.z = 0
      if (rig.levers) rig.levers.forEach((lever) => { lever.rotation.x = lever.userData.restRX ?? -.18 })
      if (presenceControl) presenceControl.position.y = presenceControl.userData.restY
      if (brakeControl) brakeControl.position.y = brakeControl.userData.restY
      rig.wheelArticulation?.reset()
      rig.root.updateMatrixWorld(true)
      if (!renderer.xr.isPresenting) camera.rotation.set(defaultViewPitch, 0, 0)
      loadPhysics?.reset()
      applyHydraulicValues(state)
      commitHydraulicConfiguration()
      setStability(100)
    }
    const recenterXR = () => {
      if (!renderer.xr.isPresenting || typeof XRRigidTransform === 'undefined') return false
      const referenceSpace = renderer.xr.getReferenceSpace()
      if (!referenceSpace?.getOffsetReferenceSpace) return false
      const xrCamera = renderer.xr.getCamera(camera)
      const headPosition = new THREE.Vector3()
      const headQuaternion = new THREE.Quaternion()
      const originQuaternion = new THREE.Quaternion()
      xrCamera.getWorldPosition(headPosition)
      xrCamera.getWorldQuaternion(headQuaternion)
      xrOrigin.getWorldQuaternion(originQuaternion)
      xrOrigin.worldToLocal(headPosition)
      headQuaternion.premultiply(originQuaternion.invert())
      const yaw = new THREE.Euler().setFromQuaternion(headQuaternion, 'YXZ').y
      const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      const offset = new XRRigidTransform(
        { x: headPosition.x, y: 0, z: headPosition.z },
        { x: yawQuaternion.x, y: yawQuaternion.y, z: yawQuaternion.z, w: yawQuaternion.w },
      )
      renderer.xr.setReferenceSpace(referenceSpace.getOffsetReferenceSpace(offset))
      clearInteractions('XR view recentered, controls released')
      updateXRPanel('View recentered. Re-engage controls')
      return true
    }
    const exitXR = async () => {
      engine.xrRequestCancelled = true
      const session = activeXRSession || renderer.xr.getSession()
      if (!session) {
        if (engine.xrRequest) setLifecycle('xr-ending', { message: 'Cancelling immersive request' })
        return Boolean(engine.xrRequest)
      }
      setLifecycle('xr-ending', { message: 'Ending immersive session' })
      clearInteractions('Exiting VR, controls released')
      try {
        await session.end()
      } catch (error) {
        setLifecycle('xr-running', { message: 'Immersive session is still running', error: error.message })
        updateXRPanel('Exit failed. Use the headset system menu')
        throw error
      }
      return true
    }
    const engine = {
      renderer,
      reset,
      state,
      rig,
      prepareXR,
      restoreDesktopCamera,
      recenterXR,
      exitXR,
      ready: false,
      xrRequest: null,
      xrRequestCancelled: false,
      isDisposed: () => disposed,
      activeXRSession: () => activeXRSession,
      focusDesktop: () => mount.focus({ preventScroll: true }),
      startDesktop: () => {
        if (!engine.ready || renderer.xr.isPresenting) return false
        clearInteractions('Engage the physical presence control')
        runningRef.current = true
        previousRunningRef.current = true
        onRunningChange(true)
        requestAnimationFrame(() => mount.focus({ preventScroll: true }))
        return true
      },
      clearInteractions: (...args) => clearInteractions(...args),
      setLifecycle,
      markXRRunning: () => {
        renderer.xr.setFoveation(PROVISIONAL_QUEST_RENDER_TIER.foveation)
        xrPanel.mesh.visible = true
        updateXRPanel('Inputs ready. Hold squeeze for presence proxy')
        setLifecycle('xr-running', { message: 'Immersive session running', floorTracked: activeFloorTracked })
      },
    }
    engineRef.current = engine
    updatePresence(false, runningRef.current ? 'Engage the physical presence control' : 'Cab controls armed')

    let hornVoice = null
    let hornStartPending = false
    let hornRequested = false
    let hornAudioFailed = false
    const stopHorn = () => {
      hornRequested = false
      const voice = hornVoice
      hornVoice = null
      if (!voice) return
      const now = voice.context.currentTime
      try {
        voice.gain.gain.cancelScheduledValues(now)
        voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, .001), now)
        voice.gain.gain.exponentialRampToValueAtTime(.001, now + .025)
        voice.oscillator.stop(now + .03)
      } catch {
        voice.oscillator.disconnect()
        voice.gain.disconnect()
      }
    }
    const soundHorn = async () => {
      hornRequested = true
      if (!audioRef.current) {
        stopHorn()
        return
      }
      if (hornAudioFailed || hornVoice || hornStartPending) return
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return
      hornStartPending = true
      try {
        if (!audioContext) audioContext = new AudioContextClass()
        if (audioContext.state === 'suspended') await audioContext.resume().catch(() => {})
        if (disposed || !hornRequested || !audioRef.current || audioContext.state === 'closed') return
        const oscillator = audioContext.createOscillator()
        const gain = audioContext.createGain()
        oscillator.type = 'square'
        oscillator.frequency.value = profile.family === 'pallet' ? 410 : 330
        gain.gain.setValueAtTime(.055, audioContext.currentTime)
        oscillator.connect(gain).connect(audioContext.destination)
        const voice = { context: audioContext, oscillator, gain }
        hornVoice = voice
        oscillator.addEventListener('ended', () => {
          oscillator.disconnect()
          gain.disconnect()
          if (hornVoice === voice) hornVoice = null
        }, { once: true })
        oscillator.start()
      } catch (error) {
        hornAudioFailed = true
        stopHorn()
        console.warn('ProLTO: horn audio unavailable for this session', error)
      } finally {
        hornStartPending = false
      }
    }
    const fireEvent = (type, label, severity = 'minor', deduction = 4, cooldown = 7000) => {
      const now = performance.now()
      if ((state.eventLocks[type] || 0) > now) return
      state.eventLocks[type] = now + cooldown
      onSafetyEvent({ type, label, severity, deduction })
    }
    const forkConfiguration = forkConfigurationForProfile(profile, rig)
    loadPhysics = createWarehouseLoadPhysics({
      truckRoot: rig.root,
      ...forkConfiguration,
      truckColliders: truckColliders(profile, rig),
      pallets: warehouse.pallets,
      rackSlots: warehouse.rackSlots,
      obstacles: [...warehouse.staticColliders, ...warehouse.cones, ...warehouse.pedestrians],
      onEvent: (event) => {
        const assessment = contactAssessment(event)
        if (assessment) {
          fireEvent(assessment.type, assessment.label, assessment.severity, assessment.deduction, assessment.cooldown)
          setActiveControl(assessment.activeControl)
        } else if (event.type === 'pallet-engaged') {
          state.load = event.pallet.weight
          setActiveControl(`${Math.round(event.pallet.weight).toLocaleString()} lb pallet engaged`)
        } else if (event.type === 'pallet-racked') {
          state.load = 0
          setActiveControl(`Pallet placed in ${event.slot.id}`)
        } else if (event.type === 'pallet-grounded') {
          state.load = 0
          setActiveControl('Pallet placed on warehouse floor')
        } else if (event.type === 'cone-contact') {
          fireEvent('cone-contact', 'Safety cone struck', 'major', 8, 2500)
          setActiveControl('Safety cone contact')
        } else if (event.type === 'load-pushed') {
          // Fires while contact persists, so the cooldown does the throttling.
          fireEvent('load-pushed', `Load pushed ${event.distance.toFixed(1)} m across the floor instead of carried`, 'major', 8, 6000)
          setActiveControl('Pushing load across the floor')
        } else if (event.type === 'load-contact') {
          fireEvent('load-contact', 'Hard contact with palletized load', 'major', 10, 2500)
          setActiveControl('Pallet contact')
        } else if (event.type === 'facility-contact') {
          const label = event.obstacle.label || (event.obstacle.kind === 'rack' ? 'pallet rack' : 'warehouse fixture')
          fireEvent('facility-contact', `Contact with ${label}`, 'critical', 18, 2500)
          setActiveControl(`Facility contact: ${label}`)
        }
      },
    })
    // Live handle on the normalized carriage-face collider so the frame loop
    // can move it with lift and reach.
    const carriageFace = loadPhysics.truckColliders.find((entry) => entry.id === CARRIAGE_FACE_ID) || null
    const platformColliderMetrics = (() => {
      if (profile.family !== 'order-picker') return null
      if (!rig.platform) throw new Error(`${profile.assetId} has no dynamic order-picker platform`)
      rig.root.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(rig.platform)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      const origin = rig.platform.getWorldPosition(new THREE.Vector3())
      const centerLocal = rig.platform.worldToLocal(center.clone())
      if (![size.x, size.y, size.z, centerLocal.x, centerLocal.z].every(Number.isFinite)
        || size.x <= 0 || size.y <= 0 || size.z <= 0) {
        throw new Error(`${profile.assetId} has invalid dynamic platform bounds`)
      }
      return {
        centerLocal,
        halfWidth: size.x * .5,
        halfLength: size.z * .5,
        minYOffset: bounds.min.y - origin.y,
        maxYOffset: bounds.max.y - origin.y,
      }
    })()

    applyHydraulicValues = (values) => {
      if (rig.carriage) {
        const rest = rig.carriage.userData.rest
        rig.carriage.position.y = (rest?.y || 0) + values.fork * INCH - forkClearance
        rig.carriage.position.x = (rest?.x || 0) + values.sideshift
      }
      if (rig.reachGroup) rig.reachGroup.position.z = (rig.reachGroup.userData.rest?.z || 0) - values.reach * INCH
      const tiltRadians = THREE.MathUtils.degToRad(values.tilt)
      if (rig.tiltGroup) rig.tiltGroup.rotation.x = tiltRadians
      else if (rig.mast) rig.mast.rotation.x = tiltRadians
      if (carriageFace) {
        const sine = Math.sin(tiltRadians)
        const cosine = Math.cos(tiltRadians)
        const halfHeight = BACKREST_HEIGHT * .5
        carriageFace.offsetX = values.sideshift
        carriageFace.offsetZ = rig.forkMetrics.heelZ - values.reach * INCH + sine * halfHeight
        carriageFace.halfLength = Math.abs(sine) * halfHeight + Math.abs(cosine) * .07
        const centerY = values.fork * INCH + cosine * halfHeight
        const verticalHalf = Math.abs(cosine) * halfHeight + Math.abs(sine) * .07
        carriageFace.minY = centerY - verticalHalf
        carriageFace.maxY = centerY + verticalHalf
      }
      rig.root.updateMatrixWorld(true)
      loadPhysics?.syncCarriedPallet()
    }

    captureHydraulicConfiguration = (values = state) => {
      const truckPose = { x: state.x, z: state.z, heading: state.heading }
      const colliders = []
      if (carriageFace) colliders.push(colliderAtPose(truckPose, carriageFace))
      colliders.push(...forkTineCollidersForFrame(
        forkConfiguration.forkFrame,
        forkConfiguration.forkSpecification,
        { idPrefix: 'truck-fork' },
      ))
      const carried = loadPhysics.carriedCollider()
      if (carried) colliders.push(colliderAtPose(truckPose, carried))
      if (platformColliderMetrics) {
        const origin = rig.platform.getWorldPosition(new THREE.Vector3())
        const center = rig.platform.localToWorld(platformColliderMetrics.centerLocal.clone())
        colliders.push({
          id: 'elevated-operator-platform',
          x: center.x,
          z: center.z,
          halfWidth: platformColliderMetrics.halfWidth,
          halfLength: platformColliderMetrics.halfLength,
          heading: state.heading,
          minY: origin.y + platformColliderMetrics.minYOffset,
          maxY: origin.y + platformColliderMetrics.maxYOffset,
        })
      }
      return {
        values: {
          fork: values.fork,
          reach: values.reach,
          tilt: values.tilt,
          sideshift: values.sideshift,
        },
        colliders,
      }
    }
    commitHydraulicConfiguration = () => {
      loadPhysics.commitHydraulicConfiguration(captureHydraulicConfiguration(state))
    }
    applyHydraulicValues(state)
    commitHydraulicConfiguration()
    engineRef.current.loadPhysics = loadPhysics

    const desktopInputActive = () => (
      runningRef.current
      && !renderer.xr.isPresenting
      && document.activeElement === mount
    )
    const refreshDesktopPresence = (releasedLabel = 'Desktop presence control released') => {
      const pointerHeld = [...state.pointerDrags.values()].some((drag) => drag.presenceOnly)
      const keyboardHeld = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight')
      updatePresence(
        desktopPresenceHeld(state.keys, state.pointerDrags),
        pointerHeld
          ? 'Modeled desktop presence control held'
          : keyboardHeld
            ? 'Keyboard training presence held'
            : releasedLabel,
      )
    }
    const keyDown = (event) => {
      if (!desktopInputActive() || isNativeInteractiveTarget(event.target)) return
      if (!DESKTOP_OPERATION_KEYS.has(event.code)) return
      state.keys.add(event.code)
      event.preventDefault()
      if (event.code === 'Space' && !event.repeat) soundHorn()
      if (event.code === 'Home') {
        state.viewYaw = 0
        state.viewPitch = defaultViewPitch
        camera.rotation.set(defaultViewPitch, 0, 0)
        setActiveControl('Operator view centered')
      }
      if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && requiresPresence && !event.repeat) {
        refreshDesktopPresence()
      }
    }
    const keyUp = (event) => {
      state.keys.delete(event.code)
      if ((event.code === 'ShiftLeft' || event.code === 'ShiftRight') && requiresPresence) {
        refreshDesktopPresence('Keyboard training presence released')
      }
    }
    const focusLost = () => clearInteractions('Simulator focus lost, controls released')
    const windowBlur = () => {
      simulationAccumulator = 0
      clearInteractions('Window focus lost, controls released')
    }
    const documentVisibility = () => {
      if (document.hidden) {
        simulationAccumulator = 0
        clearInteractions('Document hidden, controls released')
      }
    }
    mount.addEventListener('keydown', keyDown)
    mount.addEventListener('keyup', keyUp)
    mount.addEventListener('blur', focusLost)
    window.addEventListener('blur', windowBlur)
    document.addEventListener('visibilitychange', documentVisibility)

    const pointerCoordinates = (event) => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }
    const pickControl = (event) => {
      pointerCoordinates(event)
      raycaster.setFromCamera(pointer, camera)
      return raycaster.intersectObjects(interactables, false)[0]?.object || null
    }
    const setHovered = (object) => {
      if (state.hovered === object) return
      if (state.hovered?.material?.emissive) state.hovered.material.emissive.setHex(state.hovered.userData.baseEmissive || 0)
      state.hovered = object
      renderer.domElement.style.cursor = object ? 'grab' : 'crosshair'
      if (object?.material?.emissive) object.material.emissive.setHex(0x6b4700)
    }
    const releaseControl = (object) => {
      if (!object) return
      const control = object.userData.control
      if (!control) return
      const springs = control.spring || ['horn', 'belly', 'brake'].includes(control.action)
      if (springs) {
        manual[control.action] = 0
        // A spring-centred part returns on BOTH of its axes at once.
        if (control.action2) manual[control.action2] = 0
        if (control.shift2) manual[control.shift2] = 0
      }
      if (control.action === 'horn') {
        state.horn = false
        stopHorn()
      }
    }
    const setModifierHeld = (held) => {
      state.modifierHeld = applyModifierTransition(
        manual,
        [...state.pointerDrags.values(), ...state.xrDrags.values()],
        held,
      )
    }
    const endXRInteraction = (controller, label) => {
      const drag = state.xrDrags.get(controller)
      if (!drag) return
      if (drag.modifierOnly) {
        state.xrDrags.delete(controller)
        setModifierHeld([...state.pointerDrags.values(), ...state.xrDrags.values()].some((candidate) => candidate.modifierOnly))
        if (label) setActiveControl(label)
        return
      }
      if (!drag.presenceOnly) releaseControl(drag.object)
      state.xrDrags.delete(controller)
      if (drag.presenceOnly) {
        refreshXRPresence(label || `${drag.object.userData.control.label} released`)
      } else if (label) setActiveControl(label)
    }
    const refreshXRPresence = (label = 'XR presence released') => {
      const physicalPresenceHeld = [...state.xrDrags.values()].some((candidate) => candidate.presenceOnly)
      const proxyPresenceHeld = state.squeezePresenceSources.size > 0
      const engaged = physicalPresenceHeld || proxyPresenceHeld
      updatePresence(
        engaged,
        engaged
          ? proxyPresenceHeld
            ? 'Accessibility/training squeeze presence proxy held'
            : 'Modeled physical presence control held'
          : label,
      )
    }
    clearInteractions = (label, updateUI = true) => {
      state.xrDrags.forEach((drag) => { if (!drag.presenceOnly && !drag.modifierOnly) releaseControl(drag.object) })
      state.xrDrags.clear()
      state.squeezePresenceSources.clear()
      state.utilityButtons.clear()
      state.pointerDrags.forEach((drag) => { if (!drag.presenceOnly && !drag.modifierOnly) releaseControl(drag.object) })
      state.pointerDrags.clear()
      state.lookDrags.clear()
      state.modifierHeld = false
      state.keys.clear()
      Object.assign(manual, ZERO)
      state.horn = false
      stopHorn()
      state.speed = 0
      state.forwardSpeed = 0
      state.previousForwardSpeed = 0
      state.yawRate = 0
      state.turnRadius = Infinity
      state.smoothedAccel = 0
      simulationAccumulator = 0
      setHovered(null)
      if (updateUI) updatePresence(false, label)
      else {
        state.presenceLatched = false
        state.presence = !requiresPresence
      }
    }
    // A drag axis maps to screen motion: horizontal/radial read X, everything
    // else reads Y. Two orthogonal axes on one part therefore read X and Y of
    // the same drag, which is how a real thumb ball or multi-axis handle works.
    const axisDelta = (motion, event, origin) => (
      ['horizontal', 'radial'].includes(motion)
        ? (event.clientX - origin.x) / 85
        : (origin.y - event.clientY) / 85
    )
    // While a modifier switch is held, a control's secondary action re-maps.
    const secondaryAction = (control) => (
      control.shift2 && state.modifierHeld ? control.shift2 : control.action2
    )
    const pointerDown = (event) => {
      if (!runningRef.current || renderer.xr.isPresenting) return
      mount.focus({ preventScroll: true })
      const object = event.button === 2 ? null : pickControl(event)
      if (object) {
        const modifier = object.userData.modifier
        if (modifier) {
          state.pointerDrags.set(event.pointerId, { object, modifierOnly: true })
          setModifierHeld(true)
          setActiveControl(modifier.label)
          renderer.domElement.setPointerCapture(event.pointerId)
          return
        }
        const control = object.userData.control
        if (control.action === 'presence') {
          setActiveControl(control.label)
          state.pointerDrags.set(event.pointerId, { object, presenceOnly: true })
          refreshDesktopPresence()
          renderer.domElement.setPointerCapture(event.pointerId)
          return
        }
        const scale = control.scale ?? 1
        const second = secondaryAction(control)
        state.pointerDrags.set(event.pointerId, {
          object, x: event.clientX, y: event.clientY,
          start: (manual[control.action] || 0) * scale,
          start2: second ? (manual[second] || 0) * scale : 0,
          action2: second,
        })
        renderer.domElement.setPointerCapture(event.pointerId)
        setActiveControl(control.label)
        if (['button', 'pedal'].includes(control.axis)) {
          manual[control.action] = scale
          if (control.action === 'horn') { state.horn = true; soundHorn() }
          if (control.action === 'belly') fireEvent('belly-switch', 'Entry Bar safety switch contacted', 'major', 8, 1500)
        }
      } else {
        state.lookDrags.set(event.pointerId, { x: event.clientX, y: event.clientY, yaw: state.viewYaw, pitch: state.viewPitch })
        renderer.domElement.setPointerCapture(event.pointerId)
      }
    }
    const pointerMove = (event) => {
      if (!runningRef.current || renderer.xr.isPresenting) {
        setHovered(null)
        return
      }
      const pointerDrag = state.pointerDrags.get(event.pointerId)
      const lookDrag = state.lookDrags.get(event.pointerId)
      if (pointerDrag) {
        if (pointerDrag.presenceOnly || pointerDrag.modifierOnly) return
        const { object, start, start2, action2 } = pointerDrag
        const control = object.userData.control
        const scale = control.scale ?? 1
        const origin = pointerDrag
        manual[control.action] = clampInput(start + axisDelta(control.motion, event, origin)) * scale
        // The secondary axis is live in the same drag, so an operator can blend
        // travel with lift, or tilt with reach, exactly as the real part allows.
        const live = secondaryAction(control)
        if (live && control.motion2) {
          // Only one function owns the shifted axis at a time: engaging the
          // back switch mid-drag must not leave reach commanded behind it.
          if (live !== action2 && action2) manual[action2] = 0
          if (live === control.action2 && control.shift2) manual[control.shift2] = 0
          manual[live] = clampInput(start2 + axisDelta(control.motion2, event, origin)) * scale
        }
      } else if (lookDrag) {
        const yaw = lookDrag.yaw - (event.clientX - lookDrag.x) * .004
        state.viewYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
        state.viewPitch = THREE.MathUtils.clamp(lookDrag.pitch - (event.clientY - lookDrag.y) * .0035, -1.35, 1.15)
      } else setHovered(pickControl(event))
    }
    const endPointerInteraction = (event, releaseCapture = true, label = null) => {
      const pointerDrag = removePointerDrag(state.pointerDrags, event.pointerId)
      if (pointerDrag && !pointerDrag.presenceOnly && !pointerDrag.modifierOnly) releaseControl(pointerDrag.object)
      state.lookDrags.delete(event.pointerId)
      setModifierHeld([...state.pointerDrags.values(), ...state.xrDrags.values()].some((drag) => drag.modifierOnly))
      if (pointerDrag?.presenceOnly) refreshDesktopPresence(label || 'Modeled desktop presence control released')
      if (label) setActiveControl(label)
      if (releaseCapture && renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
    }
    const pointerUp = (event) => endPointerInteraction(event)
    const pointerCancel = (event) => endPointerInteraction(event, false, 'Pointer cancelled, control released')
    const pointerCaptureLost = (event) => {
      if (state.pointerDrags.has(event.pointerId) || state.lookDrags.has(event.pointerId)) {
        endPointerInteraction(event, false, 'Pointer capture lost, control released')
      }
    }
    const preventMenu = (event) => event.preventDefault()
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointermove', pointerMove)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    renderer.domElement.addEventListener('pointercancel', pointerCancel)
    renderer.domElement.addEventListener('lostpointercapture', pointerCaptureLost)
    renderer.domElement.addEventListener('contextmenu', preventMenu)
    handleReadyContextLoss = () => {
      engine.ready = false
      engine.xrRequestCancelled = true
      clearInteractions('Graphics context lost, controls released')
      runningRef.current = false
      previousRunningRef.current = false
      onRunningChange(false)
      const session = activeXRSession || renderer.xr.getSession()
      session?.end?.().catch?.(() => {})
    }

    const pulseSource = (source, intensity = .35, duration = 24) => {
      if (!renderer.xr.getSession()) return
      try {
        const actuator = source?.gamepad?.hapticActuators?.[0]
        if (actuator?.pulse) {
          const result = actuator.pulse(intensity, duration)
          result?.catch?.(() => {})
          return
        }
        const result = source?.gamepad?.vibrationActuator?.playEffect?.('dual-rumble', {
          duration, strongMagnitude: intensity, weakMagnitude: intensity * .7,
        })
        result?.catch?.(() => {})
      } catch {
        // Haptics are optional and may disappear before input-source cleanup runs.
      }
    }
    const nearControl = (position) => {
      let closest = null
      let closestDistance = .12
      let closestSurfaceArea = Infinity
      const box = new THREE.Box3()
      const size = new THREE.Vector3()
      for (const object of interactables) {
        box.setFromObject(object)
        const distance = box.distanceToPoint(position)
        box.getSize(size)
        const surfaceArea = 2 * (size.x * size.y + size.x * size.z + size.y * size.z)
        const nearer = distance < closestDistance - .001
        const tiedAndSmaller = Math.abs(distance - closestDistance) <= .001 && surfaceArea < closestSurfaceArea
        if (nearer || tiedAndSmaller) {
          closest = object
          closestDistance = distance
          closestSurfaceArea = surfaceArea
        }
      }
      return closest
    }
    // Hands, controllers and grips MUST live in the same space as the camera.
    // three.js writes raw XR reference-space poses into these objects' local
    // transforms, so parenting them to the scene while the camera hangs off
    // xrOrigin -- which rides the truck at (0, 0, 11.5) and moves with it --
    // resolved the hands at the play-space origin while the head was at the
    // truck. In the headset that reads as the controllers floating far out in
    // front, out of reach of every control.
    const xrSpace = xrOrigin
    const hands = [0, 1].map((index) => {
      const hand = renderer.xr.getHand(index)
      xrSpace.add(hand)
      return hand
    })
    const handVisuals = hands.map((hand, index) => createProceduralHandSpheres(hand, index))
    const controllers = [0, 1].map((index) => {
      const controller = renderer.xr.getController(index)
      const grip = renderer.xr.getControllerGrip(index)
      const controllerVisual = createProceduralControllerVisual(index)
      grip.add(controllerVisual)
      xrSpace.add(grip)
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -2.5)]), new THREE.LineBasicMaterial({ color: 0xffad21 }))
      line.visible = false
      controller.add(line)
      xrSpace.add(controller)
      let connectedSource = null
      const interactionPose = (source) => {
        const hand = hands[index]
        const fingertip = hand.joints?.['index-finger-tip']
        if ((source?.hand || hand.visible) && fingertip) return { node: fingertip, root: hand }
        if (source?.gripSpace) return { node: grip, root: grip }
        return { node: controller, root: controller }
      }
      const selectStart = (event) => {
        if (!runningRef.current || !renderer.xr.isPresenting) return
        if (state.xrDrags.has(controller)) endXRInteraction(controller, 'Previous control released')
        const pose = interactionPose(event.data)
        if (!pose.root.visible || !pose.node.visible) return
        const origin = new THREE.Vector3()
        pose.node.getWorldPosition(origin)
        if (![origin.x, origin.y, origin.z].every(Number.isFinite)) return
        let object = nearControl(origin)
        if (!object && assistiveXRRef.current) {
          const rayOrigin = new THREE.Vector3()
          const direction = new THREE.Vector3(0, 0, -1)
          controller.getWorldPosition(rayOrigin)
          direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()))
          raycaster.set(rayOrigin, direction)
          object = raycaster.intersectObjects(interactables, false)[0]?.object
        }
        if (!object) return
        pulseSource(event.data, .28, 18)
        // Grabbing the back switch of a multi-axis handle holds the modifier,
        // which is what re-maps the Crown thumb ball's reach axis to sideshift.
        if (object.userData.modifier) {
          state.xrDrags.set(controller, {
            object, pose: pose.node, poseRoot: pose.root, modifierOnly: true, source: event.data,
          })
          setModifierHeld(true)
          setActiveControl(object.userData.modifier.label)
          return
        }
        if (object.userData.control.action === 'presence') {
          setActiveControl(object.userData.control.label)
          state.xrDrags.set(controller, { object, pose: pose.node, poseRoot: pose.root, presenceOnly: true, source: event.data })
          refreshXRPresence(`${object.userData.control.label} engaged`)
          return
        }
        const frame = object.parent || rig.root
        const localStart = frame.worldToLocal(origin.clone())
        state.xrDrags.set(controller, {
          object,
          frame,
          pose: pose.node,
          poseRoot: pose.root,
          localStart,
          startAngle: Math.atan2(localStart.z, localStart.x),
          start: (manual[object.userData.control.action] || 0) * (object.userData.control.scale ?? 1),
          start2: (manual[secondaryAction(object.userData.control)] || 0) * (object.userData.control.scale ?? 1),
          source: event.data,
          lastDetent: 0,
        })
        setActiveControl(object.userData.control.label)
        if (['button', 'pedal'].includes(object.userData.control.axis)) {
          manual[object.userData.control.action] = object.userData.control.scale ?? 1
          if (object.userData.control.action === 'horn') { state.horn = true; soundHorn() }
          if (object.userData.control.action === 'belly') fireEvent('belly-switch', 'Emergency reverse or Entry Bar switch contacted', 'major', 8, 1500)
        }
      }
      const selectEnd = () => endXRInteraction(controller)
      const squeezeStart = (event) => {
        if (!requiresPresence || !runningRef.current || !renderer.xr.isPresenting) return
        const source = event.data || connectedSource || controller
        state.squeezePresenceSources.add(source)
        refreshXRPresence('Accessibility/training squeeze presence proxy held')
        updateXRPanel('Training presence proxy held. Trigger remains free')
        pulseSource(source, .22, 18)
      }
      const squeezeEnd = (event) => {
        const source = event.data || connectedSource || controller
        state.squeezePresenceSources.delete(source)
        if (connectedSource) state.squeezePresenceSources.delete(connectedSource)
        state.squeezePresenceSources.delete(controller)
        refreshXRPresence('Squeeze presence proxy released')
        updateXRPanel('Presence proxy released')
      }
      const connected = (event) => {
        connectedSource = event.data || null
        updateXRPanel('Input tracked. Re-engage all controls')
      }
      const disconnected = (event) => {
        endXRInteraction(controller, 'XR input disconnected, control released')
        state.squeezePresenceSources.delete(event.data || connectedSource || controller)
        if (connectedSource) state.squeezePresenceSources.delete(connectedSource)
        connectedSource = null
        refreshXRPresence('XR input disconnected, presence released')
        updateXRPanel('Input disconnected. Controls released')
      }
      controller.addEventListener('selectstart', selectStart)
      controller.addEventListener('selectend', selectEnd)
      controller.addEventListener('squeezestart', squeezeStart)
      controller.addEventListener('squeezeend', squeezeEnd)
      controller.addEventListener('connected', connected)
      controller.addEventListener('disconnected', disconnected)
      return { controller, grip, line, controllerVisual, source: () => connectedSource, selectStart, selectEnd, squeezeStart, squeezeEnd, connected, disconnected }
    })

    const readXRAxes = () => {
      if (!renderer.xr.isPresenting || !assistiveXRRef.current) return ZERO
      const sources = [...(renderer.xr.getSession()?.inputSources || [])]
      const left = sources.find((source) => source.handedness === 'left')?.gamepad
      const right = sources.find((source) => source.handedness === 'right')?.gamepad
      const axes = (pad) => pad?.axes?.length >= 4 ? [pad.axes[2], pad.axes[3]] : [pad?.axes?.[0] || 0, pad?.axes?.[1] || 0]
      const [lx, ly] = axes(left)
      const [, ry] = axes(right)
      return { ...ZERO, travel: -ly, steer: lx, lift: -ry }
    }

    let xrExitButtonPending = false
    const readXRUtilityButtons = (time) => {
      if (!renderer.xr.isPresenting || !runningRef.current) return
      const sources = [...(renderer.xr.getSession()?.inputSources || [])]
      sources.forEach((source) => {
        const gamepad = source.gamepad
        if (!gamepad || gamepad.mapping !== 'xr-standard') return
        const previous = state.utilityButtons.get(source) || { stick: false, reset: false, exitSince: 0, exitSent: false }
        const stick = Boolean(gamepad.buttons[3]?.pressed)
        const resetPressed = Boolean(gamepad.buttons[4]?.pressed)
        const exitPressed = Boolean(gamepad.buttons[5]?.pressed)
        if (stick && !previous.stick) recenterXR()
        if (resetPressed && !previous.reset) {
          reset()
          updateXRPanel('Vehicle reset. Re-engage all controls')
        }
        let exitSince = exitPressed ? previous.exitSince || time : 0
        let exitSent = exitPressed ? previous.exitSent : false
        if (exitPressed && !exitSent && !xrExitButtonPending && time - exitSince >= 1250) {
          exitSent = true
          xrExitButtonPending = true
          updateXRPanel('Ending immersive session')
          exitXR().catch((error) => console.warn('ProLTO: XR exit failed', error)).finally(() => { xrExitButtonPending = false })
        }
        state.utilityButtons.set(source, { stick, reset: resetPressed, exitSince, exitSent })
      })
    }

    const timer = new THREE.Timer()
    timer.connect(document)
    disposers.push(() => timer.dispose())
    const xrTrackingPosition = new THREE.Vector3()
    const xrTrackingBox = new THREE.Box3()
    let simulationAccumulator = 0
    renderer.setAnimationLoop((time) => {
      timer.update()
      const elapsed = timer.getDelta()
      if (Number.isFinite(elapsed) && elapsed > 0) simulationAccumulator += elapsed
      const enabled = runningRef.current
      if (renderer.xr.isPresenting) handVisuals.forEach((visual) => visual.update())
      controllers.forEach(({ line }) => { line.visible = renderer.xr.isPresenting && assistiveXRRef.current })
      let proxyTrackingLost = false
      controllers.forEach(({ controller, grip, source }) => {
        const inputSource = source()
        if (inputSource && state.squeezePresenceSources.has(inputSource) && !controller.visible && !grip.visible) {
          state.squeezePresenceSources.delete(inputSource)
          proxyTrackingLost = true
        }
      })
      if (proxyTrackingLost) refreshXRPresence('XR tracking lost, presence proxy released')
      readXRUtilityButtons(time)
      const xr = readXRAxes()
      state.xrDrags.forEach((drag, controller) => {
        if (!drag.poseRoot.visible || !drag.pose.visible) {
          endXRInteraction(controller, 'XR tracking lost, control released')
          return
        }
        const position = xrTrackingPosition
        drag.pose.getWorldPosition(position)
        if (![position.x, position.y, position.z].every(Number.isFinite)) {
          endXRInteraction(controller, 'XR pose invalid, control released')
          return
        }
        const maximumDistance = drag.presenceOnly ? .18 : .42
        if (xrTrackingBox.setFromObject(drag.object).distanceToPoint(position) > maximumDistance) {
          endXRInteraction(controller, 'XR control reach lost, control released')
          return
        }
        if (drag.presenceOnly || drag.modifierOnly) return
        const control = drag.object.userData.control
        if (['button', 'pedal'].includes(control.axis)) return
        const local = drag.frame.worldToLocal(position.clone())
        // Resolve a drag along one mechanical axis of the control's own frame.
        const localDelta = (motion) => {
          if (motion === 'radial') {
            const angle = Math.atan2(local.z, local.x)
            return Math.atan2(Math.sin(angle - drag.startAngle), Math.cos(angle - drag.startAngle)) * 1.6
          }
          if (motion === 'fore-aft') return (drag.localStart.z - local.z) * 4.5
          if (motion === 'horizontal') return (local.x - drag.localStart.x) * 5
          return (local.y - drag.localStart.y) * 5
        }
        const scale = control.scale ?? 1
        const value = clampInput(drag.start + localDelta(control.motion))
        manual[control.action] = value * scale
        const second = secondaryAction(control)
        if (second && control.motion2) {
          if (second !== control.action2 && control.action2) manual[control.action2] = 0
          if (second === control.action2 && control.shift2) manual[control.shift2] = 0
          manual[second] = clampInput(drag.start2 + localDelta(control.motion2)) * scale
        }
        // Neutral is a firmer detent than the intermediate ones, so the hand
        // can find centre without looking. Detent count comes from the asset.
        const steps = Math.max(1, control.detents ?? 2)
        const detent = Math.round(value * steps)
        if (detent !== drag.lastDetent) {
          drag.lastDetent = detent
          pulseSource(drag.source, detent === 0 ? .5 : .22, detent === 0 ? 30 : 16)
        }
      })
      const keyboard = {
        travel: (state.keys.has('KeyW') || state.keys.has('ArrowUp') ? 1 : 0) - (state.keys.has('KeyS') || state.keys.has('ArrowDown') ? 1 : 0),
        steer: (state.keys.has('KeyD') || state.keys.has('ArrowRight') ? 1 : 0) - (state.keys.has('KeyA') || state.keys.has('ArrowLeft') ? 1 : 0),
        lift: (state.keys.has('KeyE') ? 1 : 0) - (state.keys.has('KeyQ') ? 1 : 0),
        reach: (state.keys.has('KeyR') ? 1 : 0) - (state.keys.has('KeyF') ? 1 : 0),
        tilt: (state.keys.has('KeyT') ? 1 : 0) - (state.keys.has('KeyG') ? 1 : 0),
        sideshift: (state.keys.has('KeyC') ? 1 : 0) - (state.keys.has('KeyZ') ? 1 : 0),
        brake: state.keys.has('KeyB') ? 1 : 0,
        horn: state.keys.has('Space') ? 1 : 0,
      }
      const choose = (action) => Math.abs(manual[action]) > .02 ? manual[action] : Math.abs(keyboard[action] || 0) > .02 ? keyboard[action] : xr[action] || 0
      let simulationSteps = 0
      while (simulationAccumulator + SIMULATION_TIME_EPSILON >= FIXED_SIMULATION_STEP && simulationSteps < MAX_SIMULATION_STEPS_PER_FRAME) {
      const dt = FIXED_SIMULATION_STEP
      const requestedTravel = enabled ? choose('travel') : 0
      const requestedHydraulics = enabled ? Math.max(
        Math.abs(choose('lift')),
        Math.abs(choose('reach')),
        Math.abs(choose('tilt')),
        Math.abs(choose('sideshift')),
      ) : 0
      if (requiresPresence && !state.presence && (Math.abs(requestedTravel) > .1 || requestedHydraulics > .1)) fireEvent('presence', 'Operator presence control not engaged', 'major', 10, 5000)
      const permitted = state.presence || !requiresPresence
      const travelInput = permitted ? requestedTravel : 0
      const steerInput = enabled ? choose('steer') : 0
      const liftInput = permitted ? choose('lift') : 0
      const reachInput = profile.family === 'reach' && permitted ? choose('reach') : 0
      const auxiliaryInput = profile.family === 'counterbalance' && permitted ? choose('reach') : 0
      const tiltInput = ['reach', 'counterbalance'].includes(profile.family) && permitted ? choose('tilt') : 0
      const sideshiftInput = ['reach', 'counterbalance'].includes(profile.family) && permitted ? choose('sideshift') : 0
      // Losing required presence or leaving the exercise applies a fail-safe
      // brake on every profile. An explicitly modeled brake is read otherwise.
      const failSafeBrake = !enabled || (requiresPresence && !state.presence)
      const brakeInput = failSafeBrake ? 1 : choose('brake')
      state.horn = enabled && choose('horn') > .2
      if (state.horn) soundHorn()
      else stopHorn()

      // Real steering is rate-limited hydraulics, not an instant snap to lock.
      state.steerAngle = advanceSteerAngle(state.steerAngle, steerInput, steering, dt)
      state.steer = state.steerAngle / steering.maxSteer
      const loadRatio = THREE.MathUtils.clamp(state.load / profile.capacity, 0, 1)
      let ratedSpeed = profile.maxSpeed
      if (profile.family === 'reach' && profile.forksFirstSpeed) {
        const emptySpeed = travelInput >= 0 ? profile.forksFirstSpeed : profile.maxSpeed
        const loadedSpeed = travelInput >= 0 ? profile.loadedForksSpeed : profile.loadedPowerUnitSpeed
        ratedSpeed = THREE.MathUtils.lerp(emptySpeed, loadedSpeed, loadRatio)
      }
      let maxMps = ratedSpeed * .44704
      if (profile.family === 'order-picker') maxMps *= THREE.MathUtils.clamp(1 - (state.fork / profile.maxLift) * .78, .18, 1)
      if (profile.family === 'reach' && state.fork > 120) maxMps *= .48
      if (profile.family === 'counterbalance' && state.fork > 72) maxMps *= .55
      // Front-drive counterbalance trucks retain the same conservative corner
      // speed envelope as before, but it is now an explicit provisional control
      // curve rather than an incorrect consequence of steered-wheel geometry.
      maxMps *= provisionalSteeringSpeedScale(state.steerAngle, steering)
      const targetSpeed = travelInput * maxMps * (profile.forksFirstSpeed ? 1 : travelInput < 0 ? dynamics.reverseScale : 1)
      state.previousForwardSpeed = state.forwardSpeed
      state.speed = advanceDriveSpeed(
        state.speed,
        targetSpeed,
        dynamics,
        dt,
        brakeInput,
        Math.abs(travelInput) >= .02,
      )
      const previousPose = { x: state.x, z: state.z, heading: state.heading }
      // Steered-axle kinematics: the truck pivots about its FIXED axle, so the
      // steered end sweeps outside the turn. See src/sim/vehicleDynamics.js.
      const motion = integrateSteering(previousPose, state.speed, state.steerAngle, steering, dt)
      state.x = motion.x
      state.z = motion.z
      state.heading = motion.heading
      if (state.x < WORLD.minX || state.x > WORLD.maxX || state.z < WORLD.minZ || state.z > WORLD.maxZ) {
        fireEvent('boundary', 'Contact with facility boundary', 'critical', 18)
        state.x = THREE.MathUtils.clamp(state.x, WORLD.minX, WORLD.maxX)
        state.z = THREE.MathUtils.clamp(state.z, WORLD.minZ, WORLD.maxZ)
        state.speed = 0
      }
      const collision = loadPhysics.resolveTruckMotion(
        previousPose,
        { x: state.x, z: state.z, heading: state.heading },
        { speed: state.speed },
      )
      state.x = collision.pose.x
      state.z = collision.pose.z
      state.heading = collision.pose.heading
      if (collision.blocked) state.speed = 0
      const accepted = acceptedMotion(previousPose, collision.pose, steering, dt)
      state.forwardSpeed = accepted.forwardSpeed
      state.yawRate = accepted.yawRate
      state.turnRadius = accepted.radius
      rig.wheelArticulation?.update({
        fromPose: previousPose,
        toPose: collision.pose,
        steerAngle: state.steerAngle,
      })
      let liftRate = dynamics.liftRate
      if (profile.liftEmptyFpm) {
        liftRate = liftInput >= 0
          ? THREE.MathUtils.lerp(profile.liftEmptyFpm, profile.liftLoadedFpm, loadRatio) * .2
          : profile.lowerFpm * .2
      }
      rig.root.position.set(state.x, 0, state.z)
      rig.root.rotation.y = state.heading
      sun.position.set(state.x - 6, 13, state.z + 7)
      sun.target.position.set(state.x, 0, state.z)
      sun.target.updateMatrixWorld()
      const currentHydraulicValues = {
        fork: state.fork,
        reach: state.reach,
        tilt: state.tilt,
        sideshift: state.sideshift,
      }
      applyHydraulicValues(currentHydraulicValues)
      const currentHydraulicConfiguration = captureHydraulicConfiguration(currentHydraulicValues)
      const proposedHydraulicValues = {
        fork: THREE.MathUtils.clamp(state.fork + liftInput * liftRate * dt, 0, profile.maxLift),
        reach: THREE.MathUtils.clamp(state.reach + reachInput * 30 * dt, 0, profile.family === 'reach' ? 42 : 0),
        tilt: THREE.MathUtils.clamp(state.tilt + tiltInput * 4.2 * dt, -(profile.tiltForward ?? 5), profile.tiltBack ?? 9),
        sideshift: THREE.MathUtils.clamp(state.sideshift + sideshiftInput * .48 * dt, -.15, .15),
      }
      const hydraulicMoved = Object.keys(currentHydraulicValues).some(
        (key) => Math.abs(proposedHydraulicValues[key] - currentHydraulicValues[key]) > 1e-9,
      )
      let acceptedHydraulicValues = currentHydraulicValues
      if (hydraulicMoved) {
        applyHydraulicValues(proposedHydraulicValues)
        const proposedHydraulicConfiguration = captureHydraulicConfiguration(proposedHydraulicValues)
        const hydraulicResult = loadPhysics.resolveHydraulicMotion(
          currentHydraulicConfiguration,
          proposedHydraulicConfiguration,
        )
        acceptedHydraulicValues = hydraulicResult.acceptedConfiguration.values
      }
      state.fork = acceptedHydraulicValues.fork
      state.reach = acceptedHydraulicValues.reach
      state.tilt = acceptedHydraulicValues.tilt
      state.sideshift = acceptedHydraulicValues.sideshift
      mount.dataset.forkHeight = String(state.fork)
      applyHydraulicValues(acceptedHydraulicValues)
      if (rig.tillerPivot) rig.tillerPivot.rotation.y = -state.steer * .72
      // Palm discs and steering wheels spin about their column through several
      // full turns; the tiller ARM above is a physical linkage and does not.
      if (rig.steerPivot) rig.steerPivot.rotation.y = -state.steer * steerSweep
      if (rig.travelPivot) rig.travelPivot.rotation.x = travelInput * .16
      // The Crown handle lifts about the same base it travels on, so lift is a
      // separate rotation on a nested pivot rather than a detached thumb wheel.
      if (rig.liftPivot) rig.liftPivot.rotation.x = liftInput * .24
      // Thumb ball: tilt rolls it about X, reach rolls it about Z. Both pivots
      // are nested, so the one ball visibly rolls on two axes at once.
      if (rig.tiltPivot) rig.tiltPivot.rotation.x = tiltInput * .38
      if (rig.reachPivot) rig.reachPivot.rotation.z = -reachInput * .38
      if (rig.sideshiftPivot) rig.sideshiftPivot.rotation.z = -sideshiftInput * .22
      if (rig.secondaryTravelPivot) rig.secondaryTravelPivot.rotation.x = travelInput * .14
      if (rig.wheelPivot) rig.wheelPivot.rotation.z = -state.steer * steerSweep
      if (rig.levers) {
        const values = [liftInput, tiltInput, sideshiftInput, auxiliaryInput]
        rig.levers.forEach((lever, index) => { lever.rotation.x = (lever.userData.restRX ?? -.18) + (values[index] ?? 0) * .25 })
      }
      if (presenceControl) {
        const targetY = presenceControl.userData.restY - (state.presenceLatched ? .025 : 0)
        presenceControl.position.y = THREE.MathUtils.damp(presenceControl.position.y, targetY, 12, dt)
      }
      // A reverse-acting brake pedal sits DOWN while the operator is in
      // position and springs proud of the floorboard the moment they step off.
      if (brakeControl && reverseActingBrake) {
        const targetY = brakeControl.userData.restY - (state.presence ? .022 : 0)
        brakeControl.position.y = THREE.MathUtils.damp(brakeControl.position.y, targetY, 14, dt)
      }
      if (!renderer.xr.isPresenting) {
        camera.rotation.y = state.viewYaw
        camera.rotation.x = state.viewPitch
      }
      scene.updateMatrixWorld(true)
      const loadState = loadPhysics.update(dt)
      state.load = loadState.carriedWeight
      commitHydraulicConfiguration()

      // Travel speed means ground speed, which is what an evaluator is judging.
      // At heavy steer angles that is well below drive wheel speed.
      const speedMph = Math.abs(state.forwardSpeed) / .44704
      if (speedMph > profile.safeSpeed + .15) fireEvent('speed', 'Travel speed above assessment limit', 'minor', 5)
      if (speedMph > 1.2 && state.fork > 18) fireEvent('fork-height', 'Travel with elevated forks', 'major', 10)
      // The steered end sweeps outside the fixed axle's path. Near a rack face
      // that is what actually takes out an upright, so warn on the geometry
      // rather than on a steer-input threshold.
      const tailSwing = tailSwingRadius(state.steerAngle, steering)
      const rackClearance = 5.87 - Math.abs(state.x)
      if (tailSwing > .4 && rackClearance < 2.2 && Math.abs(state.speed) > .3) {
        fireEvent('tail-swing', `Tail swing ${tailSwing.toFixed(2)} m with ${rackClearance.toFixed(1)} m to the rack face`, 'major', 10, 9000)
      }
      warehouse.pedestrians.forEach((person) => { if (person.position.distanceTo(rig.root.position) < 1.9) fireEvent('pedestrian', 'Pedestrian separation breached', 'critical', 20, 10000) })
      if (Math.abs(state.z - 3.2) < 2.4 && Math.abs(state.x) < 3.2 && speedMph > .8 && !state.horn) fireEvent('intersection', 'Blind intersection without horn', 'minor', 5, 12000)
      // Two different switches share the 'belly' action. On a pallet truck the
      // belly switch drives the truck AWAY from the operator. On a Crown reach
      // truck the Entry Bar does the opposite: a foot on it sounds the alarm
      // and brings the truck to a stop (operator manual page 20).
      if (enabled && isBellyControlActive(manual.belly)) {
        if (profile.family === 'pallet') state.speed = advanceDriveSpeed(state.speed, .75, dynamics, dt, 0, true)
        else state.speed = advanceDriveSpeed(state.speed, 0, dynamics, dt, 1, true)
      }

      // Physical stability: combined center of gravity against the truck's real
      // support polygon, displaced by the centrifugal and braking forces acting
      // this frame. See src/sim/stability.js.
      // Frame-to-frame speed deltas are noisy enough that raw acceleration alone
      // made the margin jitter and trip warnings on a truck that was simply
      // driving. Filter it to the timescale a load actually responds on.
      const rawAccel = dt > 1e-4 ? (state.forwardSpeed - state.previousForwardSpeed) / dt : 0
      state.smoothedAccel = THREE.MathUtils.damp(state.smoothedAccel, rawAccel, 5, dt)
      const stabilityResult = solveStability(profile, {
        loadMass: state.load * POUND,
        forkHeight: state.fork * INCH,
        reachExtension: state.reach * INCH,
        tilt: THREE.MathUtils.degToRad(state.tilt),
        sideshift: state.sideshift,
        // Cornering force comes from how fast the truck is actually travelling
        // through the arc, not from how fast the drive wheel is spinning.
        speed: state.forwardSpeed,
        yawRate: state.yawRate,
        turnRadius: state.turnRadius,
        forwardAccel: state.smoothedAccel,
      })
      const warning = stabilityWarning(stabilityResult, {
        reachExtended: state.reach > 4,
        forkHeight: state.fork * INCH,
      })
      // A momentary dip is not a finding. The condition has to persist before it
      // is worth an evaluator's attention, or the stream fills with noise and
      // the real events stop standing out.
      if (warning) {
        if (!state.stabilityLowSince) state.stabilityLowSince = time
        if (time - state.stabilityLowSince > 700) {
          fireEvent(warning.type, warning.label, warning.severity, warning.deduction, 12000)
        }
      } else {
        state.stabilityLowSince = 0
      }
      const stabilityValue = stabilityResult.percent

      if (time - state.lastTelemetry > 100) {
        state.lastTelemetry = time
        setStability(stabilityValue)
        setStabilityState(stabilityResult.margin > .35 ? 'STABLE' : stabilityResult.margin > .18 ? 'CAUTION' : 'CRITICAL')
        onTelemetry({
          speed: speedMph,
          signedSpeed: state.forwardSpeed / .44704,
          fork: state.fork,
          reach: state.reach,
          tilt: state.tilt,
          load: state.load,
          stability: stabilityValue,
          position: { x: state.x, z: state.z },
          heading: state.heading,
          horn: state.horn,
          xr: renderer.xr.isPresenting,
          // Physical readouts an evaluator can actually reason about.
          steerAngle: THREE.MathUtils.radToDeg(state.steerAngle),
          turnRadius: Number.isFinite(state.turnRadius) ? Math.abs(state.turnRadius) : null,
          tailSwing,
          lateralAccel: stabilityResult.lateralAccel,
          lateralMargin: stabilityResult.lateralMargin,
          longitudinalMargin: stabilityResult.longitudinalMargin,
          capacityUtilization: stabilityResult.capacityUtilization,
          ratedCapacity: stabilityResult.ratedCapacity / POUND,
          criticalEdge: stabilityResult.criticalEdge,
        })
      }
      simulationAccumulator = Math.max(0, simulationAccumulator - FIXED_SIMULATION_STEP)
      simulationSteps += 1
      }
      // View input and rendering run at display cadence; physical state advances
      // only in deterministic 90 Hz quanta. Any catch-up remainder stays in the
      // accumulator for the next frame instead of being silently discarded.
      if (!renderer.xr.isPresenting) {
        camera.rotation.y = state.viewYaw
        camera.rotation.x = state.viewPitch
      }
      renderForkCam()
      renderer.render(scene, camera)
    })

    disposers.push(() => {
      const session = activeXRSession || renderer.xr.getSession()
      removeXRSessionListeners()
      activeXRSession = null
      clearInteractions('XR session closed', false)
      try {
        session?.end()?.catch?.(() => {})
      } catch {
        // A session that is already ending needs no additional cleanup.
      }
      mount.removeEventListener('keydown', keyDown)
      mount.removeEventListener('keyup', keyUp)
      mount.removeEventListener('blur', focusLost)
      window.removeEventListener('blur', windowBlur)
      document.removeEventListener('visibilitychange', documentVisibility)
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerCancel)
      renderer.domElement.removeEventListener('lostpointercapture', pointerCaptureLost)
      renderer.domElement.removeEventListener('contextmenu', preventMenu)
      renderer.domElement.removeEventListener('webglcontextlost', webglContextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', webglContextRestored)
      controllers.forEach(({ controller, grip, line, controllerVisual, selectStart, selectEnd, squeezeStart, squeezeEnd, connected, disconnected }) => {
        controller.removeEventListener('selectstart', selectStart)
        controller.removeEventListener('selectend', selectEnd)
        controller.removeEventListener('squeezestart', squeezeStart)
        controller.removeEventListener('squeezeend', squeezeEnd)
        controller.removeEventListener('connected', connected)
        controller.removeEventListener('disconnected', disconnected)
        controller.parent?.remove(controller)
        grip.parent?.remove(grip)
        line.geometry.dispose()
        line.material.dispose()
        controllerVisual.userData.dispose?.()
      })
      hands.forEach((hand, index) => {
        handVisuals[index].dispose()
        hand.parent?.remove(hand)
      })
      camera.remove(xrPanel.mesh)
      disposeOwnedRig()
      if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {})
    })
    engine.ready = true
    setLifecycle('ready', { message: 'Simulator ready' })
    }).catch((error) => {
      if (disposed) return
      assetAbortController.abort(error)
      engineRef.current = null
      disposeOwnedRig()
      if (graphicsContextLost) return
      setActiveControl('Simulator failed to initialize')
      setLifecycle('failed', { message: 'Simulator failed to initialize', error: error.message, code: error.code || null })
      console.error('ProLTO simulator init failed:', error)
    })

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(mount)
    return () => {
      disposed = true
      renderer.setAnimationLoop(null)
      assetAbortController.abort()
      if (engineRef.current) {
        engineRef.current.ready = false
        engineRef.current.xrRequestCancelled = true
      }
      observer.disconnect()
      renderer.domElement.removeEventListener('webglcontextlost', webglContextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', webglContextRestored)
      disposers.forEach((dispose) => dispose())
      ownedRig?.root.removeFromParent()
      disposeOwnedRig()
      scene.environment = null
      environmentTarget?.dispose()
      environmentTarget = null
      sun.shadow.map?.dispose()
      sun.shadow.map = null
      disposeObjectResources(scene)
      disposePmrem()
      renderer.dispose()
      renderer.forceContextLoss()
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement)
      engineRef.current = null
    }
  }, [profile, onSafetyEvent, onTelemetry, onRunningChange, contextRevision])

  return (
    <section className={`simulator-shell simulator-${profile.family} ${running ? 'running' : ''}`}>
      <div
        className="simulator-canvas"
        ref={mountRef}
        tabIndex={0}
        role="region"
        aria-label={`${profile.manufacturer} ${profile.model} first-person simulator controls`}
        data-testid="simulator-input-surface"
      />
      <div className="sim-topbar"><span><Crosshair size={15} /> Operator eye view</span><span>{profile.manufacturer} {profile.model}</span><span className={xrSupported ? 'online' : 'offline'}>{xrSupported ? 'Immersive WebXR available' : 'Desktop first-person'}</span></div>
      <div className="machine-status"><span>{profile.stance}</span><strong>{activeControl}</strong><i className={presence ? 'engaged' : ''}>{profile.family === 'pallet' && profile.stance.includes('Walk') ? 'Walkie control zone' : presence ? 'Presence engaged / release held control' : 'Presence released / hold Shift or modeled control'}</i></div>
      {/* Thresholds track src/sim/stability.js: below 35% the solver raises a
          major warning, below 18% a critical one, and 0 is the resultant leaving
          the support polygon. The old 55% cut belonged to the tuned scalar this
          replaced and read CAUTION on a healthy truck. */}
      <div className="stability-meter"><span>Stability</span><div><i style={{ height: `${stability}%` }} /></div><b>{stabilityState}</b></div>
      <div className="sim-reticle" aria-hidden="true"><i /><i /></div>
      <div className="sim-hints">
        <button onClick={() => setGuideOpen((value) => !value)} aria-expanded={guideOpen} aria-controls="simulator-controls-guide"><Keyboard size={17} /> Controls</button>
        <button onClick={() => setAudioOn((value) => !value)} aria-label={audioOn ? 'Mute audio' : 'Enable audio'}>{audioOn ? <Volume2 size={17} /> : <Headphones size={17} />}</button>
        <button onClick={() => engineRef.current?.reset()} aria-label="Reset vehicle"><RotateCcw size={17} /></button>
      </div>
      {guideOpen && <div className="control-guide" id="simulator-controls-guide"><header><Gamepad2 size={18} /><b>{profile.control}</b></header><p><MousePointer2 size={14} /> Drag a visible cab control to manipulate it. A control that moves on two axes responds to both at once, so one drag can blend its functions the way the real part does. Drag empty space, or right-drag, for unrestricted 360-degree inspection. Press Home to center the view.</p><p>Keyboard fallback while this simulator view is focused: hold Shift for training presence, W/S travel, A/D steer, E/Q lift, R/F reach, T/G tilt, Z/C sideshift, B brake, Space horn.</p><p>VR assessment: reach to the modeled physical control, hold trigger or pinch, and move it through its physical axis. A held controller squeeze is available as an accessibility and training presence proxy, so trigger remains free for a handle and the other hand can hold a modifier. This proxy is not qualification-equivalent evidence of modeled deadman operation.</p><p>Quest utility buttons: press the thumbstick to recenter, press A or X to reset, and hold B or Y to exit VR. These do not replace the standard trigger or pinch control pickup.</p><label className="xr-accessibility"><input type="checkbox" checked={assistiveXR} onChange={(event) => setAssistiveXR(event.target.checked)} /> Enable laser and thumbstick accessibility controls</label><small>{profile.guidance}</small></div>}
      {!running && <div className="start-overlay"><MousePointer2 size={24} /><div><strong>First-person practical exercise</strong><span>{engineReady ? controlPrompt(profile) : enginePhase === 'failed' ? 'The simulator could not initialize. Review the readiness error before continuing.' : enginePhase.startsWith('xr-') ? 'Completing the immersive session transition...' : 'Loading the equipment model and control bindings...'}</span></div><button disabled={!engineReady} onClick={() => engineRef.current?.startDesktop()}>{engineReady ? 'Enter operator station' : enginePhase === 'failed' ? 'Simulator unavailable' : 'Loading simulator'}</button></div>}
    </section>
  )
})

export default Simulator
