import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

// Facility built to real warehouse dimensions: 12 ft aisle, 42 in deep selective
// rack on 8 ft beam elevations, 48x40 GMA pallets, 28 ft clear height.
// Static structure is merged per material and repeated loads are instanced so
// the scene stays inside a Quest draw-call budget.

const IN = .0254
const FT = .3048

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .12, ...options })
}

const MATERIALS = {
  upright: material(0x2f4f60, { roughness: .52, metalness: .55 }),
  beam: material(0xd2701c, { roughness: .48, metalness: .35 }),
  wireDeck: material(0x8d959a, { roughness: .55, metalness: .7 }),
  palletWood: material(0xa87a4b, { roughness: .92, metalness: 0 }),
  palletWorn: material(0x8d6238, { roughness: .95, metalness: 0 }),
}

function boxGeometry(size, position, rotation) {
  const geometry = new THREE.BoxGeometry(...size)
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  if (rotation) quaternion.setFromEuler(new THREE.Euler(...rotation))
  matrix.compose(new THREE.Vector3(...position), quaternion, new THREE.Vector3(1, 1, 1))
  geometry.applyMatrix4(matrix)
  return geometry
}

function merged(parts, mat, scene, castShadow = true) {
  if (!parts.length) return null
  const geometry = mergeGeometries(parts, false)
  const mesh = new THREE.Mesh(geometry, mat)
  mesh.castShadow = castShadow
  mesh.receiveShadow = true
  scene.add(mesh)
  return mesh
}

function concreteMaterial() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  const image = context.createImageData(512, 512)
  for (let index = 0; index < image.data.length; index += 4) {
    const grain = Math.random() * 26 + Math.random() * 14
    const blotch = Math.sin(index * .00013) * 7
    image.data[index] = 122 + grain + blotch
    image.data[index + 1] = 126 + grain + blotch
    image.data[index + 2] = 127 + grain + blotch
    image.data[index + 3] = 255
  }
  context.putImageData(image, 0, 0)
  // saw-cut control joints on a 12 ft grid, plus tire-path burnish
  context.strokeStyle = 'rgba(58,63,66,.55)'
  context.lineWidth = 3
  context.beginPath()
  context.moveTo(0, 0); context.lineTo(0, 512)
  context.moveTo(0, 0); context.lineTo(512, 0)
  context.stroke()
  context.fillStyle = 'rgba(150,156,158,.16)'
  for (let index = 0; index < 40; index += 1) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    context.beginPath()
    context.ellipse(x, y, 30 + Math.random() * 60, 16 + Math.random() * 30, Math.random() * 3, 0, Math.PI * 2)
    context.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(7, 12)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  const bump = texture.clone()
  bump.colorSpace = THREE.NoColorSpace
  bump.needsUpdate = true
  return new THREE.MeshStandardMaterial({
    color: 0x9ba0a1, map: texture, bumpMap: bump, bumpScale: .35, roughness: .74, metalness: .02,
  })
}

function cartonTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  context.fillStyle = '#b5854f'
  context.fillRect(0, 0, 256, 256)
  const noise = context.getImageData(0, 0, 256, 256)
  for (let index = 0; index < noise.data.length; index += 4) {
    const variation = (Math.random() - .5) * 22
    noise.data[index] += variation
    noise.data[index + 1] += variation
    noise.data[index + 2] += variation
  }
  context.putImageData(noise, 0, 0)
  // center seam + tape line, the visual signature of a shipping carton
  context.fillStyle = 'rgba(120,86,50,.55)'
  context.fillRect(0, 124, 256, 3)
  context.fillStyle = 'rgba(214,203,182,.75)'
  context.fillRect(0, 118, 256, 14)
  context.fillStyle = 'rgba(72,62,52,.5)'
  context.fillRect(30, 150, 78, 8)
  context.fillRect(30, 166, 60, 6)
  context.fillRect(30, 178, 92, 5)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function palletGeometry() {
  // 48 x 40 in GMA stringer pallet, 5.5 in tall
  const width = 48 * IN
  const depth = 40 * IN
  const parts = []
  const stringerH = 3.5 * IN
  ;[-depth / 2 + .06, 0, depth / 2 - .06].forEach((z) => {
    parts.push(boxGeometry([width, stringerH, 1.4 * IN], [0, stringerH / 2 + .9 * IN, z]))
  })
  const topBoards = 7
  for (let index = 0; index < topBoards; index += 1) {
    const x = -width / 2 + (index + .5) * (width / topBoards)
    parts.push(boxGeometry([width / topBoards - .012, .7 * IN, depth], [x, stringerH + 1.25 * IN, 0]))
  }
  ;[-width / 2 + .09, 0, width / 2 - .09].forEach((x) => {
    parts.push(boxGeometry([.16, .7 * IN, depth], [x, .35 * IN, 0]))
  })
  return mergeGeometries(parts, false)
}

