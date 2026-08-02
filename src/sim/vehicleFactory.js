import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

const dark = 0x172126
const rubber = 0x0b1013
const steel = 0x37454b
const controlBlack = 0x11191d

function material(color, options = {}) {
  const MaterialType = options.clearcoat === undefined ? THREE.MeshStandardMaterial : THREE.MeshPhysicalMaterial
  return new MaterialType({ color, roughness: .62, metalness: .18, ...options })
}

function box(parent, size, position, color, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, options))
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function roundedBox(parent, size, position, color, options = {}, radius = .035, segments = 4) {
  const geometry = new RoundedBoxGeometry(size[0], size[1], size[2], segments, Math.min(radius, ...size.map((value) => value / 2)))
  const mesh = new THREE.Mesh(geometry, material(color, options))
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function beamBetween(parent, start, end, width, color, options = {}) {
  const midpoint = start.clone().add(end).multiplyScalar(.5)
  const length = start.distanceTo(end)
  const mesh = box(parent, [width, length, width], midpoint.toArray(), color, options)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize())
  return mesh
}

function cylinder(parent, radius, depth, position, color, rotation = [0, 0, 0], segments = 20) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, segments), material(color))
  mesh.position.set(...position)
  mesh.rotation.set(...rotation)
  mesh.castShadow = true
  parent.add(mesh)
  return mesh
}

function ellipsoid(parent, scale, position, color, options = {}, segments = 28) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.max(12, Math.floor(segments * .65))), material(color, options))
  mesh.scale.set(...scale)
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function wheel(parent, position, radius = .26, width = .16) {
  return cylinder(parent, radius, width, position, rubber, [0, 0, Math.PI / 2])
}

function markControl(mesh, action, label, axis = 'vertical', spring = true) {
  mesh.userData.control = { action, label, axis, spring }
  mesh.material = mesh.material.clone()
  mesh.userData.baseEmissive = mesh.material.emissive?.getHex?.() || 0
  return mesh
}

function mastAssembly(root, options = {}) {
  const mast = new THREE.Group()
  mast.position.z = options.z ?? -1.18
  ;[-.57, .57].forEach((x) => box(mast, [.11, options.height ?? 3.1, .14], [x, (options.height ?? 3.1) / 2, 0], dark))
  box(mast, [1.3, .1, .16], [0, .28, 0], dark)
  const carriage = new THREE.Group()
  carriage.position.z = -.12
  box(carriage, [1.25, .3, .13], [0, .23, 0], steel)
  ;[-.4, .4].forEach((x) => box(carriage, [.12, .08, options.forkLength ?? 1.65], [x, .04, -.78], steel))
  mast.add(carriage)
  root.add(mast)
  return { mast, carriage }
}

function addDisplay(parent, position, manufacturer) {
  const display = box(parent, [.34, .22, .05], position, 0x0b1114, { emissive: 0x051317 })
  const face = box(parent, [.27, .14, .012], [position[0], position[1], position[2] - .032], manufacturer === 'Crown' ? 0x76a6a8 : 0x9db6a4, { emissive: manufacturer === 'Crown' ? 0x173e43 : 0x233b2d })
  face.rotation.x = -.18
  return display
}

function crownDisplayTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 320
  const context = canvas.getContext('2d')
  context.fillStyle = '#0c171a'
  context.fillRect(0, 0, 512, 320)
  context.fillStyle = '#9cc8c3'
  context.fillRect(16, 16, 480, 288)
  context.fillStyle = '#10292b'
  context.font = '700 36px Arial'
  context.fillText('CROWN', 28, 58)
  context.font = '700 70px Arial'
  context.fillText('0.0', 35, 151)
  context.font = '600 25px Arial'
  context.fillText('MPH', 205, 147)
  context.strokeStyle = '#10292b'
  context.lineWidth = 8
  context.strokeRect(360, 38, 104, 50)
  context.fillRect(464, 52, 12, 22)
  context.fillRect(371, 49, 72, 28)
  context.beginPath()
  context.moveTo(76, 225)
  context.lineTo(115, 190)
  context.lineTo(154, 225)
  context.stroke()
  context.font = '600 23px Arial'
  context.fillText('PARK', 196, 231)
  context.fillText('0 in', 357, 231)
  context.fillStyle = '#173a3b'
  context.fillRect(26, 265, 460, 3)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function crownDisplay(parent, position) {
  const surround = roundedBox(parent, [.42, .275, .075], position, 0x12191b, { roughness: .48, metalness: .04 }, .045)
  surround.rotation.x = -.12
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(.348, .208),
    new THREE.MeshStandardMaterial({ map: crownDisplayTexture(), emissive: 0x244644, emissiveIntensity: .35, roughness: .3 }),
  )
  face.position.set(position[0], position[1] - .005, position[2] + .044)
  face.rotation.x = -.12
  parent.add(face)
  return surround
}

