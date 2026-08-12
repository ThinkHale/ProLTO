// Facility collision verification.  node scripts/verify-facility.mjs
//
// The rack used to be a SINGLE box collider per run, spanning every bay from
// the floor to infinity. The entire rack face was a solid wall: a trainee could
// not enter a bay, could not put forks into a bottom-level position, and never
// had to judge an approach at all. Pedestrians, meanwhile, had no collider of
// any kind and could be driven straight through.
//
// These checks assert the hardware is now modeled as hardware: posts and
// footplates are solid, beams are solid at their own elevation and nowhere
// else, the bay opening between them is genuinely open, and a person is
// something you can hit.
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// createWarehouse paints its concrete and carton maps on a 2D canvas. Stub just
// enough of it to run headless, matching scripts/verify-rig-binding.mjs.
const imageData = (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
const stubContext = {
  fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  ellipse() {}, fill() {}, fillText() {}, putImageData() {}, closePath() {}, arc() {},
  createImageData: (width, height) => imageData(width, height),
  getImageData: (x, y, width, height) => imageData(width, height),
}
globalThis.document = globalThis.document || {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubContext }),
}
globalThis.self = globalThis.self || globalThis

const THREE = await import('three')
const { FACILITY, createWarehouse } = await import('../src/sim/warehouse.js')
const {
  WarehouseLoadPhysics,
  obbIntersectsAabb,
  obbIntersectsCircle,
  sweepPose,
} = await import('../src/sim/loadPhysics.js')

// The retired stock shell cannot ship or return through an unnoticed runtime
// reference. Constructing the old filename keeps this verifier from being the
// only literal reference to the asset it is intended to prohibit.
const retiredAsset = ['facility', '.glb'].join('')
assert.equal(existsSync(join('public', 'models', retiredAsset)), false, `${retiredAsset} must not ship`)

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:js|jsx|css)$/.test(entry.name) ? [path] : []
  })
}

for (const path of sourceFiles('src')) {
  const source = readFileSync(path, 'utf8')
  assert.equal(source.includes(retiredAsset), false, `${path} must not reference the retired facility asset`)
}
const warehouseSource = readFileSync(join('src', 'sim', 'warehouse.js'), 'utf8')
assert.doesNotMatch(warehouseSource, /GLTFLoader/, 'the original facility must not need a glTF network loader')
assert.doesNotMatch(warehouseSource, /Math[.]random\s*\(/, 'facility visuals must be deterministic')

const scene = new THREE.Scene()
const warehouse = createWarehouse(scene)
const colliders = warehouse.staticColliders
const uprights = colliders.filter((entry) => entry.kind === 'rack-upright')
const beams = colliders.filter((entry) => entry.kind === 'rack-beam')

// The visible wall shell, floor, simulation clamp, and collision planes must
// describe the same interior. The retired asset temporarily made all four use
// different dimensions, allowing the truck to enter invisible space.
const near = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 1e-4, `${label}: expected ${expected}, got ${actual}`)
}
const walls = Object.fromEntries(colliders.filter((entry) => entry.kind === 'wall').map((entry) => [entry.id, entry]))
assert.deepEqual(Object.keys(walls).sort(), ['east-wall', 'north-wall', 'south-wall', 'west-wall'])
near(walls['west-wall'].maxX, FACILITY.minX, 'west wall interior face')
near(walls['east-wall'].minX, FACILITY.maxX, 'east wall interior face')
near(walls['north-wall'].maxZ, FACILITY.minZ, 'north wall interior face')
near(walls['south-wall'].minZ, FACILITY.maxZ, 'south wall interior face')
assert.equal(warehouse.facilityShell?.name, 'original_procedural_facility', 'the original procedural shell must be active')
assert.equal(warehouse.facilityShell.userData.interiorBounds, FACILITY, 'the visual shell must use the canonical bounds')
const shellBounds = new THREE.Box3().setFromObject(warehouse.facilityShell)
near(shellBounds.min.x, FACILITY.minX - .3, 'visible west wall exterior')
near(shellBounds.max.x, FACILITY.maxX + .3, 'visible east wall exterior')
near(shellBounds.min.z, FACILITY.minZ - .3, 'visible north wall exterior')
near(shellBounds.max.z, FACILITY.maxZ + .3, 'visible south wall exterior')

