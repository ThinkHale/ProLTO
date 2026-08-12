import * as THREE from 'three'

const AXES = Object.freeze([
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
])
const TAU = Math.PI * 2
const MIN_WHEEL_RADIUS = .015
const MAX_WHEEL_RADIUS = 1
const MIN_WIDTH_SEPARATION = 1.08
const MAX_RADIAL_DIAMETER_ERROR = .08
const MIN_ROLL_ALIGNMENT = .9

export class WheelArticulationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'WheelArticulationError'
  }
}

function finiteVector(vector) {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}

function vehicleAxisInParent(root, parent, axis) {
  const rootWorld = root.getWorldQuaternion(new THREE.Quaternion())
  const parentWorldInverse = parent.getWorldQuaternion(new THREE.Quaternion()).invert()
  return axis.clone().applyQuaternion(rootWorld).applyQuaternion(parentWorldInverse).normalize()
}

function wheelCenterInRoot(root, wheel) {
  const rootInverse = root.matrixWorld.clone().invert()
  const center = wheel.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse)
  if (!finiteVector(center) || Math.max(Math.abs(center.x), Math.abs(center.y), Math.abs(center.z)) > 10) {
    throw new WheelArticulationError(`${wheel.name} has an invalid center in the rig-root frame`)
  }
  return center
}

function validPose(pose) {
  return pose
    && Number.isFinite(pose.x)
    && Number.isFinite(pose.z)
    && Number.isFinite(pose.heading)
}

function rootPointAtPose(localPoint, pose, target) {
  const cosine = Math.cos(pose.heading)
  const sine = Math.sin(pose.heading)
  return target.set(
    pose.x + localPoint.x * cosine + localPoint.z * sine,
    localPoint.y,
    pose.z - localPoint.x * sine + localPoint.z * cosine,
  )
}

function wheelTravelFromPoses(state, fromPose, toPose) {
  rootPointAtPose(state.rootCenter, fromPose, state.fromWorld)
  rootPointAtPose(state.rootCenter, toPose, state.toWorld)
  state.displacement.subVectors(state.toWorld, state.fromWorld)
  const headingDelta = Math.atan2(
    Math.sin(toPose.heading - fromPose.heading),
    Math.cos(toPose.heading - fromPose.heading),
  )
  const rollingHeading = fromPose.heading + headingDelta * .5 + state.steeringAngle
  const rollingX = -Math.sin(rollingHeading)
  const rollingZ = -Math.cos(rollingHeading)
  return state.displacement.x * rollingX + state.displacement.z * rollingZ
}

function matrixAxisScales(matrix) {
  const elements = matrix.elements
  return [
    Math.hypot(elements[0], elements[1], elements[2]),
    Math.hypot(elements[4], elements[5], elements[6]),
    Math.hypot(elements[8], elements[9], elements[10]),
  ]
}

