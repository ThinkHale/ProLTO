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
  acceptedMotion,
  advanceDriveSpeed,
  advanceSteerAngle,
  fixedAxleSpeed,
  integrateSteering,
  PROVISIONAL_LONGITUDINAL_LIMITS,
  provisionalSteeringSpeedScale,
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

// Traction topology is explicit. A counterbalance truck drives through its
// fixed front axle; reach equipment drives through the steered traction unit.
// The former uses v*tan(delta)/L, the latter wheelSpeed*sin(delta)/L.
{
  const wheelSpeed = 2
  const reachLimits = steerLimits(reach)
  assert.equal(limits.tractionAxle, 'fixed', 'counterbalance traction must be on the fixed axle')
  assert.equal(reachLimits.tractionAxle, 'steered', 'reach traction must be on the steered axle')
  const moderateSteer = 35 * DEG
  near(fixedAxleSpeed(wheelSpeed, moderateSteer, limits), wheelSpeed, 1e-9, 'fixed-axle traction speed')
  near(
    yawRateAt(wheelSpeed, moderateSteer, limits),
    -wheelSpeed * Math.tan(moderateSteer) / limits.wheelbase,
    1e-9,
    'fixed-axle yaw rate',
  )
  near(
    fixedAxleSpeed(wheelSpeed, moderateSteer, reachLimits),
    wheelSpeed * Math.cos(moderateSteer),
    1e-9,
    'steered traction forward component',
  )
  near(
    yawRateAt(wheelSpeed, moderateSteer, reachLimits),
    -wheelSpeed * Math.sin(moderateSteer) / reachLimits.wheelbase,
    1e-9,
    'steered traction yaw rate',
  )

  // The provisional counterbalance controller curve retains the previous safe
  // full-lock envelope without pretending the front drive axle steers.
  const limitedSpeed = wheelSpeed * provisionalSteeringSpeedScale(limits.maxSteer, limits)
  const locked = integrateSteering({ x: 0, z: 0, heading: 0 }, limitedSpeed, limits.maxSteer, limits, 1 / 60)
  near(locked.forwardSpeed, limitedSpeed, 1e-9, 'fixed-axle speed must equal the limited drive command')
  near(
    Math.abs(locked.yawRate),
    wheelSpeed * Math.sin(limits.maxSteer) / limits.wheelbase,
    1e-9,
    'separate corner-speed control must preserve the bounded steady-state yaw envelope',
  )

  // Steered traction stays bounded by wheel-path speed all the way to full lock.
  let worst = 0
  for (let degrees = 0; degrees <= reachLimits.maxSteer / DEG; degrees += 1) {
    const rate = Math.abs(yawRateAt(wheelSpeed, degrees * DEG, reachLimits))
    worst = Math.max(worst, rate)
  }
  const ceiling = wheelSpeed / reachLimits.wheelbase
  assert.ok(worst <= ceiling + 1e-9, `yaw rate ${worst.toFixed(2)} rad/s exceeded the wheel-speed ceiling ${ceiling.toFixed(2)}`)

  // A crawl must stay a crawl no matter how hard the wheel is turned.
  const crawl = integrateSteering({ x: 0, z: 0, heading: 0 }, .25, reachLimits.maxSteer, reachLimits, 1 / 60)
  assert.ok(Math.abs(crawl.yawRate) * 180 / Math.PI < 15, `creeping at full lock yaws ${(Math.abs(crawl.yawRate) * 180 / Math.PI).toFixed(1)} deg/s`)
}

// Pallet trucks steer at the power unit, not the load end, so their fixed axle
// is FORWARD of the steered axle -- the opposite topology to a counterbalance.
{
  const pallet = steerLimits({ manufacturer: 'Crown', family: 'pallet' })
  assert.ok(pallet.fixedAxleZ < pallet.steerAxleZ, 'pallet truck load wheels must sit forward of the steered wheel')
  assert.ok(limits.fixedAxleZ < limits.steerAxleZ, 'counterbalance drive axle must sit forward of the steered axle')
}