function buildCrownReach(profile) {
  const root = new THREE.Group()
  root.name = 'Crown RR 5725-45 measured truck'
  const crownIvory = profile.color
  const mastBlack = 0x111719
  const charcoal = 0x20292c
  const molded = 0x2b3437
  const crownOrange = 0xf2a516
  const darkOrange = 0xc97a0a
  const polished = 0x7b878a
  const ivoryFinish = { roughness: .3, metalness: .14, clearcoat: .28, clearcoatRoughness: .25 }
  const blackFinish = { roughness: .42, metalness: .64 }

  // RR 5725-45: 58.04 in head length, 9.4 in floor height, 42 in minimum outer straddle.
  const body = roundedBox(root, [1.055, .73, 1.21], [0, .49, .42], crownIvory, ivoryFinish, .11, 6)
  roundedBox(root, [1.015, .2, 1.1], [0, .875, .45], charcoal, { roughness: .52, metalness: .04 }, .08)
  roundedBox(root, [.105, .56, .94], [-.475, 1.17, .47], crownIvory, ivoryFinish, .05)
  roundedBox(root, [.105, .56, .94], [.475, 1.17, .47], crownIvory, ivoryFinish, .05)
  roundedBox(root, [.028, .47, .78], [-.414, 1.16, .45], 0x1c2325, { roughness: .68, metalness: .03 }, .012)
  roundedBox(root, [.028, .47, .78], [.414, 1.16, .45], 0x1c2325, { roughness: .68, metalness: .03 }, .012)
  roundedBox(root, [.94, .16, .34], [0, 1.37, .79], crownIvory, ivoryFinish, .07)
  roundedBox(root, [.82, .28, .12], [0, 1.43, .91], 0x172023, { roughness: .78, metalness: .02 }, .045)
  roundedBox(root, [.9, .075, .7], [0, .275, .47], 0x343d3e, { roughness: .83, metalness: .03 }, .025)
  box(root, [.88, .018, .64], [0, .318, .45], 0x252b2b, { roughness: .94, metalness: 0 })
  for (let z = .2; z <= .7; z += .1) box(root, [.72, .008, .012], [0, .329, z], 0x111718, { roughness: .9, metalness: 0 })

  // Fixed mast, nested rails, hydraulic cylinder, chains, and carriage.
  const mast = new THREE.Group()
  mast.position.z = -.64
  const mastHeight = 3.5
  ;[-.49, .49].forEach((x) => {
    roundedBox(mast, [.115, mastHeight, .16], [x, mastHeight / 2, 0], mastBlack, blackFinish, .018)
    roundedBox(mast, [.072, 2.92, .095], [x * .84, 1.52, -.055], 0x2c3436, blackFinish, .014)
  })
  ;[.31, 1.35, 2.32, 3.38].forEach((y) => box(mast, [1.08, .085, .14], [0, y, .015], mastBlack, blackFinish))
  cylinder(mast, .054, 2.56, [0, 1.52, .025], 0x20282a, [0, 0, 0], 28).material.metalness = .78
  cylinder(mast, .031, 1.88, [0, 1.62, -.02], polished, [0, 0, 0], 24).material.metalness = .9
  ;[-.31, .31].forEach((x) => {
    const chain = box(mast, [.018, 2.62, .023], [x, 1.64, -.105], 0x15191a, { roughness: .5, metalness: .9 })
    chain.name = 'Lift chain'
  })
  root.add(mast)

  const carriage = new THREE.Group()
  carriage.position.set(0, .02, -.12)
  roundedBox(carriage, [1.0, .26, .12], [0, .28, 0], mastBlack, blackFinish, .018)
  mast.add(carriage)

  // The RR reach mechanism extends the fork carriage, not the fixed mast.
  const reachGroup = new THREE.Group()
  reachGroup.position.z = 0
  carriage.add(reachGroup)
  ;[-.42, .42].forEach((x) => {
    beamBetween(reachGroup, new THREE.Vector3(x, .13, -.02), new THREE.Vector3(x, .48, -.43), .042, mastBlack, blackFinish)
    beamBetween(reachGroup, new THREE.Vector3(x, .48, -.02), new THREE.Vector3(x, .13, -.43), .042, mastBlack, blackFinish)
    cylinder(reachGroup, .032, .055, [x, .3, -.225], polished, [0, 0, Math.PI / 2], 20)
  })
  roundedBox(reachGroup, [1.02, .25, .1], [0, .29, -.49], mastBlack, blackFinish, .014)
  ;[-.34, .34].forEach((x) => roundedBox(reachGroup, [.102, .045, .915], [x, .115, -.91], 0x343c3e, { roughness: .4, metalness: .82 }, .012))
  ;[-.43, .43].forEach((x) => box(reachGroup, [.055, .9, .055], [x, .72, -.535], mastBlack, blackFinish))
  ;[.35, .64, .93, 1.16].forEach((y) => box(reachGroup, [.9, .045, .045], [0, y, -.535], mastBlack, blackFinish))

  // 42 in minimum outer straddle with small polyurethane load wheels.
  const loadWheels = []
  ;[-.482, .482].forEach((x) => {
    roundedBox(root, [.112, .17, 1.5], [x, .18, -1.16], crownIvory, ivoryFinish, .038)
    roundedBox(root, [.08, .085, 1.34], [x, .285, -1.12], charcoal, { roughness: .5, metalness: .42 }, .02)
    loadWheels.push(wheel(root, [x, .095, -1.76], .075, .105))
  })
  const driveWheel = wheel(root, [0, .165, .78], .165, .14)
  driveWheel.material = material(0x191d1e, { roughness: .96, metalness: 0 })
  ;[-.4, .4].forEach((x) => wheel(root, [x, .102, .72], .102, .075))

  const controls = new THREE.Group()
  controls.name = 'Crown RR 5700 operator compartment'
  roundedBox(controls, [1.0, .25, .46], [0, 1.05, .05], 0x101617, { roughness: .58, metalness: .03 }, .07)
  roundedBox(controls, [.92, .14, .37], [0, 1.18, .015], molded, { roughness: .5, metalness: .04 }, .055)
  crownDisplay(controls, [-.12, 1.32, -.19])

  const steerPivot = new THREE.Group()
  steerPivot.position.set(-.37, 1.02, -.08)
  roundedBox(steerPivot, [.14, .25, .15], [0, .08, 0], 0x151c1f, { roughness: .64, metalness: .06 }, .055)
  const steeringPad = markControl(ellipsoid(steerPivot, [.14, .055, .11], [0, .22, -.02], 0x222b2e, { roughness: .72, metalness: .02 }), 'steer', 'Crown palm steering tiller', 'horizontal', false)
  ellipsoid(steerPivot, [.095, .016, .066], [0, .271, -.02], 0x0a0f11, { roughness: .45, metalness: .08 }, 24)
  controls.add(steerPivot)

  const travelPivot = new THREE.Group()
  travelPivot.position.set(.35, 1.06, -.065)
  roundedBox(travelPivot, [.31, .17, .23], [0, 0, 0], 0x1d2528, { roughness: .56, metalness: .04 }, .06)
  cylinder(travelPivot, .065, .12, [.035, .085, -.015], 0x2b3335, [0, 0, 0], 24)
  const multi = markControl(ellipsoid(travelPivot, [.092, .16, .085], [.035, .205, -.015], controlBlack, { roughness: .7, metalness: .02 }), 'travel', 'Crown Multi-Task Control Handle', 'vertical', true)
  multi.rotation.x = -.13
  roundedBox(travelPivot, [.19, .075, .13], [.035, .325, -.06], crownOrange, { roughness: .42, metalness: .04 }, .025)
  markControl(roundedBox(travelPivot, [.065, .035, .055], [.035, .365, -.12], 0x202729, { roughness: .62, metalness: .03 }, .012), 'horn', 'Horn button', 'button', true)
  const liftPivot = new THREE.Group()
  liftPivot.position.set(-.065, .23, -.075)
  markControl(roundedBox(liftPivot, [.085, .055, .12], [0, 0, 0], crownOrange, { roughness: .4, metalness: .04 }, .018), 'lift', 'Lift and lower thumb rocker', 'vertical', true)
  travelPivot.add(liftPivot)
  const reachPivot = new THREE.Group()
  reachPivot.position.set(.065, .23, -.075)
  markControl(roundedBox(reachPivot, [.085, .055, .12], [0, 0, 0], darkOrange, { roughness: .42, metalness: .04 }, .018), 'reach', 'Reach and retract thumb rocker', 'horizontal', true)
  travelPivot.add(reachPivot)
  const tiltPivot = new THREE.Group()
  tiltPivot.position.set(.1, .125, -.087)
  markControl(roundedBox(tiltPivot, [.07, .05, .085], [0, 0, 0], 0x69777a, { roughness: .5, metalness: .12 }, .014), 'tilt', 'Fork tilt rocker', 'horizontal', true)
  travelPivot.add(tiltPivot)
  controls.add(travelPivot)

  const brakePedal = markControl(roundedBox(controls, [.25, .045, .23], [-.27, .355, -.12], 0x252b2c, { roughness: .9, metalness: .02 }, .018), 'brake', 'Left brake pedal', 'pedal', true)
  brakePedal.rotation.x = -.12
  const presencePad = markControl(roundedBox(controls, [.36, .035, .3], [.22, .35, -.045], 0x303b3d, { roughness: .94, metalness: 0 }, .014), 'presence', 'Right operator presence pedal', 'button', false)
  for (let z = -.16; z < .08; z += .055) box(controls, [.29, .007, .008], [.22, .371, z], 0x111718, { roughness: .9, metalness: 0 })
  roundedBox(controls, [.86, .09, .13], [0, .47, .88], crownOrange, { roughness: .46, metalness: .1 }, .035)
  root.add(controls)

  // Overhead guard with side posts and three fore-aft roof members.
  ;[-.5, .5].forEach((x) => {
    const rearPost = box(root, [.065, 1.35, .08], [x, 1.69, .78], mastBlack, blackFinish)
    rearPost.rotation.x = -.04
    const frontPost = box(root, [.06, 1.42, .07], [x, 1.74, -.32], mastBlack, blackFinish)
    frontPost.rotation.x = .06
  })
  ;[-.5, .5].forEach((x) => box(root, [.075, .075, 1.25], [x, 2.405, .25], mastBlack, blackFinish))
  ;[-.34, .84].forEach((z) => box(root, [1.08, .075, .075], [0, 2.405, z], mastBlack, blackFinish))
  ;[-.25, 0, .25].forEach((x) => box(root, [.065, .07, 1.12], [x, 2.41, .25], mastBlack, blackFinish))

  const cameraMount = new THREE.Group()
  cameraMount.position.set(.03, 1.67, .69)
  root.add(cameraMount)
  return {
    root, body, mast, carriage, reachGroup, cameraMount, platform: null, controls, family: 'reach',
    steerPivot, travelPivot, liftPivot, reachPivot, tiltPivot, driveWheel, loadWheels, tiltGroup: carriage,
    specification: 'RR 5725-45 36V',
  }
}