function cartonStackGeometry(columns = 2, rows = 2, layers = 2, jitter = .012) {
  // Case-goods pallet: 24x20x18 in cartons, two per side per layer. Fewer and
  // larger than a brick pile. That is what a real palletized load looks like.
  const parts = []
  const width = 1.18 / columns
  const depth = .98 / rows
  const height = .44
  for (let layer = 0; layer < layers; layer += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const offsetX = (Math.random() - .5) * jitter
        const offsetZ = (Math.random() - .5) * jitter
        parts.push(boxGeometry(
          [width - .03, height - .02, depth - .03],
          [-.59 + (column + .5) * width + offsetX, .148 + height * (layer + .5), -.49 + (row + .5) * depth + offsetZ],
          [0, (Math.random() - .5) * .05, 0],
        ))
      }
    }
  }
  return mergeGeometries(parts, false)
}

function palletLoad(parent, position, tint = 0xb5854f, wrapped = false) {
  const group = new THREE.Group()
  const pallet = new THREE.Mesh(palletGeometry(), MATERIALS.palletWood)
  pallet.castShadow = true
  pallet.receiveShadow = true
  group.add(pallet)
  const cartons = new THREE.Mesh(
    cartonStackGeometry(),
    new THREE.MeshStandardMaterial({ color: tint, map: cartonTexture(), roughness: .93, metalness: 0 }),
  )
  cartons.castShadow = true
  cartons.receiveShadow = true
  group.add(cartons)
  if (wrapped) {
    const wrap = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.02, 1.0),
      new THREE.MeshPhysicalMaterial({
        color: 0xd6e0e0, transparent: true, opacity: .17, roughness: .32,
        transmission: .55, thickness: .04, depthWrite: false,
      }),
    )
    wrap.position.y = .66
    group.add(wrap)
  }
  group.position.set(...position)
  parent.add(group)
  return group
}

