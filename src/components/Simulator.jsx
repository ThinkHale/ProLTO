import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as THREE from 'three'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { Crosshair, Gamepad2, Headphones, Keyboard, MousePointer2, RotateCcw, Volume2 } from 'lucide-react'
import { controlMeshes, createVehicleRig } from '../sim/vehicleFactory.js'
import { createWarehouse } from '../sim/warehouse.js'

const WORLD = { minX: -8.6, maxX: 8.6, minZ: -18, maxZ: 16 }
const ZERO = { travel: 0, steer: 0, lift: 0, reach: 0, tilt: 0, sideshift: 0, brake: 0, horn: 0, presence: 0, belly: 0 }
const DYNAMICS = {
  reach: { acceleration: 2.45, braking: 6.8, turnRate: 1.42, liftRate: 30.6, reverseScale: .86 },
  'order-picker': { acceleration: 2.05, braking: 6.4, turnRate: 1.14, liftRate: 40, reverseScale: .82 },
  pallet: { acceleration: 3.2, braking: 8.2, turnRate: 1.72, liftRate: 4.2, reverseScale: .72 },
  counterbalance: { acceleration: 2.15, braking: 6.1, turnRate: .9, liftRate: 43, reverseScale: .86 },
}

// Resting head pose per family. Stand-up trucks look down into a near console;
// seated and walk-behind operators sit back from theirs.
const VIEWS = {
  reach: { fov: 68, pitch: -.26 },
  'order-picker': { fov: 70, pitch: -.4 },
  pallet: { fov: 72, pitch: -.2 },
  counterbalance: { fov: 70, pitch: -.32 },
}

const clampInput = (value) => THREE.MathUtils.clamp(value, -1, 1)

function controlPrompt(profile) {
  if (profile.family === 'reach') return 'Drag the left steering tiller and right Multi-Task handle. Presence engages when you enter.'
  if (profile.family === 'order-picker') return 'Use the opposing hand controls. The deadman engages on entry, and your eye point rises with the platform.'
  if (profile.family === 'pallet' && profile.stance.includes('Walk')) return 'Drag the tiller head to steer and use either butterfly throttle while staying beside the truck.'
  if (profile.family === 'pallet') return 'Operate the X10 handle from the rider platform. Fork lift is limited to pallet clearance.'
  return 'Turn the wheel, press the pedals, and manipulate each hydraulic lever. Account for rear counterweight swing.'
}

