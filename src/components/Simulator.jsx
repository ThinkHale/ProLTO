import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as THREE from 'three'
import { Box, Crosshair, Gamepad2, Headphones, Keyboard, RotateCcw, Volume2 } from 'lucide-react'

const WORLD = { minX: -9.5, maxX: 9.5, minZ: -18, maxZ: 16 }

function box(scene, size, position, color, material = {}) {
  const geometry = new THREE.BoxGeometry(...size)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .12, ...material }))
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}

function addRack(scene, x, z, rotation = 0) {
  const group = new THREE.Group()
  const steel = 0x31566a
  ;[-1.8, 1.8].forEach((dx) => {
    ;[-.65, .65].forEach((dz) => box(group, [.11, 4.6, .11], [dx, 2.3, dz], steel))
  })
  ;[.25, 1.65, 3.05, 4.45].forEach((y) => {
    box(group, [3.8, .1, 1.55], [0, y, 0], 0xd0882f)
    if (y > .3) {
      box(group, [1.45, .7, 1.1], [-.82, y + .42, 0], 0x93623f)
      box(group, [1.45, .7, 1.1], [.82, y + .42, 0], 0x9e7048)
    }
  })
  group.position.set(x, 0, z)
  group.rotation.y = rotation
  scene.add(group)
}

function makeForklift(profile) {
  const root = new THREE.Group()
  const body = new THREE.Group()
  root.add(body)
  const bodyLength = profile.family === 'pallet' ? 2.2 : 1.8
  box(body, [1.45, .72, bodyLength], [0, .52, .25], profile.color)
  box(body, [1.2, .54, .8], [0, 1.05, .65], 0x1c252b)
  const mast = new THREE.Group()
  mast.name = 'mast'
  ;[-.62, .62].forEach((x) => box(mast, [.12, 3.1, .16], [x, 1.75, -1], 0x182228))
  box(mast, [1.42, .12, .18], [0, .32, -1], 0x182228)
  const carriage = new THREE.Group()
  carriage.name = 'carriage'
  box(carriage, [1.35, .36, .15], [0, .2, -1.13], 0x27343a)
  const forkLeft = box(carriage, [.13, .09, 2.05], [-.43, .02, -2.05], 0x3d4548)
  const forkRight = box(carriage, [.13, .09, 2.05], [.43, .02, -2.05], 0x3d4548)
  forkLeft.name = 'fork'; forkRight.name = 'fork'
  mast.add(carriage)
  body.add(mast)
  if (profile.family === 'order-picker') {
    box(carriage, [1.42, .12, 1.2], [0, .18, -.32], 0x5e6465)
    box(carriage, [1.38, 1.05, .12], [0, .75, .18], 0x1d292f)
  }
  ;[-.64, .64].forEach((x) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .16, 20), new THREE.MeshStandardMaterial({ color: 0x101518, roughness: .9 }))
    wheel.rotation.z = Math.PI / 2
    wheel.position.set(x, .29, .65)
    body.add(wheel)
  })
  root.userData = { body, mast, carriage, forkHeight: 0, reach: 0, tilt: 0 }
  return root
}

function addPedestrian(scene, x, z, color = 0xdac54c) {
  const group = new THREE.Group()
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.24, .55, 5, 10), new THREE.MeshStandardMaterial({ color }))
  torso.position.y = 1.08
  group.add(torso)
  const head = new THREE.Mesh(new THREE.SphereGeometry(.17, 14, 10), new THREE.MeshStandardMaterial({ color: 0xa76d52 }))
  head.position.y = 1.65
  group.add(head)
  group.position.set(x, 0, z)
  scene.add(group)
  return group
}