function buildReach(profile) {
  const root = new THREE.Group()
  const body = box(root, [1.42, .68, 1.9], [0, .43, .25], profile.color)
  box(root, [1.32, .11, 1.18], [0, .87, .52], 0x222d32)
  box(root, [.13, .5, 1.35], [-.66, 1.08, .38], profile.color)
  box(root, [.13, .5, 1.35], [.66, 1.08, .38], profile.color)
  box(root, [1.25, .68, .12], [0, 1.16, 1.03], dark)
  box(root, [1.05, .5, .13], [0, 1.47, 1.08], 0x26343a)
  const { mast, carriage } = mastAssembly(root, { z: -1.02, height: 3.3, forkLength: 1.7 })
  const reachGroup = new THREE.Group()
  root.remove(mast)
  reachGroup.add(mast)
  root.add(reachGroup)
  ;[-.63, .63].forEach((x) => {
    box(root, [.12, .18, 1.9], [x, .18, -1.18], profile.color)
    wheel(root, [x, .22, -1.86], .18, .1)
  })
  wheel(root, [0, .27, .79], .28, .18)

  const controls = new THREE.Group()
  controls.name = 'Crown RR operator compartment'
  addDisplay(controls, [-.42, 1.34, -.02], profile.manufacturer)
  const tillerPost = cylinder(controls, .055, .58, [-.43, 1.04, .1], steel, [0, 0, 0])
  tillerPost.rotation.z = -.22
  const tiller = markControl(cylinder(controls, .085, .34, [-.43, 1.31, .06], controlBlack, [Math.PI / 2, 0, 0]), 'steer', 'Steering tiller', 'horizontal', false)
  tiller.rotation.z = -.22
  const multi = markControl(cylinder(controls, .09, .36, [.42, 1.24, .02], controlBlack, [.12, 0, 0]), 'travel', profile.control, 'vertical', true)
  box(controls, [.3, .16, .3], [.42, 1.02, .05], 0x29363b)
  const lift = markControl(box(controls, [.2, .08, .18], [.42, 1.34, -.08], profile.manufacturer === 'Crown' ? 0xd6d7d1 : 0xc43f34), 'lift', 'Lift and lower rocker', 'vertical', true)
  lift.rotation.x = -.18
  markControl(box(controls, [.13, .07, .11], [.28, 1.34, -.07], 0xc38b1a), 'reach', 'Reach and retract', 'horizontal', true)
  markControl(box(controls, [.13, .07, .11], [.56, 1.34, -.07], 0x59737c), 'tilt', 'Tilt rocker', 'horizontal', true)
  markControl(box(controls, [.12, .045, .13], [.42, 1.42, -.09], 0xe0a221), 'horn', 'Horn', 'button', true)
  markControl(box(controls, [.3, .06, .28], [-.32, .12, .34], 0x22292c), 'brake', 'Brake pedal', 'pedal', true)
  markControl(box(controls, [.62, .045, .72], [.18, .11, .5], 0x3f4c50), 'presence', 'Presence pad', 'button', false)
  box(controls, [1.17, .09, .12], [0, .26, .99], 0xe2a222)
  root.add(controls)

  const cameraMount = new THREE.Group()
  cameraMount.position.set(.08, 1.62, .54)
  root.add(cameraMount)
  return { root, body, mast, carriage, reachGroup, cameraMount, platform: null, controls, family: 'reach' }
}

