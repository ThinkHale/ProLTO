import * as THREE from 'three'
import { getChassis, wheelbase } from '../data/chassis.js'

// Steered-axle kinematics for powered industrial trucks.
//
// The previous model advanced a heading rate directly:
//     heading -= steer * turnRate * steerRatio * sign(speed) * dt
// which turns the truck as if it pivoted about its own origin. Real lift trucks
// do not do that. One axle is FIXED and body-aligned, the other STEERS, so the
// truck rotates about a point on the fixed axle line and the steered end sweeps
// a wide arc outside the turn. On a counterbalance truck that is the rear
// counterweight; on a reach truck the power unit; on an end-control pallet truck
// the operator's own platform. Tail swing is the handling trait operators most
// often underestimate, and modeling it is what makes rack-post strikes and
// pedestrian strikes happen for the right reason.
//
// The model below is the standard kinematic bicycle, re-referenced to the fixed
// axle instead of the vehicle center:
//
//     yaw rate  psi_dot = v * tan(delta) / L
//     the fixed axle midpoint travels along the body's forward axis
//     the rest of the truck follows from the new heading
//
// Sign convention matches the rest of the simulator: forward is (-sin h, -cos h)
// and a positive steer input curves the TRAVEL PATH to the operator's right, so
// heading decreases. The tail swinging the other way falls out of the geometry
// rather than being scripted.

const DEG = Math.PI / 180
const MIN_ROLLING_SPEED = .02

// Conservative training defaults in SI units. Public manuals do not publish
// the complete loaded acceleration and stopping curves for every configured
// serial range, so these values remain explicitly provisional until measured.
export const PROVISIONAL_LONGITUDINAL_LIMITS = Object.freeze({
  reach: Object.freeze({ accelMps2: 2, coastDecelMps2: 1.15, serviceBrakeMps2: 3.6 }),
  'order-picker': Object.freeze({ accelMps2: 1.8, coastDecelMps2: 1.05, serviceBrakeMps2: 3.4 }),
  pallet: Object.freeze({ accelMps2: 2.2, coastDecelMps2: 1.25, serviceBrakeMps2: 3.8 }),
  counterbalance: Object.freeze({ accelMps2: 2, coastDecelMps2: 1.1, serviceBrakeMps2: 3.6 }),
})

export function steerLimits(profile) {
  const chassis = getChassis(profile)
  return {
    maxSteer: chassis.maxSteerDeg * DEG,
    steerRate: chassis.steerRateDegPerSec * DEG,
    wheelbase: wheelbase(chassis),
    fixedAxleZ: chassis.fixedAxleZ,
    steerAxleZ: chassis.steerAxleZ,
    tractionAxle: chassis.tractionAxle || 'steered',
  }
}

// Hydraulic and electric power steering has a finite slew rate. Snapping the
// wheel to full lock in one frame is both unrealistic and lets a trainee corner
// in ways the real truck physically cannot.
export function advanceSteerAngle(currentAngle, input, limits, dt) {
  const target = THREE.MathUtils.clamp(input, -1, 1) * limits.maxSteer
  const maxDelta = limits.steerRate * dt
  const delta = THREE.MathUtils.clamp(target - currentAngle, -maxDelta, maxDelta)
  return currentAngle + delta
}

// Signed turn radius measured at the fixed axle. Infinite when running straight.
export function turnRadius(steerAngle, limits) {
  const tangent = Math.tan(steerAngle)
  if (Math.abs(tangent) < 1e-6) return Infinity
  return limits.wheelbase / tangent
}

// Speed at the fixed axle, which is also the truck's body-forward ground speed.
// A steered traction wheel contributes only its body-aligned component. A
// counterbalance truck drives through its fixed front axle, so no cosine belongs
// in the kinematics for that topology.
export function fixedAxleSpeed(driveSpeed, steerAngle, limits) {
  return limits.tractionAxle === 'fixed' ? driveSpeed : driveSpeed * Math.cos(steerAngle)
}

// Yaw follows the same bicycle geometry for both traction layouts, referenced
// to whichever speed the motor actually controls.
export function yawRate(driveSpeed, steerAngle, limits) {
  if (limits.tractionAxle === 'fixed') {
    return -(driveSpeed / limits.wheelbase) * Math.tan(steerAngle)
  }
  return -(driveSpeed / limits.wheelbase) * Math.sin(steerAngle)
}

// Counterbalance controllers reduce travel command during hard steering. The
// exact curve is serial- and option-specific; cosine preserves the previous
// safe steady-state envelope while keeping it separate from axle geometry. It
// must be replaced with measured controller data before replica certification.
export function provisionalSteeringSpeedScale(steerAngle, limits) {
  return limits.tractionAxle === 'fixed' ? Math.max(1e-3, Math.abs(Math.cos(steerAngle))) : 1
}

