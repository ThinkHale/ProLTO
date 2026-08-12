import { getChassis } from '../data/chassis.js'

// Lift truck stability.
//
// The previous readout was a tuned linear scalar:
//     100 - speed*4.5 - forkHeight*.085 - |steer|*speed*7.5 - |sideshift|*18
// It moved in roughly the right direction but it was not a physical model: it
// had no mass, no load moment, no support geometry, and no notion of which way
// the truck was about to go over. For a tool that sits next to 29 CFR 1910.178
// that is the wrong thing to be approximating.
//
// This module implements the standard model instead:
//
//   1. Build the SUPPORT POLYGON from the chassis. A four-wheel counterbalance
//      truck is still a TRIANGLE, because its rear axle pivots on a center
//      trunnion -- that single fact is why forklifts tip sideways and why the
//      stability triangle is taught the way it is. Straddle trucks get a
//      quadrilateral from the outriggers, pallet trucks a tricycle.
//
//   2. Combine the truck, load, and (for order pickers) elevated operator into
//      one center of gravity in truck-local coordinates.
//
//   3. Displace that CG by the inertial forces actually acting -- centrifugal
//      from the turn radius the steering model is already solving, longitudinal
//      from braking and acceleration -- to get the point where the resultant
//      force meets the floor.
//
//   4. Report the normalized margin to the nearest edge of the polygon, and
//      WHICH edge, so the event rules can say something specific and true.
//
// Frame convention matches src/data/chassis.js: -Z forward, +X operator right.

const G = 9.80665
const IN = .0254

function supportPolygon(chassis) {
  if (chassis.support === 'triangle') {
    // Front drive wheels plus the rear axle's center pivot. NOT the rear tires.
    return [
      { x: -chassis.fixedHalfWidth, z: chassis.fixedAxleZ, edge: 'left' },
      { x: chassis.fixedHalfWidth, z: chassis.fixedAxleZ, edge: 'right' },
      { x: 0, z: chassis.pivotZ, edge: 'rear pivot' },
    ]
  }
  if (chassis.support === 'tricycle') {
    return [
      { x: -chassis.fixedHalfWidth, z: chassis.fixedAxleZ, edge: 'left load wheel' },
      { x: chassis.fixedHalfWidth, z: chassis.fixedAxleZ, edge: 'right load wheel' },
      { x: 0, z: chassis.steerAxleZ, edge: 'drive wheel' },
    ]
  }
  // Straddle: outrigger tips forward, drive and stabilizer aft.
  return [
    { x: -chassis.outriggerHalfWidth, z: chassis.outriggerTipZ, edge: 'left outrigger' },
    { x: chassis.outriggerHalfWidth, z: chassis.outriggerTipZ, edge: 'right outrigger' },
    { x: chassis.driveHalfWidth, z: chassis.steerAxleZ, edge: 'right drive' },
    { x: -chassis.driveHalfWidth, z: chassis.steerAxleZ, edge: 'left drive' },
  ]
}

function centroid(polygon) {
  const sum = polygon.reduce((total, point) => ({ x: total.x + point.x, z: total.z + point.z }), { x: 0, z: 0 })
  return { x: sum.x / polygon.length, z: sum.z / polygon.length }
}

// Normalized inward margin: 1 at the centroid, 0 on the edge, negative once the
// resultant has left the polygon and the truck is going over.
function edgeMargins(polygon, point) {
  const center = centroid(polygon)
  const margins = []
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index]
    const b = polygon[(index + 1) % polygon.length]
    const ex = b.x - a.x
    const ez = b.z - a.z
    const length = Math.hypot(ex, ez)
    if (length < 1e-6) continue
    // Outward normal, oriented by testing the centroid.
    let nx = ez / length
    let nz = -ex / length
    if ((center.x - a.x) * nx + (center.z - a.z) * nz > 0) {
      nx = -nx
      nz = -nz
    }
    const pointDistance = (point.x - a.x) * nx + (point.z - a.z) * nz
    const centerDistance = (center.x - a.x) * nx + (center.z - a.z) * nz
    const reach = Math.abs(centerDistance)
    if (reach < 1e-6) continue
    margins.push({ margin: -pointDistance / reach, edge: `${a.edge} to ${b.edge}`, axis: Math.abs(ex) > Math.abs(ez) ? 'longitudinal' : 'lateral' })
  }
  return margins
}

