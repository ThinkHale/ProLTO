import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { surfaceMaterial } from './surfacing.js'

// Facility built to real warehouse dimensions: 12 ft aisle, 42 in deep selective
// rack on 8 ft beam elevations, 48x40 GMA pallets, 28 ft clear height.
// Static structure is merged per material and repeated loads are instanced so
// the scene stays inside a Quest draw-call budget.

const IN = .0254
const FT = .3048

function material(color, options = {}, treatment = null) {
  const created = new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .12, ...options })
  return treatment ? surfaceMaterial(created, treatment) : created
}

const MATERIALS = {
  upright: material(0x2f4f60, { roughness: .52, metalness: .55 }, 'structuralSteel'),
  beam: material(0xd2701c, { roughness: .48, metalness: .35 }, 'structuralSteel'),
  wireDeck: material(0x8d959a, { roughness: .55, metalness: .7 }, 'structuralSteel'),
  palletWood: material(0xa87a4b, { roughness: .92, metalness: 0 }, 'wood'),
  palletWorn: material(0x8d6238, { roughness: .95, metalness: 0 }, 'wood'),
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
  // The canvas map carries large-scale color: joints, burnish, blotching. Relief
  // now comes from the surfacing pass at true world scale instead of a bumpMap
  // reusing this same coarse image, which read as noise rather than aggregate.
  return surfaceMaterial(
    new THREE.MeshStandardMaterial({ color: 0x9ba0a1, map: texture, roughness: .74, metalness: .02 }),
    'concrete',
  )
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

// 48 x 40 in GMA stringer pallet, 5.5 in tall.
//
// ORIENTATION MATTERS AND IT WAS WRONG. The three stringers run the 48 in
// length, and a fork can only enter the openings BETWEEN them, so the truck
// approaches the 40 in face and travels along the 48 in axis. The geometry used
// to run its stringers along X while testForkPalletEngagement assumed entry
// along local -Z -- ninety degrees apart. The pallet therefore had to be
// approached from the side, and in a 12 ft aisle the side is where the rack is.
// Local axes are now: X = 40 in lateral, Z = 48 in fork travel, entry face -Z.
export const PALLET_LATERAL = 40 * IN
export const PALLET_TRAVEL = 48 * IN

function palletGeometry() {
  const lateral = PALLET_LATERAL
  const travel = PALLET_TRAVEL
  const parts = []
  const stringerH = 3.5 * IN
  // Stringers run the 48 in travel axis, spaced across the 40 in face.
  ;[-lateral / 2 + .06, 0, lateral / 2 - .06].forEach((x) => {
    parts.push(boxGeometry([1.4 * IN, stringerH, travel], [x, stringerH / 2 + .9 * IN, 0]))
  })
  // Deck boards lie across the stringers.
  const topBoards = 7
  for (let index = 0; index < topBoards; index += 1) {
    const z = -travel / 2 + (index + .5) * (travel / topBoards)
    parts.push(boxGeometry([lateral, .7 * IN, travel / topBoards - .012], [0, stringerH + 1.25 * IN, z]))
  }
  ;[-travel / 2 + .09, 0, travel / 2 - .09].forEach((z) => {
    parts.push(boxGeometry([lateral, .7 * IN, .16], [0, .35 * IN, z]))
  })
  return mergeGeometries(parts, false)
}

function cartonStackGeometry(columns = 2, rows = 2, layers = 2, jitter = .012) {
  // Case-goods pallet: 24x20x18 in cartons, two per side per layer. Fewer and
  // larger than a brick pile. That is what a real palletized load looks like.
  // Footprint follows the pallet's 40 in lateral by 48 in travel axes.
  const parts = []
  const spanX = PALLET_LATERAL - .04
  const spanZ = PALLET_TRAVEL - .04
  const width = spanX / columns
  const depth = spanZ / rows
  const height = .44
  for (let layer = 0; layer < layers; layer += 1) {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const offsetX = (Math.random() - .5) * jitter
        const offsetZ = (Math.random() - .5) * jitter
        parts.push(boxGeometry(
          [width - .03, height - .02, depth - .03],
          [-spanX / 2 + (column + .5) * width + offsetX, .148 + height * (layer + .5), -spanZ / 2 + (row + .5) * depth + offsetZ],
          [0, (Math.random() - .5) * .05, 0],
        ))
      }
    }
  }
  return mergeGeometries(parts, false)
}