function buildRackRun(scene, x, zStart, bays, facing) {
  // Selective pallet rack: 3 in teardrop uprights, 42 in deep frames, 96 in bays
  const bayWidth = 96 * IN + .1
  const frameDepth = 42 * IN
  const uprightParts = []
  const beamParts = []
  const deckParts = []
  const levels = [0, 6 * FT, 12 * FT, 18 * FT]
  const height = 24 * FT

  for (let bay = 0; bay <= bays; bay += 1) {
    const z = zStart + bay * bayWidth
    ;[-frameDepth / 2, frameDepth / 2].forEach((dz) => {
      uprightParts.push(boxGeometry([.09, height, .076], [0, height / 2, z + dz]))
    })
    // K-brace lattice between the two upright columns
    for (let step = 0; step < 11; step += 1) {
      const y = .5 + step * (height - 1) / 11
      const brace = boxGeometry([.038, .038, frameDepth * 1.06], [0, y, z], [step % 2 ? .82 : -.82, 0, 0])
      uprightParts.push(brace)
      uprightParts.push(boxGeometry([.05, .05, frameDepth], [0, y + (height - 1) / 22, z]))
    }
    uprightParts.push(boxGeometry([.14, .3, frameDepth + .1], [0, .15, z]))
  }
  for (let bay = 0; bay < bays; bay += 1) {
    const zCenter = zStart + (bay + .5) * bayWidth
    levels.forEach((level, levelIndex) => {
      if (levelIndex === 0) return
      ;[-frameDepth / 2 + .05, frameDepth / 2 - .05].forEach((dz) => {
        beamParts.push(boxGeometry([.05, .11, bayWidth - .09], [.005, level, zCenter + dz]))
        beamParts.push(boxGeometry([.09, .035, bayWidth - .09], [0, level + .04, zCenter + dz]))
      })
      for (let wire = 0; wire < 9; wire += 1) {
        const z = zCenter - bayWidth / 2 + (wire + .5) * (bayWidth / 9)
        deckParts.push(boxGeometry([.012, .012, frameDepth - .06], [0, level + .06, z], [0, 0, Math.PI / 2]))
      }
      ;[-.38, -.13, .13, .38].forEach((dz) => {
        deckParts.push(boxGeometry([.014, .014, bayWidth - .1], [0, level + .07, zCenter + dz]))
      })
    })
  }
  const frames = merged(uprightParts, MATERIALS.upright, scene)
  const beams = merged(beamParts, MATERIALS.beam, scene)
  const decks = merged(deckParts, MATERIALS.wireDeck, scene, false)
  ;[frames, beams, decks].forEach((mesh) => { if (mesh) mesh.position.x = x })

  // stored pallets, thinned out so aisles read as a working facility
  const loads = []
  for (let bay = 0; bay < bays; bay += 1) {
    const zCenter = zStart + (bay + .5) * bayWidth
    levels.forEach((level, levelIndex) => {
      if (levelIndex === 0) return
      ;[-.62, .62].forEach((offset, slot) => {
        if (Math.random() < .22) return
        const tint = [0xb5854f, 0xa97a49, 0xbd8f5c, 0x9d7346][(bay + levelIndex + slot) % 4]
        loads.push(palletLoad(scene, [x - facing * .02, level + .09, zCenter + offset], tint, (bay + levelIndex) % 3 === 0))
      })
    })
  }
  return loads
}

