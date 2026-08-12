import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

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

function addDisplay(parent, position, manufacturer) {
  const display = box(parent, [.34, .22, .05], position, 0x0b1114, { emissive: 0x051317 })
  const face = box(parent, [.27, .14, .012], [position[0], position[1], position[2] + .032], manufacturer === 'Crown' ? 0x76a6a8 : 0x9db6a4, { emissive: manufacturer === 'Crown' ? 0x173e43 : 0x233b2d })
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

function textDecal(parent, text, position, size = [.42, .11], color = '#e8ecec', rotation = [0, 0, 0]) {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = color
  context.font = '700 64px Arial Narrow, Arial'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, canvas.width / 2, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide }))
  decal.position.set(...position)
  decal.rotation.set(...rotation)
  decal.renderOrder = 3
  parent.add(decal)
  return decal
}

function slottedGrille(parent, position, count = 5, color = 0x0a0f11, spacing = .052, vertical = true) {
  for (let index = 0; index < count; index += 1) {
    const offset = (index - (count - 1) / 2) * spacing
    const slot = roundedBox(parent, vertical ? [.022, .09, .016] : [.09, .022, .016], vertical ? [position[0] + offset, position[1], position[2]] : [position[0], position[1] + offset, position[2]], color, { roughness: .72, metalness: .08 }, .009, 3)
    slot.rotation.set(0, 0, 0)
  }
}

function meshPanel(parent, width, height, position, color = 0x1b2326) {
  const group = new THREE.Group()
  const horizontalCount = 7
  const verticalCount = 5
  for (let index = 0; index <= horizontalCount; index += 1) {
    const x = -width / 2 + (width / horizontalCount) * index
    box(group, [.018, height, .018], [x, 0, 0], color, { roughness: .52, metalness: .68 })
  }
  for (let index = 0; index <= verticalCount; index += 1) {
    const y = -height / 2 + (height / verticalCount) * index
    box(group, [width, .018, .018], [0, y, 0], color, { roughness: .52, metalness: .68 })
  }
  group.position.set(...position)
  parent.add(group)
  return group
}

function seatAssembly(parent, position, accent = 0x151a1c) {
  const group = new THREE.Group()
  group.position.set(...position)
  roundedBox(group, [.58, .16, .56], [0, .12, 0], accent, { roughness: .9, metalness: 0 }, .09, 5)
  const back = roundedBox(group, [.54, .64, .17], [0, .48, .24], accent, { roughness: .92, metalness: 0 }, .09, 5)
  back.rotation.x = -.09
  ;[-.16, 0, .16].forEach((x) => box(back, [.008, .43, .012], [x, 0, -.095], 0x303638, { roughness: 1, metalness: 0 }))
  roundedBox(group, [.7, .09, .48], [0, -.02, .02], 0x2b3336, { roughness: .45, metalness: .42 }, .035)
  parent.add(group)
  return group
}