function buildOrderPicker(profile) {
  const root = new THREE.Group()
  const body = box(root, [1.28, .72, 1.78], [0, .46, .38], profile.color)
  box(root, [1.18, .12, .88], [0, .88, .5], dark)
  const { mast, carriage } = mastAssembly(root, { z: -1.02, height: 4.25, forkLength: 1.4 })
  const platform = new THREE.Group()
  box(platform, [1.12, .1, 1.08], [0, .91, .23], 0x3d484c)
  box(platform, [1.12, .72, .1], [0, 1.3, .78], profile.color)
  box(platform, [.08, .9, .95], [-.55, 1.42, .25], profile.color)
  box(platform, [.08, .9, .95], [.55, 1.42, .25], profile.color)
  box(platform, [1.08, .08, .08], [0, 1.78, -.26], 0xe5a422)
  carriage.add(platform)
  ;[-.52, .52].forEach((x) => wheel(root, [x, .25, .72], .25, .14))

  const controls = new THREE.Group()
  controls.position.y = .91
  controls.position.z = -.18
  addDisplay(controls, [0, 1.42, -.18], profile.manufacturer)
  const tiller = markControl(cylinder(controls, .075, .38, [-.38, 1.24, -.05], controlBlack, [Math.PI / 2, 0, 0]), 'steer', 'Steering tiller', 'horizontal', false)
  tiller.rotation.z = -.15
  const handle = markControl(cylinder(controls, .085, .36, [.38, 1.24, -.05], controlBlack, [.08, 0, 0]), 'travel', profile.control, 'vertical', true)
  handle.rotation.z = .12
  markControl(box(controls, [.19, .07, .16], [.38, 1.37, -.13], 0xe6a624), 'lift', 'Platform lift and lower', 'vertical', true)
  markControl(box(controls, [.12, .05, .12], [.27, 1.4, -.13], 0xc64635), 'horn', 'Horn', 'button', true)
  markControl(box(controls, [.45, .05, .46], [0, .11, .24], 0x424d50), 'presence', 'Deadman pedal', 'button', false)
  carriage.add(controls)

  const cameraMount = new THREE.Group()
  cameraMount.position.set(0, 2.43, .62)
  carriage.add(cameraMount)
  return { root, body, mast, carriage, reachGroup: null, cameraMount, platform, controls, family: 'order-picker' }
}