function buildStructure(scene) {
  const clearHeight = 28 * FT
  const wallMaterial = material(0x9aa1a3, { roughness: .93, metalness: .02 })
  const wallParts = []
  ;[-11.2, 11.2].forEach((x) => wallParts.push(boxGeometry([.3, clearHeight, 44], [x, clearHeight / 2, -1])))
  wallParts.push(boxGeometry([22.7, clearHeight, .3], [0, clearHeight / 2, -21.2]))
  wallParts.push(boxGeometry([22.7, clearHeight, .3], [0, clearHeight / 2, 19.2]))
  merged(wallParts, wallMaterial, scene, false)

  const deckMaterial = material(0x6e7679, { roughness: .88, metalness: .3 })
  const roofParts = [boxGeometry([22.7, .22, 44], [0, clearHeight, -1])]
  // open-web joists + girders on 8 ft centers, the ceiling operators actually see
  for (let z = -20; z <= 18; z += 8 * FT) {
    roofParts.push(boxGeometry([22, .32, .12], [0, clearHeight - .34, z]))
    for (let step = 0; step < 18; step += 1) {
      const x = -10.6 + step * 1.24
      roofParts.push(boxGeometry([1.5, .05, .05], [x, clearHeight - .52, z], [0, 0, step % 2 ? .78 : -.78]))
    }
  }
  ;[-7.5, 0, 7.5].forEach((x) => roofParts.push(boxGeometry([.34, .5, 42], [x, clearHeight - .95, -1])))
  merged(roofParts, deckMaterial, scene, false)

  const columnParts = []
  ;[-7.5, 7.5].forEach((x) => {
    for (let z = -18; z <= 16; z += 12) {
      columnParts.push(boxGeometry([.26, clearHeight - .95, .26], [x, (clearHeight - .95) / 2, z]))
      columnParts.push(boxGeometry([.6, .05, .6], [x, .03, z]))
    }
  })
  merged(columnParts, material(0x39474d, { roughness: .6, metalness: .5 }), scene)

  // high-bay LED fixtures on the aisle centerlines
  const fixtureMaterial = new THREE.MeshStandardMaterial({
    color: 0xf2f5f0, emissive: 0xfff6e2, emissiveIntensity: 2.6, roughness: .3, metalness: .1,
  })
  const housing = material(0x2a3134, { roughness: .5, metalness: .6 })
  const housingParts = []
  const lensParts = []
  for (let z = -18; z <= 16; z += 5.6) {
    ;[-5.4, 0, 5.4].forEach((x) => {
      housingParts.push(boxGeometry([.72, .12, .34], [x, clearHeight - 1.5, z]))
      housingParts.push(boxGeometry([.05, .5, .05], [x, clearHeight - 1.2, z]))
      lensParts.push(boxGeometry([.64, .03, .28], [x, clearHeight - 1.58, z]))
    })
  }
  merged(housingParts, housing, scene, false)
  merged(lensParts, fixtureMaterial, scene, false)

  // a few real spot lights only near the working aisle; the rest is IBL + emissive
  for (let z = -12; z <= 12; z += 8) {
    const light = new THREE.SpotLight(0xfff4e0, 130, 20, .85, .6, 1.4)
    light.position.set(0, clearHeight - 1.7, z)
    light.target.position.set(0, 0, z)
    scene.add(light, light.target)
  }
}

function buildFloorMarkings(scene) {
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8b229, roughness: .62, metalness: .04 })
  const white = new THREE.MeshStandardMaterial({ color: 0xdfe3e0, roughness: .68, metalness: .03 })
  const parts = []
  ;[-4.05, 4.05].forEach((x) => {
    parts.push(boxGeometry([.1, .004, 34], [x, .012, -1]))
    parts.push(boxGeometry([.1, .004, 34], [x + (x < 0 ? -.16 : .16), .012, -1]))
  })
  ;[-14.5, 10.5].forEach((z) => parts.push(boxGeometry([8.2, .004, .12], [0, .012, z])))
  merged(parts, paint, scene, false)

  // hatched pedestrian walkway along the rack face
  const walkParts = []
  for (let z = -16; z <= 16; z += .75) {
    walkParts.push(boxGeometry([1.15, .004, .16], [-5.2, .012, z], [0, .5, 0]))
  }
  merged(walkParts, white, scene, false)
}

function pedestrian(scene, x, z, vestColor) {
  const group = new THREE.Group()
  const skin = material(0x9c6a4e, { roughness: .82 })
  const trouser = material(0x2c3a48, { roughness: .9 })
  const vest = new THREE.MeshStandardMaterial({ color: vestColor, roughness: .62, metalness: .02, emissive: vestColor, emissiveIntensity: .12 })

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.19, .42, 6, 14), vest)
  torso.position.y = 1.16
  torso.scale.z = .68
  group.add(torso)
  const hips = new THREE.Mesh(new THREE.CapsuleGeometry(.17, .16, 4, 12), trouser)
  hips.position.y = .86
  hips.scale.z = .72
  group.add(hips)
  ;[-.1, .1].forEach((dx) => {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.085, .62, 4, 10), trouser)
    leg.position.set(dx, .48, 0)
    group.add(leg)
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.062, .46, 4, 10), vest)
    arm.position.set(dx * 2.4, 1.16, 0)
    arm.rotation.z = dx * .12
    group.add(arm)
  })
  const head = new THREE.Mesh(new THREE.SphereGeometry(.115, 18, 14), skin)
  head.position.y = 1.56
  group.add(head)
  const hardHat = new THREE.Mesh(new THREE.SphereGeometry(.135, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), material(0xdcd6c4, { roughness: .45 }))
  hardHat.position.y = 1.6
  group.add(hardHat)
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(.15, .15, .016, 20), material(0xdcd6c4, { roughness: .45 }))
  brim.position.set(0, 1.6, .03)
  group.add(brim)
  ;[1.24, 1.06].forEach((y) => {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(.2, .016, 6, 20), material(0xd8dde0, { roughness: .4, metalness: .1 }))
    stripe.position.y = y
    stripe.rotation.x = Math.PI / 2
    stripe.scale.z = .7
    group.add(stripe)
  })
  group.traverse((object) => { object.castShadow = true })
  group.position.set(x, 0, z)
  scene.add(group)
  return group
}

