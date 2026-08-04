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
const { createWarehouse } = await import('../src/sim/warehouse.js')
const { obbIntersectsAabb, obbIntersectsCircle, sweepPose } = await import('../src/sim/loadPhysics.js')

const scene = new THREE.Scene()
const warehouse = createWarehouse(scene)
const colliders = warehouse.staticColliders
const uprights = colliders.filter((entry) => entry.kind === 'rack-upright')
const beams = colliders.filter((entry) => entry.kind === 'rack-beam')

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

// A carried load must be able to come DOWN onto a beam without the beam
// hard-stopping the truck -- but the contact still has to be reported, or the
// evaluator never sees the load being dragged across the rack face.
{
  const beam = {
    id: 'test-beam', kind: 'rack-beam', blocksCarriedLoads: false,
    minX: -1, maxX: 1, minZ: -.1, maxZ: .1, minY: 1.7, maxY: 1.9,
  }
  const result = sweepPose(
    { x: 0, z: 2, heading: 0 },
    { x: 0, z: 0, heading: 0 },
    [{ id: 'carried:load', halfWidth: .6, halfLength: .5, offsetX: 0, offsetZ: 0, minY: 1.75, maxY: 2.8 }],
    [beam],
  )
  assert.equal(result.blocked, false, 'a carried load must pass through a beam it is being set onto')
  assert.equal(result.contacts.length, 1, 'the beam contact must still be recorded')
  assert.equal(result.contacts[0].blocking, false, 'that contact must be marked non-blocking')

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

console.log(`PASS facility: ${uprights.length} frame colliders, ${beams.length} beam colliders, open bays, solid pedestrians`)