function buildPallet(profile) {
  const root = new THREE.Group()
  const walkie = profile.stance.includes('Walk')
  const body = box(root, [1.05, .72, walkie ? .82 : 1.32], [0, .46, .48], profile.color)
  box(root, [.88, .52, .35], [0, .98, .6], dark)
  ;[-.49, .49].forEach((x) => wheel(root, [x, .24, .42], .24, .13))
  const carriage = new THREE.Group()
  ;[-.34, .34].forEach((x) => box(carriage, [.18, .1, 2.3], [x, .15, -1.05], steel))
  root.add(carriage)
  const platform = walkie ? null : box(root, [1.04, .12, .74], [0, .22, 1.43], steel)
  if (!walkie) {
    box(root, [1.08, .68, .11], [0, .58, 1.77], profile.color)
    markControl(box(root, [.54, .035, .42], [0, .3, 1.43], 0x435158), 'presence', 'Rider presence pad', 'button', false)
  }

  const controls = new THREE.Group()
  const tillerPivot = new THREE.Group()
  tillerPivot.position.set(0, .38, .22)
  const shaft = box(tillerPivot, [.11, .84, .14], [0, .4, .18], steel)
  shaft.rotation.x = -.32
  const head = markControl(box(tillerPivot, [.56, .22, .22], [0, .82, .32], controlBlack), 'steer', profile.control, 'horizontal', false)
  markControl(box(tillerPivot, [.15, .14, .28], [-.25, .82, .25], 0x4d6067), 'travel', 'Left butterfly throttle', 'horizontal', true)
  markControl(box(tillerPivot, [.15, .14, .28], [.25, .82, .25], 0x4d6067), 'travel', 'Right butterfly throttle', 'horizontal', true)
  markControl(box(tillerPivot, [.18, .06, .1], [0, .94, .24], 0xe4a021), 'horn', 'Horn', 'button', true)
  markControl(box(tillerPivot, [.12, .06, .1], [-.15, .94, .24], 0x637a83), 'lift', 'Fork lift and lower', 'vertical', true)
  markControl(box(tillerPivot, [.3, .08, .08], [0, .72, .18], 0xd34638), 'belly', 'Emergency reverse switch', 'button', true)
  controls.add(tillerPivot)
  root.add(controls)
  const cameraMount = new THREE.Group()
  cameraMount.position.set(0, walkie ? 1.58 : 1.56, walkie ? 1.72 : 1.45)
  root.add(cameraMount)
  return { root, body, mast: null, carriage, reachGroup: null, cameraMount, platform, controls, tillerPivot, family: 'pallet', walkie }
}

