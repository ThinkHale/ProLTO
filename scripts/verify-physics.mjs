import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  WarehouseLoadPhysics,
  evaluateRackPlacementSupport,
  findRackSlotPlacement,
  forkConfigurationForProfile,
  forkTineCollidersForFrame,
  obbIntersectsAabb,
  obbIntersectsCircle,
  obbIntersectsObb,
  resolveHydraulicMotion,
  sweepPose,
  testForkPalletEngagement,
} from '../src/sim/loadPhysics.js'
import { contactAssessment } from '../src/sim/safetyEvents.js'

const near = (actual, expected, tolerance = .002) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not near ${expected}`)
const GMA_POCKET_MIN = .7 * .0254 + .004
const GMA_POCKET_MAX = 4.4 * .0254 - .004

function installVisualProbe(object) {
  object.userData.visualMatrix = new THREE.Matrix4()
  object.userData.visualSyncCount = 0
  object.userData.syncVisual = () => {
    object.updateWorldMatrix(true, false)
    object.userData.visualMatrix.copy(object.matrixWorld)
    object.userData.visualSyncCount += 1
  }
}

function assertVisualProbe(object, label) {
  object.updateWorldMatrix(true, false)
  object.matrixWorld.elements.forEach((value, index) => {
    near(object.userData.visualMatrix.elements[index], value, 1e-6)
  })
  assert.ok(object.userData.visualSyncCount > 0, `${label} must invoke the visual sync callback`)
}

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
const beam = {
  id: 'beam', kind: 'rack-beam', blocksCarriedLoads: false,
  minX: -1, maxX: 1, minZ: -.08, maxZ: .08, minY: 1.4, maxY: 1.6,
}
const carriedThroughSteel = sweepPose(
  { x: 0, z: 2, heading: 0 },
  { x: 0, z: 0, heading: 0 },
  [{ id: 'carried:test', halfWidth: .5, halfLength: .5, offsetX: 0, offsetZ: 0, minY: 1.2, maxY: 2.2 }],
  [beam],
)
assert.equal(carriedThroughSteel.blocked, true, 'a carried pallet may not tunnel horizontally through beam steel')
const carriedOnBeamTop = sweepPose(
  { x: 0, z: 2, heading: 0 },
  { x: 0, z: 0, heading: 0 },
  [{ id: 'carried:test', halfWidth: .5, halfLength: .5, offsetX: 0, offsetZ: 0, minY: 1.59, maxY: 2.59 }],
  [beam],
)
assert.equal(carriedOnBeamTop.blocked, false, 'a pallet may settle or skim across the beam support skin')
assert.ok(carriedOnBeamTop.contacts.some((contact) => contact.supportContact), 'beam-top support contact must remain observable')
const carriageIntoBeam = sweepPose(
  { x: 0, z: 2, heading: 0 },
  { x: 0, z: 0, heading: 0 },
  [{ id: 'carriage', loadEnd: true, halfWidth: .5, halfLength: .5, offsetX: 0, offsetZ: 0, minY: 1.59, maxY: 2.2 }],
  [beam],
)
assert.equal(carriageIntoBeam.blocked, true, 'the carriage may never inherit the carried-pallet beam exemption')
const openBaySweep = sweepPose(
  { x: 0, z: 2, heading: 0 },
  { x: 0, z: 0, heading: 0 },
  [{ id: 'fork-access', halfWidth: .1, halfLength: .55, offsetX: 0, offsetZ: 0, minY: .02, maxY: .12 }],
  [beam],
)
assert.equal(openBaySweep.blocked, false, 'fork-height access below an elevated beam must remain open')

// Hydraulic attachments move independently of the truck root. Sweep their
// complete 3D configurations so lift, reach, and sideshift cannot teleport a
// carriage, carried load, or elevated operator platform through facility steel.
{
  const hydraulicBeam = {
    id: 'hydraulic-beam', kind: 'rack-beam', blocksCarriedLoads: false,
    minX: -1, maxX: 1, minZ: -.09, maxZ: .09, minY: 1.4, maxY: 1.6,
  }
  const configuration = (values, colliders) => ({ values, colliders })
  const carriage = (overrides = {}) => ({
    id: 'carriage', x: 0, z: 0, halfWidth: .45, halfLength: .08,
    heading: 0, minY: .5, maxY: 1, ...overrides,
  })
  assert.throws(
    () => resolveHydraulicMotion(
      configuration({}, [carriage()]),
      configuration({}, [{ ...carriage(), maxY: Number.NaN }]),
      [],
    ),
    /finite maxY/,
    'invalid hydraulic geometry must fail closed',
  )
  assert.throws(
    () => resolveHydraulicMotion(
      configuration({}, [carriage()]),
      configuration({}, [carriage({ id: 'different-id' })]),
      [],
    ),
    /same collider ids/,
  )

  const liftIntoBeam = resolveHydraulicMotion(
    configuration({ lift: .5 }, [carriage()]),
    configuration({ lift: 1.2 }, [carriage({ minY: 1.2, maxY: 1.7 })]),
    [hydraulicBeam],
  )
  assert.equal(liftIntoBeam.blocked, true, 'lifting a carriage into a beam must stop')
  assert.ok(liftIntoBeam.acceptedConfiguration.colliders[0].maxY <= hydraulicBeam.minY + .002)
  assert.ok(liftIntoBeam.blockingContacts.some((contact) => contact.newContact && contact.penetration >= 0))
  assert.ok(liftIntoBeam.fraction > 0 && liftIntoBeam.fraction < 1)

  const reachIntoBeam = resolveHydraulicMotion(
    configuration({ reach: 0 }, [carriage({ z: .8, minY: 1.45, maxY: 1.55 })]),
    configuration({ reach: .8 }, [carriage({ z: 0, minY: 1.45, maxY: 1.55 })]),
    [hydraulicBeam],
  )
  assert.equal(reachIntoBeam.blocked, true, 'reaching a carriage through a beam must stop')
  assert.ok(reachIntoBeam.acceptedConfiguration.colliders[0].z > .16)

  const sideWall = {
    id: 'side-wall', kind: 'wall',
    minX: -.08, maxX: .08, minZ: -.8, maxZ: .8, minY: .2, maxY: 2,
  }
  const sideshiftIntoWall = resolveHydraulicMotion(
    configuration({ sideshift: -.7 }, [carriage({ x: -.7 })]),
    configuration({ sideshift: 0 }, [carriage({ x: 0 })]),
    [sideWall],
  )
  assert.equal(sideshiftIntoWall.blocked, true, 'sideshifting into a wall must stop')

  const carriedIntoBeam = resolveHydraulicMotion(
    configuration({ reach: 0 }, [{
      id: 'carried:load', x: 0, z: 1.2, halfWidth: .5, halfLength: .5,
      heading: 0, minY: 1.2, maxY: 2.2,
    }]),
    configuration({ reach: 1.2 }, [{
      id: 'carried:load', x: 0, z: 0, halfWidth: .5, halfLength: .5,
      heading: 0, minY: 1.2, maxY: 2.2,
    }]),
    [hydraulicBeam],
  )
  assert.equal(carriedIntoBeam.blocked, true, 'a carried pallet must not reach through beam steel')
  assert.equal(carriedIntoBeam.blockingContacts[0].collider.id, 'carried:load')

  const platformIntoBeam = resolveHydraulicMotion(
    configuration({ lift: 0 }, [{
      id: 'operator-platform', x: 0, z: 0, halfWidth: .56, halfLength: .7,
      heading: 0, minY: .1, maxY: 1.1,
    }]),
    configuration({ lift: 1 }, [{
      id: 'operator-platform', x: 0, z: 0, halfWidth: .56, halfLength: .7,
      heading: 0, minY: 1.1, maxY: 2.1,
    }]),
    [hydraulicBeam],
  )
  assert.equal(platformIntoBeam.blocked, true, 'an elevated order-picker platform must be a dynamic collider')

  const loweringEscape = resolveHydraulicMotion(
    configuration({ lift: 1.3 }, [carriage({ minY: 1.3, maxY: 1.5 })]),
    configuration({ lift: .8 }, [carriage({ minY: .8, maxY: 1 })]),
    [hydraulicBeam],
  )
  assert.equal(loweringEscape.blocked, false, 'lowering out of an existing beam overlap must remain possible')
  assert.equal(loweringEscape.fraction, 1)
  assert.ok(loweringEscape.contacts.some((contact) => contact.escaping), 'escape evidence must be retained')
  const worseningOverlap = resolveHydraulicMotion(
    configuration({ lift: 1.3 }, [carriage({ minY: 1.3, maxY: 1.5 })]),
    configuration({ lift: 1.45 }, [carriage({ minY: 1.45, maxY: 1.65 })]),
    [hydraulicBeam],
  )
  assert.equal(worseningOverlap.blocked, true, 'deepening an existing 3D overlap must be blocked')
  near(worseningOverlap.fraction, 0, .005)
  const hiddenHorizontalWorsening = resolveHydraulicMotion(
    configuration({ reach: 0 }, [carriage({ z: .15, minY: 1.3, maxY: 1.41 })]),
    configuration({ reach: .15 }, [carriage({ z: 0, minY: 1.3, maxY: 1.41 })]),
    [hydraulicBeam],
  )
  assert.equal(
    hiddenHorizontalWorsening.blocked,
    true,
    'a constant shallow vertical overlap must not hide worsening horizontal penetration',
  )
  near(hiddenHorizontalWorsening.fraction, 0, .005)

  const events = []
  const classPhysics = new WarehouseLoadPhysics({
    obstacles: [hydraulicBeam],
    onEvent: (event) => events.push(event),
  })
  const twoBodies = (y) => configuration({ lift: y }, [-.25, .25].map((x, index) => carriage({
    id: `platform-part-${index}`, x, minY: y, maxY: y + .5, halfWidth: .2,
  })))
  classPhysics.resolveHydraulicMotion(twoBodies(.8), twoBodies(1.4))
  classPhysics.resolveHydraulicMotion(twoBodies(.8), twoBodies(1.4))
  assert.equal(
    events.filter((event) => event.type === 'rack-contact').length,
    1,
    'one hydraulic obstacle strike must emit one canonical score event across colliders and held input',
  )
  assert.equal(events[0].hydraulicMotion, true)
  assert.ok(events[0].penetrationDelta >= 0)
}

// Fork blades are physical collision bodies, with one narrow exception: both
// tines may enter the two distinct stringer openings of a GMA pallet while they
// remain vertically inside the pocket.
{
  const palletWood = {
    id: 'gma-pallet', kind: 'pallet', shape: 'obb', solid: true,
    x: 0, z: 0, heading: 0, halfWidth: .508, halfLength: .6096,
    width: 1.016, depth: 1.2192, minY: 0, maxY: 1.05,
    pocketMin: GMA_POCKET_MIN, pocketMax: GMA_POCKET_MAX,
    stringerWidth: 1.4 * .0254, edgeStringerInset: .06, channelClearance: .006,
  }
  const tineSet = (z, lateral = [-.25, .25]) => ({
    values: { reach: 1.3 - z },
    colliders: lateral.map((x, index) => ({
      id: `fork-tine-${index}`, x, z, halfWidth: .05, halfLength: .5,
      heading: 0, minY: .035, maxY: .085,
      forkTine: true, forkSetId: 'main-forks',
    })),
  })
  const channelEntry = resolveHydraulicMotion(tineSet(1.3), tineSet(0), [palletWood])
  assert.equal(channelEntry.blocked, false, 'two low tines must enter the two valid GMA channels')
  assert.equal(channelEntry.fraction, 1)
  assert.equal(channelEntry.contacts.filter((contact) => contact.channelAccess).length, 2)
  assert.deepEqual(
    channelEntry.contacts.filter((contact) => contact.channelAccess).map((contact) => contact.tineChannel).sort(),
    [0, 1],
  )

  const channelEvents = []
  const channelPalletObject = new THREE.Group()
  channelPalletObject.name = 'channel-pallet'
  channelPalletObject.userData.physics = {
    id: 'channel-pallet',
    dimensions: { x: 1.016, y: 1.05, z: 1.2192 },
  }
  const channelTravelPhysics = new WarehouseLoadPhysics({
    pallets: [channelPalletObject],
    truckColliders: [{
      id: 'body-away', offsetX: 0, offsetZ: 10, halfWidth: .1, halfLength: .1,
      minY: 0, maxY: .2,
    }],
    onEvent: (event) => channelEvents.push(event),
  })
  channelTravelPhysics.resolveHydraulicMotion(tineSet(1.3), tineSet(1.3))
  const channelTravel = channelTravelPhysics.resolveTruckMotion(
    { x: 0, z: 0, heading: 0 },
    { x: 0, z: -1.3, heading: 0 },
  )
  assert.equal(channelTravel.blocked, false)
  assert.equal(
    channelEvents.filter((event) => event.type === 'load-contact').length,
    0,
    'valid channel access is contact evidence, not a scoreable load strike',
  )

  const stringerStrike = resolveHydraulicMotion(tineSet(1.3, [0, .25]), tineSet(0, [0, .25]), [palletWood])
  assert.equal(stringerStrike.blocked, true, 'a tine centered on a pallet stringer must hit wood')
  assert.ok(stringerStrike.blockingContacts.some((contact) => contact.obstacle.id === 'gma-pallet'))

  const deckCuttingSet = (z) => ({
    values: { reach: 1.3 - z },
    colliders: [-.25, .25].map((x, index) => ({
      id: `fork-tine-${index}`, x, z, halfWidth: .05, halfLength: .5,
      heading: 0, minY: .08, maxY: .12,
      forkTine: true, forkSetId: 'main-forks',
    })),
  })
  assert.equal(
    resolveHydraulicMotion(deckCuttingSet(1.3), deckCuttingSet(0), [palletWood]).blocked,
    true,
    'a tine intersecting the top deck must hit pallet wood',
  )

  const lowSteel = {
    id: 'low-steel', kind: 'rack-upright',
    minX: -.8, maxX: .8, minZ: -.06, maxZ: .06, minY: 0, maxY: .3,
  }
  const tineSteelStrike = resolveHydraulicMotion(tineSet(1.3), tineSet(0), [lowSteel])
  assert.equal(tineSteelStrike.blocked, true, 'fork tines must not pass through low rack steel')

  const lowWall = {
    id: 'low-wall', kind: 'wall',
    minX: -.8, maxX: .8, minZ: -.06, maxZ: .06, minY: 0, maxY: .3,
  }
  assert.equal(
    resolveHydraulicMotion(tineSet(1.3), tineSet(0), [lowWall]).blocked,
    true,
    'fork tines must not pass through walls',
  )

  const pedestrian = {
    id: 'fork-pedestrian', kind: 'pedestrian', shape: 'circle',
    x: .25, z: 0, radius: .22, minY: 0, maxY: 1.8,
  }
  const tinePedestrianStrike = resolveHydraulicMotion(tineSet(1.3), tineSet(0), [pedestrian])
  assert.equal(tinePedestrianStrike.blocked, true, 'fork tines must not pass through a pedestrian')

  const frame = new THREE.Group()
  frame.position.set(0, .04, 0)
  frame.updateMatrixWorld(true)
  const builtTines = forkTineCollidersForFrame(frame, {
    localBase: [0, 0, 0], localForward: [0, 0, -1],
    length: 1.1, spread: .5, tineWidth: .1, thickness: .05,
  })
  assert.equal(builtTines.length, 2)
  near(Math.abs(builtTines[0].x - builtTines[1].x), .5)
  near(builtTines[0].maxY - builtTines[0].minY, .05)

  // Once committed, dynamic tines remain in the ordinary travel sweep rather
  // than becoming nonphysical whenever only the truck root is moving.
  const travelPhysics = new WarehouseLoadPhysics({
    obstacles: [lowSteel],
    truckColliders: [{
      id: 'body-away', offsetX: 0, offsetZ: 10, halfWidth: .1, halfLength: .1,
      minY: 0, maxY: .2,
    }],
  })
  travelPhysics.resolveHydraulicMotion(tineSet(1.3), tineSet(1.3))
  const travelStrike = travelPhysics.resolveTruckMotion(
    { x: 0, z: 0, heading: 0 },
    { x: 0, z: -1.3, heading: 0 },
  )
  assert.equal(travelStrike.blocked, true, 'accepted dynamic tines must also block during truck travel')

  const releasedLoadPhysics = new WarehouseLoadPhysics({
    truckColliders: [{
      id: 'body-away', offsetX: 0, offsetZ: 10, halfWidth: .1, halfLength: .1,
      minY: 0, maxY: .2,
    }],
  })
  const staleCarried = {
    values: { lift: 0 },
    colliders: [{
      id: 'carried:released', x: 0, z: 0, halfWidth: .508, halfLength: .6096,
      heading: 0, minY: 0, maxY: 1.05,
    }],
  }
  releasedLoadPhysics.resolveHydraulicMotion(staleCarried, staleCarried)
  const releasedObject = new THREE.Group()
  releasedObject.name = 'released'
  releasedObject.userData.physics = {
    id: 'released', dimensions: { x: 1.016, y: 1.05, z: 1.2192 },
  }
  releasedLoadPhysics.registerPallet(releasedObject)
  assert.equal(
    releasedLoadPhysics.resolveTruckMotion(
      { x: 0, z: 0, heading: 0 },
      { x: 0, z: 0, heading: 0 },
    ).blocked,
    false,
    'a released pallet must not collide with its stale carried envelope on the next travel step',
  )
}

// Starting inside a collider must not permanently trap the truck or a pushed
// load. Only moves that strictly reduce the original penetration are accepted.
{
  const wall = { id: 'overlap-wall', minX: -.2, maxX: .2, minZ: -2, maxZ: 2 }
  for (const id of ['body', 'pushed:load']) {
    const collider = [{ id, halfWidth: .5, halfLength: .5, offsetX: 0, offsetZ: 0 }]
    const escaping = sweepPose({ x: .65, z: 0, heading: 0 }, { x: 1.2, z: 0, heading: 0 }, collider, [wall])
    assert.equal(escaping.blocked, false, `${id} motion out of an existing overlap must be accepted`)
    near(escaping.pose.x, 1.2)
    const deepening = sweepPose({ x: .65, z: 0, heading: 0 }, { x: .4, z: 0, heading: 0 }, collider, [wall])
    assert.equal(deepening.blocked, true, `${id} motion deeper into an existing overlap must be blocked`)
    near(deepening.pose.x, .65, .003)
  }
}

// Solver contact types must map to an evaluator-visible assessment. Rack and
// pedestrian contacts previously reached the React callback and disappeared.
{
  const upright = contactAssessment({ type: 'rack-contact', obstacle: { kind: 'rack-upright', label: 'Rack upright' } })
  const beam = contactAssessment({ type: 'rack-contact', obstacle: { kind: 'rack-beam', label: 'Rack beam' } })
  const pedestrian = contactAssessment({ type: 'pedestrian-contact', obstacle: { kind: 'pedestrian' } })
  assert.deepEqual(
    { type: upright.type, severity: upright.severity, deduction: upright.deduction },
    { type: 'rack-contact', severity: 'critical', deduction: 20 },
  )
  assert.equal(beam.severity, 'major')
  assert.equal(beam.deduction, 12)
  assert.equal(pedestrian.type, 'pedestrian-contact')
  assert.equal(pedestrian.severity, 'critical')
  assert.equal(pedestrian.deduction, 25)
  assert.equal(contactAssessment({ type: 'pallet-engaged' }), null)
}

{
  const contactEvents = []
  const contactPhysics = new WarehouseLoadPhysics({
    obstacles: [{
      id: 'single-upright', kind: 'rack-upright',
      minX: -.2, maxX: .2, minZ: -.2, maxZ: .2, minY: 0, maxY: 4,
    }],
    truckColliders: [
      { id: 'body-a', offsetX: 0, offsetZ: 0, halfWidth: .4, halfLength: .4, minY: 0, maxY: 2 },
      { id: 'body-b', offsetX: 0, offsetZ: 0, halfWidth: .3, halfLength: .3, minY: 0, maxY: 2 },
    ],
    onEvent: (event) => contactEvents.push(event),
  })
  contactPhysics.resolveTruckMotion({ x: 0, z: 1, heading: 0 }, { x: 0, z: 0, heading: 0 })
  assert.equal(contactEvents.filter((event) => event.type === 'rack-contact').length, 1, 'one obstacle contact must emit once even when multiple colliders hit it')
  assert.equal(contactEvents[0].severity, 'critical')
}

const nominalFork = {
  baseX: 0, baseY: .04, baseZ: 1.75,
  forwardX: 0, forwardY: 0, forwardZ: -1,
  rightX: 1, rightY: 0, rightZ: 0, upY: 1,
  length: 1.12, spread: .66, tineWidth: .1, thickness: .05,
  minimumPenetration: .34, maximumApproachAngle: 18 * Math.PI / 180,
}
const nominalPallet = {
  x: 0, y: 0, z: 1, yaw: 0, width: 1.016, depth: 1.2192,
  weight: 1200, pocketMin: GMA_POCKET_MIN, pocketMax: GMA_POCKET_MAX,
}
const engagement = testForkPalletEngagement(nominalFork, nominalPallet)
assert.equal(engagement.eligible, true)
assert.ok(engagement.penetration > .8)
assert.deepEqual(engagement.tineChannels.map((entry) => entry.channel), [0, 1], 'both tines must occupy distinct GMA openings')
assert.equal(testForkPalletEngagement(nominalFork, { ...nominalPallet, yaw: Math.PI }).eligible, true, 'either 40 inch face permits entry')
assert.equal(testForkPalletEngagement(nominalFork, { ...nominalPallet, yaw: Math.PI / 2 }).eligible, false, 'side entry through stringers must fail')
assert.equal(testForkPalletEngagement(nominalFork, { ...nominalPallet, x: .09 }).channelEligible, false, 'lateral stringer penetration must fail')
assert.equal(testForkPalletEngagement({ ...nominalFork, spread: .1 }, nominalPallet).channelEligible, false, 'both tines in one pocket must fail')
assert.equal(testForkPalletEngagement({ ...nominalFork, forwardY: .15 }, nominalPallet).verticalEligible, false, 'a pitched tine cutting the deck must fail')
const overweight = testForkPalletEngagement({ ...nominalFork, maximumLoadWeight: 1000 }, nominalPallet)
assert.equal(overweight.geometryEligible, true)
assert.equal(overweight.loadEligible, false)
assert.equal(overweight.eligible, false)
assert.equal(overweight.rejectionReason, 'overweight')

const placement = findRackSlotPlacement(
  { id: 'pallet', x: .03, y: 1.8, z: -.02, yaw: Math.PI, width: 1.016, depth: 1.2192 },
  [{ id: 'slot', x: 0, y: 1.8, z: 0, yaw: 0, width: 1.34, depth: 1.12, positionTolerance: .17, yawTolerance: .14, enabled: true }],
)
assert.equal(placement.id, 'slot')

{
  const slot = { id: 'supported-slot', x: 0, y: 1, z: 0, yaw: 0 }
  const pallet = { width: 1.016, depth: 1.2192 }
  const supportBeams = [-.45, .45].map((z, index) => ({
    id: `support-${index}`, kind: 'rack-beam',
    minX: -.7, maxX: .7, minZ: z - .05, maxZ: z + .05, minY: .9, maxY: 1.01,
  }))
  const support = evaluateRackPlacementSupport(pallet, slot, supportBeams)
  assert.equal(support.eligible, true)
  near(support.supportY, 1.01)
  assert.deepEqual(support.beamIds, ['support-0', 'support-1'])
  assert.equal(evaluateRackPlacementSupport(pallet, slot, supportBeams.slice(0, 1)).eligible, false)
}

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
pallet.userData.physics = { id: 'test-load', weight: 1440, dimensions: { x: 1.016, y: 1.05, z: 1.2192 } }
installVisualProbe(pallet)
scene.add(pallet)
scene.updateMatrixWorld(true)

const events = []
const placementBeams = [-.45, .45].map((offset, index) => ({
  id: `slot-a-support-${index}`,
  kind: 'rack-beam',
  blocksCarriedLoads: false,
  minX: -.7,
  maxX: .7,
  minZ: 1 + offset - .05,
  maxZ: 1 + offset + .05,
  minY: .9,
  maxY: 1.01,
}))
const physics = new WarehouseLoadPhysics({
  truckRoot: truck,
  forkFrame,
  pallets: [pallet],
  obstacles: placementBeams,
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
assertVisualProbe(pallet, 'attach')

forkFrame.position.y = 1.1
scene.updateMatrixWorld(true)
physics.update(1 / 60)
assert.ok(pallet.getWorldPosition(new THREE.Vector3()).y > 1)
assertVisualProbe(pallet, 'carry')
forkFrame.position.y = 1.04
scene.updateMatrixWorld(true)
physics.update(1 / 60)
assert.equal(physics.snapshot().carriedPalletId, null)
assert.equal(physics.snapshot().slots[0].occupiedBy, 'test-load')
near(pallet.getWorldPosition(new THREE.Vector3()).y, 1.01)
assertVisualProbe(pallet, 'rack settle')

physics.update(1 / 60)
for (let step = 0; step < 6 && !physics.carried; step += 1) {
  forkFrame.position.y += .01
  scene.updateMatrixWorld(true)
  physics.update(1 / 60)
}
assert.equal(physics.snapshot().carriedPalletId, 'test-load')
assert.equal(physics.snapshot().slots[0].occupiedBy, null)
assert.deepEqual(events.filter((type) => type.startsWith('pallet-')), ['pallet-engaged', 'pallet-racked', 'pallet-engaged'])
physics.reset()
assert.equal(physics.snapshot().carriedPalletId, null)
assert.equal(physics.snapshot().slots[0].occupiedBy, null)
near(pallet.getWorldPosition(new THREE.Vector3()).y, 0)
near(pallet.getWorldPosition(new THREE.Vector3()).z, 1)
assertVisualProbe(pallet, 'reset')

// End-to-end regression for the Phase 3 pickup deadlock. A 75 mm pallet-truck
// blade has less than the old generic 35 mm free-rise threshold inside a GMA
// pocket. Sweep each accepted hydraulic increment, then let update attach the
// pallet when the blade reaches the underside of the top deck.
{
  const thickScene = new THREE.Scene()
  const thickTruck = new THREE.Group()
  thickTruck.position.z = 2
  thickScene.add(thickTruck)
  const thickFork = new THREE.Group()
  thickFork.position.set(0, GMA_POCKET_MIN, -.25)
  thickTruck.add(thickFork)
  const thickPallet = new THREE.Group()
  thickPallet.position.set(0, 0, 1)
  thickPallet.userData.physics = {
    id: 'thick-blade-load', weight: 1200,
    dimensions: { x: 1.016, y: 1.05, z: 1.2192 },
  }
  thickScene.add(thickPallet)
  const thickForkSpecification = {
    localBase: [0, .075 * .5, 0],
    localForward: [0, 0, -1],
    length: 1.22,
    spread: .49,
    tineWidth: .1,
    thickness: .075,
  }
  thickScene.updateMatrixWorld(true)
  const thickPhysics = new WarehouseLoadPhysics({
    truckRoot: thickTruck,
    forkFrame: thickFork,
    forkSpecification: thickForkSpecification,
    pallets: [thickPallet],
  })
  thickPhysics.update(1 / 90)
  for (let step = 0; step < 8 && !thickPhysics.carried; step += 1) {
    const current = {
      values: { forkY: thickFork.position.y },
      colliders: forkTineCollidersForFrame(thickFork, thickForkSpecification),
    }
    thickFork.position.y += .002
    thickScene.updateMatrixWorld(true)
    const proposed = {
      values: { forkY: thickFork.position.y },
      colliders: forkTineCollidersForFrame(thickFork, thickForkSpecification),
    }
    const result = thickPhysics.resolveHydraulicMotion(current, proposed)
    assert.equal(result.blocked, false, 'valid in-pocket lift must reach pallet deck contact')
    thickFork.position.y = result.acceptedConfiguration.values.forkY
    thickScene.updateMatrixWorld(true)
    thickPhysics.update(1 / 90)
  }
  assert.equal(
    thickPhysics.snapshot().carriedPalletId,
    'thick-blade-load',
    'deck contact must attach before the next hydraulic step would intersect pallet wood',
  )
}

// Rated-capacity and custom policy hooks reject attachment while preserving a
// machine-readable reason for the Simulator's later capacity UI integration.
{
  const capacityScene = new THREE.Scene()
  const capacityTruck = new THREE.Group()
  capacityTruck.position.z = 2
  capacityScene.add(capacityTruck)
  const capacityFork = new THREE.Group()
  capacityFork.position.set(0, .04, -.25)
  capacityTruck.add(capacityFork)
  const capacityLoad = new THREE.Group()
  capacityLoad.position.set(0, 0, 1)
  capacityLoad.userData.physics = {
    id: 'overweight-load', weight: 1800,
    dimensions: { x: 1.016, y: 1.05, z: 1.2192 },
  }
  capacityScene.add(capacityLoad)
  capacityScene.updateMatrixWorld(true)
  const capacityPhysics = new WarehouseLoadPhysics({
    truckRoot: capacityTruck,
    forkFrame: capacityFork,
    pallets: [capacityLoad],
    forkSpecification: { localBase: [0, 0, 0], maximumLoadWeight: 1500 },
  })
  capacityPhysics.update(1 / 90)
  capacityFork.position.y += .04
  capacityScene.updateMatrixWorld(true)
  const capacitySnapshot = capacityPhysics.update(1 / 90)
  assert.equal(capacitySnapshot.carriedPalletId, null, 'an overweight pallet must not attach')
  assert.equal(capacitySnapshot.engagement.loadEligible, false)
  assert.equal(capacitySnapshot.engagement.rejectionReason, 'overweight')

  capacityPhysics.configureTruck({
    forkSpecification: { maximumLoadWeight: Infinity },
    engagementEligibility: () => ({ eligible: false, reason: 'derated-capacity' }),
  })
  const hooked = capacityPhysics.evaluatePalletEngagement(capacityPhysics.pallets[0], nominalFork)
  assert.equal(hooked.eligible, false)
  assert.equal(hooked.rejectionReason, 'derated-capacity')
}

const reachFork = new THREE.Group()
const referenceForkConfiguration = forkConfigurationForProfile(
  { manufacturer: 'Crown', family: 'reach', capacity: 1450 },
  { reachGroup: reachFork, carriage: new THREE.Group() },
)
assert.equal(referenceForkConfiguration.forkFrame, reachFork)
assert.equal(
  referenceForkConfiguration.forkSpecification.maximumLoadWeight,
  1450,
  'profile capacity must reach the load-eligibility boundary without extra Simulator wiring',
)
assert.equal(
  testForkPalletEngagement(
    { ...nominalFork, maximumLoadWeight: referenceForkConfiguration.forkSpecification.maximumLoadWeight },
    { ...nominalPallet, weight: 1500 },
  ).rejectionReason,
  'overweight',
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

// Floor pallets are shoved rather than treated as bollards, but every accepted
// displacement is swept against facility hardware, people, and other loads.
{
  const makePallet = (scene, name, weight, z, extra = {}) => {
    const body = new THREE.Group()
    body.name = name
    body.position.set(0, 0, z)
    body.userData.physics = { id: name, weight, dimensions: { x: 1.016, y: 1.05, z: 1.2192 }, ...extra }
    installVisualProbe(body)
    scene.add(body)
    return body
  }
  const pushScenario = ({ weight, movable = true, obstacles = [], trailingLoad = false }) => {
    const scene = new THREE.Scene()
    const truck = new THREE.Group()
    scene.add(truck)
    const load = makePallet(scene, 'test-load', weight, 0, { movable })
    const trailing = trailingLoad ? makePallet(scene, 'blocking-load', 1200, -1.3) : null
    scene.updateMatrixWorld(true)
    const pushed = []
    const events = []
    const physics = new WarehouseLoadPhysics({
      truckRoot: truck,
      pallets: trailing ? [load, trailing] : [load],
      obstacles,
      truckColliders: [{ id: 'body', offsetX: 0, offsetZ: 0, halfWidth: .6, halfLength: .8, minY: 0, maxY: 2 }],
      onEvent: (event) => {
        events.push(event)
        if (event.type === 'load-pushed') pushed.push(event)
      },
    })
    const result = physics.resolveTruckMotion(
      { x: 0, z: 2.4, heading: 0 },
      { x: 0, z: 1.2, heading: 0 },
      { speed: 1.2 },
    )
    return { load, trailing, physics, pushed, events, result }
  }

  const light = pushScenario({ weight: 200 })
  const heavy = pushScenario({ weight: 4000 })
  const lightMoved = Math.abs(light.load.position.z)
  const heavyMoved = Math.abs(heavy.load.position.z)
  assert.ok(lightMoved > 0, 'a floor pallet must be pushable')
  assert.ok(lightMoved > heavyMoved, `a light load must shove further than a heavy one (${lightMoved.toFixed(3)} vs ${heavyMoved.toFixed(3)})`)
  assert.equal(light.pushed.length, 1, 'one pushed load must produce one canonical event')
  assertVisualProbe(light.load, 'push')

  const syncsBeforeReset = light.load.userData.visualSyncCount
  light.physics.reset()
  near(light.load.position.z, 0)
  assert.ok(light.load.userData.visualSyncCount > syncsBeforeReset, 'push reset must resync the visual matrix')
  assertVisualProbe(light.load, 'push reset')
  const fixed = pushScenario({ weight: 200, movable: false })
  near(fixed.load.position.z, 0)
  assert.equal(fixed.result.blocked, true, 'movable:false must remain a solid load')

  const thinWall = {
    id: 'thin-wall', kind: 'wall', minX: -2, maxX: 2,
    minZ: -.72, maxZ: -.68, minY: 0, maxY: 2,
  }
  const rackPost = {
    id: 'rack-post', kind: 'rack-upright', minX: -.2, maxX: .2,
    minZ: -.76, maxZ: -.68, minY: 0, maxY: 4,
  }
  const pedestrian = {
    id: 'pedestrian', kind: 'pedestrian', shape: 'circle',
    x: 0, z: -.9, radius: .2, minY: 0, maxY: 1.8,
  }
  for (const { scenario, expectedContact } of [
    { scenario: pushScenario({ weight: 200, obstacles: [thinWall] }), expectedContact: 'facility-contact' },
    { scenario: pushScenario({ weight: 200, obstacles: [rackPost] }), expectedContact: 'rack-contact' },
    { scenario: pushScenario({ weight: 200, obstacles: [pedestrian] }), expectedContact: 'pedestrian-contact' },
    { scenario: pushScenario({ weight: 200, trailingLoad: true }), expectedContact: 'load-contact' },
  ]) {
    assert.ok(scenario.load.position.z > -.11, `pushed load crossed its blocker at z=${scenario.load.position.z}`)
    assert.ok(scenario.events.some((event) => event.type === expectedContact), `${expectedContact} must remain canonical when transmitted through a pushed load`)
    if (scenario.trailing) near(scenario.trailing.position.z, -1.3)
  }

  // A racked load is not a shoving match; it stays put and scores as a strike.
  const rackedScene = new THREE.Scene()
  const racked = makePallet(rackedScene, 'racked-load', 1200, 0, { status: 'racked' })
  rackedScene.updateMatrixWorld(true)
  const rackedPhysics = new WarehouseLoadPhysics({
    pallets: [{ object: racked, status: 'racked', slotId: 'slot-x', weight: 1200 }],
    rackSlots: [{ id: 'slot-x', position: { x: 0, y: 0, z: 0 }, halfExtents: { x: .56, z: .69 } }],
    truckColliders: [{ id: 'body', offsetX: 0, offsetZ: 0, halfWidth: .6, halfLength: .8, minY: 0, maxY: 2 }],
  })
  rackedPhysics.resolveTruckMotion({ x: 0, z: 2.4, heading: 0 }, { x: 0, z: 1.2, heading: 0 }, { speed: 1.2 })
  near(racked.position.z, 0)
}

// REGRESSION: a picked-up load must end up ON the forks, wherever the truck
// happens to be standing. forkConfigurationForProfile derives the backrest seat
// position from a TRUCK-LOCAL blade measurement; subtracting a WORLD frame
// position from it put the seat ~13 m ahead of the forks, so engaging a pallet
// flung it forty feet down the aisle while it still tracked lift.
{
  const farScene = new THREE.Scene()
  const farTruck = new THREE.Group()
  farTruck.position.set(0, 0, 11.5)          // the Simulator's start position
  farScene.add(farTruck)
  const carriage = new THREE.Group()
  carriage.position.set(0, .04, 0)
  farTruck.add(carriage)
  // Blades measured in TRUCK-LOCAL space, as measureForks does during rig mapping.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(.1, .04, 1.07))
  blade.name = 'forks_L'
  blade.position.set(0, 0, -.415)
  carriage.add(blade)
  const blade2 = blade.clone()
  blade2.name = 'forks_R'
  carriage.add(blade2)
  farScene.updateMatrixWorld(true)

  const box = new THREE.Box3().setFromObject(blade)
  const rig = {
    root: farTruck,
    carriage,
    forkMetrics: {
      clearance: box.min.y, bladeBottom: box.min.y,
      length: 1.07, spread: .56, tineWidth: .1,
      // Truck-local, i.e. relative to farTruck, not world.
      heelZ: box.max.z - farTruck.position.z,
      tipZ: box.min.z - farTruck.position.z,
      faceHalfWidth: .33,
    },
  }
  const { forkSpecification } = forkConfigurationForProfile({ manufacturer: 'Crown', family: 'counterbalance' }, rig)
  assert.ok(
    Math.abs(forkSpecification.heelLocalZ) < 1.5,
    `heelLocalZ ${forkSpecification.heelLocalZ.toFixed(2)} is not a fork-frame offset; world and truck-local spaces have been mixed`,
  )
}

console.log('PASS load physics: collision sweep, fork engagement, rigid carry, rack placement, rack removal, cone response, pallet pushing, load seating')
