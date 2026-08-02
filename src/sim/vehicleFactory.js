import * as THREE from 'three'

const dark = 0x172126
const rubber = 0x0b1013
const steel = 0x37454b
const controlBlack = 0x11191d

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .62, metalness: .18, ...options })
}

function box(parent, size, position, color, options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color, options))
  mesh.position.set(...position)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
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