function buildCounterbalance(profile) {
  const root = new THREE.Group()
  const body = box(root, [1.42, .64, 2.18], [0, .45, .22], profile.color)
  box(root, [1.2, .75, .85], [0, .96, .72], profile.color)
  box(root, [1.05, .66, .64], [0, 1.08, .38], dark)
  const { mast, carriage } = mastAssembly(root, { z: -1.16, height: 3.1, forkLength: 1.65 })
  ;[-.62, .62].forEach((x) => {
    wheel(root, [x, .35, -.65], .36, .18)
    wheel(root, [x, .3, .86], .27, .16)
    box(root, [.08, 1.75, .08], [x, 1.72, .48], dark)
  })
  box(root, [1.38, .09, 1.42], [0, 2.58, -.04], dark)
  const controls = new THREE.Group()
  box(controls, [1.14, .38, .44], [0, 1.03, -.34], 0x2b373c)
  addDisplay(controls, [0, 1.23, -.53], profile.manufacturer)
  const wheelPivot = new THREE.Group()
  wheelPivot.position.set(-.3, 1.25, -.43)
  const steeringWheel = markControl(new THREE.Mesh(new THREE.TorusGeometry(.25, .035, 10, 30), material(controlBlack)), 'steer', 'Steering wheel', 'horizontal', false)
  steeringWheel.rotation.x = Math.PI / 2.6
  wheelPivot.add(steeringWheel)
  controls.add(wheelPivot)
  const levers = []
  ;[['lift', .18, 0xe0a221], ['tilt', .37, 0x60767e], ['sideshift', .56, 0x60767e]].forEach(([action, x, color]) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, 1.23, -.36)
    const lever = markControl(cylinder(pivot, .035, .36, [0, .16, 0], steel), action, `${action[0].toUpperCase()}${action.slice(1)} lever`, 'vertical', true)
    cylinder(pivot, .065, .12, [0, .35, 0], color)
    pivot.rotation.x = -.18
    controls.add(pivot)
    levers.push(pivot)
  })
  markControl(box(controls, [.25, .06, .28], [.3, .17, -.28], 0x30383b), 'travel', 'Accelerator pedal', 'vertical', true)
  markControl(box(controls, [.25, .06, .28], [-.18, .17, -.28], 0x30383b), 'brake', 'Brake pedal', 'vertical', true)
  markControl(box(controls, [.16, .05, .12], [-.52, 1.16, -.45], 0xe0a221), 'horn', 'Horn', 'button', true)
  box(controls, [.74, .11, .65], [0, .67, .42], 0x303a3e)
  box(controls, [.62, .63, .16], [0, 1.02, .7], 0x222c31)
  markControl(box(controls, [.13, .06, .15], [.4, .76, .56], 0xc94736), 'presence', 'Seat switch and restraint', 'button', false)
  root.add(controls)
  const cameraMount = new THREE.Group()
  cameraMount.position.set(0, 1.68, .42)
  root.add(cameraMount)
  return { root, body, mast, carriage, reachGroup: null, cameraMount, platform: null, controls, wheelPivot, levers, family: 'counterbalance' }
}

export function createVehicleRig(profile) {
  if (profile.family === 'reach' && profile.manufacturer === 'Crown') return buildCrownReach(profile)
  if (profile.family === 'reach') return buildReach(profile)
  if (profile.family === 'order-picker') return buildOrderPicker(profile)
  if (profile.family === 'pallet') return buildPallet(profile)
  return buildCounterbalance(profile)
}

export function controlMeshes(rig) {
  const result = []
  rig.root.traverse((object) => { if (object.userData.control) result.push(object) })
  return result
}