// Draw-budget regression: physics keeps one lightweight proxy per pallet, while
// visible pallet bases, cartons, and transparent wraps are dynamic instances.
let meshCount = 0
let shadowCasterCount = 0
const loadBuckets = []
scene.traverse((object) => {
  if (!object.isMesh) return
  meshCount += 1
  if (object.castShadow) shadowCasterCount += 1
  if (object.isInstancedMesh && object.userData.loadVisualBucket) loadBuckets.push(object)
})
const bucketsOfKind = (kind) => loadBuckets.filter((mesh) => mesh.userData.loadVisualBucket.kind === kind)
const instanceCount = (buckets) => buckets.reduce((sum, mesh) => sum + mesh.count, 0)
const palletBuckets = bucketsOfKind('pallet-base')
const cartonBuckets = bucketsOfKind('carton-load')
const wrapBuckets = bucketsOfKind('stretch-wrap')
const wrappedPallets = warehouse.pallets.filter((proxy) => (
  proxy.loadVisualBindings.some((binding) => binding.kind === 'stretch-wrap')
))
assert.equal(instanceCount(palletBuckets), warehouse.pallets.length, 'every physical pallet needs one instanced pallet base')
assert.equal(instanceCount(cartonBuckets), warehouse.pallets.length, 'every physical pallet needs one instanced carton load')
assert.equal(instanceCount(wrapBuckets), wrappedPallets.length, 'every wrapped pallet needs one transparent wrap instance')
assert.ok(new Set(cartonBuckets.map((mesh) => mesh.geometry)).size <= 4, 'carton stacks must use four deterministic geometry variants at most')
assert.ok(new Set(cartonBuckets.map((mesh) => mesh.material)).size <= 4, 'carton stacks must share four tint materials at most')
assert.equal(new Set(cartonBuckets.map((mesh) => mesh.material.map)).size, 1, 'carton stacks must share one canvas texture')
assert.ok(loadBuckets.every((mesh) => mesh.frustumCulled === false), 'dynamic load instances must not disappear behind stale bounds')
assert.ok(warehouse.pallets.every((proxy) => (
  proxy.children.length === 0
  && typeof proxy.syncLoadVisual === 'function'
  && proxy.loadVisualBindings.length >= 2
  && proxy.userData.loadVisualBindings === undefined
)), 'every load must be a mesh-free physics proxy with visual bindings')
assert.equal(wrapBuckets.length, 1, 'all stretch wrap must share one transparent bucket')
assert.equal(wrapBuckets[0].material.transparent, true, 'stretch wrap must remain transparent')
near(wrapBuckets[0].material.opacity, .17, 'stretch wrap opacity')
near(wrapBuckets[0].material.transmission, .55, 'stretch wrap transmission')
assert.equal(wrapBuckets[0].material.depthWrite, false, 'stretch wrap must not write opaque depth')
assert.ok(meshCount <= 52, `facility mesh budget regressed to ${meshCount}`)
assert.ok(shadowCasterCount <= 42, `facility shadow-caster budget regressed to ${shadowCasterCount}`)
assert.equal(new Set(colliders.map((entry) => entry.id)).size, colliders.length, 'facility collider IDs must be unique')
assert.equal(new Set(warehouse.pallets.map((entry) => entry.name)).size, warehouse.pallets.length, 'pallet IDs must be unique')

const geometrySignature = (root, name) => {
  const mesh = root.getObjectByName(name)
  assert.ok(mesh?.geometry?.attributes?.position, `${name} must have position geometry`)
  return Array.from(mesh.geometry.attributes.position.array, (value) => Number(value.toFixed(6)))
}
const palletSignature = (created) => created.pallets.map((entry) => ({
  id: entry.name,
  position: entry.position.toArray(),
  yaw: entry.rotation.y,
  bindings: entry.loadVisualBindings.map((binding) => {
    const matrix = new THREE.Matrix4()
    binding.mesh.getMatrixAt(binding.index, matrix)
    return {
      kind: binding.kind,
      key: binding.mesh.userData.loadVisualBucket.key,
      matrix: matrix.elements.map((value) => Number(value.toFixed(6))),
      geometry: binding.kind === 'carton-load'
        ? Array.from(binding.mesh.geometry.attributes.position.array, (value) => Number(value.toFixed(6)))
        : null,
    }
  }),
}))
const secondScene = new THREE.Scene()
const secondWarehouse = createWarehouse(secondScene)
assert.deepEqual(secondWarehouse.staticColliders, warehouse.staticColliders, 'facility colliders must reproduce exactly')
assert.deepEqual(secondWarehouse.rackSlots, warehouse.rackSlots, 'rack slots must reproduce exactly')
assert.deepEqual(palletSignature(secondWarehouse), palletSignature(warehouse), 'pallet visuals must reproduce exactly')
for (const name of ['empty_pallet_stack_clean', 'empty_pallet_stack_worn']) {
  assert.deepEqual(geometrySignature(secondScene, name), geometrySignature(scene, name), `${name} must reproduce exactly`)
}