// Rated capacity falls with load center, lift height, and -- on a reach truck --
// with the pantograph extended, because each moves the load's moment arm out.
// This approximates a published capacity chart rather than reproducing one.
export function ratedCapacityAt(chassis, loadCenter, height, reachExtension = 0) {
  const centerFactor = chassis.ratedLoadCenter / Math.max(loadCenter, chassis.ratedLoadCenter)
  const heightFactor = 1 - (chassis.heightDerate || 0) * Math.min(1, Math.max(0, height / chassis.ratedHeight))
  const reachFactor = chassis.maxReachExtension
    ? 1 - (chassis.reachDerate || 0) * Math.min(1, Math.max(0, reachExtension / chassis.maxReachExtension))
    : 1
  return chassis.ratedCapacity * centerFactor * Math.max(heightFactor, .12) * Math.max(reachFactor, .12)
}

/**
 * Solve stability for one frame.
 *
 * All distances meters, masses kilograms, speed m/s, tilt radians.
 * `yawRate` and `forwardAccel` come straight out of the steering integrator.
 */
// Each truck's margin at rest, empty and stationary. A parked counterbalance
// sits at 0.73 and a parked pallet truck at 0.44 -- both correct, because the
// margin is distance to the nearest edge of the support polygon and no truck
// carries its CG exactly at the centroid. But a gauge that never reads full
// when parked is unreadable, so the DISPLAY is scaled against this reference
// while `margin` stays the raw physical value the warnings are judged on.
const REST_INPUT = Object.freeze({
  loadMass: 0, forkHeight: 0, speed: 0, yawRate: 0, turnRadius: Infinity, forwardAccel: 0,
})
const restMargins = new Map()

function restMargin(profile) {
  const key = `${profile.manufacturer}:${profile.family}`
  if (!restMargins.has(key)) {
    restMargins.set(key, Math.max(solveCore(profile, REST_INPUT).margin, .05))
  }
  return restMargins.get(key)
}

export function solveStability(profile, input) {
  const result = solveCore(profile, input)
  // 100% = as stable as this truck gets standing empty; 0% = the resultant has
  // left the support polygon.
  result.percent = Math.round(Math.max(0, Math.min(1, result.margin / restMargin(profile))) * 100)
  result.restMargin = restMargin(profile)
  return result
}