function palletLoad(parent, position, tint = 0xb5854f, wrapped = false, options = {}) {
  const group = new THREE.Group()
  const pallet = new THREE.Mesh(palletGeometry(), MATERIALS.palletWood)
  pallet.castShadow = true
  pallet.receiveShadow = true
  group.add(pallet)
  const cartons = new THREE.Mesh(
    cartonStackGeometry(),
    surfaceMaterial(
      new THREE.MeshStandardMaterial({ color: tint, map: cartonTexture(), roughness: .93, metalness: 0 }),
      'cardboard',
    ),
  )
  cartons.castShadow = true
  cartons.receiveShadow = true
  group.add(cartons)
  if (wrapped) {
    const wrap = new THREE.Mesh(
      new THREE.BoxGeometry(PALLET_LATERAL - .02, 1.02, PALLET_TRAVEL - .02),
      new THREE.MeshPhysicalMaterial({
        color: 0xd6e0e0, transparent: true, opacity: .17, roughness: .32,
        transmission: .55, thickness: .04, depthWrite: false,
      }),
    )
    wrap.position.y = .66
    group.add(wrap)
  }
  group.position.set(...position)
  group.rotation.y = options.yaw || 0
  group.name = options.id || 'movable_pallet'
  group.userData.physics = {
    kind: 'pallet',
    id: group.name,
    weight: options.weight ?? 2400,
    // x is the 40 in lateral face, z the 48 in fork-travel axis.
    dimensions: { x: PALLET_LATERAL, y: 1.04, z: PALLET_TRAVEL },
    slotId: options.slotId || null,
    movable: options.movable !== false,
  }
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
  const side = facing > 0 ? 'left' : 'right'
  // The rack used to be ONE box collider spanning the whole run, floor to
  // infinity. That made the entire rack face a solid wall: a trainee could not
  // enter a bay, could not put forks into a bottom-level pallet, and never had
  // to judge an approach. Modeling the actual hardware -- posts, footplates,
  // and beams at their real elevations -- leaves the bays open, which is the
  // whole skill being assessed, and makes an upright strike a distinct event.
  const colliders = []

  for (let bay = 0; bay <= bays; bay += 1) {
    const z = zStart + bay * bayWidth
    ;[-frameDepth / 2, frameDepth / 2].forEach((dx) => {
      uprightParts.push(boxGeometry([.076, height, .09], [dx, height / 2, z]))
    })
    // Posts run floor to roof, so this collider is deliberately unbounded in Y.
    colliders.push({
      id: `${side}-rack-upright-${bay}`,
      label: 'Rack upright',
      kind: 'rack-upright',
      minX: x - frameDepth / 2 - .06,
      maxX: x + frameDepth / 2 + .06,
      minZ: z - .08,
      maxZ: z + .08,
    })
    // The frame footplate is wider than the post and is what a load wheel or an
    // outrigger tip actually catches.
    colliders.push({
      id: `${side}-rack-foot-${bay}`,
      label: 'Rack frame footplate',
      kind: 'rack-upright',
      minX: x - frameDepth / 2 - .09,
      maxX: x + frameDepth / 2 + .09,
      minZ: z - .17,
      maxZ: z + .17,
      minY: 0,
      maxY: .17,
    })
    // K-brace lattice spans the rack depth between the front and rear posts.
    for (let step = 0; step < 11; step += 1) {
      const y = .5 + step * (height - 1) / 11
      const brace = boxGeometry([frameDepth * 1.06, .038, .038], [0, y, z], [0, 0, step % 2 ? .82 : -.82])
      uprightParts.push(brace)
      uprightParts.push(boxGeometry([frameDepth, .05, .05], [0, y + (height - 1) / 22, z]))
    }
    uprightParts.push(boxGeometry([frameDepth + .1, .14, .3], [0, .07, z]))
  }
  for (let bay = 0; bay < bays; bay += 1) {
    const zCenter = zStart + (bay + .5) * bayWidth
    levels.forEach((level, levelIndex) => {
      if (levelIndex === 0) return
      ;[-frameDepth / 2 + .05, frameDepth / 2 - .05].forEach((dx, beamIndex) => {
        beamParts.push(boxGeometry([.11, .11, bayWidth - .09], [dx, level, zCenter]))
        beamParts.push(boxGeometry([.09, .035, bayWidth - .09], [dx, level + .04, zCenter]))
        colliders.push({
          id: `${side}-rack-beam-b${bay + 1}-l${levelIndex}-${beamIndex}`,
          label: 'Rack beam',
          kind: 'rack-beam',
          // A load has to be able to come down ONTO the beams, so a carried
          // pallet passes through and still registers the contact. The truck
          // itself is stopped, which is what makes driving the mast into a beam
          // a real consequence.
          blocksCarriedLoads: false,
          minX: x + dx - .075,
          maxX: x + dx + .075,
          minZ: zCenter - bayWidth / 2 + .045,
          maxZ: zCenter + bayWidth / 2 - .045,
          minY: level - .08,
          maxY: level + .1,
        })
      })
      for (let wire = 0; wire < 9; wire += 1) {
        const z = zCenter - bayWidth / 2 + (wire + .5) * (bayWidth / 9)
        deckParts.push(boxGeometry([frameDepth - .06, .012, .012], [0, level + .06, z]))
      }
      ;[-.38, -.13, .13, .38].forEach((dx) => {
        deckParts.push(boxGeometry([.014, .014, bayWidth - .1], [dx, level + .07, zCenter]))
      })
    })
  }
  const frames = merged(uprightParts, MATERIALS.upright, scene)
  const beams = merged(beamParts, MATERIALS.beam, scene)
  const decks = merged(deckParts, MATERIALS.wireDeck, scene, false)
  ;[frames, beams, decks].forEach((mesh) => { if (mesh) mesh.position.x = x })

  // stored pallets, thinned out so aisles read as a working facility
  const loads = []
  const slots = []
  for (let bay = 0; bay < bays; bay += 1) {
    const zCenter = zStart + (bay + .5) * bayWidth
    levels.forEach((level, levelIndex) => {
      if (levelIndex === 0) return
      ;[-.62, .62].forEach((offset, slot) => {
        const slotId = `${side}-rack-b${bay + 1}-l${levelIndex}-s${slot + 1}`
        const rackSlot = {
          id: slotId,
          position: { x: x + facing * .02, y: level + .09, z: zCenter + offset },
          yaw: Math.PI / 2,
          // Slot-local X is lateral along the rack run, Z is into the rack. A
          // 48 in pallet on a 42 in frame overhangs the beams slightly, which is
          // normal, so the depth allowance is the frame plus that overhang.
          halfExtents: { x: .56, y: .16, z: frameDepth / 2 + .16 },
          occupiedBy: null,
        }
        slots.push(rackSlot)
        if ((bay * 7 + levelIndex * 3 + slot * 5) % 6 === 0) return
        const tint = [0xb5854f, 0xa97a49, 0xbd8f5c, 0x9d7346][(bay + levelIndex + slot) % 4]
        const load = palletLoad(
          scene,
          [rackSlot.position.x, rackSlot.position.y, rackSlot.position.z],
          tint,
          (bay + levelIndex) % 3 === 0,
          { id: `pallet-${slotId}`, slotId, yaw: rackSlot.yaw, weight: 1800 + ((bay + levelIndex + slot) % 4) * 350 },
        )
        rackSlot.occupiedBy = load.name
        loads.push(load)
      })
    })
  }
  return { loads, slots, colliders }
}