function measureWheel(wheel) {
  if (!wheel?.isMesh || !wheel.geometry) {
    throw new WheelArticulationError(`${wheel?.name || 'unnamed wheel'} must be a mesh with geometry`)
  }
  if (!wheel.geometry.boundingBox) wheel.geometry.computeBoundingBox()
  const bounds = wheel.geometry.boundingBox
  if (!bounds || bounds.isEmpty()) {
    throw new WheelArticulationError(`${wheel.name} has no measurable geometry bounds`)
  }

  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  if (!finiteVector(center) || !finiteVector(size)) {
    throw new WheelArticulationError(`${wheel.name} has non-finite geometry bounds`)
  }
  const localSizes = [size.x, size.y, size.z]
  const orderedAxes = [0, 1, 2].sort((left, right) => localSizes[left] - localSizes[right])
  const [axleIndex, radialIndexA, radialIndexB] = orderedAxes
  if (localSizes[axleIndex] <= 0 || localSizes[radialIndexA] / localSizes[axleIndex] < MIN_WIDTH_SEPARATION) {
    throw new WheelArticulationError(
      `${wheel.name} has ambiguous axle geometry (${localSizes.map((value) => value.toFixed(4)).join(' x ')} m)`,
    )
  }

  wheel.updateWorldMatrix(true, false)
  const axisScales = matrixAxisScales(wheel.matrixWorld)
  const radialDiameters = [
    localSizes[radialIndexA] * axisScales[radialIndexA],
    localSizes[radialIndexB] * axisScales[radialIndexB],
  ]
  const radialError = Math.abs(radialDiameters[0] - radialDiameters[1]) / Math.max(...radialDiameters)
  if (radialError > MAX_RADIAL_DIAMETER_ERROR) {
    throw new WheelArticulationError(
      `${wheel.name} is not circular enough to infer a rolling radius (${radialDiameters.map((value) => value.toFixed(4)).join(' x ')} m)`,
    )
  }
  const radius = (radialDiameters[0] + radialDiameters[1]) / 4
  if (!Number.isFinite(radius) || radius < MIN_WHEEL_RADIUS || radius > MAX_WHEEL_RADIUS) {
    throw new WheelArticulationError(`${wheel.name} inferred radius ${radius} m is outside the supported range`)
  }

  const centerTolerance = Math.max(radius * .001, 1e-5)
  if (center.length() > centerTolerance) {
    throw new WheelArticulationError(
      `${wheel.name} geometry is ${center.length().toFixed(5)} m off its rotation pivot`,
    )
  }

  return {
    radius,
    axleIndex,
    localAxle: AXES[axleIndex].clone(),
    localSizes,
  }
}

function wheelRoles(rig) {
  if (rig.family === 'counterbalance') {
    if (!rig.frontWheels?.length || !rig.rearWheels?.length) {
      throw new WheelArticulationError('counterbalance rig requires front drive wheels and rear steer wheels')
    }
    return [
      ...rig.frontWheels.map((wheel) => ({ wheel, role: 'front-drive', driven: true, steered: false })),
      ...rig.rearWheels.map((wheel) => ({ wheel, role: 'rear-steer', driven: false, steered: true })),
    ]
  }
  if (!rig.driveWheel || !rig.loadWheels?.length) {
    throw new WheelArticulationError(`${rig.family || 'unknown'} rig requires one drive-steer wheel and load wheels`)
  }
  return [
    { wheel: rig.driveWheel, role: 'drive-steer', driven: true, steered: true },
    ...rig.loadWheels.map((wheel) => ({ wheel, role: 'load', driven: false, steered: false })),
  ]
}

function wrapAngle(angle) {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, TAU) - Math.PI
}

function publicBinding(state) {
  const binding = {
    wheel: state.wheel,
    name: state.wheel.name,
    role: state.role,
    driven: state.driven,
    steered: state.steered,
    radius: state.radius,
    axleAxis: ['x', 'y', 'z'][state.axleIndex],
    localAxle: Object.freeze(state.localAxle.toArray()),
    parentAxle: Object.freeze(state.parentAxle.toArray()),
    steeringAxis: Object.freeze(state.steeringAxis.toArray()),
    rootCenter: Object.freeze(state.rootCenter.toArray()),
    spinSign: state.spinSign,
  }
  Object.defineProperties(binding, {
    spinAngle: { enumerable: true, get: () => state.spinAngle },
    steeringAngle: { enumerable: true, get: () => state.steeringAngle },
    lastDistanceMeters: { enumerable: true, get: () => state.lastDistanceMeters },
  })
  return Object.freeze(binding)
}

/**
 * Binds visual wheel motion to the authored GLB wheel meshes. The rolling axle,
 * radius, pivot validity, and forward rotation sign are measured rather than
 * assumed. Steering is composed in the wheel parent's coordinates and rolling
 * is composed in the wheel mesh's authored coordinates, preserving its rest
 * quaternion and all hub, cap, and fastener descendants. Simulator steering is
 * positive for a right turn, while Three.js positive Y rotation points a wheel
 * left, so the visual steering quaternion uses the opposite sign.
 */