function buildFixtures(scene) {
  const parts = []
  // guard rail protecting the column line at the aisle mouth
  ;[-7.5, 7.5].forEach((x) => {
    ;[-.7, .7].forEach((dz) => parts.push(boxGeometry([.09, 1.05, .09], [x + (x < 0 ? .55 : -.55), .52, 3.2 + dz])))
    parts.push(boxGeometry([.06, .22, 1.5], [x + (x < 0 ? .55 : -.55), .72, 3.2]))
    parts.push(boxGeometry([.06, .22, 1.5], [x + (x < 0 ? .55 : -.55), .38, 3.2]))
  })
  merged(parts, new THREE.MeshStandardMaterial({ color: 0xe0b02a, roughness: .6, metalness: .18 }), scene)

  const cones = []
  ;[[-2.1, 3.2], [0, 3.2], [2.1, 3.2]].forEach(([x, z]) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(.19, .62, 20), material(0xdd5f1c, { roughness: .7 }))
    cone.position.set(x, .31, z)
    cone.castShadow = true
    scene.add(cone)
    const base = new THREE.Mesh(new THREE.BoxGeometry(.34, .03, .34), material(0xdd5f1c, { roughness: .7 }))
    base.position.set(x, .015, z)
    scene.add(base)
    cones.push(cone)
  })

  // empty pallet stack and a battery charger against the wall, working-facility cues
  for (let index = 0; index < 6; index += 1) {
    const stack = new THREE.Mesh(palletGeometry(), index % 2 ? MATERIALS.palletWorn : MATERIALS.palletWood)
    stack.position.set(-9.4, index * .145, 13.4)
    stack.rotation.y = (Math.random() - .5) * .04
    stack.castShadow = true
    stack.receiveShadow = true
    scene.add(stack)
  }
  const charger = new THREE.Mesh(new THREE.BoxGeometry(.7, 1.15, .5), material(0x38424a, { roughness: .55, metalness: .35 }))
  charger.position.set(9.9, .58, 12.5)
  charger.castShadow = true
  scene.add(charger)
  const chargerFace = new THREE.Mesh(new THREE.BoxGeometry(.3, .2, .04), new THREE.MeshStandardMaterial({ color: 0x0d1b1e, emissive: 0x1c4a3f, emissiveIntensity: .8, roughness: .3 }))
  chargerFace.position.set(9.9, .95, 12.24)
  scene.add(chargerFace)
}

export function createWarehouse(scene) {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(23, .3, 44), concreteMaterial())
  floor.position.set(0, -.15, -1)
  floor.receiveShadow = true
  scene.add(floor)

  buildStructure(scene)
  buildFloorMarkings(scene)
  buildRackRun(scene, -6.4, -16, 11, -1)
  buildRackRun(scene, 6.4, -16, 11, 1)
  buildFixtures(scene)

  const pallet = palletLoad(scene, [0, 0, -11.5], 0xb5854f, false)
  const pedestrians = [
    pedestrian(scene, 2.7, -7.6, 0xd9d43f),
    pedestrian(scene, -2.9, 8.2, 0xe07c22),
  ]
  return { pallet, pedestrians }
}
