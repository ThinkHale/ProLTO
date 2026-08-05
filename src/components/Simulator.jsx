import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as THREE from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js'
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js'
import { Crosshair, Gamepad2, Headphones, Keyboard, MousePointer2, RotateCcw, Volume2 } from 'lucide-react'
import { createWarehouseLoadPhysics, forkConfigurationForProfile } from '../sim/loadPhysics.js'
import { controlMeshes, createVehicleRig } from '../sim/vehicleFactory.js'
import { createWarehouse } from '../sim/warehouse.js'
import { advanceSteerAngle, integrateSteering, steerLimits, tailSwingRadius } from '../sim/vehicleDynamics.js'
import { solveStability, stabilityWarning } from '../sim/stability.js'
import { applyFleetSurfacing } from '../sim/surfacing.js'

// Broad fail-safe bounds sit just inside the authored walls. Exact contact is
// resolved by the warehouse wall, column, rack, and fixture colliders below.
const WORLD = { minX: -10.9, maxX: 10.9, minZ: -20.9, maxZ: 18.9 }
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
const DYNAMICS = {
  reach: { acceleration: 2.45, braking: 6.8, liftRate: 30.6, reverseScale: .86 },
  'order-picker': { acceleration: 2.05, braking: 6.4, liftRate: 40, reverseScale: .82 },
  pallet: { acceleration: 3.2, braking: 8.2, liftRate: 4.2, reverseScale: .72 },
  counterbalance: { acceleration: 2.15, braking: 6.1, liftRate: 43, reverseScale: .86 },
}

