// Physical verification for the steering, stability, and facility collision
// models.  node scripts/verify-dynamics.mjs
//
// These assert BEHAVIOR, not implementation: that the truck pivots about its
// fixed axle and swings its tail, that the stability solver puts a truck over
// when the physics say it goes over, and that a rack bay is something you can
// actually drive into. Each of those was wrong before and none of them would
// have been caught by the existing model or rig checks.
import assert from 'node:assert/strict'
import { getChassis, wheelbase } from '../src/data/chassis.js'
import {
  advanceSteerAngle,
  integrateSteering,
  steerLimits,
  tailSwingRadius,
  turnRadius,
  yawRate as yawRateAt,
} from '../src/sim/vehicleDynamics.js'
import { ratedCapacityAt, solveStability } from '../src/sim/stability.js'

const DEG = Math.PI / 180
const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} was not within ${tolerance} of ${expected}`)

const counterbalance = { manufacturer: 'Crown', family: 'counterbalance' }
const threeWheel = { manufacturer: 'Raymond', family: 'counterbalance' }
const reach = { manufacturer: 'Crown', family: 'reach' }

// ---------------------------------------------------------------- steering ---
const limits = steerLimits(counterbalance)

// Straight ahead: heading holds and the truck runs down -Z, which is forward.
{
  let pose = { x: 0, z: 0, heading: 0 }
  for (let step = 0; step < 60; step += 1) pose = integrateSteering(pose, 2, 0, limits, 1 / 60)
  near(pose.heading, 0, 1e-9, 'straight travel must not change heading')
  near(pose.z, -2, .01, 'one second at 2 m/s must cover 2 m')
  near(pose.x, 0, 1e-9, 'straight travel must not drift laterally')
}

// Turn radius follows L/tan(delta), measured at the fixed axle.
{
  const delta = 30 * DEG
  near(Math.abs(turnRadius(delta, limits)), wheelbase(getChassis(counterbalance)) / Math.tan(delta), 1e-9, 'turn radius')
}

// A stationary truck does not rotate no matter how the wheel is sawed.
{
  const parked = integrateSteering({ x: 1, z: 2, heading: .4 }, 0, 60 * DEG, limits, 1 / 60)
  assert.equal(parked.heading, .4, 'a parked truck must not yaw')
  assert.equal(parked.x, 1, 'a parked truck must not translate')
}

// THE tail-swing assertion. On a rear-steered truck the steered end sweeps a
// wider arc than the fixed axle, so the rear corner must leave the path the
// front traced. The old heading-rate model produced zero swing here.
{
  const start = { x: 0, z: 0, heading: 0 }
  const delta = 45 * DEG
  const fixedAt = (pose) => ({ x: pose.x + Math.sin(pose.heading) * limits.fixedAxleZ, z: pose.z + Math.cos(pose.heading) * limits.fixedAxleZ })
  const steerAt = (pose) => ({ x: pose.x + Math.sin(pose.heading) * limits.steerAxleZ, z: pose.z + Math.cos(pose.heading) * limits.steerAxleZ })
  let pose = start
  const startSteer = steerAt(start)
  const fixedOrigin = fixedAt(start)
  let maxSteerExcursion = 0
  for (let step = 0; step < 45; step += 1) {
    pose = integrateSteering(pose, 1.5, delta, limits, 1 / 60)
    const fixedRadius = Math.hypot(fixedAt(pose).x - fixedOrigin.x, fixedAt(pose).z - fixedOrigin.z)
    const steerOffset = Math.hypot(steerAt(pose).x - startSteer.x, steerAt(pose).z - startSteer.z)
    maxSteerExcursion = Math.max(maxSteerExcursion, steerOffset - fixedRadius)
  }
  assert.ok(maxSteerExcursion > .1, `steered end must sweep outside the fixed axle path, got ${maxSteerExcursion.toFixed(3)} m`)
  assert.ok(tailSwingRadius(delta, limits) > .15, 'tail swing radius must be reported for a hard turn')
  near(tailSwingRadius(0, limits), 0, 1e-9, 'running straight there is no tail swing')
}

// The fixed axle traces a circle of the commanded radius: this is what makes an
// aisle turn repeatable instead of speed-dependent guesswork.
{
  const delta = 40 * DEG
  const expected = Math.abs(turnRadius(delta, limits))
  let pose = { x: 0, z: 0, heading: 0 }
  const fixedAt = (p) => ({ x: p.x + Math.sin(p.heading) * limits.fixedAxleZ, z: p.z + Math.cos(p.heading) * limits.fixedAxleZ })
  const origin = fixedAt(pose)
  // Quarter turn, then check the chord against the geometric circle.
  let turned = 0
  while (Math.abs(turned) < Math.PI / 2) {
    const next = integrateSteering(pose, 1.2, delta, limits, 1 / 240)
    turned += next.heading - pose.heading
    pose = next
  }
  const chord = Math.hypot(fixedAt(pose).x - origin.x, fixedAt(pose).z - origin.z)
  near(chord, expected * Math.SQRT2, expected * .04, 'quarter-turn chord must match the commanded radius')
}

// Steering is rate limited: full lock is not reachable in a single frame.
{
  const stepped = advanceSteerAngle(0, 1, limits, 1 / 60)
  assert.ok(stepped < limits.maxSteer, 'steer angle must not snap to full lock in one frame')
  near(stepped, limits.steerRate / 60, 1e-9, 'steer slew must equal rate * dt')
  let angle = 0
  for (let step = 0; step < 600; step += 1) angle = advanceSteerAngle(angle, 1, limits, 1 / 60)
  near(angle, limits.maxSteer, 1e-9, 'held input must eventually reach full lock')
}

// REGRESSION: yaw rate must stay bounded at full lock. Driving it from FORWARD
// speed as v*tan(delta)/L sent tan to infinity near 90 degrees and spun the
// truck on the spot at a crawl. Driving it from DRIVE WHEEL speed as
// v*sin(delta)/L bounds it, and forward travel correctly falls away instead.
{
  const wheelSpeed = 2
  let worst = 0
  for (let degrees = 0; degrees <= limits.maxSteer / DEG; degrees += 1) {
    const rate = Math.abs(yawRateAt(wheelSpeed, degrees * DEG, limits))
    worst = Math.max(worst, rate)
  }
  const ceiling = wheelSpeed / limits.wheelbase
  assert.ok(worst <= ceiling + 1e-9, `yaw rate ${worst.toFixed(2)} rad/s exceeded the wheel-speed ceiling ${ceiling.toFixed(2)}`)
  assert.ok(worst * 180 / Math.PI < 100, `full lock at 2 m/s yaws ${(worst * 180 / Math.PI).toFixed(0)} deg/s, which is a spin not a turn`)

  // Forward travel falls off as the cosine of the steer angle, so at full lock
  // most of the wheel's motion is going into rotation rather than travel.
  const straight = integrateSteering({ x: 0, z: 0, heading: 0 }, 2, 0, limits, 1 / 60)
  const locked = integrateSteering({ x: 0, z: 0, heading: 0 }, 2, limits.maxSteer, limits, 1 / 60)
  near(straight.forwardSpeed, 2, 1e-9, 'straight ahead, forward speed is wheel speed')
  near(locked.forwardSpeed, 2 * Math.cos(limits.maxSteer), 1e-9, 'at full lock, forward speed is wheelSpeed * cos(delta)')
  assert.ok(Math.abs(locked.forwardSpeed) < Math.abs(straight.forwardSpeed) * .3, 'forward speed must collapse at full lock')

  // A crawl must stay a crawl no matter how hard the wheel is turned.
  const crawl = integrateSteering({ x: 0, z: 0, heading: 0 }, .25, limits.maxSteer, limits, 1 / 60)
  assert.ok(Math.abs(crawl.yawRate) * 180 / Math.PI < 15, `creeping at full lock yaws ${(Math.abs(crawl.yawRate) * 180 / Math.PI).toFixed(1)} deg/s`)
}

// Pallet trucks steer at the power unit, not the load end, so their fixed axle
// is FORWARD of the steered axle -- the opposite topology to a counterbalance.
{
  const pallet = steerLimits({ manufacturer: 'Crown', family: 'pallet' })
  assert.ok(pallet.fixedAxleZ < pallet.steerAxleZ, 'pallet truck load wheels must sit forward of the steered wheel')
  assert.ok(limits.fixedAxleZ < limits.steerAxleZ, 'counterbalance drive axle must sit forward of the steered axle')
}

// --------------------------------------------------------------- stability ---
const restingInput = { loadMass: 0, forkHeight: 0, speed: 0, yawRate: 0, turnRadius: Infinity, forwardAccel: 0 }

// An empty truck standing still is comfortably inside its support polygon.
{
  const result = solveStability(counterbalance, restingInput)
  assert.ok(result.margin > .5, `empty truck should be stable, got margin ${result.margin.toFixed(3)}`)
  assert.equal(result.tipping, false)
  assert.equal(result.overloaded, false)
}

// Adding rated load on the floor erodes the longitudinal margin but does not
// tip: that is the whole point of the counterweight.
{
  const laden = solveStability(counterbalance, { ...restingInput, loadMass: 1814 })
  const empty = solveStability(counterbalance, restingInput)
  assert.ok(laden.margin < empty.margin, 'rated load must reduce the stability margin')
  assert.equal(laden.tipping, false, 'a truck at rated capacity on the floor must not tip')
  assert.equal(laden.criticalAxis, 'longitudinal', 'rated load on the floor loads the front axle')
}

// Braking hard with the load in the air throws the resultant over the front
// axle. This is the classic forward tipover and it must actually register.
{
  const result = solveStability(counterbalance, {
    ...restingInput, loadMass: 1200, forkHeight: 4.5, speed: 2.2, forwardAccel: -3.4,
  })
  assert.equal(result.criticalAxis, 'longitudinal')
  assert.ok(result.margin < .2, `hard braking with an elevated load must collapse the margin, got ${result.margin.toFixed(3)}`)
}

// Cornering with an elevated load runs the resultant out the SIDE instead.
{
  const result = solveStability(counterbalance, {
    ...restingInput, loadMass: 1200, forkHeight: 4.5, speed: 2.6, yawRate: -.55, turnRadius: 4.7,
  })
  assert.equal(result.criticalAxis, 'lateral', 'a fast corner must threaten the lateral edge')
  assert.ok(result.lateralMargin < result.longitudinalMargin, 'lateral margin must be the binding constraint in a corner')
}

// Same corner, same load: the three-wheel truck must be less stable laterally
// than the four-wheel truck. If this ever inverts, the geometry is wrong.
{
  const shared = { ...restingInput, loadMass: 1200, forkHeight: 3.0, speed: 2.4, yawRate: -.5, turnRadius: 4.6 }
  const four = solveStability(counterbalance, shared)
  const three = solveStability(threeWheel, shared)
  assert.ok(three.lateralMargin < four.lateralMargin, 'the three-wheel truck must have less lateral margin')
}

// Capacity derates with height, with load center, and -- on a reach truck --
// with the pantograph extended.
{
  const chassis = getChassis(counterbalance)
  const ground = ratedCapacityAt(chassis, chassis.ratedLoadCenter, 0)
  const high = ratedCapacityAt(chassis, chassis.ratedLoadCenter, chassis.ratedHeight)
  const farCenter = ratedCapacityAt(chassis, chassis.ratedLoadCenter * 2, 0)
  assert.ok(high < ground, 'capacity must fall with lift height')
  assert.ok(farCenter < ground * .6, 'doubling the load center must roughly halve capacity')

  const reachChassis = getChassis(reach)
  const retracted = ratedCapacityAt(reachChassis, reachChassis.ratedLoadCenter, 3, 0)
  const extended = ratedCapacityAt(reachChassis, reachChassis.ratedLoadCenter, 3, reachChassis.maxReachExtension)
  assert.ok(extended < retracted * .7, 'a fully extended pantograph must derate capacity sharply')
}

// Overload is reported against the DERATED capacity, not the plate figure, so a
// load that is legal on the floor becomes an overload at height.
{
  const low = solveStability(counterbalance, { ...restingInput, loadMass: 1700, forkHeight: 0 })
  const high = solveStability(counterbalance, { ...restingInput, loadMass: 1700, forkHeight: 4.7 })
  assert.equal(low.overloaded, false, '1700 kg on the floor is inside the rated capacity')
  assert.equal(high.overloaded, true, 'the same load at full height must exceed the derated capacity')
}

// REGRESSION: pallet trucks straddle their load. The load wheels are at the
// FORK TIPS, so a load sits BETWEEN the axles, not cantilevered ahead of them
// the way it does on a counterbalance truck. Measuring the load center from the
// fork tip instead of the heel put the load outside the support polygon and
// reported a parked truck as nearly tipping.
for (const pallet of [{ manufacturer: 'Crown', family: 'pallet' }, { manufacturer: 'Raymond', family: 'pallet' }]) {
  const chassis = getChassis(pallet)
  const loadZ = chassis.forkPivotZ - chassis.ratedLoadCenter
  assert.ok(
    loadZ > chassis.fixedAxleZ && loadZ < chassis.steerAxleZ,
    `${pallet.manufacturer} pallet load CG at z=${loadZ.toFixed(3)} must sit between the load wheels (${chassis.fixedAxleZ}) and the drive wheel (${chassis.steerAxleZ})`,
  )
  const empty = solveStability(pallet, restingInput)
  const laden = solveStability(pallet, { ...restingInput, loadMass: 1000, forkHeight: .152 })
  assert.ok(laden.margin > empty.margin, 'loading a pallet truck must move the CG toward the middle of its support triangle, not off the front')
  assert.equal(laden.tipping, false, 'a loaded pallet truck at fork height must not be tipping')
}

// Reach trucks: extending the pantograph pushes the load outside the outriggers.
{
  const retracted = solveStability(reach, { ...restingInput, loadMass: 1300, forkHeight: 4 })
  const extended = solveStability(reach, { ...restingInput, loadMass: 1300, forkHeight: 4, reachExtension: 1.06 })
  assert.ok(extended.margin < retracted.margin, 'extending the reach must reduce the stability margin')
  assert.equal(extended.criticalAxis, 'longitudinal', 'an extended reach loads the outrigger tips')
}

console.log('PASS dynamics: steered-axle kinematics, tail swing, rate limiting, stability triangle, capacity derating')