function addGuard(root, dimensions, color = 0x141a1c) {
  const [width, height, depth] = dimensions
  const posts = []
  ;[-width / 2, width / 2].forEach((x) => {
    ;[-depth / 2, depth / 2].forEach((z) => posts.push(box(root, [.065, height, .075], [x, height / 2 + .72, z], color, { roughness: .38, metalness: .72 })))
  })
  ;[-depth / 2, depth / 2].forEach((z) => box(root, [width + .1, .075, .075], [0, height + .72, z], color, { roughness: .38, metalness: .72 }))
  ;[-width / 2, width / 2].forEach((x) => box(root, [.075, .075, depth + .1], [x, height + .72, 0], color, { roughness: .38, metalness: .72 }))
  for (let x = -width / 2 + .18; x < width / 2; x += .22) box(root, [.035, .045, depth], [x, height + .735, 0], color, { roughness: .45, metalness: .7 })
  return posts
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
  markControl(ellipsoid(steerPivot, [.14, .055, .11], [0, .22, -.02], 0x222b2e, { roughness: .72, metalness: .02 }), 'steer', 'Crown palm steering tiller', 'horizontal', false)
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
  markControl(roundedBox(controls, [.36, .035, .3], [.22, .35, -.045], 0x303b3d, { roughness: .94, metalness: 0 }, .014), 'presence', 'Right operator presence pedal', 'button', false)
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

function buildRaymondReach(_profile) {
  const root = new THREE.Group()
  root.name = 'Raymond 7500 Universal Stance reference-built truck'
  const raymondRed = 0xc93635
  const redFinish = { roughness: .31, metalness: .17, clearcoat: .24, clearcoatRoughness: .28 }
  const blackFinish = { roughness: .39, metalness: .62 }
  const body = roundedBox(root, [1.04, .78, 1.18], [0, .51, .48], raymondRed, redFinish, .08, 6)
  roundedBox(root, [1.0, .24, 1.08], [0, .92, .46], 0x20282b, { roughness: .6, metalness: .04 }, .07)
  roundedBox(root, [.12, .72, .92], [-.46, 1.25, .5], raymondRed, redFinish, .035)
  roundedBox(root, [.12, .72, .92], [.46, 1.25, .5], raymondRed, redFinish, .035)
  roundedBox(root, [.025, .58, .74], [-.398, 1.25, .48], 0x1b2326, { roughness: .88, metalness: .02 }, .015)
  roundedBox(root, [.025, .58, .74], [.398, 1.25, .48], 0x1b2326, { roughness: .88, metalness: .02 }, .015)
  roundedBox(root, [.83, .28, .12], [0, 1.48, .9], 0x1a2225, { roughness: .76, metalness: .03 }, .04)
  roundedBox(root, [.82, .07, .72], [0, .26, .49], 0x303a3d, { roughness: .9, metalness: .02 }, .025)
  textDecal(root, 'RAYMOND', [.526, .88, .47], [.46, .105], '#f4f5f5', [0, Math.PI / 2, 0])
  slottedGrille(root, [.527, .62, .35], 5, 0x111719, .045, false)

  const mast = new THREE.Group()
  mast.position.z = -.68
  const mastHeight = 3.7
  ;[-.47, .47].forEach((x) => {
    roundedBox(mast, [.12, mastHeight, .16], [x, mastHeight / 2, 0], 0x111719, blackFinish, .018)
    roundedBox(mast, [.07, 3.12, .095], [x * .82, 1.66, -.055], 0x2a3336, blackFinish, .012)
  })
  ;[.3, 1.42, 2.48, 3.58].forEach((y) => box(mast, [1.02, .08, .14], [0, y, .01], 0x111719, blackFinish))
  cylinder(mast, .052, 2.7, [0, 1.58, .02], 0x242d30, [0, 0, 0], 28)
  cylinder(mast, .028, 2.08, [0, 1.72, -.035], 0x879194, [0, 0, 0], 24)
  ;[-.3, .3].forEach((x) => box(mast, [.017, 2.76, .022], [x, 1.72, -.1], 0x121718, { roughness: .52, metalness: .88 }))
  root.add(mast)
  const carriage = new THREE.Group()
  carriage.position.set(0, .02, -.12)
  roundedBox(carriage, [1.0, .25, .11], [0, .28, 0], 0x141a1c, blackFinish, .014)
  mast.add(carriage)
  const reachGroup = new THREE.Group()
  carriage.add(reachGroup)
  ;[-.41, .41].forEach((x) => {
    beamBetween(reachGroup, new THREE.Vector3(x, .13, -.02), new THREE.Vector3(x, .48, -.43), .043, 0x161c1e, blackFinish)
    beamBetween(reachGroup, new THREE.Vector3(x, .48, -.02), new THREE.Vector3(x, .13, -.43), .043, 0x161c1e, blackFinish)
  })
  roundedBox(reachGroup, [1.02, .24, .1], [0, .29, -.48], 0x171d20, blackFinish, .014)
  ;[-.34, .34].forEach((x) => roundedBox(reachGroup, [.102, .045, .95], [x, .115, -.94], raymondRed, { roughness: .37, metalness: .68 }, .012))
  ;[-.43, .43].forEach((x) => box(reachGroup, [.052, .9, .052], [x, .73, -.53], 0x171d20, blackFinish))
  ;[.36, .65, .94, 1.17].forEach((y) => box(reachGroup, [.9, .042, .042], [0, y, -.53], 0x171d20, blackFinish))

  const loadWheels = []
  ;[-.48, .48].forEach((x) => {
    roundedBox(root, [.11, .16, 1.56], [x, .17, -1.19], 0x20282b, blackFinish, .03)
    roundedBox(root, [.075, .1, 1.38], [x, .26, -1.15], raymondRed, redFinish, .022)
    loadWheels.push(wheel(root, [x, .09, -1.8], .074, .1))
  })
  const driveWheel = wheel(root, [0, .17, .78], .17, .15)

  const controls = new THREE.Group()
  controls.name = 'Raymond 7500 universal stance compartment'
  roundedBox(controls, [1.0, .28, .44], [0, 1.06, .02], 0x161e21, { roughness: .59, metalness: .04 }, .07)
  roundedBox(controls, [.9, .13, .35], [0, 1.2, -.01], 0x293337, { roughness: .52, metalness: .05 }, .05)
  addDisplay(controls, [-.12, 1.34, .25], 'Raymond')
  const steerPivot = new THREE.Group()
  steerPivot.position.set(-.34, 1.08, -.08)
  const steering = markControl(new THREE.Mesh(new THREE.TorusGeometry(.13, .028, 10, 26), material(0x161d20, { roughness: .76, metalness: .02 })), 'steer', 'Raymond universal-stance steering control', 'horizontal', false)
  steering.rotation.x = Math.PI / 2.15
  steerPivot.add(steering)
  roundedBox(steerPivot, [.13, .2, .12], [0, -.08, .03], 0x222c2f, { roughness: .55, metalness: .04 }, .04)
  controls.add(steerPivot)
  const travelPivot = new THREE.Group()
  travelPivot.position.set(.34, 1.1, -.07)
  roundedBox(travelPivot, [.28, .16, .22], [0, 0, 0], 0x1e282b, { roughness: .54, metalness: .04 }, .055)
  const handle = markControl(ellipsoid(travelPivot, [.085, .15, .078], [0, .19, -.01], 0x111719, { roughness: .74, metalness: .02 }), 'travel', 'Raymond single-axis control handle', 'vertical', true)
  handle.rotation.x = -.12
  markControl(roundedBox(travelPivot, [.085, .05, .11], [-.06, .29, -.055], 0xcf3533, { roughness: .38, metalness: .04 }, .016), 'lift', 'Lift and lower rocker', 'vertical', true)
  markControl(roundedBox(travelPivot, [.085, .05, .11], [.06, .29, -.055], 0x6b777a, { roughness: .48, metalness: .12 }, .016), 'reach', 'Reach and retract rocker', 'horizontal', true)
  markControl(roundedBox(travelPivot, [.06, .04, .07], [0, .35, -.075], 0xd8a126, { roughness: .42, metalness: .05 }, .012), 'horn', 'Horn button', 'button', true)
  controls.add(travelPivot)
  markControl(roundedBox(controls, [.25, .04, .23], [-.25, .35, -.1], 0x252e31, { roughness: .9, metalness: .02 }, .015), 'brake', 'Brake pedal', 'pedal', true)
  markControl(roundedBox(controls, [.36, .035, .3], [.2, .35, -.03], 0x364246, { roughness: .92, metalness: 0 }, .014), 'presence', 'Universal deadman pedal', 'button', false)
  root.add(controls)
  addGuard(root, [1.02, 1.56, 1.18], 0x151b1d)
  const cameraMount = new THREE.Group()
  cameraMount.position.set(.02, 1.68, .67)
  root.add(cameraMount)
  return { root, body, mast, carriage, reachGroup, cameraMount, platform: null, controls, family: 'reach', steerPivot, travelPivot, driveWheel, loadWheels, tiltGroup: carriage, specification: 'Raymond 7500 Universal Stance' }
}

function buildOrderPicker(profile) {
  const root = new THREE.Group()
  const crown = profile.manufacturer === 'Crown'
  root.name = crown ? 'Crown SP 1500 reference-built order picker' : 'Raymond 5300 reference-built order picker'
  const paint = crown ? profile.color : 0xc93635
  const accent = crown ? 0xf0a318 : 0xc93635
  const paintFinish = { roughness: .31, metalness: .17, clearcoat: .22, clearcoatRoughness: .28 }
  const blackFinish = { roughness: .4, metalness: .6 }
  const body = roundedBox(root, [1.04, .76, 1.0], [0, .5, .62], paint, paintFinish, .09, 6)
  roundedBox(root, [1.0, .22, .92], [0, .91, .6], 0x20282b, { roughness: .58, metalness: .04 }, .065)
  roundedBox(root, [.11, .62, .82], [-.47, .91, .62], paint, paintFinish, .035)
  roundedBox(root, [.11, .62, .82], [.47, .91, .62], paint, paintFinish, .035)
  textDecal(root, crown ? 'SP 1500' : 'RAYMOND 5300', [.526, .82, .61], [.5, .095], crown ? '#2c3335' : '#f3f4f4', [0, Math.PI / 2, 0])
  ;[-.43, .43].forEach((x) => wheel(root, [x, .22, .78], .22, .12))

  const mast = new THREE.Group()
  mast.position.z = -.56
  const mastHeight = 4.35
  ;[-.48, .48].forEach((x) => {
    roundedBox(mast, [.12, mastHeight, .16], [x, mastHeight / 2, 0], 0x12191b, blackFinish, .017)
    roundedBox(mast, [.072, 3.75, .095], [x * .82, 1.95, -.055], 0x2b3538, blackFinish, .012)
  })
  ;[.31, 1.55, 2.72, 4.22].forEach((y) => box(mast, [1.05, .085, .14], [0, y, .01], 0x12191b, blackFinish))
  cylinder(mast, .05, 3.15, [0, 1.82, .015], 0x263033, [0, 0, 0], 26)
  ;[-.29, .29].forEach((x) => box(mast, [.017, 3.25, .022], [x, 1.9, -.1], 0x121718, { roughness: .5, metalness: .88 }))
  root.add(mast)
  const carriage = new THREE.Group()
  carriage.position.set(0, .02, -.14)
  roundedBox(carriage, [1.03, .24, .12], [0, .27, 0], 0x151c1e, blackFinish, .014)
  mast.add(carriage)
  const platform = new THREE.Group()
  roundedBox(platform, [1.1, .09, 1.08], [0, .84, .25], 0x343f42, { roughness: .82, metalness: .14 }, .025)
  box(platform, [.98, .018, .94], [0, .895, .25], 0x242b2d, { roughness: .96, metalness: 0 })
  roundedBox(platform, [1.08, .68, .1], [0, 1.25, .77], paint, paintFinish, .035)
  roundedBox(platform, [.085, .94, .9], [-.52, 1.38, .24], 0x1b2427, blackFinish, .025)
  roundedBox(platform, [.085, .94, .9], [.52, 1.38, .24], 0x1b2427, blackFinish, .025)
  meshPanel(platform, .88, .68, [0, 1.57, .73], 0x151c1e)
  roundedBox(platform, [1.12, .12, .9], [0, 2.02, .24], 0x171e21, blackFinish, .035)
  ;[-.34, 0, .34].forEach((x) => box(platform, [.045, .05, .78], [x, 2.09, .24], 0x1a2224, blackFinish))
  const leftGate = roundedBox(platform, [.06, .62, .66], [-.58, 1.34, -.08], accent, paintFinish, .028)
  const rightGate = roundedBox(platform, [.06, .62, .66], [.58, 1.34, -.08], accent, paintFinish, .028)
  ;[leftGate, rightGate].forEach((gate) => {
    gate.rotation.x = 0
    box(gate, [.02, .48, .02], [0, 0, 0], crown ? 0x8b5609 : 0x551919, { roughness: .6, metalness: .42 })
  })
  ;[-.35, .35].forEach((x) => roundedBox(platform, [.102, .045, 1.42], [x, .72, -.9], 0x343d3f, { roughness: .42, metalness: .82 }, .012))
  carriage.add(platform)

  const controls = new THREE.Group()
  controls.position.set(0, 1.05, -.15)
  roundedBox(controls, [1.0, .42, .35], [0, .48, .02], 0x20292c, { roughness: .6, metalness: .04 }, .065)
  roundedBox(controls, [.9, .13, .29], [0, .67, -.03], 0x303a3d, { roughness: .52, metalness: .04 }, .045)
  addDisplay(controls, [0, .78, .2], profile.manufacturer)
  const steerPivot = new THREE.Group()
  steerPivot.position.set(-.32, .9, .3)
  const tiller = markControl(new THREE.Mesh(new THREE.TorusGeometry(.14, .034, 10, 26), material(0x3b484b, { roughness: .7, metalness: .08 })), 'steer', crown ? 'Crown dual-position steering tiller' : 'Raymond order-picker steering control', 'horizontal', false)
  tiller.rotation.x = Math.PI / 2.2
  steerPivot.add(tiller)
  roundedBox(steerPivot, [.1, .1, .08], [0, 0, .035], crown ? 0xe0a221 : 0xc93635, { roughness: .4, metalness: .04 }, .025)
  controls.add(steerPivot)
  const travelPivot = new THREE.Group()
  travelPivot.position.set(.31, .9, .3)
  roundedBox(travelPivot, [.22, .15, .2], [0, 0, 0], 0x182124, { roughness: .56, metalness: .04 }, .05)
  const handle = markControl(ellipsoid(travelPivot, [.08, .14, .075], [0, .17, -.01], 0x111719, { roughness: .75, metalness: .02 }), 'travel', profile.control, 'vertical', true)
  handle.rotation.x = -.11
  markControl(roundedBox(travelPivot, [.09, .05, .11], [0, .27, -.055], accent, { roughness: .4, metalness: .04 }, .016), 'lift', 'Platform lift and lower rocker', 'vertical', true)
  markControl(roundedBox(travelPivot, [.055, .035, .07], [-.06, .32, -.07], 0xd9a126, { roughness: .4, metalness: .04 }, .012), 'horn', 'Horn button', 'button', true)
  controls.add(travelPivot)
  markControl(roundedBox(controls, [.44, .035, .42], [0, .055, .24], 0x3b474a, { roughness: .94, metalness: 0 }, .015), 'presence', 'Order-picker deadman pedal', 'button', false)
  carriage.add(controls)

  const cameraMount = new THREE.Group()
  cameraMount.position.set(0, 2.25, .6)
  carriage.add(cameraMount)
  return { root, body, mast, carriage, reachGroup: null, cameraMount, platform, controls, family: 'order-picker', steerPivot, travelPivot, gates: [leftGate, rightGate], specification: crown ? 'Crown SP 1500' : 'Raymond 5300' }
}

function buildPallet(profile) {
  const root = new THREE.Group()
  const walkie = profile.stance.includes('Walk')
  const crown = profile.manufacturer === 'Crown'
  root.name = crown ? 'Crown PE 4500 reference-built end rider' : 'Raymond 8210 reference-built walkie'
  const paint = crown ? profile.color : 0xc93635
  const paintFinish = { roughness: .31, metalness: .16, clearcoat: .22, clearcoatRoughness: .3 }
  const blackFinish = { roughness: .42, metalness: .56 }
  const bodyDepth = walkie ? .78 : 1.08
  const body = roundedBox(root, [walkie ? .72 : .92, .62, bodyDepth], [0, .42, .47], paint, paintFinish, walkie ? .16 : .12, 7)
  roundedBox(root, [walkie ? .69 : .88, .17, bodyDepth - .08], [0, .75, .46], 0x20282b, { roughness: .58, metalness: .04 }, .07)
  roundedBox(root, [walkie ? .7 : .9, .17, .24], [0, .28, .09], 0x171f22, { roughness: .56, metalness: .28 }, .06)
  if (walkie) {
    slottedGrille(root, [0, .35, .077], 5, 0x0b1012, .05, true)
    textDecal(root, 'RAYMOND', [.365, .56, .45], [.46, .1], '#f4f5f5', [0, Math.PI / 2, 0])
  } else {
    slottedGrille(root, [-.28, .58, -.075], 5, 0x0b1012, .035, false)
    slottedGrille(root, [.28, .58, -.075], 5, 0x0b1012, .035, false)
    textDecal(root, 'CROWN PE', [.466, .55, .43], [.4, .085], '#293133', [0, Math.PI / 2, 0])
  }
  ;[-(walkie ? .32 : .42), walkie ? .32 : .42].forEach((x) => wheel(root, [x, .2, .43], .2, .115))
  const carriage = new THREE.Group()
  ;[-.33, .33].forEach((x) => {
    roundedBox(carriage, [.17, .09, 2.25], [x, .13, -1.02], 0x343d3f, { roughness: .42, metalness: .82 }, .014)
    wheel(carriage, [x, .075, -1.98], .07, .11)
  })
  root.add(carriage)
  const platform = walkie ? null : roundedBox(root, [.94, .1, .72], [0, .22, 1.23], 0x333d40, { roughness: .64, metalness: .48 }, .028)
  if (!walkie) {
    box(root, [.86, .018, .57], [0, .28, 1.23], 0x202729, { roughness: .96, metalness: 0 })
    roundedBox(root, [.98, .6, .1], [0, .53, 1.58], paint, paintFinish, .04)
    roundedBox(root, [.86, .18, .08], [0, .81, 1.52], 0x182023, { roughness: .75, metalness: .04 }, .035)
    markControl(roundedBox(root, [.52, .032, .38], [0, .3, 1.23], 0x435158, { roughness: .94, metalness: 0 }, .015), 'presence', 'Rider presence pad', 'button', false)
  }

  const controls = new THREE.Group()
  const tillerPivot = new THREE.Group()
  tillerPivot.position.set(0, walkie ? .32 : .62, walkie ? .23 : .44)
  const shaft = roundedBox(tillerPivot, [.095, walkie ? .76 : .55, .13], [0, walkie ? .37 : .25, .14], 0x2b3538, { roughness: .47, metalness: .46 }, .04)
  shaft.rotation.x = walkie ? -.3 : -.18
  const headGroup = new THREE.Group()
  headGroup.position.set(0, walkie ? .78 : .56, walkie ? .27 : .21)
  const head = markControl(new THREE.Mesh(new THREE.TorusGeometry(walkie ? .235 : .29, .055, 10, 34), material(0x141b1e, { roughness: .72, metalness: .03 })), 'steer', profile.control, 'horizontal', false)
  head.scale.y = walkie ? .76 : .55
  headGroup.add(head)
  roundedBox(headGroup, [walkie ? .29 : .36, .18, .15], [0, .08, 0], 0x1e282b, { roughness: .56, metalness: .04 }, .06)
  const leftThrottle = markControl(roundedBox(headGroup, [.1, .1, .13], [-.15, .06, -.08], 0x4b5a5e, { roughness: .62, metalness: .08 }, .025), 'travel', crown ? 'Left X10 twist grip' : 'Left butterfly throttle', 'horizontal', true)
  const rightThrottle = markControl(roundedBox(headGroup, [.1, .1, .13], [.15, .06, -.08], 0x4b5a5e, { roughness: .62, metalness: .08 }, .025), 'travel', crown ? 'Right X10 twist grip' : 'Right butterfly throttle', 'horizontal', true)
  markControl(roundedBox(headGroup, [.11, .045, .075], [0, .17, -.09], crown ? 0xe2a126 : 0x49565a, { roughness: .44, metalness: .04 }, .012), 'lift', 'Fork lift and lower rocker', 'vertical', true)
  markControl(roundedBox(headGroup, [.075, .04, .065], [-.08, .17, -.09], 0xe2a126, { roughness: .44, metalness: .04 }, .012), 'horn', 'Horn button', 'button', true)
  markControl(roundedBox(headGroup, [.18, .07, .06], [0, -.12, -.075], 0xd53b37, { roughness: .38, metalness: .04 }, .02), 'belly', 'Emergency reverse switch', 'button', true)
  tillerPivot.add(headGroup)
  controls.add(tillerPivot)
  root.add(controls)
  if (walkie) {
    const loadBackrest = new THREE.Group()
    loadBackrest.position.set(0, .54, -.15)
    roundedBox(loadBackrest, [.72, .055, .055], [0, .53, 0], 0x1b2326, blackFinish, .018)
    ;[-.34, .34].forEach((x) => roundedBox(loadBackrest, [.055, 1.08, .055], [x, 0, 0], 0x1b2326, blackFinish, .018))
    ;[-.18, 0, .18].forEach((x) => box(loadBackrest, [.025, .95, .025], [x, 0, 0], 0x1b2326, blackFinish))
    root.add(loadBackrest)
  }
  const cameraMount = new THREE.Group()
  cameraMount.position.set(walkie ? .34 : 0, walkie ? 1.57 : 1.55, walkie ? 1.45 : 1.35)
  if (walkie) cameraMount.rotation.y = .12
  root.add(cameraMount)
  return { root, body, mast: null, carriage, reachGroup: null, cameraMount, platform, controls, tillerPivot, family: 'pallet', walkie, headGroup, leftThrottle, rightThrottle, specification: crown ? 'Crown PE 4500' : 'Raymond 8210' }
}

function buildCounterbalance(profile) {
  const root = new THREE.Group()
  const crown = profile.manufacturer === 'Crown'
  root.name = crown ? 'Crown SC 6200 four-wheel reference-built truck' : 'Raymond 4460 three-wheel reference-built truck'
  const paint = crown ? profile.color : 0xc93635
  const paintFinish = { roughness: .3, metalness: .18, clearcoat: .25, clearcoatRoughness: .27 }
  const blackFinish = { roughness: .4, metalness: .62 }
  const body = roundedBox(root, [1.12, .64, 1.72], [0, .45, .27], paint, paintFinish, .16, 8)
  roundedBox(root, [1.17, .36, 1.78], [0, .27, .25], 0x20272a, { roughness: .55, metalness: .32 }, .14, 7)
  ellipsoid(root, [.57, .36, .72], [0, .72, .72], paint, paintFinish, 32)
  roundedBox(root, [1.02, .19, .84], [0, .93, .5], 0x222b2e, { roughness: .58, metalness: .04 }, .08)
  roundedBox(root, [1.04, .17, .57], [0, .73, -.42], paint, paintFinish, .07)
  textDecal(root, crown ? 'CROWN SC 6200' : 'RAYMOND 4460', [.575, .72, .5], [.54, .09], crown ? '#293133' : '#f3f4f4', [0, Math.PI / 2, 0])
  slottedGrille(root, [.577, .68, .74], crown ? 5 : 4, 0x111719, .04, false)

  const mast = new THREE.Group()
  mast.position.z = -.78
  const mastHeight = 3.25
  ;[-.5, .5].forEach((x) => {
    roundedBox(mast, [.13, mastHeight, .18], [x, mastHeight / 2, 0], 0x111719, blackFinish, .018)
    roundedBox(mast, [.078, 2.72, .1], [x * .8, 1.48, -.06], 0x2b3538, blackFinish, .012)
  })
  ;[.3, 1.35, 2.3, 3.12].forEach((y) => box(mast, [1.1, .09, .15], [0, y, .01], 0x111719, blackFinish))
  cylinder(mast, .06, 2.44, [0, 1.48, .02], 0x242d30, [0, 0, 0], 28)
  cylinder(mast, .032, 1.86, [0, 1.55, -.04], 0x899397, [0, 0, 0], 24)
  ;[-.31, .31].forEach((x) => box(mast, [.018, 2.45, .022], [x, 1.58, -.11], 0x121718, { roughness: .5, metalness: .9 }))
  root.add(mast)
  const carriage = new THREE.Group()
  carriage.position.set(0, .02, -.12)
  roundedBox(carriage, [1.06, .29, .12], [0, .28, 0], 0x151c1e, blackFinish, .014)
  ;[-.36, .36].forEach((x) => roundedBox(carriage, [.105, .05, 1.05], [x, .11, -.56], 0x343d3f, { roughness: .4, metalness: .82 }, .012))
  ;[-.46, .46].forEach((x) => box(carriage, [.052, .9, .052], [x, .72, -.08], 0x151c1e, blackFinish))
  ;[.37, .66, .95, 1.18].forEach((y) => box(carriage, [.96, .043, .043], [0, y, -.08], 0x151c1e, blackFinish))
  mast.add(carriage)

  const frontWheels = []
  ;[-.55, .55].forEach((x) => frontWheels.push(wheel(root, [x, .35, -.48], .35, .19)))
  const rearWheels = []
  if (crown) {
    ;[-.47, .47].forEach((x) => rearWheels.push(wheel(root, [x, .27, .92], .27, .16)))
  } else {
    rearWheels.push(wheel(root, [0, .29, .96], .29, .34))
  }
  frontWheels.forEach((truckWheel) => {
    const hub = cylinder(truckWheel, .13, .195, [0, 0, 0], 0x687276, [0, 0, 0], 24)
    hub.rotation.z = 0
  })

  addGuard(root, [1.12, 1.77, 1.35], 0x141a1c)
  ;[-.56, .56].forEach((x) => {
    const frontPost = box(root, [.075, 1.78, .085], [x, 1.6, -.38], 0x141a1c, blackFinish)
    frontPost.rotation.x = .08
    const rearPost = box(root, [.075, 1.7, .085], [x, 1.58, .72], 0x141a1c, blackFinish)
    rearPost.rotation.x = -.08
  })
  const seat = seatAssembly(root, [0, .82, .55], 0x151a1c)
  const controls = new THREE.Group()
  roundedBox(controls, [1.02, .38, .46], [0, 1.03, -.33], 0x273236, { roughness: .58, metalness: .04 }, .07)
  roundedBox(controls, [.9, .12, .38], [0, 1.23, -.4], 0x303a3d, { roughness: .5, metalness: .04 }, .045)
  addDisplay(controls, [0, 1.28, -.12], profile.manufacturer)
  const wheelPivot = new THREE.Group()
  wheelPivot.position.set(-.28, 1.3, -.47)
  const steeringWheel = markControl(new THREE.Mesh(new THREE.TorusGeometry(.235, .032, 10, 32), material(controlBlack, { roughness: .74, metalness: .03 })), 'steer', crown ? 'Crown steering wheel' : 'Raymond tilt steering wheel', 'horizontal', false)
  steeringWheel.rotation.x = Math.PI / 2.55
  wheelPivot.add(steeringWheel)
  cylinder(wheelPivot, .045, .3, [0, -.08, .08], 0x343f42, [.62, 0, 0], 20)
  controls.add(wheelPivot)
  const levers = []
  const leverXs = crown ? [.18, .36, .54] : [.16, .34, .52]
  ;[['lift', leverXs[0], crown ? 0xe0a221 : 0x151c1e], ['tilt', leverXs[1], 0x60767e], ['sideshift', leverXs[2], 0x60767e]].forEach(([action, x, color]) => {
    const pivot = new THREE.Group()
    pivot.position.set(x, 1.18, -.33)
    markControl(cylinder(pivot, .03, .32, [0, .14, 0], steel), action, `${profile.manufacturer} ${action} lever`, 'vertical', true)
    cylinder(pivot, .058, .11, [0, .32, 0], color)
    pivot.rotation.x = -.18
    controls.add(pivot)
    levers.push(pivot)
  })
  markControl(roundedBox(controls, [.22, .05, .28], [.25, .18, -.24], 0x30383b, { roughness: .9, metalness: .02 }, .015), 'travel', 'Accelerator pedal', 'vertical', true)
  markControl(roundedBox(controls, [.22, .05, .28], [-.16, .18, -.24], 0x30383b, { roughness: .9, metalness: .02 }, .015), 'brake', 'Brake pedal', 'vertical', true)
  markControl(roundedBox(controls, [.13, .045, .11], [-.5, 1.2, -.48], crown ? 0xe0a221 : 0xc93635, { roughness: .4, metalness: .04 }, .014), 'horn', 'Horn button', 'button', true)
  roundedBox(controls, [.72, .1, .62], [0, .67, .42], 0x303a3e, { roughness: .65, metalness: .08 }, .04)
  markControl(roundedBox(controls, [.13, .05, .14], [.4, .76, .54], 0xc94736, { roughness: .42, metalness: .04 }, .014), 'presence', 'Seat switch and restraint', 'button', false)
  root.add(controls)
  const cameraMount = new THREE.Group()
  cameraMount.position.set(0, 1.69, .48)
  root.add(cameraMount)
  return { root, body, mast, carriage, reachGroup: null, cameraMount, platform: null, controls, wheelPivot, levers, family: 'counterbalance', seat, frontWheels, rearWheels, tiltGroup: mast, specification: crown ? 'Crown SC 6200 four-wheel' : 'Raymond 4460 three-wheel' }
}

export function createVehicleRig(profile) {
  if (profile.family === 'reach' && profile.manufacturer === 'Crown') return buildCrownReach(profile)
  if (profile.family === 'reach') return buildRaymondReach(profile)
  if (profile.family === 'order-picker') return buildOrderPicker(profile)
  if (profile.family === 'pallet') return buildPallet(profile)
  return buildCounterbalance(profile)
}

export function controlMeshes(rig) {
  const result = []
  rig.root.traverse((object) => { if (object.userData.control) result.push(object) })
  return result
}
