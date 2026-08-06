import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  WarehouseLoadPhysics,
  findRackSlotPlacement,
  forkConfigurationForProfile,
  obbIntersectsAabb,
  obbIntersectsCircle,
  obbIntersectsObb,
  sweepPose,
  testForkPalletEngagement,
} from '../src/sim/loadPhysics.js'

const near = (actual, expected, tolerance = .002) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not near ${expected}`)

const truckBox = { x: 0, z: 0, halfWidth: .5, halfLength: 1, heading: 0, minY: 0, maxY: 2 }
assert.equal(obbIntersectsAabb(truckBox, { minX: .45, maxX: .8, minZ: -.2, maxZ: .2 }), true)
assert.equal(obbIntersectsAabb(truckBox, { minX: .6, maxX: .8, minZ: -.2, maxZ: .2 }), false)
assert.equal(obbIntersectsCircle(truckBox, { x: .58, z: 0, radius: .1 }), true)
assert.equal(obbIntersectsCircle(truckBox, { x: .8, z: 0, radius: .1 }), false)
assert.equal(obbIntersectsObb(truckBox, { x: .8, z: 0, halfWidth: .4, halfLength: .4, heading: Math.PI / 4 }), true)

const sweep = sweepPose(
  { x: 0, z: 3, heading: 0 },
  { x: 0, z: -3, heading: 0 },
  [{ halfWidth: .5, halfLength: .8, offsetX: 0, offsetZ: 0 }],
  [{ id: 'beam', minX: -2, maxX: 2, minZ: -.1, maxZ: .1, kind: 'rack' }],
)
assert.equal(sweep.blocked, true)
assert.ok(sweep.pose.z > .89 && sweep.pose.z < .93, `sweep stopped at ${sweep.pose.z}`)
const carriedSweep = sweepPose(
  { x: 0, z: 2, heading: 0 },
  { x: 0, z: 0, heading: 0 },
  [{ id: 'carried:test', halfWidth: .5, halfLength: .5, offsetX: 0, offsetZ: 0 }],
  [{ id: 'rack-envelope', minX: -1, maxX: 1, minZ: -.5, maxZ: .5, blocksCarriedLoads: false }],
)
assert.equal(carriedSweep.blocked, false)

const engagement = testForkPalletEngagement(
  {
    baseX: 0, baseY: .04, baseZ: 1.75,
    forwardX: 0, forwardZ: -1, rightX: 1, rightZ: 0,
    length: 1.12, spread: .66, tineWidth: .1, thickness: .05,
    minimumPenetration: .34, maximumApproachAngle: 18 * Math.PI / 180,
  },
  { x: 0, y: 0, z: 1, yaw: 0, width: 1.2192, depth: 1.016, pocketMin: .025, pocketMax: .13 },
)
assert.equal(engagement.eligible, true)
assert.ok(engagement.penetration > .8)

const placement = findRackSlotPlacement(
  { id: 'pallet', x: .03, y: 1.8, z: -.02, yaw: Math.PI, width: 1.2192, depth: 1.016 },
  [{ id: 'slot', x: 0, y: 1.8, z: 0, yaw: 0, width: 1.34, depth: 1.12, positionTolerance: .17, yawTolerance: .14, enabled: true }],
)
assert.equal(placement.id, 'slot')

const scene = new THREE.Scene()
const truck = new THREE.Group()
truck.position.z = 2
scene.add(truck)
const forkFrame = new THREE.Group()
forkFrame.position.set(0, .04, -.25)
truck.add(forkFrame)
const pallet = new THREE.Group()
pallet.name = 'test-pallet'
pallet.position.set(0, 0, 1)
pallet.userData.physics = { id: 'test-load', weight: 1440, dimensions: { x: 1.2192, y: 1.05, z: 1.016 } }
scene.add(pallet)
scene.updateMatrixWorld(true)

const events = []
const physics = new WarehouseLoadPhysics({
  truckRoot: truck,
  forkFrame,
  pallets: [pallet],
  rackSlots: [{ id: 'slot-a', position: { x: 0, y: 1, z: 1 }, halfExtents: { x: .67, z: .56 } }],
  forkSpecification: { localBase: [0, 0, 0] },
  onEvent: (event) => events.push(event.type),
})

physics.update(1 / 60)
assert.equal(physics.snapshot().carriedPalletId, null)
forkFrame.position.y += .04
scene.updateMatrixWorld(true)
physics.update(1 / 60)
assert.equal(physics.snapshot().carriedPalletId, 'test-load')
assert.equal(physics.snapshot().carriedWeight, 1440)

forkFrame.position.y = 1.1
scene.updateMatrixWorld(true)
physics.update(1 / 60)
assert.ok(pallet.getWorldPosition(new THREE.Vector3()).y > 1)
forkFrame.position.y = 1.04
scene.updateMatrixWorld(true)
physics.update(1 / 60)
assert.equal(physics.snapshot().carriedPalletId, null)
assert.equal(physics.snapshot().slots[0].occupiedBy, 'test-load')
near(pallet.getWorldPosition(new THREE.Vector3()).y, 1)

physics.update(1 / 60)
forkFrame.position.y += .04
scene.updateMatrixWorld(true)
physics.update(1 / 60)
assert.equal(physics.snapshot().carriedPalletId, 'test-load')
assert.equal(physics.snapshot().slots[0].occupiedBy, null)
assert.deepEqual(events.filter((type) => type.startsWith('pallet-')), ['pallet-engaged', 'pallet-racked', 'pallet-engaged'])
physics.reset()
assert.equal(physics.snapshot().carriedPalletId, null)
assert.equal(physics.snapshot().slots[0].occupiedBy, null)
near(pallet.getWorldPosition(new THREE.Vector3()).y, 0)
near(pallet.getWorldPosition(new THREE.Vector3()).z, 1)

const reachFork = new THREE.Group()
assert.equal(
  forkConfigurationForProfile({ manufacturer: 'Crown', family: 'reach' }, { reachGroup: reachFork, carriage: new THREE.Group() }).forkFrame,
  reachFork,
)

const coneObject = new THREE.Group()
coneObject.name = 'raw-cone'
coneObject.userData.physics = { kind: 'cone', radius: .2 }
scene.add(coneObject)
const conePhysics = new WarehouseLoadPhysics({
  obstacles: [coneObject],
})
const coneHit = conePhysics.resolveTruckMotion(
  { x: 0, z: 1, heading: 0 },
  { x: 0, z: 0, heading: 0 },
  { speed: 1.2 },
)
assert.equal(coneHit.blocked, false)
conePhysics.update(.1)
assert.equal(conePhysics.obstacles[0].knocked, true)
assert.notEqual(coneObject.rotation.x, 0)
assert.ok(coneObject.position.z < 0)
conePhysics.reset()
near(coneObject.position.x, 0)
near(coneObject.position.z, 0)
near(coneObject.rotation.x, 0)

// Floor pallets are shoved rather than treated as bollards, and a heavy load
// resists far more than a light one. Racked loads must NOT slide.
{
  const pushScene = new THREE.Scene()
  const pushTruck = new THREE.Group()
  pushScene.add(pushTruck)
  const makePallet = (name, weight, z) => {
    const body = new THREE.Group()
    body.name = name
    body.position.set(0, 0, z)
    body.userData.physics = { id: name, weight, dimensions: { x: 1.016, y: 1.05, z: 1.2192 } }
    pushScene.add(body)
    return body
  }
  const light = makePallet('light-load', 200, 0)
  const heavy = makePallet('heavy-load', 4000, 0)
  pushScene.updateMatrixWorld(true)

  const pushed = []
  const physics = new WarehouseLoadPhysics({
    truckRoot: pushTruck,
    pallets: [light, heavy],
    truckColliders: [{ id: 'body', offsetX: 0, offsetZ: 0, halfWidth: .6, halfLength: .8, minY: 0, maxY: 2 }],
    onEvent: (event) => { if (event.type === 'load-pushed') pushed.push(event.pallet.id) },
  })
  // Drive from +Z toward the loads sitting at the origin.
  physics.resolveTruckMotion({ x: 0, z: 2.4, heading: 0 }, { x: 0, z: 1.2, heading: 0 }, { speed: 1.2 })
  const lightMoved = Math.abs(light.position.z - 0)
  const heavyMoved = Math.abs(heavy.position.z - 0)
  assert.ok(lightMoved > 0, 'a floor pallet must be pushable')
  assert.ok(lightMoved > heavyMoved, `a light load must shove further than a heavy one (${lightMoved.toFixed(3)} vs ${heavyMoved.toFixed(3)})`)
  assert.ok(pushed.length > 0, 'pushing a load must be reported to the evaluator')

  physics.reset()
  near(light.position.z, 0)
  // A racked load is not a shoving match; it stays put and scores as a strike.
  const racked = makePallet('racked-load', 1200, -4)
  racked.userData.physics.status = 'racked'
  pushScene.updateMatrixWorld(true)
  const rackedPhysics = new WarehouseLoadPhysics({
    truckRoot: pushTruck,
    pallets: [{ object: racked, status: 'racked', slotId: 'slot-x', weight: 1200 }],
    rackSlots: [{ id: 'slot-x', position: { x: 0, y: 0, z: -4 }, halfExtents: { x: .56, z: .69 } }],
    truckColliders: [{ id: 'body', offsetX: 0, offsetZ: 0, halfWidth: .6, halfLength: .8, minY: 0, maxY: 2 }],
  })
  const before = racked.position.z
  rackedPhysics.resolveTruckMotion({ x: 0, z: -2, heading: 0 }, { x: 0, z: -3.2, heading: 0 }, { speed: 1.2 })
  near(racked.position.z, before)
}

console.log('PASS load physics: collision sweep, fork engagement, rigid carry, rack placement, rack removal, cone response, pallet pushing')