// Interior play area. The imported facility shell measures 41.2 x 53.2 m with a
// 14.6 m clear height, so the walls sit well outside the racking rather than
// hard against it the way the old 22 x 40 m procedural box did.
export const FACILITY = Object.freeze({
  minX: -18.4, maxX: 18.4, minZ: -20.6, maxZ: 26.4, clearHeight: 14.06,
})

function buildStructure(scene) {
  // Visuals go into a removable group: when public/models/facility.glb loads it
  // replaces this box, and if it fails to load this stays as the fallback.
  const shell = new THREE.Group()
  shell.name = 'procedural_shell'
  scene.add(shell)
  const clearHeight = 28 * FT
  const wall = .3
  const colliders = [
    { id: 'west-wall', label: 'west wall', kind: 'wall', minX: FACILITY.minX - wall, maxX: FACILITY.minX, minZ: FACILITY.minZ - wall, maxZ: FACILITY.maxZ + wall },
    { id: 'east-wall', label: 'east wall', kind: 'wall', minX: FACILITY.maxX, maxX: FACILITY.maxX + wall, minZ: FACILITY.minZ - wall, maxZ: FACILITY.maxZ + wall },
    { id: 'north-wall', label: 'north wall', kind: 'wall', minX: FACILITY.minX - wall, maxX: FACILITY.maxX + wall, minZ: FACILITY.minZ - wall, maxZ: FACILITY.minZ },
    { id: 'south-wall', label: 'south wall', kind: 'wall', minX: FACILITY.minX - wall, maxX: FACILITY.maxX + wall, minZ: FACILITY.maxZ, maxZ: FACILITY.maxZ + wall },
  ]
  const wallMaterial = material(0x9aa1a3, { roughness: .93, metalness: .02 }, 'concrete')
  const wallParts = []
  ;[-11.2, 11.2].forEach((x) => wallParts.push(boxGeometry([.3, clearHeight, 44], [x, clearHeight / 2, -1])))
  wallParts.push(boxGeometry([22.7, clearHeight, .3], [0, clearHeight / 2, -21.2]))
  wallParts.push(boxGeometry([22.7, clearHeight, .3], [0, clearHeight / 2, 19.2]))
  merged(wallParts, wallMaterial, shell, false)

  const deckMaterial = material(0x6e7679, { roughness: .88, metalness: .3 }, 'structuralSteel')
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
  merged(roofParts, deckMaterial, shell, false)

  const columnParts = []
  ;[-7.5, 7.5].forEach((x) => {
    for (let z = -18; z <= 16; z += 12) {
      columnParts.push(boxGeometry([.26, clearHeight - .95, .26], [x, (clearHeight - .95) / 2, z]))
      columnParts.push(boxGeometry([.6, .05, .6], [x, .03, z]))
      colliders.push({
        id: `column-${x}-${z}`,
        label: 'building column',
        kind: 'column',
        minX: x - .3,
        maxX: x + .3,
        minZ: z - .3,
        maxZ: z + .3,
      })
    }
  })
  merged(columnParts, material(0x39474d, { roughness: .6, metalness: .5 }, 'structuralSteel'), shell)

  // high-bay LED fixtures on the aisle centerlines
  const fixtureMaterial = new THREE.MeshStandardMaterial({
    color: 0xf2f5f0, emissive: 0xfff6e2, emissiveIntensity: 2.6, roughness: .3, metalness: .1,
  })
  const housing = material(0x2a3134, { roughness: .5, metalness: .6 }, 'structuralSteel')
  const housingParts = []
  const lensParts = []
  for (let z = -18; z <= 16; z += 5.6) {
    ;[-5.4, 0, 5.4].forEach((x) => {
      housingParts.push(boxGeometry([.72, .12, .34], [x, clearHeight - 1.5, z]))
      housingParts.push(boxGeometry([.05, .5, .05], [x, clearHeight - 1.2, z]))
      lensParts.push(boxGeometry([.64, .03, .28], [x, clearHeight - 1.58, z]))
    })
  }
  merged(housingParts, housing, shell, false)
  merged(lensParts, fixtureMaterial, shell, false)

  // a few real spot lights only near the working aisle; the rest is IBL + emissive
  for (let z = -12; z <= 12; z += 8) {
    const light = new THREE.SpotLight(0xfff4e0, 130, 20, .85, .6, 1.4)
    light.position.set(0, clearHeight - 1.7, z)
    light.target.position.set(0, 0, z)
    scene.add(light, light.target)
  }
  return { colliders, shell }
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
  // Pedestrians previously had no collider at all -- the truck drove straight
  // through them and only a 1.9 m proximity warning fired. In a tool whose whole
  // purpose is separation discipline, a person has to be something you can hit.
  group.userData.physics = {
    kind: 'pedestrian', label: 'Pedestrian', radius: .42, solid: true, minY: 0, maxY: 1.78,
  }
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
  merged(parts, material(0xe0b02a, { roughness: .6, metalness: .18 }, 'paint'), scene)

  const cones = []
  ;[[-2.1, 3.2], [0, 3.2], [2.1, 3.2]].forEach(([x, z]) => {
    const coneGroup = new THREE.Group()
    coneGroup.name = `safety_cone_${cones.length + 1}`
    const cone = new THREE.Mesh(new THREE.ConeGeometry(.19, .62, 20), material(0xdd5f1c, { roughness: .7 }, 'paint'))
    cone.position.set(0, .31, 0)
    cone.castShadow = true
    coneGroup.add(cone)
    const base = new THREE.Mesh(new THREE.BoxGeometry(.34, .03, .34), material(0xdd5f1c, { roughness: .7 }))
    base.position.set(0, .015, 0)
    coneGroup.add(base)
    coneGroup.position.set(x, 0, z)
    coneGroup.userData.physics = { kind: 'cone', radius: .24, tipped: false }
    scene.add(coneGroup)
    cones.push(coneGroup)
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
  const charger = new THREE.Mesh(new THREE.BoxGeometry(.7, 1.15, .5), material(0x38424a, { roughness: .55, metalness: .35 }, 'structuralSteel'))
  charger.position.set(9.9, .58, 12.5)
  charger.castShadow = true
  scene.add(charger)
  const chargerFace = new THREE.Mesh(new THREE.BoxGeometry(.3, .2, .04), new THREE.MeshStandardMaterial({ color: 0x0d1b1e, emissive: 0x1c4a3f, emissiveIntensity: .8, roughness: .3 }))
  chargerFace.position.set(9.9, .95, 12.24)
  scene.add(chargerFace)
  return {
    cones,
    colliders: [
      { id: 'empty-pallet-stack', label: 'empty pallet stack', kind: 'pallet-stack', minX: -10.05, maxX: -8.75, minZ: 12.85, maxZ: 13.95 },
      { id: 'battery-charger', label: 'Battery charger', kind: 'fixture', minX: 9.5, maxX: 10.3, minZ: 12.18, maxZ: 12.82 },
    ],
  }
}

// Third-party facility shell (assets-src/facility.py). It supplies the building
// envelope only -- the source contains no racking, shelving or pallets -- so the
// racking, rack slots, loads and every collider below stay procedural and none
// of the training-critical geometry depends on it. If it fails to load, the
// procedural shell it replaces stays on screen.
const facilityLoader = new GLTFLoader()

function loadFacilityShell(scene, fallbackShell) {
  // Headless verification builds the warehouse to assert collider topology and
  // has no fetch; it keeps the procedural shell, which is the same fallback a
  // browser gets if the asset is missing.
  if (typeof window === 'undefined') return
  const url = `${import.meta.env?.BASE_URL ?? '/'}models/facility.glb`
  facilityLoader.load(url, (gltf) => {
    gltf.scene.traverse((object) => {
      if (!object.isMesh) return
      // A 41 x 53 m shell casting shadows would blow the shadow-map budget for
      // no gain; it receives them instead.
      object.castShadow = false
      object.receiveShadow = true
      // Our own floor carries the aisle markings and the concrete surfacing
      // pass, so the model's floor is dropped rather than z-fighting with it.
      if (/^Floor_Object/i.test(object.name)) object.visible = false
    })
    // The model's slab sits at exactly y = 0.000 -- the same plane as our floor's
    // top face -- and its stair trim and door thresholds sit within 2 mm of it.
    // Coplanar surfaces z-fight, which is what made the floor shimmer. Dropping
    // the whole shell 3 cm puts every one of those surfaces cleanly underneath
    // instead of tied with it; walls and columns just start fractionally lower,
    // which is invisible.
    gltf.scene.position.y = -.03
    scene.add(gltf.scene)
    if (fallbackShell) {
      scene.remove(fallbackShell)
      fallbackShell.traverse((object) => { if (object.isMesh) object.geometry.dispose() })
    }
  }, undefined, (error) => {
    console.warn('ProLTO: facility shell unavailable, keeping procedural structure', error)
  })
}

export function createWarehouse(scene) {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(41, .3, 53), concreteMaterial())
  floor.position.set(0, -.15, 3)
  floor.receiveShadow = true
  scene.add(floor)

  const { colliders: structureColliders, shell } = buildStructure(scene)
  loadFacilityShell(scene, shell)
  buildFloorMarkings(scene)
  const leftRack = buildRackRun(scene, -6.4, -16, 11, 1)
  const rightRack = buildRackRun(scene, 6.4, -16, 11, -1)
  const fixtures = buildFixtures(scene)

  const pallet = palletLoad(scene, [0, 0, 7.2], 0xb5854f, false, { id: 'training-pallet', weight: 2400 })
  const pedestrians = [
    pedestrian(scene, 2.7, -7.6, 0xd9d43f),
    pedestrian(scene, -2.9, 8.2, 0xe07c22),
  ]
  return {
    pallet,
    pallets: [pallet, ...leftRack.loads, ...rightRack.loads],
    pedestrians,
    cones: fixtures.cones,
    rackSlots: [...leftRack.slots, ...rightRack.slots],
    staticColliders: [...structureColliders, ...leftRack.colliders, ...rightRack.colliders, ...fixtures.colliders],
  }
}