const Simulator = forwardRef(function Simulator({ profile, onTelemetry, onSafetyEvent, running, onRunningChange }, ref) {
  const mountRef = useRef(null)
  const engineRef = useRef(null)
  const runningRef = useRef(running)
  const previousRunningRef = useRef(running)
  const audioRef = useRef(true)
  const [xrSupported, setXrSupported] = useState(false)
  const [audioOn, setAudioOn] = useState(true)
  const [guideOpen, setGuideOpen] = useState(false)
  const [activeControl, setActiveControl] = useState('Cab controls armed')
  const [stability, setStability] = useState(100)
  const [presence, setPresence] = useState(false)

  useImperativeHandle(ref, () => ({
    async enterVR() {
      const engine = engineRef.current
      if (!engine || !navigator.xr) return false
      const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'], optionalFeatures: ['bounded-floor', 'hand-tracking'] })
      await engine.renderer.xr.setSession(session)
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
    if (running && !wasRunning) engineRef.current?.setPresence(true, 'Presence engaged on operator entry')
    if (!running && wasRunning) engineRef.current?.setPresence(false, 'Operator station exited')
    previousRunningRef.current = running
  }, [running])
  useEffect(() => { audioRef.current = audioOn }, [audioOn])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    setActiveControl('Cab controls armed')
    setPresence(false)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x6a7173)
    // Light haze only at the far end of the building — enough for depth without
    // graying out rack faces the operator is judging distance against.
    scene.fog = new THREE.Fog(0x767d7f, 34, 78)
    const view = VIEWS[profile.family]
    const defaultViewPitch = view.pitch
    const camera = new THREE.PerspectiveCamera(view.fov, mount.clientWidth / mount.clientHeight, .035, 90)
    camera.rotation.order = 'YXZ'
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
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

    const { pallet, pedestrians } = createWarehouse(scene)
    let disposed = false
    const disposers = []
    setActiveControl('Loading equipment model…')
    createVehicleRig(profile).then((rig) => {
    if (disposed) return
    setActiveControl('Cab controls armed')
    rig.root.position.set(0, 0, 11.5)
    rig.cameraMount.add(camera)
    scene.add(rig.root)
    const interactables = controlMeshes(rig)
    const presenceControl = interactables.find((object) => object.userData.control.action === 'presence')
    if (presenceControl) presenceControl.userData.restY = presenceControl.position.y
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    const dynamics = DYNAMICS[profile.family]
    const requiresPresence = profile.family !== 'pallet' || !rig.walkie
    const manual = { ...ZERO }
    const state = {
      x: 0, z: 11.5, heading: 0, speed: 0, steer: 0, fork: 0, reach: 0, tilt: 0, sideshift: 0,
      load: 0, horn: false, presence: !requiresPresence || runningRef.current, presenceLatched: runningRef.current, viewYaw: 0, viewPitch: defaultViewPitch, lastTelemetry: 0,
      eventLocks: {}, keys: new Set(), pointerDrag: null, lookDrag: null, xrDrags: new Map(), hovered: null,
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
      Object.assign(state, { x: 0, z: 11.5, heading: 0, speed: 0, steer: 0, fork: 0, reach: 0, tilt: 0, sideshift: 0, load: 0, viewYaw: 0, viewPitch: defaultViewPitch })
      Object.assign(manual, ZERO)
      state.eventLocks = {}
      rig.root.position.set(0, 0, 11.5)
      rig.root.rotation.y = 0
      camera.rotation.set(defaultViewPitch, 0, 0)
      updatePresence(runningRef.current, runningRef.current ? 'Presence engaged after reset' : 'Cab controls armed')
      setStability(100)
    }
    engineRef.current = { renderer, reset, state, rig, setPresence: updatePresence }
    updatePresence(runningRef.current, runningRef.current ? 'Presence engaged on operator entry' : 'Cab controls armed')

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

    const keyDown = (event) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return
      state.keys.add(event.code)
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault()
      if (event.code === 'Space' && !state.horn) soundHorn()
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
      if (control.spring || ['horn', 'belly', 'brake'].includes(control.action)) manual[control.action] = 0
      if (control.action === 'horn') state.horn = false
    }
    const pointerDown = (event) => {
      const object = event.button === 2 ? null : pickControl(event)
      if (object) {
        const control = object.userData.control
        if (control.action === 'presence') {
          setActiveControl(control.label)
          togglePresence()
          return
        }
        state.pointerDrag = { object, x: event.clientX, y: event.clientY, start: manual[control.action] || 0 }
        renderer.domElement.setPointerCapture(event.pointerId)
        setActiveControl(control.label)
        if (['button', 'pedal'].includes(control.axis)) {
          manual[control.action] = 1
          if (control.action === 'horn') { state.horn = true; soundHorn() }
          if (control.action === 'belly') fireEvent('belly-switch', 'Emergency reverse switch activated', 'minor', 0, 1000)
        }
      } else {
        state.lookDrag = { x: event.clientX, y: event.clientY, yaw: state.viewYaw, pitch: state.viewPitch }
        renderer.domElement.setPointerCapture(event.pointerId)
      }
    }
    const pointerMove = (event) => {
      if (state.pointerDrag) {
        const { object, x, y, start } = state.pointerDrag
        const control = object.userData.control
        const delta = control.axis === 'horizontal' ? (event.clientX - x) / 85 : (y - event.clientY) / 85
        manual[control.action] = clampInput(start + delta)
      } else if (state.lookDrag) {
        state.viewYaw = THREE.MathUtils.clamp(state.lookDrag.yaw - (event.clientX - state.lookDrag.x) * .004, -.95, .95)
        state.viewPitch = THREE.MathUtils.clamp(state.lookDrag.pitch - (event.clientY - state.lookDrag.y) * .0035, -.72, .55)
      } else setHovered(pickControl(event))
    }
    const pointerUp = (event) => {
      if (state.pointerDrag) releaseControl(state.pointerDrag.object)
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

    const controllers = [0, 1].map((index) => {
      const controller = renderer.xr.getController(index)
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -2.5)]), new THREE.LineBasicMaterial({ color: 0xffad21 }))
      controller.add(line)
      scene.add(controller)
      const selectStart = () => {
        const origin = new THREE.Vector3()
        const direction = new THREE.Vector3(0, 0, -1)
        controller.getWorldPosition(origin)
        direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()))
        raycaster.set(origin, direction)
        const object = raycaster.intersectObjects(interactables, false)[0]?.object
        if (!object) return
        if (object.userData.control.action === 'presence') {
          setActiveControl(object.userData.control.label)
          togglePresence()
          return
        }
        const position = new THREE.Vector3()
        controller.getWorldPosition(position)
        state.xrDrags.set(controller, { object, position, start: manual[object.userData.control.action] || 0 })
        setActiveControl(object.userData.control.label)
        if (['button', 'pedal'].includes(object.userData.control.axis)) {
          manual[object.userData.control.action] = 1
          if (object.userData.control.action === 'horn') soundHorn()
        }
      }
      const selectEnd = () => {
        const drag = state.xrDrags.get(controller)
        if (drag) releaseControl(drag.object)
        state.xrDrags.delete(controller)
      }
      controller.addEventListener('selectstart', selectStart)
      controller.addEventListener('selectend', selectEnd)
      return { controller, selectStart, selectEnd }
    })

    const readXRAxes = () => {
      if (!renderer.xr.isPresenting) return ZERO
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
      const xr = readXRAxes()
      state.xrDrags.forEach((drag, controller) => {
        const position = new THREE.Vector3()
        controller.getWorldPosition(position)
        const control = drag.object.userData.control
        const delta = control.axis === 'horizontal' ? position.x - drag.position.x : position.y - drag.position.y
        manual[control.action] = clampInput(drag.start + delta * 2.6)
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
      const tiltInput = ['reach', 'counterbalance'].includes(profile.family) && permitted ? choose('tilt') : 0
      const sideshiftInput = ['reach', 'counterbalance'].includes(profile.family) && permitted ? choose('sideshift') : 0
      const brakeInput = enabled ? choose('brake') : 0
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
      state.speed = THREE.MathUtils.damp(state.speed, brakeInput > .1 ? 0 : targetSpeed, damping, dt)
      state.steer = THREE.MathUtils.damp(state.steer, steerInput, profile.family === 'counterbalance' ? 3.1 : 5.2, dt)
      if (Math.abs(state.speed) > .025) {
        const speedRatio = Math.abs(state.speed) / Math.max(maxMps, .1)
        state.heading -= state.steer * dynamics.turnRate * profile.steerRatio * Math.sign(state.speed) * (.3 + speedRatio * .7) * dt
      }
      state.x -= Math.sin(state.heading) * state.speed * dt
      state.z -= Math.cos(state.heading) * state.speed * dt
      if (state.x < WORLD.minX || state.x > WORLD.maxX || state.z < WORLD.minZ || state.z > WORLD.maxZ) {
        fireEvent('boundary', 'Contact with facility boundary', 'critical', 18)
        state.x = THREE.MathUtils.clamp(state.x, WORLD.minX, WORLD.maxX)
        state.z = THREE.MathUtils.clamp(state.z, WORLD.minZ, WORLD.maxZ)
        state.speed *= -.12
      }
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
        rig.carriage.position.y = (rest?.y || 0) + state.fork * .0254
        rig.carriage.position.x = (rest?.x || 0) + state.sideshift
      }
      if (rig.reachGroup) rig.reachGroup.position.z = (rig.reachGroup.userData.rest?.z || 0) - state.reach * .0254
      if (rig.tiltGroup) rig.tiltGroup.rotation.x = THREE.MathUtils.degToRad(state.tilt)
      else if (rig.mast) rig.mast.rotation.x = THREE.MathUtils.degToRad(state.tilt)
      if (rig.tillerPivot) rig.tillerPivot.rotation.y = -state.steer * .72
      if (rig.steerPivot) rig.steerPivot.rotation.y = -state.steer * .62
      if (rig.travelPivot) rig.travelPivot.rotation.x = travelInput * .16
      if (rig.liftPivot) rig.liftPivot.rotation.x = liftInput * .24
      if (rig.reachPivot) rig.reachPivot.rotation.z = -reachInput * .22
      if (rig.tiltPivot) rig.tiltPivot.rotation.z = -tiltInput * .22
      if (rig.wheelPivot) rig.wheelPivot.rotation.z = -state.steer * 1.5
      if (rig.driveWheel) rig.driveWheel.rotation.x -= state.speed * dt / .165
      if (rig.loadWheels) rig.loadWheels.forEach((loadWheel) => { loadWheel.rotation.x -= state.speed * dt / .075 })
      if (rig.levers) {
        const values = [liftInput, tiltInput, sideshiftInput]
        rig.levers.forEach((lever, index) => { lever.rotation.x = (lever.userData.restRX ?? -.18) + values[index] * .25 })
      }
      if (presenceControl) {
        const targetY = presenceControl.userData.restY - (state.presenceLatched ? .025 : 0)
        presenceControl.position.y = THREE.MathUtils.damp(presenceControl.position.y, targetY, 12, dt)
      }
      camera.rotation.y = state.viewYaw
      camera.rotation.x = state.viewPitch

      const speedMph = Math.abs(state.speed) / .44704
      if (speedMph > profile.safeSpeed + .15) fireEvent('speed', 'Travel speed above assessment limit', 'minor', 5)
      if (speedMph > 1.2 && state.fork > 18) fireEvent('fork-height', 'Travel with elevated forks', 'major', 10)
      if (speedMph > .4 && Math.abs(state.steer) > .74 && state.fork > 48) fireEvent('stability', 'Sharp turn with elevated carriage', 'critical', 18)
      pedestrians.forEach((person) => { if (person.position.distanceTo(rig.root.position) < 1.9) fireEvent('pedestrian', 'Pedestrian separation breached', 'critical', 20, 10000) })
      const palletDistance = rig.root.position.distanceTo(pallet.position)
      if (palletDistance < 1.75 && state.fork < 8 && Math.abs(state.speed) < .45) state.load = Math.min(profile.capacity * .62, 2400)
      if (palletDistance < 1.1 && Math.abs(state.speed) > .8) fireEvent('load-contact', 'Hard contact with pallet', 'major', 10)
      if (Math.abs(state.z - 3.2) < 2.4 && Math.abs(state.x) < 3.2 && speedMph > .8 && !state.horn) fireEvent('intersection', 'Blind intersection without horn', 'minor', 5, 12000)
      if (manual.belly > .2) state.speed = Math.max(state.speed, .75)

      const stabilityValue = Math.max(6, 100 - speedMph * 4.5 - state.fork * .085 - Math.abs(state.steer) * speedMph * 7.5 - Math.abs(state.sideshift) * 18)
      if (time - state.lastTelemetry > 100) {
        state.lastTelemetry = time
        setStability(Math.round(stabilityValue))
        onTelemetry({ speed: speedMph, signedSpeed: state.speed / .44704, fork: state.fork, reach: state.reach, tilt: state.tilt, load: state.load, stability: stabilityValue, position: { x: state.x, z: state.z }, heading: state.heading, horn: state.horn, xr: renderer.xr.isPresenting })
      }
      renderer.render(scene, camera)
    })

    disposers.push(() => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      renderer.domElement.removeEventListener('pointerdown', pointerDown)
      renderer.domElement.removeEventListener('pointermove', pointerMove)
      renderer.domElement.removeEventListener('pointerup', pointerUp)
      renderer.domElement.removeEventListener('pointercancel', pointerUp)
      renderer.domElement.removeEventListener('contextmenu', preventMenu)
      controllers.forEach(({ controller, selectStart, selectEnd }) => {
        controller.removeEventListener('selectstart', selectStart)
        controller.removeEventListener('selectend', selectEnd)
      })
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
      <div className="stability-meter"><span>Stability</span><div><i style={{ height: `${stability}%` }} /></div><b>{stability > 55 ? 'STABLE' : 'CAUTION'}</b></div>
      <div className="sim-reticle" aria-hidden="true"><i /><i /></div>
      <div className="sim-hints">
        <button onClick={() => setGuideOpen((value) => !value)}><Keyboard size={17} /> Controls</button>
        <button onClick={() => setAudioOn((value) => !value)} aria-label={audioOn ? 'Mute audio' : 'Enable audio'}>{audioOn ? <Volume2 size={17} /> : <Headphones size={17} />}</button>
        <button onClick={() => engineRef.current?.reset()} aria-label="Reset vehicle"><RotateCcw size={17} /></button>
      </div>
      {guideOpen && <div className="control-guide"><header><Gamepad2 size={18} /><b>{profile.control}</b></header><p><MousePointer2 size={14} /> Drag a visible cab control to manipulate it. Drag empty space, or right-drag, to look around.</p><p>Keyboard fallback: Control toggles presence, W/S travel, A/D steer, E/Q lift, R/F reach, T/G tilt, Z/C sideshift, B brake, Space horn.</p><p>VR: point at a physical control, hold trigger, and move it. Thumbsticks remain available for accessibility.</p><small>{profile.guidance}</small></div>}
      {!running && <div className="start-overlay"><MousePointer2 size={24} /><div><strong>First-person practical exercise</strong><span>{controlPrompt(profile)}</span></div><button onClick={() => onRunningChange(true)}>Enter operator station</button></div>}
    </section>
  )
})

export default Simulator