const assertVisualsFollowProxy = (proxy, label) => {
  proxy.updateWorldMatrix(true, false)
  for (const binding of proxy.loadVisualBindings) {
    binding.mesh.updateWorldMatrix(true, false)
    const instance = new THREE.Matrix4()
    binding.mesh.getMatrixAt(binding.index, instance)
    const actual = new THREE.Matrix4().multiplyMatrices(binding.mesh.matrixWorld, instance)
    const expected = proxy.matrixWorld.clone().multiply(binding.localMatrix)
    actual.elements.forEach((value, index) => near(value, expected.elements[index], `${label} ${binding.kind} matrix ${index}`))
  }
}
warehouse.pallets.forEach((proxy) => assertVisualsFollowProxy(proxy, `${proxy.name} initial`))

// Exercise the actual instanced warehouse proxy through every load solver pose
// path. This is stronger than checking callback counts: the GPU instance matrix
// itself must match the physics-owned proxy after push, carry, settle, and reset.
const trainingProxy = warehouse.pallet
const visualFork = new THREE.Group()
scene.add(visualFork)
const visualPhysics = new WarehouseLoadPhysics({
  forkFrame: visualFork,
  pallets: [trainingProxy],
  truckColliders: [],
})
const trainingBody = visualPhysics.pallets[0]
const pushed = visualPhysics.pushBlockingPallets(
  { fraction: .5, blockingContacts: [{ obstacle: { palletId: trainingBody.id } }] },
  { x: 0, z: 9.2, heading: 0 },
  { x: 0, z: 8.2, heading: 0 },
)
assert.equal(pushed.moved, true, 'the visual-sync test pallet must be pushed')
assertVisualsFollowProxy(trainingProxy, 'training pallet pushed')

visualFork.position.copy(trainingProxy.getWorldPosition(new THREE.Vector3()))
scene.updateMatrixWorld(true)
assert.equal(visualPhysics.attachPallet(trainingBody, {}, { eligible: true }), true, 'the training proxy must attach')
assertVisualsFollowProxy(trainingProxy, 'training pallet attached')
visualFork.position.x += .35
visualFork.position.y += .8
visualFork.rotation.y = .22
scene.updateMatrixWorld(true)
visualPhysics.syncCarriedPallet()
assertVisualsFollowProxy(trainingProxy, 'training pallet carried')
assert.equal(visualPhysics.releaseCarried({ force: true }), true, 'the carried training proxy must settle')
assertVisualsFollowProxy(trainingProxy, 'training pallet floor settled')

visualFork.position.copy(trainingProxy.getWorldPosition(new THREE.Vector3()))
visualFork.rotation.y = trainingProxy.rotation.y
scene.updateMatrixWorld(true)
assert.equal(visualPhysics.attachPallet(trainingBody, {}, { eligible: true }), true, 'the training proxy must reattach')
const visualSlot = { id: 'visual-slot', x: -1.2, y: 1.8, z: 5.4, yaw: Math.PI / 2 }
assert.equal(visualPhysics.settleCarriedPallet(visualSlot, {
  eligible: true,
  supportY: 1.83,
  beamIds: ['visual-support-a', 'visual-support-b'],
}), true, 'the training proxy must settle into a rack slot')
assertVisualsFollowProxy(trainingProxy, 'training pallet rack settled')
visualPhysics.reset()
assertVisualsFollowProxy(trainingProxy, 'training pallet reset')
near(trainingProxy.position.y, 0, 'training reset height')
near(trainingProxy.position.z, 7.2, 'training reset position')