// Integrate one step. Returns the new root pose plus the diagnostics the
// stability solver and the event rules need.
//
// `speed` is traction speed. On a steered traction unit it is wheel-path speed;
// on a counterbalance truck it is fixed-axle ground speed. Both reduce to the
// same turn radius, but keeping the reference explicit prevents drivetrain
// geometry from being silently changed by a controller tuning value.
export function integrateSteering(pose, speed, steerAngle, limits, dt) {
  const heading = pose.heading || 0
  if (Math.abs(speed) < MIN_ROLLING_SPEED) {
    // Power steering still moves the wheel with the truck stopped, but a
    // stationary truck does not rotate. Returning early keeps a parked truck
    // from creeping when the operator saws at the wheel.
    return {
      x: pose.x, z: pose.z, heading, yawRate: 0, forwardSpeed: 0, radius: turnRadius(steerAngle, limits),
    }
  }

  const forwardSpeed = fixedAxleSpeed(speed, steerAngle, limits)
  const cosine = Math.cos(heading)
  const sine = Math.sin(heading)
  // Fixed axle midpoint in world space (same local->world basis as loadPhysics).
  const fixedX = pose.x + sine * limits.fixedAxleZ
  const fixedZ = pose.z + cosine * limits.fixedAxleZ

  const rate = yawRate(speed, steerAngle, limits)
  const rawHeading = heading + rate * dt
  const newHeading = Math.atan2(Math.sin(rawHeading), Math.cos(rawHeading))

  // Integrate the fixed axle along the exact circular arc. Advancing along the
  // old heading and rotating afterward introduced a frame-rate-dependent chord
  // error that made 72 Hz VR and 60 Hz desktop follow different paths.
  let advancedX
  let advancedZ
  if (Math.abs(rate) < 1e-8) {
    advancedX = fixedX - sine * forwardSpeed * dt
    advancedZ = fixedZ - cosine * forwardSpeed * dt
  } else {
    advancedX = fixedX + (forwardSpeed / rate) * (Math.cos(rawHeading) - cosine)
    advancedZ = fixedZ - (forwardSpeed / rate) * (Math.sin(rawHeading) - sine)
  }

  // Rebuild the root from the advanced fixed axle and the new heading. Every
  // point aft of the fixed axle now sits somewhere it was not, which IS the
  // tail swing.
  const newCosine = Math.cos(newHeading)
  const newSine = Math.sin(newHeading)
  return {
    x: advancedX - newSine * limits.fixedAxleZ,
    z: advancedZ - newCosine * limits.fixedAxleZ,
    heading: newHeading,
    yawRate: rate,
    forwardSpeed,
    radius: turnRadius(steerAngle, limits),
  }
}

// Unit-correct bounded longitudinal response. The caller supplies explicit
// m/s^2 limits instead of an exponential damping lambda whose effective force
// changed with target speed. Direction reversals brake to zero before applying
// traction in the opposite direction.
export function advanceDriveSpeed(currentSpeed, targetSpeed, limits, dt, brakeInput = 0, travelCommanded = true) {
  if (!(dt > 0)) return currentSpeed
  const brake = THREE.MathUtils.clamp(brakeInput, 0, 1)
  const coast = Math.max(0, limits.coastDecelMps2 || 0)
  const service = Math.max(coast, limits.serviceBrakeMps2 || coast)
  const acceleration = Math.max(0, limits.accelMps2 || 0)
  const moveToward = (target, rate) => currentSpeed + THREE.MathUtils.clamp(target - currentSpeed, -rate * dt, rate * dt)

  if (brake > 0) return moveToward(0, THREE.MathUtils.lerp(coast, service, brake))
  if (!travelCommanded || Math.abs(targetSpeed) < 1e-6) return moveToward(0, coast)
  if (currentSpeed * targetSpeed < 0) return moveToward(0, service)
  if (Math.abs(targetSpeed) < Math.abs(currentSpeed)) return moveToward(targetSpeed, coast)
  return moveToward(targetSpeed, acceleration)
}

// Diagnostics reconstructed from the pose the collision sweep actually
// accepted. This prevents telemetry and stability from reporting the rejected
// full-speed proposal after a partial sweep or hard stop.
export function acceptedMotion(from, to, limits, dt) {
  if (!(dt > 0)) return { forwardSpeed: 0, yawRate: 0, radius: Infinity }
  const fromHeading = from.heading || 0
  const toHeading = to.heading || 0
  const headingDelta = Math.atan2(Math.sin(toHeading - fromHeading), Math.cos(toHeading - fromHeading))
  const fromFixedX = from.x + Math.sin(fromHeading) * limits.fixedAxleZ
  const fromFixedZ = from.z + Math.cos(fromHeading) * limits.fixedAxleZ
  const toFixedX = to.x + Math.sin(toHeading) * limits.fixedAxleZ
  const toFixedZ = to.z + Math.cos(toHeading) * limits.fixedAxleZ
  const middleHeading = fromHeading + headingDelta * .5
  const dx = toFixedX - fromFixedX
  const dz = toFixedZ - fromFixedZ
  const forwardSpeed = (-Math.sin(middleHeading) * dx - Math.cos(middleHeading) * dz) / dt
  const acceptedYawRate = headingDelta / dt
  const radius = Math.abs(acceptedYawRate) > 1e-7 ? -forwardSpeed / acceptedYawRate : Infinity
  return { forwardSpeed, yawRate: acceptedYawRate, radius }
}

// How far the steered end sweeps outside the path of the fixed axle. This is
// the number an operator needs internalized before backing out of an aisle, and
// it drives the tail-swing clearance warning.
export function tailSwingRadius(steerAngle, limits) {
  const overhang = Math.abs(limits.steerAxleZ - limits.fixedAxleZ)
  const tangent = Math.abs(Math.tan(steerAngle))
  if (tangent < 1e-6) return 0
  const radius = limits.wheelbase / tangent
  return Math.hypot(radius, overhang) - radius
}