function solveCore(profile, input) {
  const chassis = getChassis(profile)
  const polygon = supportPolygon(chassis)
  const {
    loadMass = 0,
    forkHeight = 0,
    reachExtension = 0,
    tilt = 0,
    sideshift = 0,
    speed = 0,
    yawRate = 0,
    forwardAccel = 0,
    loadHeight = 1.05,
  } = input

  // --- Combined center of gravity -------------------------------------------
  const truckMass = chassis.serviceWeight
  const truckZ = chassis.fixedAxleZ + chassis.cgFromFixedAxleZ
  let totalMass = truckMass
  let momentX = 0
  let momentY = truckMass * chassis.cgHeight
  let momentZ = truckMass * truckZ

  // The load's own CG sits about half its height above the fork blades, one
  // load-center forward of the fork face, and moves with reach and sideshift.
  const loadCenter = chassis.ratedLoadCenter
  const loadCgAboveFork = loadHeight * .5
  if (loadMass > 0) {
    // Tilting back pulls the load toward the truck and slightly down; tilting
    // forward pushes it out over the front wheels, which is exactly the habit
    // that puts an elevated load on the floor.
    const loadZ = chassis.forkPivotZ - reachExtension - loadCenter + Math.sin(tilt) * (forkHeight + loadCgAboveFork)
    const loadY = forkHeight + loadCgAboveFork * Math.cos(tilt)
    totalMass += loadMass
    momentX += loadMass * sideshift
    momentY += loadMass * loadY
    momentZ += loadMass * loadZ
  }

  // An order picker lifts the operator too, so the crew mass rides the platform.
  if (chassis.platformMass) {
    totalMass += chassis.platformMass
    momentY += chassis.platformMass * (forkHeight + .95)
    momentZ += chassis.platformMass * chassis.platformZ
  }

  const cg = { x: momentX / totalMass, y: momentY / totalMass, z: momentZ / totalMass }

  // --- Inertial displacement of the resultant -------------------------------
  // Centrifugal force acts outward from the turn; braking throws the CG forward.
  // Signed body-lateral inertial acceleration is v * yawRate. Yaw reverses
  // while backing, but signed ground speed reverses with it, so the product
  // keeps the force on the physically correct side of the truck. Using only
  // sign(yawRate) mirrored the critical edge in reverse.
  const signedLateralAccel = Number.isFinite(speed) && Number.isFinite(yawRate) ? speed * yawRate : 0
  const lateralAccel = Math.abs(signedLateralAccel)
  const lateralShift = Math.sign(signedLateralAccel) * (lateralAccel / G) * cg.y
  const longitudinalShift = (forwardAccel / G) * cg.y
  const resultant = { x: cg.x + lateralShift, z: cg.z + longitudinalShift }

  // --- Margin to the support polygon ----------------------------------------
  const margins = edgeMargins(polygon, resultant)
  const worst = margins.reduce((lowest, candidate) => (candidate.margin < lowest.margin ? candidate : lowest), margins[0])
  const lateral = margins.filter((entry) => entry.axis === 'lateral').reduce((lowest, candidate) => (candidate.margin < lowest.margin ? candidate : lowest), { margin: 1 })
  const longitudinal = margins.filter((entry) => entry.axis === 'longitudinal').reduce((lowest, candidate) => (candidate.margin < lowest.margin ? candidate : lowest), { margin: 1 })

  // --- Capacity ---------------------------------------------------------------
  const rated = ratedCapacityAt(chassis, loadCenter, forkHeight, reachExtension)
  const utilization = rated > 0 ? loadMass / rated : 0

  return {
    margin: Math.max(0, Math.min(1, worst.margin)),
    // Overwritten by solveStability with the normalized display value.
    percent: 0,
    tipping: worst.margin <= 0,
    criticalEdge: worst.edge,
    criticalAxis: worst.axis,
    lateralMargin: Math.max(0, Math.min(1, lateral.margin)),
    longitudinalMargin: Math.max(0, Math.min(1, longitudinal.margin)),
    lateralAccel,
    signedLateralAccel,
    centerOfGravity: cg,
    resultant,
    combinedMass: totalMass,
    ratedCapacity: rated,
    capacityUtilization: utilization,
    overloaded: utilization > 1,
  }
}

// Turn the solver output into the specific, true statement an evaluator wants
// in the event stream. Order matters: report the thing that will hurt first.
export function stabilityWarning(result, context = {}) {
  if (result.overloaded) {
    return {
      type: 'capacity',
      severity: 'critical',
      label: `Load exceeds rated capacity at this height and load center (${Math.round(result.capacityUtilization * 100)}% of rated)`,
      deduction: 20,
    }
  }
  if (result.tipping) {
    return {
      type: 'stability',
      severity: 'critical',
      label: result.criticalAxis === 'lateral'
        ? 'Lateral tipover: resultant left the stability triangle'
        : 'Longitudinal tipover: load moment exceeded the front axle',
      deduction: 25,
    }
  }
  if (result.margin < .18) {
    return {
      type: 'stability',
      severity: 'critical',
      label: `Approaching tipover across the ${result.criticalEdge} edge`,
      deduction: 18,
    }
  }
  if (result.margin < .35) {
    return {
      type: 'stability',
      severity: 'major',
      label: result.criticalAxis === 'lateral'
        ? 'Cornering speed is eroding lateral stability margin'
        : 'Load moment is eroding longitudinal stability margin',
      deduction: 10,
    }
  }
  if (context.reachExtended && context.forkHeight > 2.5 && result.margin < .5) {
    return {
      type: 'stability',
      severity: 'major',
      label: 'Pantograph extended with an elevated load outside the outriggers',
      deduction: 12,
    }
  }
  return null
}

export const STABILITY_UNITS = { G, IN }