const Simulator = forwardRef(function Simulator({ profile, onTelemetry, onSafetyEvent, running, onRunningChange }, ref) {
  const mountRef = useRef(null)
  const engineRef = useRef(null)
  const runningRef = useRef(running)
  const [xrSupported, setXrSupported] = useState(false)
  const [audioOn, setAudioOn] = useState(true)
  const [guideOpen, setGuideOpen] = useState(false)

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
    if (navigator.xr) navigator.xr.isSessionSupported('immersive-vr').then((supported) => active && setXrSupported(supported)).catch(() => setXrSupported(false))
    return () => { active = false }
  }, [])

  useEffect(() => { runningRef.current = running }, [running])

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111c22)
    scene.fog = new THREE.Fog(0x111c22, 22, 48)
    const camera = new THREE.PerspectiveCamera(66, mount.clientWidth / mount.clientHeight, .05, 100)
    camera.position.set(7.4, 5.4, 9.2)
    camera.lookAt(0, 1, -2.5)
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local-floor')
    mount.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight(0xcce9f4, 0x26343a, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 3.1)
    sun.position.set(-8, 14, 8); sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = -20; sun.shadow.camera.right = 20; sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20
    scene.add(sun)
    box(scene, [24, .15, 40], [0, -.08, -1], 0x6c7476)
    const grid = new THREE.GridHelper(40, 40, 0xe2a32b, 0x586064)
    grid.position.y = .005; grid.material.opacity = .22; grid.material.transparent = true; scene.add(grid)
    ;[-9, 9].forEach((x) => box(scene, [.12, 7, 40], [x, 3.5, -1], 0x26343a))
    ;[-6.7, 6.7].forEach((x) => { [-12, -6, 0, 6].forEach((z) => addRack(scene, x, z, 0)) })
    box(scene, [.09, .02, 33], [-3.4, .02, -1], 0xf0b32b, { emissive: 0x6a4200 })
    box(scene, [.09, .02, 33], [3.4, .02, -1], 0xf0b32b, { emissive: 0x6a4200 })
    ;[-14, 10].forEach((z) => box(scene, [6.7, .025, .1], [0, .025, z], 0xf0b32b, { emissive: 0x6a4200 }))
    const pallet = new THREE.Group()
    ;[-.45, 0, .45].forEach((z) => box(pallet, [1.25, .1, .23], [0, .13, z], 0x8e5b32))
    box(pallet, [1.2, .86, .98], [0, .68, 0], 0xaa7448)
    pallet.position.set(0, 0, -11.5); scene.add(pallet)
    const pedestrians = [addPedestrian(scene, 2.7, -7.6), addPedestrian(scene, -2.9, 8.2, 0xe18a3b)]
    const coneGroup = new THREE.Group()
    ;[[-2.1, 3.2], [0, 3.2], [2.1, 3.2]].forEach(([x, z]) => {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(.25, .75, 18), new THREE.MeshStandardMaterial({ color: 0xe97520 }))
      cone.position.set(x, .38, z); coneGroup.add(cone)
    })
    scene.add(coneGroup)

    const forklift = makeForklift(profile)
    scene.add(forklift)
    const state = { x: 0, z: 11.5, heading: Math.PI, speed: 0, steer: 0, fork: 0, reach: 0, tilt: 0, horn: false, load: 0, lastTime: performance.now(), lastTelemetry: 0, eventLocks: {}, keys: new Set() }
    const initial = { x: 0, z: 11.5, heading: Math.PI }
    const reset = () => { Object.assign(state, initial, { speed: 0, steer: 0, fork: 0, reach: 0, tilt: 0, load: 0 }); state.eventLocks = {}; forklift.position.set(state.x, 0, state.z); forklift.rotation.y = state.heading }
    engineRef.current = { renderer, reset, state }

    const hornAudio = () => {
      if (!audioOn) return
      const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain()
      oscillator.type = 'square'; oscillator.frequency.value = 330; gain.gain.setValueAtTime(.08, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .22)
      oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .22)
    }
    const keyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      state.keys.add(e.code)
      if (e.code === 'Space' && !state.horn) { state.horn = true; hornAudio() }
    }
    const keyUp = (e) => { state.keys.delete(e.code); if (e.code === 'Space') state.horn = false }
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp)
    const controller1 = renderer.xr.getController(0); const controller2 = renderer.xr.getController(1)
    scene.add(controller1, controller2)

    const fireEvent = (type, label, severity = 'minor', deduction = 4, cooldown = 7000) => {
      const now = performance.now()
      if ((state.eventLocks[type] || 0) > now) return
      state.eventLocks[type] = now + cooldown
      onSafetyEvent({ type, label, severity, deduction })
    }

    const readXR = () => {
      if (!renderer.xr.isPresenting) return { drive: 0, steer: 0, lift: 0, reach: 0, horn: false }
      const session = renderer.xr.getSession(); const sources = [...(session?.inputSources || [])]
      const left = sources.find((s) => s.handedness === 'left')?.gamepad
      const right = sources.find((s) => s.handedness === 'right')?.gamepad
      const axes = (pad) => pad?.axes?.length >= 4 ? [pad.axes[2], pad.axes[3]] : [pad?.axes?.[0] || 0, pad?.axes?.[1] || 0]
      const [lx, ly] = axes(left); const [, ry] = axes(right)
      return { drive: -ly, steer: lx, lift: -ry, reach: (right?.buttons?.[0]?.value || 0) - (right?.buttons?.[1]?.value || 0), horn: !!left?.buttons?.[0]?.pressed }
    }

    const timer = new THREE.Timer()
    renderer.setAnimationLoop((time) => {
      timer.update()
      const dt = Math.min(timer.getDelta(), .04)
      const xr = readXR()
      const enabled = runningRef.current
      const driveInput = enabled ? ((state.keys.has('KeyW') || state.keys.has('ArrowUp') ? 1 : 0) - (state.keys.has('KeyS') || state.keys.has('ArrowDown') ? 1 : 0) || xr.drive) : 0
      const steerInput = enabled ? ((state.keys.has('KeyD') || state.keys.has('ArrowRight') ? 1 : 0) - (state.keys.has('KeyA') || state.keys.has('ArrowLeft') ? 1 : 0) || xr.steer) : 0
      const liftInput = enabled ? ((state.keys.has('KeyE') ? 1 : 0) - (state.keys.has('KeyQ') ? 1 : 0) || xr.lift) : 0
      const reachInput = enabled ? ((state.keys.has('KeyR') ? 1 : 0) - (state.keys.has('KeyF') ? 1 : 0) || xr.reach) : 0
      const tiltInput = enabled ? ((state.keys.has('KeyT') ? 1 : 0) - (state.keys.has('KeyG') ? 1 : 0)) : 0
      const maxMeters = profile.maxSpeed * .44704
      const target = driveInput * maxMeters
      state.speed = THREE.MathUtils.damp(state.speed, target, driveInput ? 2.4 : 5.8, dt)
      state.steer = THREE.MathUtils.damp(state.steer, steerInput, 5, dt)
      if (Math.abs(state.speed) > .02) state.heading += state.steer * profile.steerRatio * dt * (state.speed / Math.max(maxMeters, .1))
      state.x += Math.sin(state.heading) * state.speed * dt
      state.z += Math.cos(state.heading) * state.speed * dt
      if (state.x < WORLD.minX || state.x > WORLD.maxX || state.z < WORLD.minZ || state.z > WORLD.maxZ) { fireEvent('boundary', 'Contact with facility boundary', 'critical', 18); state.x = THREE.MathUtils.clamp(state.x, WORLD.minX, WORLD.maxX); state.z = THREE.MathUtils.clamp(state.z, WORLD.minZ, WORLD.maxZ); state.speed *= -.15 }
      state.fork = THREE.MathUtils.clamp(state.fork + liftInput * dt * 52, 0, profile.maxLift)
      state.reach = THREE.MathUtils.clamp(state.reach + reachInput * dt * 28, 0, profile.family === 'reach' ? 42 : 12)
      state.tilt = THREE.MathUtils.clamp(state.tilt + tiltInput * dt * 4, -5, 9)
      forklift.position.set(state.x, 0, state.z); forklift.rotation.y = state.heading
      forklift.userData.carriage.position.y = state.fork * .0254
      forklift.userData.carriage.position.z = -state.reach * .0254
      forklift.userData.mast.rotation.x = THREE.MathUtils.degToRad(state.tilt)
      const speedMph = Math.abs(state.speed) / .44704
      if (speedMph > profile.safeSpeed + .15) fireEvent('speed', 'Travel speed above assessment limit', 'minor', 5)
      if (speedMph > 1.2 && state.fork > 18) fireEvent('fork-height', 'Travel with elevated forks', 'major', 10)
      if (speedMph > .4 && Math.abs(state.steer) > .78 && state.fork > 48) fireEvent('stability', 'Sharp turn with elevated carriage', 'critical', 18)
      pedestrians.forEach((person) => { if (person.position.distanceTo(forklift.position) < 1.9) fireEvent('pedestrian', 'Pedestrian separation breached', 'critical', 20, 10000) })
      const palletDistance = forklift.position.distanceTo(pallet.position)
      if (palletDistance < 1.7 && state.fork < 8 && Math.abs(state.speed) < .45) state.load = Math.min(profile.capacity * .62, 2400)
      if (palletDistance < 1.1 && Math.abs(state.speed) > .8) fireEvent('load-contact', 'Hard contact with pallet', 'major', 10)
      if (Math.abs(state.z - 3.2) < 2.4 && Math.abs(state.x) < 3.2 && speedMph > .8 && !state.horn && !xr.horn) fireEvent('intersection', 'Blind intersection without horn', 'minor', 5, 12000)
      if (time - state.lastTelemetry > 100) {
        state.lastTelemetry = time
        onTelemetry({ speed: speedMph, signedSpeed: state.speed / .44704, fork: state.fork, reach: state.reach, tilt: state.tilt, load: state.load, stability: Math.max(8, 100 - speedMph * 5 - state.fork * .09 - Math.abs(state.steer) * speedMph * 8), position: { x: state.x, z: state.z }, heading: state.heading, horn: state.horn || xr.horn, xr: renderer.xr.isPresenting })
      }
      if (!renderer.xr.isPresenting) {
        const desired = new THREE.Vector3(state.x + 7.4, 5.4, state.z + 9.2)
        camera.position.lerp(desired, .035); camera.lookAt(state.x, 1, state.z - 3)
      }
      renderer.render(scene, camera)
    })

    const resize = () => { if (!mount.clientWidth || !mount.clientHeight) return; camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mount.clientWidth, mount.clientHeight) }
    const observer = new ResizeObserver(resize); observer.observe(mount)
    return () => {
      observer.disconnect(); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp)
      renderer.setAnimationLoop(null); renderer.dispose(); mount.removeChild(renderer.domElement); engineRef.current = null
    }
  }, [profile, onSafetyEvent, onTelemetry, audioOn, onRunningChange])

  return (
    <section className={`simulator-shell ${running ? 'running' : ''}`}>
      <div className="simulator-canvas" ref={mountRef} />
      <div className="sim-topbar"><span><Crosshair size={15} /> Training Bay 01</span><span>{profile.manufacturer} {profile.model}</span><span className={xrSupported ? 'online' : 'offline'}>{xrSupported ? 'WebXR ready' : 'Desktop ready'}</span></div>
      <div className="stability-meter"><span>Stability</span><div><i style={{ height: '74%' }} /></div><b>MONITORED</b></div>
      <div className="sim-hints">
        <button onClick={() => setGuideOpen((value) => !value)}><Keyboard size={17} /> Controls</button>
        <button onClick={() => setAudioOn((value) => !value)}>{audioOn ? <Volume2 size={17} /> : <Headphones size={17} />}</button>
        <button onClick={() => engineRef.current?.reset()}><RotateCcw size={17} /></button>
      </div>
      {guideOpen && <div className="control-guide"><header><Gamepad2 size={18} /><b>{profile.control}</b></header><p>Desktop: W/S travel, A/D steer, E/Q lift, R/F reach, T/G tilt, Space horn.</p><p>VR: left stick travel and steer, right stick lift, right trigger/grip reach, left trigger horn.</p><small>{profile.guidance}</small></div>}
      {!running && <div className="start-overlay"><Box size={24} /><div><strong>Practical exercise ready</strong><span>Inspect the truck, sound the horn at the cross-aisle, engage the pallet, and place it in the marked zone.</span></div><button onClick={() => onRunningChange(true)}>Start desktop exercise</button></div>}
    </section>
  )
})

export default Simulator