// Exact arc integration must produce the same pose at desktop and headset frame
// rates. This is a direct regression for the old-heading Euler chord error.
{
  const delta = 48 * DEG
  const driveSpeed = 1.35
  const run = (hz) => {
    let pose = { x: 0, z: 0, heading: 0 }
    for (let frame = 0; frame < hz; frame += 1) pose = integrateSteering(pose, driveSpeed, delta, limits, 1 / hz)
    return pose
  }
  const reference = run(240)
  for (const hz of [25, 60, 72, 90, 120]) {
    const pose = run(hz)
    near(pose.x, reference.x, 1e-9, `${hz} Hz x must match analytic reference`)
    near(pose.z, reference.z, 1e-9, `${hz} Hz z must match analytic reference`)
    near(pose.heading, reference.heading, 1e-9, `${hz} Hz heading must match analytic reference`)
  }

  const fixedStepRun = (displayHz) => {
    let pose = { x: 0, z: 0, heading: 0 }
    let accumulator = 0
    let simulationSteps = 0
    for (let frame = 0; frame < displayHz; frame += 1) {
      accumulator += 1 / displayHz
      while (accumulator + 1e-10 >= 1 / 90) {
        pose = integrateSteering(pose, driveSpeed, delta, limits, 1 / 90)
        accumulator = Math.max(0, accumulator - 1 / 90)
        simulationSteps += 1
      }
    }
    assert.equal(simulationSteps, 90, `${displayHz} Hz must consume exactly 90 fixed simulation steps per second`)
    return pose
  }
  const fixedReference = fixedStepRun(90)
  for (const hz of [25, 60, 72, 120, 240]) {
    const pose = fixedStepRun(hz)
    near(pose.x, fixedReference.x, 1e-12, `${hz} Hz fixed-step x`)
    near(pose.z, fixedReference.z, 1e-12, `${hz} Hz fixed-step z`)
    near(pose.heading, fixedReference.heading, 1e-12, `${hz} Hz fixed-step heading`)
  }

  const proposed = integrateSteering({ x: 0, z: 0, heading: 0 }, driveSpeed, delta, limits, 1 / 90)
  const accepted = acceptedMotion({ x: 0, z: 0, heading: 0 }, proposed, limits, 1 / 90)
  near(accepted.forwardSpeed, proposed.forwardSpeed, 1e-5, 'accepted-pose forward speed')
  near(accepted.yawRate, proposed.yawRate, 1e-9, 'accepted-pose yaw rate')
}

// Longitudinal response is bounded in m/s^2 and invariant to render cadence.
{
  const dynamics = PROVISIONAL_LONGITUDINAL_LIMITS.counterbalance
  const target = 4
  const accelerate = (hz) => {
    let speed = 0
    for (let frame = 0; frame < hz; frame += 1) speed = advanceDriveSpeed(speed, target, dynamics, 1 / hz, 0, true)
    return speed
  }
  for (const hz of [25, 60, 72, 90, 120, 240]) {
    near(accelerate(hz), dynamics.accelMps2, 1e-9, `${hz} Hz bounded acceleration`)
  }

  let speed = 4
  let pose = { x: 0, z: 0, heading: 0 }
  let steps = 0
  while (speed > 0 && steps < 1000) {
    speed = advanceDriveSpeed(speed, 0, dynamics, 1 / 90, 1, true)
    pose = integrateSteering(pose, speed, 0, limits, 1 / 90)
    steps += 1
  }
  near(steps / 90, 4 / dynamics.serviceBrakeMps2, 1 / 90, 'service-brake stopping time')
  near(-pose.z, 4 * 4 / (2 * dynamics.serviceBrakeMps2), .03, 'service-brake stopping distance')

  const reversal = advanceDriveSpeed(1, -2, dynamics, .1, 0, true)
  assert.ok(reversal >= 0, 'a direction reversal must brake to zero before applying opposite traction')
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

// Reversing flips yaw and signed ground speed together, so the inertial force
// remains on the same truck-local side for the same steering angle.
{
  const forward = solveStability(counterbalance, {
    ...restingInput, loadMass: 1200, forkHeight: 4, sideshift: -.15,
    speed: 1.5, yawRate: -.4,
  })
  const reverse = solveStability(counterbalance, {
    ...restingInput, loadMass: 1200, forkHeight: 4, sideshift: -.15,
    speed: -1.5, yawRate: .4,
  })
  assert.ok(forward.signedLateralAccel < 0 && reverse.signedLateralAccel < 0, 'forward and reverse must keep the outward force on the same side')
  near(forward.resultant.x, reverse.resultant.x, 1e-9, 'reverse turn resultant side')
  near(forward.lateralMargin, reverse.lateralMargin, 1e-9, 'reverse turn lateral margin')
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
