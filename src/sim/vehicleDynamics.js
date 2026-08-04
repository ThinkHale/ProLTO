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

export function steerLimits(profile) {
  const chassis = getChassis(profile)
  return {
    maxSteer: chassis.maxSteerDeg * DEG,
    steerRate: chassis.steerRateDegPerSec * DEG,
    wheelbase: wheelbase(chassis),
    fixedAxleZ: chassis.fixedAxleZ,
    steerAxleZ: chassis.steerAxleZ,
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

export function yawRate(speed, steerAngle, limits) {
  return -(speed / limits.wheelbase) * Math.tan(steerAngle)
}

// Integrate one step. Returns the new root pose plus the diagnostics the
// stability solver and the event rules need.
export function integrateSteering(pose, speed, steerAngle, limits, dt) {
  const heading = pose.heading || 0
  if (Math.abs(speed) < MIN_ROLLING_SPEED) {
    // Power steering still moves the wheel with the truck stopped, but a
    // stationary truck does not rotate. Returning early keeps a parked truck
    // from creeping when the operator saws at the wheel.
    return { x: pose.x, z: pose.z, heading, yawRate: 0, radius: turnRadius(steerAngle, limits) }
  }

  const cosine = Math.cos(heading)
  const sine = Math.sin(heading)
  // Fixed axle midpoint in world space (same local->world basis as loadPhysics).
  const fixedX = pose.x + sine * limits.fixedAxleZ
  const fixedZ = pose.z + cosine * limits.fixedAxleZ

  // A body-aligned axle cannot slip sideways, so its velocity is pure forward.
  const advancedX = fixedX - sine * speed * dt
  const advancedZ = fixedZ - cosine * speed * dt

  const rate = yawRate(speed, steerAngle, limits)
  const newHeading = Math.atan2(Math.sin(heading + rate * dt), Math.cos(heading + rate * dt))

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
    radius: turnRadius(steerAngle, limits),
  }
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