// Body envelopes stop the power unit and operator compartment while leaving
// the authored forks free to enter a pallet. Walk-behind equipment includes a
// second envelope for the exposed tiller and its operator-side travel arc.
const TRUCK_COLLIDERS = {
  reach: [
    { id: 'power-unit', offsetX: 0, offsetZ: .48, halfWidth: .69, halfLength: .92, minY: 0, maxY: 2.35 },
  ],
  'order-picker': [
    { id: 'operator-platform', offsetX: 0, offsetZ: .43, halfWidth: .57, halfLength: .96, minY: 0, maxY: 2.65 },
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

function truckColliders(profile, rig) {
  if (profile.family !== 'pallet') return TRUCK_COLLIDERS[profile.family]
  return rig.walkie ? TRUCK_COLLIDERS['pallet-walkie'] : TRUCK_COLLIDERS['pallet-rider']
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

const Simulator = forwardRef(function Simulator({ profile, onTelemetry, onSafetyEvent, running, onRunningChange }, ref) {
  const mountRef = useRef(null)
  const engineRef = useRef(null)
  const runningRef = useRef(running)
  const previousRunningRef = useRef(running)
  const audioRef = useRef(true)
  const assistiveXRRef = useRef(false)
  const [xrSupported, setXrSupported] = useState(false)
  const [audioOn, setAudioOn] = useState(true)
  const [assistiveXR, setAssistiveXR] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [activeControl, setActiveControl] = useState('Cab controls armed')
  const [stability, setStability] = useState(100)
  const [presence, setPresence] = useState(false)

  useImperativeHandle(ref, () => ({
    async enterVR() {
      const engine = engineRef.current
      if (!engine || !navigator.xr) return false
      const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'hand-tracking'] })
      engine.prepareXR(session)
      try {
        await engine.renderer.xr.setSession(session)
      } catch (error) {
        engine.restoreDesktopCamera()
        await session.end().catch(() => {})
        throw error
      }
      onRunningChange(true)
      return true
    },
    reset() { engineRef.current?.reset() },
  }))

  useEffect(() => {
    let active = true
    if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then((value) => active && setXrSupported(value)).catch(() => setXrSupported(false))
    return () => { active = false }
  }, [])
  useEffect(() => {
    const wasRunning = previousRunningRef.current
    runningRef.current = running
    if (running && !wasRunning) engineRef.current?.setPresence(false, 'Engage the physical presence control')
    if (!running && wasRunning) engineRef.current?.setPresence(false, 'Operator station exited')
    previousRunningRef.current = running
  }, [running])
  useEffect(() => { audioRef.current = audioOn }, [audioOn])
  useEffect(() => { assistiveXRRef.current = assistiveXR }, [assistiveXR])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
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
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7))
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
    mount.appendChild(renderer.domElement)

    // Image-based lighting: PBR paint/clearcoat on the trucks needs a real
    // environment to reflect, or it reads as flat plastic.
    const pmrem = new THREE.PMREMGenerator(renderer)
    new HDRLoader().load(`${import.meta.env.BASE_URL}env/warehouse_1k.hdr`, (hdr) => {
      scene.environment = pmrem.fromEquirectangular(hdr).texture
      scene.environmentIntensity = .62
      hdr.dispose()
      pmrem.dispose()
    })
    scene.add(new THREE.HemisphereLight(0xe7f3f4, 0x40484b, .8))
    // Key light stands in for the high-bay array: shadows follow the truck so
    // the 2k map stays dense enough to resolve mast and fork shadows.
    const sun = new THREE.DirectionalLight(0xfff4e2, 2.6)
    sun.position.set(-6, 13, 7)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -9
    sun.shadow.camera.right = 9
    sun.shadow.camera.top = 9
    sun.shadow.camera.bottom = -9
    sun.shadow.camera.far = 42
    sun.shadow.bias = -.0006
    sun.shadow.normalBias = .022
    scene.add(sun, sun.target)

    const warehouse = createWarehouse(scene)
    let disposed = false
    const disposers = []
    setActiveControl('Loading equipment model...')
    createVehicleRig(profile).then((rig) => {
    if (disposed) return
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
      forkCamera = new THREE.PerspectiveCamera(68, 320 / 200, .04, 26)
      // Angled down the blades so the fork tips and the pallet face are both in
      // frame, which is what the operator is actually judging.
      forkCamera.rotation.x = -.22
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
      if (!forkCamera) return
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
      steerAngle: 0, previousSpeed: 0, yawRate: 0, turnRadius: Infinity,
      forwardSpeed: 0, smoothedAccel: 0, stabilityLowSince: 0,
      load: 0, horn: false, presence: !requiresPresence, presenceLatched: false, viewYaw: 0, viewPitch: defaultViewPitch, lastTelemetry: 0,
      eventLocks: {}, keys: new Set(), pointerDrag: null, lookDrag: null, xrDrags: new Map(), hovered: null,
      modifierHeld: false, modifierObject: null,
    }
    let loadPhysics = null
    let activeXRSession = null
    let xrSessionEnd = null
    let clearXRInteractions = () => {}
    const restoreDesktopCamera = () => {
      if (activeXRSession && xrSessionEnd) activeXRSession.removeEventListener('end', xrSessionEnd)
      activeXRSession = null
      xrSessionEnd = null
      desktopCameraMount.add(camera)
      camera.position.set(0, 0, 0)
      state.viewYaw = 0
      state.viewPitch = defaultViewPitch
      camera.rotation.set(defaultViewPitch, 0, 0)
    }
    const prepareXR = (session) => {
      if (activeXRSession) restoreDesktopCamera()
      state.viewYaw = 0
      state.viewPitch = 0
      xrOrigin.add(camera)
      camera.position.set(0, 0, 0)
      camera.rotation.set(0, 0, 0)
      activeXRSession = session
      xrSessionEnd = () => {
        clearXRInteractions('XR session ended, controls released')
        restoreDesktopCamera()
        if (!disposed) onRunningChange(false)
      }
      session.addEventListener('end', xrSessionEnd, { once: true })
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
    const togglePresence = () => updatePresence(!state.presenceLatched)
    const reset = () => {
      Object.assign(state, {
        x: 0, z: 11.5, heading: 0, speed: 0, steer: 0, fork: 0, reach: 0, tilt: 0, sideshift: 0, load: 0,
        steerAngle: 0, previousSpeed: 0, yawRate: 0, turnRadius: Infinity,
      forwardSpeed: 0, smoothedAccel: 0, stabilityLowSince: 0,
        viewYaw: 0, viewPitch: defaultViewPitch,
      })
      Object.assign(manual, ZERO)
      state.eventLocks = {}
      rig.root.position.set(0, 0, 11.5)
      rig.root.rotation.y = 0
      camera.rotation.set(defaultViewPitch, 0, 0)
      loadPhysics?.reset()
      updatePresence(false, runningRef.current ? 'Engage the physical presence control' : 'Cab controls armed')
      setStability(100)
    }
    engineRef.current = { renderer, reset, state, rig, setPresence: updatePresence, prepareXR, restoreDesktopCamera }
    updatePresence(false, runningRef.current ? 'Engage the physical presence control' : 'Cab controls armed')

    const soundHorn = () => {
      if (!audioRef.current) return
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass) return
      const context = new AudioContextClass()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'square'
      oscillator.frequency.value = profile.family === 'pallet' ? 410 : 330
      gain.gain.setValueAtTime(.07, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .2)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start()
      oscillator.stop(context.currentTime + .21)
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
        if (event.type === 'pallet-engaged') {
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
    engineRef.current.loadPhysics = loadPhysics

    const keyDown = (event) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      state.keys.add(event.code)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
      if (event.code === 'Space' && !state.horn) soundHorn()
      if (event.code === 'Home') {
        state.viewYaw = 0
        state.viewPitch = defaultViewPitch
        camera.rotation.set(defaultViewPitch, 0, 0)
        setActiveControl('Operator view centered')
      }
      if ((event.code === 'ControlLeft' || event.code === 'ControlRight') && !event.repeat && runningRef.current && requiresPresence) {
        event.preventDefault()
        togglePresence()
      }
    }
    const keyUp = (event) => state.keys.delete(event.code)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)

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
      if (control.action === 'horn') state.horn = false
    }
    const endXRInteraction = (controller, label) => {
      const drag = state.xrDrags.get(controller)
      if (!drag) return
      if (drag.modifierOnly) {
        state.xrDrags.delete(controller)
        state.modifierHeld = [...state.xrDrags.values()].some((candidate) => candidate.modifierOnly)
        if (label) setActiveControl(label)
        return
      }
      if (!drag.presenceOnly) releaseControl(drag.object)
      state.xrDrags.delete(controller)
      if (drag.presenceOnly) {
        const presenceStillHeld = [...state.xrDrags.values()].some((candidate) => candidate.presenceOnly)
        updatePresence(
          presenceStillHeld,
          presenceStillHeld ? 'Another presence control remains engaged' : label || `${drag.object.userData.control.label} released`,
        )
      } else if (label) setActiveControl(label)
    }
    clearXRInteractions = (label, updateUI = true) => {
      state.xrDrags.forEach((drag) => { if (!drag.presenceOnly && !drag.modifierOnly) releaseControl(drag.object) })
      state.xrDrags.clear()
      if (state.pointerDrag?.object) releaseControl(state.pointerDrag.object)
      state.pointerDrag = null
      state.lookDrag = null
      state.modifierHeld = false
      state.modifierObject = null
      state.keys.clear()
      Object.assign(manual, ZERO)
      state.horn = false
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
      const object = event.button === 2 ? null : pickControl(event)
      if (object) {
        const modifier = object.userData.modifier
        if (modifier) {
          state.modifierHeld = true
          state.modifierObject = object
          setActiveControl(modifier.label)
          renderer.domElement.setPointerCapture(event.pointerId)
          return
        }
        const control = object.userData.control
        if (control.action === 'presence') {
          setActiveControl(control.label)
          togglePresence()
          return
        }
        const scale = control.scale ?? 1
        const second = secondaryAction(control)
        state.pointerDrag = {
          object, x: event.clientX, y: event.clientY,
          start: (manual[control.action] || 0) * scale,
          start2: second ? (manual[second] || 0) * scale : 0,
          action2: second,
        }
        renderer.domElement.setPointerCapture(event.pointerId)
        setActiveControl(control.label)
        if (['button', 'pedal'].includes(control.axis)) {
          manual[control.action] = scale
          if (control.action === 'horn') { state.horn = true; soundHorn() }
          if (control.action === 'belly') fireEvent('belly-switch', 'Entry Bar safety switch contacted', 'major', 8, 1500)
        }
      } else {
        state.lookDrag = { x: event.clientX, y: event.clientY, yaw: state.viewYaw, pitch: state.viewPitch }
        renderer.domElement.setPointerCapture(event.pointerId)
      }
    }
    const pointerMove = (event) => {
      if (state.pointerDrag) {
        const { object, start, start2, action2 } = state.pointerDrag
        const control = object.userData.control
        const scale = control.scale ?? 1
        const origin = state.pointerDrag
        manual[control.action] = clampInput(start + axisDelta(control.motion, event, origin)) * scale
        // The secondary axis is live in the same drag, so an operator can blend
        // travel with lift, or tilt with reach, exactly as the real part allows.
        const live = secondaryAction(control)
        if (live && control.motion2) {
          // Only one function owns the shifted axis at a time: engaging the
          // back switch mid-drag must not leave reach commanded behind it.
          if (live !== action2 && action2) manual[action2] = 0
          manual[live] = clampInput(start2 + axisDelta(control.motion2, event, origin)) * scale
        }
      } else if (state.lookDrag) {
        const yaw = state.lookDrag.yaw - (event.clientX - state.lookDrag.x) * .004
        state.viewYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw))
        state.viewPitch = THREE.MathUtils.clamp(state.lookDrag.pitch - (event.clientY - state.lookDrag.y) * .0035, -1.35, 1.15)
      } else setHovered(pickControl(event))
    }
    const pointerUp = (event) => {
      if (state.pointerDrag) releaseControl(state.pointerDrag.object)
      if (state.modifierObject) {
        state.modifierHeld = false
        state.modifierObject = null
      }
      state.pointerDrag = null
      state.lookDrag = null
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
    }
    const preventMenu = (event) => event.preventDefault()
    renderer.domElement.addEventListener('pointerdown', pointerDown)
    renderer.domElement.addEventListener('pointermove', pointerMove)
    renderer.domElement.addEventListener('pointerup', pointerUp)
    renderer.domElement.addEventListener('pointercancel', pointerUp)
    renderer.domElement.addEventListener('contextmenu', preventMenu)

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
    const controllerModelFactory = new XRControllerModelFactory()
    const handModelFactory = new XRHandModelFactory()
    const hands = [0, 1].map((index) => {
      const hand = renderer.xr.getHand(index)
      hand.add(handModelFactory.createHandModel(hand, 'mesh'))
      scene.add(hand)
      return hand
    })
    const controllers = [0, 1].map((index) => {
      const controller = renderer.xr.getController(index)
      const grip = renderer.xr.getControllerGrip(index)
      grip.add(controllerModelFactory.createControllerModel(grip))
      scene.add(grip)
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -2.5)]), new THREE.LineBasicMaterial({ color: 0xffad21 }))
      line.visible = false
      controller.add(line)
      scene.add(controller)
      const interactionPose = (source) => {
        const hand = hands[index]
        const fingertip = hand.joints?.['index-finger-tip']
        if ((source?.hand || hand.visible) && fingertip) return { node: fingertip, root: hand }
        if (source?.gripSpace) return { node: grip, root: grip }
        return { node: controller, root: controller }
      }
      const selectStart = (event) => {
        if (state.xrDrags.has(controller)) endXRInteraction(controller, 'Previous control released')
        const pose = interactionPose(event.data)
        const origin = new THREE.Vector3()
        pose.node.getWorldPosition(origin)
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
          state.modifierHeld = true
          setActiveControl(object.userData.modifier.label)
          state.xrDrags.set(controller, {
            object, pose: pose.node, poseRoot: pose.root, modifierOnly: true, source: event.data,
          })
          return
        }
        if (object.userData.control.action === 'presence') {
          setActiveControl(object.userData.control.label)
          updatePresence(true, `${object.userData.control.label} engaged`)
          state.xrDrags.set(controller, { object, pose: pose.node, poseRoot: pose.root, presenceOnly: true, source: event.data })
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
          if (object.userData.control.action === 'horn') soundHorn()
        }
      }
      const selectEnd = () => endXRInteraction(controller)
      const disconnected = () => endXRInteraction(controller, 'XR input disconnected, control released')
      controller.addEventListener('selectstart', selectStart)
      controller.addEventListener('selectend', selectEnd)
      controller.addEventListener('disconnected', disconnected)
      return { controller, grip, line, selectStart, selectEnd, disconnected }
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

    const timer = new THREE.Timer()
    renderer.setAnimationLoop((time) => {
      timer.update()
      const dt = Math.min(timer.getDelta(), .04)
      const enabled = runningRef.current
      controllers.forEach(({ line }) => { line.visible = renderer.xr.isPresenting && assistiveXRRef.current })
      const xr = readXRAxes()
      state.xrDrags.forEach((drag, controller) => {
        if (drag.presenceOnly) return
        if (!drag.poseRoot.visible) {
          endXRInteraction(controller, 'XR tracking lost, control released')
          return
        }
        const position = new THREE.Vector3()
        drag.pose.getWorldPosition(position)
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
      const requestedTravel = enabled ? choose('travel') : 0
      const requestedHydraulics = enabled ? Math.max(Math.abs(choose('lift')), Math.abs(choose('reach')), Math.abs(choose('tilt'))) : 0
      if (requiresPresence && !state.presence && (Math.abs(requestedTravel) > .1 || requestedHydraulics > .1)) fireEvent('presence', 'Operator presence control not engaged', 'major', 10, 5000)
      const permitted = state.presence || !requiresPresence
      const travelInput = permitted ? requestedTravel : 0
      const steerInput = enabled ? choose('steer') : 0
      const liftInput = permitted ? choose('lift') : 0
      const reachInput = profile.family === 'reach' && permitted ? choose('reach') : 0
      const auxiliaryInput = profile.family === 'counterbalance' && permitted ? choose('reach') : 0
      const tiltInput = ['reach', 'counterbalance'].includes(profile.family) && permitted ? choose('tilt') : 0
      const sideshiftInput = ['reach', 'counterbalance'].includes(profile.family) && permitted ? choose('sideshift') : 0
      // On a reverse-acting brake the commanded value APPLIES the brake, and
      // losing operator presence applies it automatically, which is what
      // actually happens when the operator's foot comes off the pedal.
      const brakeInput = reverseActingBrake
        ? (enabled && state.presence ? choose('brake') : 1)
        : (enabled ? choose('brake') : 0)
      state.horn = enabled && choose('horn') > .2

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
      const targetSpeed = travelInput * maxMps * (profile.forksFirstSpeed ? 1 : travelInput < 0 ? dynamics.reverseScale : 1)
      const damping = brakeInput > .1 || Math.abs(travelInput) < .02 ? dynamics.braking * (1 + brakeInput) : dynamics.acceleration
      state.previousSpeed = state.speed
      state.speed = THREE.MathUtils.damp(state.speed, brakeInput > .1 ? 0 : targetSpeed, damping, dt)
      // Real steering is rate-limited hydraulics, not an instant snap to lock.
      state.steerAngle = advanceSteerAngle(state.steerAngle, steerInput, steering, dt)
      state.steer = state.steerAngle / steering.maxSteer
      const previousPose = { x: state.x, z: state.z, heading: state.heading }
      // Steered-axle kinematics: the truck pivots about its FIXED axle, so the
      // steered end sweeps outside the turn. See src/sim/vehicleDynamics.js.
      const motion = integrateSteering(previousPose, state.speed, state.steerAngle, steering, dt)
      state.x = motion.x
      state.z = motion.z
      state.heading = motion.heading
      state.yawRate = motion.yawRate
      state.turnRadius = motion.radius
      // Forward travel falls away as the wheel is turned toward full lock, so
      // this is not the same number as state.speed (drive wheel speed).
      state.forwardSpeed = motion.forwardSpeed
      if (state.x < WORLD.minX || state.x > WORLD.maxX || state.z < WORLD.minZ || state.z > WORLD.maxZ) {
        fireEvent('boundary', 'Contact with facility boundary', 'critical', 18)
        state.x = THREE.MathUtils.clamp(state.x, WORLD.minX, WORLD.maxX)
        state.z = THREE.MathUtils.clamp(state.z, WORLD.minZ, WORLD.maxZ)
        state.speed *= -.12
      }
      const collision = loadPhysics.resolveTruckMotion(
        previousPose,
        { x: state.x, z: state.z, heading: state.heading },
        { speed: state.speed },
      )
      state.x = collision.pose.x
      state.z = collision.pose.z
      state.heading = collision.pose.heading
      if (collision.blocked) state.speed *= -.08
      let liftRate = dynamics.liftRate
      if (profile.liftEmptyFpm) {
        liftRate = liftInput >= 0
          ? THREE.MathUtils.lerp(profile.liftEmptyFpm, profile.liftLoadedFpm, loadRatio) * .2
          : profile.lowerFpm * .2
      }
      state.fork = THREE.MathUtils.clamp(state.fork + liftInput * liftRate * dt, 0, profile.maxLift)
      state.reach = THREE.MathUtils.clamp(state.reach + reachInput * 30 * dt, 0, profile.family === 'reach' ? 42 : 0)
      state.tilt = THREE.MathUtils.clamp(state.tilt + tiltInput * 4.2 * dt, -(profile.tiltForward ?? 5), profile.tiltBack ?? 9)
      state.sideshift = THREE.MathUtils.clamp(state.sideshift + sideshiftInput * .48 * dt, -.15, .15)
      rig.root.position.set(state.x, 0, state.z)
      rig.root.rotation.y = state.heading
      sun.position.set(state.x - 6, 13, state.z + 7)
      sun.target.position.set(state.x, 0, state.z)
      sun.target.updateMatrixWorld()
      if (rig.carriage) {
        const rest = rig.carriage.userData.rest
        rig.carriage.position.y = (rest?.y || 0) + state.fork * INCH - forkClearance
        rig.carriage.position.x = (rest?.x || 0) + state.sideshift
      }
      if (rig.reachGroup) rig.reachGroup.position.z = (rig.reachGroup.userData.rest?.z || 0) - state.reach * .0254
      if (rig.tiltGroup) rig.tiltGroup.rotation.x = THREE.MathUtils.degToRad(state.tilt)
      else if (rig.mast) rig.mast.rotation.x = THREE.MathUtils.degToRad(state.tilt)
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
      if (rig.driveWheel) rig.driveWheel.rotation.x -= state.speed * dt / .165
      if (rig.loadWheels) rig.loadWheels.forEach((loadWheel) => { loadWheel.rotation.x -= state.speed * dt / .075 })
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
      camera.rotation.y = state.viewYaw
      camera.rotation.x = state.viewPitch
      scene.updateMatrixWorld(true)
      const loadState = loadPhysics.update(dt)
      state.load = loadState.carriedWeight

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
      if (manual.belly > .2) {
        if (profile.family === 'pallet') state.speed = Math.max(state.speed, .75)
        else state.speed = THREE.MathUtils.damp(state.speed, 0, 6.5, dt)
      }

      // Physical stability: combined center of gravity against the truck's real
      // support polygon, displaced by the centrifugal and braking forces acting
      // this frame. See src/sim/stability.js.
      // Frame-to-frame speed deltas are noisy enough that raw acceleration alone
      // made the margin jitter and trip warnings on a truck that was simply
      // driving. Filter it to the timescale a load actually responds on.
      const rawAccel = dt > 1e-4 ? (state.speed - state.previousSpeed) / dt : 0
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
      renderForkCam()
      renderer.render(scene, camera)
    })

    disposers.push(() => {
      const session = activeXRSession || renderer.xr.getSession()
      if (activeXRSession && xrSessionEnd) activeXRSession.removeEventListener('end', xrSessionEnd)
      activeXRSession = null
      xrSessionEnd = null
      clearXRInteractions('XR session closed', false)
      try {
        session?.end()?.catch?.(() => {})
      } catch {
        // A session that is already ending needs no additional cleanup.
      }
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerUp)
      renderer.domElement.removeEventListener('contextmenu', preventMenu)
      controllers.forEach(({ controller, grip, selectStart, selectEnd, disconnected }) => {
        controller.removeEventListener('selectstart', selectStart)
        controller.removeEventListener('selectend', selectEnd)
        controller.removeEventListener('disconnected', disconnected)
        scene.remove(controller)
        scene.remove(grip)
      })
      hands.forEach((hand) => scene.remove(hand))
    })
    }).catch((error) => console.error('ProLTO simulator init failed:', error))

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
      observer.disconnect()
      disposers.forEach((dispose) => dispose())
      renderer.setAnimationLoop(null)
      renderer.dispose()
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement)
      engineRef.current = null
    }
  }, [profile, onSafetyEvent, onTelemetry, onRunningChange])

  return (
    <section className={`simulator-shell simulator-${profile.family} ${running ? 'running' : ''}`}>
      <div className="simulator-canvas" ref={mountRef} />
      <div className="sim-topbar"><span><Crosshair size={15} /> Operator eye view</span><span>{profile.manufacturer} {profile.model}</span><span className={xrSupported ? 'online' : 'offline'}>{xrSupported ? 'WebXR ready' : 'Desktop first-person'}</span></div>
      <div className="machine-status"><span>{profile.stance}</span><strong>{activeControl}</strong><i className={presence ? 'engaged' : ''}>{profile.family === 'pallet' && profile.stance.includes('Walk') ? 'Walkie control zone' : presence ? 'Presence engaged / Control to release' : 'Presence released / Control to engage'}</i></div>
      {/* Thresholds track src/sim/stability.js: below 35% the solver raises a
          major warning, below 18% a critical one, and 0 is the resultant leaving
          the support polygon. The old 55% cut belonged to the tuned scalar this
          replaced and read CAUTION on a healthy truck. */}
      <div className="stability-meter"><span>Stability</span><div><i style={{ height: `${stability}%` }} /></div><b>{stability > 35 ? 'STABLE' : stability > 18 ? 'CAUTION' : 'CRITICAL'}</b></div>
      <div className="sim-reticle" aria-hidden="true"><i /><i /></div>
      <div className="sim-hints">
        <button onClick={() => setGuideOpen((value) => !value)}><Keyboard size={17} /> Controls</button>
        <button onClick={() => setAudioOn((value) => !value)} aria-label={audioOn ? 'Mute audio' : 'Enable audio'}>{audioOn ? <Volume2 size={17} /> : <Headphones size={17} />}</button>
        <button onClick={() => engineRef.current?.reset()} aria-label="Reset vehicle"><RotateCcw size={17} /></button>
      </div>
      {guideOpen && <div className="control-guide"><header><Gamepad2 size={18} /><b>{profile.control}</b></header><p><MousePointer2 size={14} /> Drag a visible cab control to manipulate it. A control that moves on two axes responds to both at once, so one drag can blend its functions the way the real part does. Drag empty space, or right-drag, for unrestricted 360-degree inspection. Press Home to center the view.</p><p>Keyboard fallback: Control toggles presence, W/S travel, A/D steer, E/Q lift, R/F reach, T/G tilt, Z/C sideshift, B brake, Space horn.</p><p>VR assessment: reach to the modeled control, hold trigger or pinch, and move it through its physical axis. Hold the deadman control continuously. Where a control has a modifier switch, grab and hold that switch to shift the control to its second function.</p><label className="xr-accessibility"><input type="checkbox" checked={assistiveXR} onChange={(event) => setAssistiveXR(event.target.checked)} /> Enable laser and thumbstick accessibility controls</label><small>{profile.guidance}</small></div>}
      {!running && <div className="start-overlay"><MousePointer2 size={24} /><div><strong>First-person practical exercise</strong><span>{controlPrompt(profile)}</span></div><button onClick={() => onRunningChange(true)}>Enter operator station</button></div>}
    </section>
  )
})

export default Simulator