const wrappedProxy = wrappedPallets[0]
const wrappedPhysics = new WarehouseLoadPhysics({ forkFrame: visualFork, pallets: [wrappedProxy] })
const wrappedBody = wrappedPhysics.pallets[0]
visualFork.position.copy(wrappedProxy.getWorldPosition(new THREE.Vector3()))
visualFork.rotation.y = wrappedProxy.rotation.y
scene.updateMatrixWorld(true)
assert.equal(wrappedPhysics.attachPallet(wrappedBody, {}, { eligible: true }), true, 'a wrapped racked proxy must attach')
visualFork.position.y += .4
visualFork.position.z += .25
scene.updateMatrixWorld(true)
wrappedPhysics.syncCarriedPallet()
assertVisualsFollowProxy(wrappedProxy, 'wrapped pallet carried')
wrappedPhysics.reset()
assertVisualsFollowProxy(wrappedProxy, 'wrapped pallet reset to rack')

assert.ok(uprights.length >= 40, `expected a collider per rack frame, got ${uprights.length}`)
assert.ok(beams.length >= 100, `expected a collider per beam per bay per level, got ${beams.length}`)
assert.equal(colliders.filter((entry) => entry.kind === 'rack').length, 0, 'the monolithic rack-run collider must be gone')

// REGRESSION: no rack collider may span a whole run. The old one covered ~28 m
// of aisle in a single box, which is what sealed the rack face.
for (const entry of [...uprights, ...beams]) {
  const span = entry.maxZ - entry.minZ
  assert.ok(span < 3, `${entry.id} spans ${span.toFixed(2)} m of Z; rack colliders must be per-frame or per-bay`)
}

// Posts are unbounded in Y (they run floor to roof); beams are NOT, because a
// beam you cannot drive under is a wall.
assert.ok(uprights.some((entry) => entry.minY === undefined), 'rack posts must block at every height')
for (const beam of beams) {
  assert.ok(Number.isFinite(beam.minY) && Number.isFinite(beam.maxY), `${beam.id} must be bounded in Y`)
  assert.ok(beam.maxY - beam.minY < .4, `${beam.id} is ${(beam.maxY - beam.minY).toFixed(2)} m tall; a beam is not a wall`)
}

// Derive real bay geometry from the emitted colliders rather than hardcoding it,
// so this keeps testing the truth if the rack layout is retuned.
const leftPosts = uprights
  .filter((entry) => entry.id.startsWith('left-rack-upright-'))
  .sort((a, b) => a.minZ - b.minZ)
assert.ok(leftPosts.length >= 3, 'need at least three frames to derive a bay')
const bayCenterZ = (leftPosts[1].minZ + leftPosts[1].maxZ) / 2 + ((leftPosts[2].minZ + leftPosts[2].maxZ) / 2 - (leftPosts[1].minZ + leftPosts[1].maxZ) / 2) / 2
const postCenterZ = (leftPosts[2].minZ + leftPosts[2].maxZ) / 2
const rackCenterX = (leftPosts[1].minX + leftPosts[1].maxX) / 2

const rackColliders = [...uprights, ...beams]
const hits = (box) => rackColliders.filter((entry) => obbIntersectsAabb(box, entry))

// A fork-and-carriage sized envelope at floor level, inside the bay opening.
const forkEnvelope = (z) => ({ x: rackCenterX, z, halfWidth: .35, halfLength: .5, heading: 0, minY: 0, maxY: .3 })

// THE bay-openness assertion. At floor level, between two frames, the bay is
// open and forks go in. Under the old collider this was solid.
{
  const blocking = hits(forkEnvelope(bayCenterZ))
  assert.equal(blocking.length, 0, `bay opening must be clear, blocked by: ${blocking.map((entry) => entry.id).join(', ')}`)
}

// The frame itself is still solid, so a misjudged approach hits a post.
{
  const blocking = hits(forkEnvelope(postCenterZ))
  assert.ok(blocking.length > 0, 'a rack frame must block')
  assert.ok(blocking.every((entry) => entry.kind === 'rack-upright'), 'only the frame should be blocking at a post')
}