export function createWheelArticulation(rig) {
  if (!rig?.root?.isObject3D) throw new WheelArticulationError('wheel articulation requires a Three.js rig root')
  rig.root.updateMatrixWorld(true)
  const roles = wheelRoles(rig)
  const uniqueWheels = new Set(roles.map(({ wheel }) => wheel))
  if (uniqueWheels.size !== roles.length) throw new WheelArticulationError('the same wheel is bound to more than one role')

  const states = roles.map(({ wheel, role, driven, steered }) => {
    if (!wheel.parent) throw new WheelArticulationError(`${wheel.name} is detached from the GLB hierarchy`)
    const measurement = measureWheel(wheel)
    const restQuaternion = wheel.quaternion.clone().normalize()
    const parentAxle = measurement.localAxle.clone().applyQuaternion(restQuaternion).normalize()
    const steeringAxis = vehicleAxisInParent(rig.root, wheel.parent, new THREE.Vector3(0, 1, 0))
    const forwardAxis = vehicleAxisInParent(rig.root, wheel.parent, new THREE.Vector3(0, 0, -1))
    const forwardTangent = parentAxle.clone().cross(steeringAxis.clone().negate()).normalize()
    const alignment = forwardTangent.dot(forwardAxis)
    if (!Number.isFinite(alignment) || Math.abs(alignment) < MIN_ROLL_ALIGNMENT) {
      throw new WheelArticulationError(
        `${wheel.name} axle is not perpendicular to the vehicle forward and up axes (alignment ${alignment.toFixed(3)})`,
      )
    }
    return {
      wheel,
      role,
      driven,
      steered,
      ...measurement,
      restQuaternion,
      parentAxle,
      steeringAxis,
      rootCenter: wheelCenterInRoot(rig.root, wheel),
      spinSign: Math.sign(alignment),
      spinAngle: 0,
      steeringAngle: 0,
      lastDistanceMeters: 0,
      steerQuaternion: new THREE.Quaternion(),
      spinQuaternion: new THREE.Quaternion(),
      fromWorld: new THREE.Vector3(),
      toWorld: new THREE.Vector3(),
      displacement: new THREE.Vector3(),
    }
  })

  function applyState(state) {
    state.steerQuaternion.setFromAxisAngle(state.steeringAxis, state.steeringAngle)
    state.spinQuaternion.setFromAxisAngle(state.localAxle, state.spinAngle)
    state.wheel.quaternion
      .copy(state.steerQuaternion)
      .multiply(state.restQuaternion)
      .multiply(state.spinQuaternion)
      .normalize()
  }

  const articulation = {
    bindings: Object.freeze(states.map(publicBinding)),
    // Accepted poses provide exact per-wheel travel, including distinct inner
    // and outer paths. distanceMeters remains a straight-line/test fallback.
    update({ distanceMeters = 0, steerAngle = 0, fromPose, toPose } = {}) {
      if (!Number.isFinite(distanceMeters)) throw new TypeError('distanceMeters must be finite')
      if (!Number.isFinite(steerAngle)) throw new TypeError('steerAngle must be finite')
      if (Math.abs(steerAngle) > Math.PI) throw new RangeError('steerAngle must be within +/- pi radians')
      const hasFromPose = fromPose !== undefined
      const hasToPose = toPose !== undefined
      if (hasFromPose !== hasToPose) throw new TypeError('fromPose and toPose must be provided together')
      if (hasFromPose && (!validPose(fromPose) || !validPose(toPose))) {
        throw new TypeError('fromPose and toPose require finite x, z, and heading values')
      }
      states.forEach((state) => {
        state.steeringAngle = state.steered ? -steerAngle : 0
        state.lastDistanceMeters = hasFromPose
          ? wheelTravelFromPoses(state, fromPose, toPose)
          : distanceMeters
        state.spinAngle = wrapAngle(
          state.spinAngle + state.spinSign * state.lastDistanceMeters / state.radius,
        )
        applyState(state)
      })
    },
    reset() {
      states.forEach((state) => {
        state.spinAngle = 0
        state.steeringAngle = 0
        state.lastDistanceMeters = 0
        state.wheel.quaternion.copy(state.restQuaternion)
      })
    },
  }
  return Object.freeze(articulation)
}