// Beams are solid at their own elevation: a full-height truck body cannot be
// driven into a bay even though the forks can enter beneath.
{
  const truckHeight = { x: rackCenterX, z: bayCenterZ, halfWidth: .6, halfLength: .5, heading: 0, minY: 0, maxY: 2.35 }
  const blocking = hits(truckHeight)
  assert.ok(blocking.some((entry) => entry.kind === 'rack-beam'), 'a beam must stop a full-height truck body entering the bay')
}

// Pedestrians are solid obstacles, not scenery.
{
  assert.ok(warehouse.pedestrians.length > 0, 'the exercise needs pedestrians')
  for (const person of warehouse.pedestrians) {
    const physics = person.userData.physics
    assert.equal(physics?.kind, 'pedestrian', 'a pedestrian must carry pedestrian physics metadata')
    assert.equal(physics.solid, true, 'a pedestrian must be solid')
    assert.ok(physics.radius > .3, 'a pedestrian needs a body-sized radius')
  }
  const person = warehouse.pedestrians[0]
  const truck = { x: person.position.x, z: person.position.z, halfWidth: .6, halfLength: .9, heading: 0, minY: 0, maxY: 2.3 }
  assert.equal(
    obbIntersectsCircle(truck, { x: person.position.x, z: person.position.z, radius: person.userData.physics.radius, minY: 0, maxY: 1.78 }),
    true,
    'driving onto a pedestrian must register as contact',
  )
}

// A carried load may settle onto a beam top, but it may not pass horizontally
// through the steel from below. Both contacts remain evaluator-visible.
{
  const beam = {
    id: 'test-beam', kind: 'rack-beam', blocksCarriedLoads: false,
    minX: -1, maxX: 1, minZ: -.1, maxZ: .1, minY: 1.7, maxY: 1.9,
  }
  const result = sweepPose(
    { x: 0, z: 2, heading: 0 },
    { x: 0, z: 0, heading: 0 },
    [{ id: 'carried:load', halfWidth: .6, halfLength: .5, offsetX: 0, offsetZ: 0, minY: 1.9, maxY: 2.8 }],
    [beam],
  )
  assert.equal(result.blocked, false, 'a carried load on the beam top must be allowed to settle')
  assert.equal(result.contacts.length, 1, 'the beam contact must still be recorded')
  assert.equal(result.contacts[0].blocking, false, 'that contact must be marked non-blocking')
  assert.equal(result.contacts[0].supportContact, true, 'the contact must be marked as beam support')

  const lowLoadResult = sweepPose(
    { x: 0, z: 2, heading: 0 },
    { x: 0, z: 0, heading: 0 },
    [{ id: 'carried:load', halfWidth: .6, halfLength: .5, offsetX: 0, offsetZ: 0, minY: 1.75, maxY: 2.8 }],
    [beam],
  )
  assert.equal(lowLoadResult.blocked, true, 'a carried load below the beam top must not pass through steel')

  const truckResult = sweepPose(
    { x: 0, z: 2, heading: 0 },
    { x: 0, z: 0, heading: 0 },
    [{ id: 'power-unit', halfWidth: .6, halfLength: .5, offsetX: 0, offsetZ: 0, minY: 0, maxY: 2.35 }],
    [beam],
  )
  assert.equal(truckResult.blocked, true, 'the same beam must stop the truck body')
}

// The broad phase must not change any answer, only the cost of getting it.
{
  const far = sweepPose(
    { x: 0, z: 3, heading: 0 },
    { x: 0, z: -3, heading: 0 },
    [{ halfWidth: .5, halfLength: .8, offsetX: 0, offsetZ: 0 }],
    [{ id: 'distant', minX: 40, maxX: 41, minZ: -.1, maxZ: .1 }, { id: 'beam', minX: -2, maxX: 2, minZ: -.1, maxZ: .1 }],
  )
  assert.equal(far.blocked, true, 'a distant obstacle must not suppress a real one')
  assert.equal(far.blockingContacts[0].obstacle.id, 'beam')
}

console.log(
  `PASS facility: ${uprights.length} frame colliders, ${beams.length} beam colliders, ` +
  `${meshCount} meshes, ${shadowCasterCount} shadow casters, ` +
  `${loadBuckets.length} load buckets / ${instanceCount(loadBuckets)} instances, open bays, solid pedestrians`,
)
