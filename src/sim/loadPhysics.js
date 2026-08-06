import * as THREE from 'three'

// Lightweight deterministic collision and load handling for ProLTO. This is
// intentionally a focused warehouse solver, not a general rigid-body engine.
// Dimensions are meters and headings use the truck root's Y rotation.

const EPSILON = 1e-7
const DEG = Math.PI / 180
const POUND = .45359237

// Pallet weights are authored in pounds; `referenceMass` is the mass at which a
// shoved load moves at roughly half the truck's rate. An empty pallet skitters,
// a 2400 lb load barely shifts.
const PALLET_PUSH = Object.freeze({
  referenceMass: 520,
  maxEfficiency: .85,
  minEfficiency: .1,
})

export const DEFAULT_TRUCK_COLLIDER = Object.freeze({
  id: 'truck-body',
  offsetX: 0,
  offsetZ: .42,
  halfWidth: .64,
  halfLength: .9,
  heading: 0,
  minY: 0,
  maxY: 2.35,
})

export const DEFAULT_FORK_SPEC = Object.freeze({
  localBase: Object.freeze([0, .04, 0]),
  localForward: Object.freeze([0, 0, -1]),
  length: 1.12,
  spread: .66,
  tineWidth: .1,
  thickness: .05,
  minimumPenetration: .34,
  maximumApproachAngle: 18 * DEG,
  pickupClearance: .035,
  dropClearance: .06,
  landingTolerance: .045,
})

export const DEFAULT_PALLET_SPEC = Object.freeze({
  // A GMA pallet is entered from its 40 in face and the fork travels the 48 in
  // stringer axis, so `width` is the LATERAL 40 in span the tines must fit
  // inside and `depth` is the 48 in the tines penetrate. These were swapped,
  // which put the engagement test ninety degrees out from the pallet geometry.
  width: 1.016,
  depth: 1.2192,
  height: 1.05,
  weight: 1200,
  pocketMin: .025,
  pocketMax: .13,
})

// These presets use the authored blade heel, tip, and tine-center dimensions in
// assets-src/trucks. The returned frame follows the animated carriage or reach
// group, so fork engagement stays correct while lifting and reaching.
export const FORK_RIG_PRESETS = Object.freeze({
  'Crown:reach': Object.freeze({ frame: 'reachGroup', localBase: [0, .07, 0], length: 1.07, spread: .55, thickness: .04 }),
  'Raymond:reach': Object.freeze({ frame: 'reachGroup', localBase: [0, .08, 0], length: 1.07, spread: .56, thickness: .04 }),
  'Crown:order-picker': Object.freeze({ frame: 'carriage', localBase: [0, .025, 0], length: 1.1, spread: .55, thickness: .04 }),
  'Raymond:order-picker': Object.freeze({ frame: 'carriage', localBase: [0, .025, 0], length: 1.1, spread: .56, thickness: .04 }),
  'Crown:pallet': Object.freeze({ frame: 'carriage', localBase: [0, .055, -.46], length: 1.36, spread: .5, thickness: .06 }),
  'Raymond:pallet': Object.freeze({ frame: 'carriage', localBase: [0, .0475, -.36], length: 1.22, spread: .49, thickness: .075 }),
  'Crown:counterbalance': Object.freeze({ frame: 'carriage', localBase: [0, .04, 0], length: 1.07, spread: .62, thickness: .04 }),
  'Raymond:counterbalance': Object.freeze({ frame: 'carriage', localBase: [0, .04, 0], length: 1.07, spread: .62, thickness: .04 }),
})

export function forkConfigurationForProfile(profile, rig) {
  const key = `${profile.manufacturer}:${profile.family}`
  const preset = FORK_RIG_PRESETS[key] || DEFAULT_FORK_SPEC
  const frame = preset.frame ? rig[preset.frame] : rig.reachGroup || rig.carriage
  const forkFrame = frame || rig.carriage || rig.root
  const specification = { ...DEFAULT_FORK_SPEC, ...preset }

  // Prefer geometry measured off the actual blade meshes (see
  // vehicleFactory.measureForks) over the authored constants above. The presets
  // are kept only as a fallback for rigs that do not expose forks_L/forks_R,
  // because a hand-maintained copy of the model's dimensions WILL drift from the
  // model -- and it had, badly enough that two trucks could not pick up a pallet.
  const metrics = rig.forkMetrics
  if (metrics && forkFrame?.getWorldPosition) {
    const frameWorldY = forkFrame.getWorldPosition(new THREE.Vector3()).y
    specification.localBase = [
      specification.localBase[0],
      metrics.bladeBottom + specification.thickness * .5 - frameWorldY,
      specification.localBase[2],
    ]
    specification.length = metrics.length
    specification.spread = metrics.spread
    specification.tineWidth = metrics.tineWidth
    // Heel position in the fork frame's own space, so a picked-up load can be
    // seated against the backrest instead of left wherever the approach stopped.
    const frameWorldZ = forkFrame.getWorldPosition(new THREE.Vector3()).z
    specification.heelLocalZ = metrics.heelZ - frameWorldZ
  }
  return { forkFrame, forkSpecification: specification }
}

export function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export function localToWorld2(pose, localX, localZ) {
  const cosine = Math.cos(pose.heading || 0)
  const sine = Math.sin(pose.heading || 0)
  return {
    x: pose.x + cosine * localX + sine * localZ,
    z: pose.z - sine * localX + cosine * localZ,
  }
}

export function worldToLocal2(pose, worldX, worldZ) {
  const cosine = Math.cos(pose.heading || 0)
  const sine = Math.sin(pose.heading || 0)
  const dx = worldX - pose.x
  const dz = worldZ - pose.z
  return {
    x: cosine * dx - sine * dz,
    z: sine * dx + cosine * dz,
  }
}

export function colliderAtPose(pose, localCollider = DEFAULT_TRUCK_COLLIDER) {
  const center = localToWorld2(pose, localCollider.offsetX || 0, localCollider.offsetZ || 0)
  return {
    id: localCollider.id || 'collider',
    x: center.x,
    z: center.z,
    halfWidth: localCollider.halfWidth,
    halfLength: localCollider.halfLength,
    heading: normalizeAngle((pose.heading || 0) + (localCollider.heading || 0)),
    minY: localCollider.minY ?? 0,
    maxY: localCollider.maxY ?? 2.35,
    // Carried forward so the narrow phase can tell a load-end collider from a
    // body envelope; without it the carriage face is treated as chassis and
    // cannot enter a rack bay.
    loadEnd: localCollider.loadEnd === true,
  }
}

function verticalOverlap(first, second) {
  const firstMin = first.minY ?? -Infinity
  const firstMax = first.maxY ?? Infinity
  const secondMin = second.minY ?? -Infinity
  const secondMax = second.maxY ?? Infinity
  return firstMax >= secondMin - EPSILON && secondMax >= firstMin - EPSILON
}

export function obbIntersectsAabb(obb, aabb) {
  if (!verticalOverlap(obb, aabb)) return false
  const centerX = (aabb.minX + aabb.maxX) * .5
  const centerZ = (aabb.minZ + aabb.maxZ) * .5
  const halfX = (aabb.maxX - aabb.minX) * .5
  const halfZ = (aabb.maxZ - aabb.minZ) * .5
  const dx = obb.x - centerX
  const dz = obb.z - centerZ
  const cosine = Math.cos(obb.heading || 0)
  const sine = Math.sin(obb.heading || 0)
  const axisX = { x: cosine, z: -sine }
  const axisZ = { x: sine, z: cosine }

  if (Math.abs(dx) > halfX + obb.halfWidth * Math.abs(axisX.x) + obb.halfLength * Math.abs(axisZ.x)) return false
  if (Math.abs(dz) > halfZ + obb.halfWidth * Math.abs(axisX.z) + obb.halfLength * Math.abs(axisZ.z)) return false
  if (Math.abs(dx * axisX.x + dz * axisX.z) > obb.halfWidth + halfX * Math.abs(axisX.x) + halfZ * Math.abs(axisX.z)) return false
  if (Math.abs(dx * axisZ.x + dz * axisZ.z) > obb.halfLength + halfX * Math.abs(axisZ.x) + halfZ * Math.abs(axisZ.z)) return false
  return true
}

export function obbIntersectsCircle(obb, circle) {
  if (!verticalOverlap(obb, circle)) return false
  const local = worldToLocal2(obb, circle.x, circle.z)
  const closestX = THREE.MathUtils.clamp(local.x, -obb.halfWidth, obb.halfWidth)
  const closestZ = THREE.MathUtils.clamp(local.z, -obb.halfLength, obb.halfLength)
  const dx = local.x - closestX
  const dz = local.z - closestZ
  return dx * dx + dz * dz <= circle.radius * circle.radius + EPSILON
}

export function obbIntersectsObb(first, second) {
  if (!verticalOverlap(first, second)) return false
  const deltaX = second.x - first.x
  const deltaZ = second.z - first.z
  const firstCosine = Math.cos(first.heading || 0)
  const firstSine = Math.sin(first.heading || 0)
  const secondCosine = Math.cos(second.heading || 0)
  const secondSine = Math.sin(second.heading || 0)
  const axes = [
    { x: firstCosine, z: -firstSine },
    { x: firstSine, z: firstCosine },
    { x: secondCosine, z: -secondSine },
    { x: secondSine, z: secondCosine },
  ]
  const firstAxes = axes.slice(0, 2)
  const secondAxes = axes.slice(2)
  for (const axis of axes) {
    const distance = Math.abs(deltaX * axis.x + deltaZ * axis.z)
    const firstRadius = first.halfWidth * Math.abs(firstAxes[0].x * axis.x + firstAxes[0].z * axis.z)
      + first.halfLength * Math.abs(firstAxes[1].x * axis.x + firstAxes[1].z * axis.z)
    const secondRadius = second.halfWidth * Math.abs(secondAxes[0].x * axis.x + secondAxes[0].z * axis.z)
      + second.halfLength * Math.abs(secondAxes[1].x * axis.x + secondAxes[1].z * axis.z)
    if (distance > firstRadius + secondRadius + EPSILON) return false
  }
  return true
}

export function colliderIntersectsObstacle(collider, obstacle) {
  if (obstacle.disabled) return false
  if (obstacle.shape === 'circle') return obbIntersectsCircle(collider, obstacle)
  if (obstacle.shape === 'obb') return obbIntersectsObb(collider, obstacle)
  return obbIntersectsAabb(collider, obstacle)
}

function normalizeCollider(collider, index = 0) {
  return {
    ...DEFAULT_TRUCK_COLLIDER,
    ...collider,
    id: collider.id || `truck-collider-${index}`,
  }
}

function objectBounds(object) {
  const box = new THREE.Box3().setFromObject(object)
  return {
    minX: box.min.x,
    maxX: box.max.x,
    minY: box.min.y,
    maxY: box.max.y,
    minZ: box.min.z,
    maxZ: box.max.z,
  }
}

// Bounding circle in the XZ plane, cached on the obstacle so the broad phase
// below costs one distance compare instead of a full separating-axis test. The
// facility now registers a few hundred obstacles (every rack upright and beam
// is its own collider), so an O(colliders x obstacles) narrow phase per sweep
// step is no longer free.
export function refreshObstacleBounds(obstacle) {
  obstacle.__normalized = true
  if (obstacle.shape === 'circle') {
    obstacle.boundX = obstacle.x
    obstacle.boundZ = obstacle.z
    obstacle.boundRadius = obstacle.radius
  } else if (obstacle.shape === 'obb') {
    obstacle.boundX = obstacle.x
    obstacle.boundZ = obstacle.z
    obstacle.boundRadius = Math.hypot(obstacle.halfWidth, obstacle.halfLength)
  } else {
    const halfX = (obstacle.maxX - obstacle.minX) * .5
    const halfZ = (obstacle.maxZ - obstacle.minZ) * .5
    obstacle.boundX = obstacle.minX + halfX
    obstacle.boundZ = obstacle.minZ + halfZ
    obstacle.boundRadius = Math.hypot(halfX, halfZ)
  }
  return obstacle
}

function normalizeObstacle(input, index = 0) {
  const object = input.object || (input.isObject3D ? input : null)
  const metadata = object?.userData?.physics || {}
  const obstacle = input.isObject3D ? { ...metadata, object } : { ...metadata, ...input, object }
  const hasDeclaredShape = obstacle.shape || Number.isFinite(obstacle.radius) || Number.isFinite(obstacle.halfWidth)
  const source = object && !hasDeclaredShape ? { ...objectBounds(object), ...obstacle } : obstacle
  const id = obstacle.id || object?.name || `obstacle-${index}`
  if (source.shape === 'circle' || Number.isFinite(source.radius)) {
    const position = source.position || obstacle.position || {}
    const knockable = obstacle.knockable ?? obstacle.kind === 'cone'
    return refreshObstacleBounds({
      ...source,
      ...obstacle,
      id,
      shape: 'circle',
      kind: obstacle.kind || 'facility',
      solid: obstacle.solid ?? !knockable,
      knockable,
      radius: source.radius ?? .2,
      x: source.x ?? position.x ?? object?.position.x ?? 0,
      z: source.z ?? position.z ?? object?.position.z ?? 0,
    })
  }
  if (source.shape === 'obb' || Number.isFinite(source.halfWidth)) {
    return refreshObstacleBounds({
      ...source,
      ...obstacle,
      id,
      shape: 'obb',
      kind: obstacle.kind || 'facility',
      solid: obstacle.solid ?? true,
      heading: source.heading || 0,
    })
  }
  return refreshObstacleBounds({
    ...source,
    ...obstacle,
    id,
    shape: 'aabb',
    kind: obstacle.kind || 'facility',
    solid: obstacle.solid ?? true,
  })
}

function collisionQuery(pose, colliders, obstacles) {
  const contacts = []
  const worldColliders = colliders.map((collider) => colliderAtPose(pose, collider))
  for (const collider of worldColliders) {
    // Load-end colliders are the carried pallet and the carriage face. Both
    // travel into a rack bay by design, so both may pass an obstacle that opts
    // out of blocking them (a beam), while still being stopped by everything
    // else (uprights, stored loads, walls).
    const carried = collider.id.startsWith('carried:') || collider.loadEnd === true
    const colliderRadius = Math.hypot(collider.halfWidth, collider.halfLength)
    for (const obstacle of obstacles) {
      if (obstacle.disabled) continue
      const reach = colliderRadius + (obstacle.boundRadius ?? 0)
      const dx = collider.x - (obstacle.boundX ?? 0)
      const dz = collider.z - (obstacle.boundZ ?? 0)
      if (dx * dx + dz * dz > reach * reach) continue
      if (!colliderIntersectsObstacle(collider, obstacle)) continue
      // A carried load passing through something it is meant to be set onto --
      // a rack beam -- must not hard-stop the truck, but it is still a contact
      // the evaluator should see. Recording it as non-blocking keeps the event
      // without wedging the placement.
      const passthrough = carried && obstacle.blocksCarriedLoads === false
      contacts.push({ collider, obstacle, blocking: !passthrough && obstacle.solid !== false })
    }
  }
  return contacts
}

function interpolatePose(from, to, fraction) {
  const headingDelta = normalizeAngle((to.heading || 0) - (from.heading || 0))
  return {
    x: THREE.MathUtils.lerp(from.x, to.x, fraction),
    z: THREE.MathUtils.lerp(from.z, to.z, fraction),
    heading: normalizeAngle((from.heading || 0) + headingDelta * fraction),
  }
}

export function sweepPose(from, to, colliders, obstacles, options = {}) {
  const normalizedColliders = colliders.map(normalizeCollider)
  // Obstacles arriving from WarehouseLoadPhysics are already normalized. Passing
  // them through normalizeObstacle again would rebuild several hundred objects
  // every frame purely to produce identical values.
  const normalizedObstacles = obstacles.map((obstacle, index) => (
    obstacle.__normalized ? obstacle : normalizeObstacle(obstacle, index)
  ))
  const distance = Math.hypot(to.x - from.x, to.z - from.z)
  const radius = Math.max(...normalizedColliders.map((collider) => Math.hypot(collider.halfWidth, collider.halfLength)))
  const angularDistance = Math.abs(normalizeAngle((to.heading || 0) - (from.heading || 0))) * radius
  const stepDistance = options.stepDistance || .055
  const steps = Math.max(1, Math.min(options.maxSteps || 512, Math.ceil(Math.max(distance, angularDistance) / stepDistance)))
  const contactsById = new Map()
  let safePose = { ...from, heading: normalizeAngle(from.heading || 0) }
  let safeFraction = 0
  let blockingContacts = []

  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps
    const pose = interpolatePose(from, to, fraction)
    const contacts = collisionQuery(pose, normalizedColliders, normalizedObstacles)
    contacts.forEach((contact) => contactsById.set(contact.obstacle.id, contact))
    blockingContacts = contacts.filter((contact) => contact.blocking)
    if (blockingContacts.length) break
    safePose = pose
    safeFraction = fraction
  }

  if (!blockingContacts.length) {
    return { pose: safePose, blocked: false, fraction: 1, contacts: [...contactsById.values()], blockingContacts: [] }
  }

  let low = safeFraction
  let high = Math.min(1, safeFraction + 1 / steps)
  for (let iteration = 0; iteration < 7; iteration += 1) {
    const middle = (low + high) * .5
    const pose = interpolatePose(from, to, middle)
    const contacts = collisionQuery(pose, normalizedColliders, normalizedObstacles)
    if (contacts.some((contact) => contact.blocking)) high = middle
    else low = middle
  }
  safePose = interpolatePose(from, to, Math.max(0, low - .0005))
  return {
    pose: safePose,
    blocked: true,
    fraction: low,
    contacts: [...contactsById.values()],
    blockingContacts,
  }
}

function worldYaw(object) {
  const quaternion = object.getWorldQuaternion(new THREE.Quaternion())
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion)
  return Math.atan2(-forward.x, -forward.z)
}

function worldPose(object) {
  const position = object.getWorldPosition(new THREE.Vector3())
  return { x: position.x, y: position.y, z: position.z, yaw: worldYaw(object) }
}

function setWorldPose(object, pose) {
  const position = new THREE.Vector3(pose.x, pose.y, pose.z)
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pose.yaw || 0, 0))
  if (object.parent) {
    object.parent.updateWorldMatrix(true, false)
    object.parent.worldToLocal(position)
    const parentQuaternion = object.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
    quaternion.premultiply(parentQuaternion)
  }
  object.position.copy(position)
  object.quaternion.copy(quaternion)
  object.updateMatrixWorld(true)
}

function normalizePallet(spec, index = 0) {
  const object = spec.object || spec
  const metadata = object.userData?.physics || {}
  const source = spec.object ? { ...metadata, ...spec } : metadata
  const dimensions = source.dimensions || {}
  const initialPose = worldPose(object)
  const slotId = source.slotId || null
  return {
    ...DEFAULT_PALLET_SPEC,
    ...source,
    width: source.width ?? dimensions.width ?? dimensions.x ?? DEFAULT_PALLET_SPEC.width,
    depth: source.depth ?? dimensions.depth ?? dimensions.z ?? DEFAULT_PALLET_SPEC.depth,
    height: source.height ?? dimensions.height ?? dimensions.y ?? DEFAULT_PALLET_SPEC.height,
    id: source.id || object.name || `pallet-${index}`,
    object,
    status: source.status || (slotId ? 'racked' : 'floor'),
    slotId,
    supportY: source.supportY ?? initialPose.y,
    pose: initialPose,
    initialPose: { ...initialPose },
    initialStatus: source.status || (slotId ? 'racked' : 'floor'),
    initialSlotId: slotId,
    candidateForkY: null,
    lastBaseY: initialPose.y,
    originSupportY: source.supportY ?? initialPose.y,
    wasClear: false,
    obstacleCache: null,
    carryPosition: new THREE.Vector3(),
    carryQuaternion: new THREE.Quaternion(),
    truckLocal: null,
  }
}

function normalizeSlot(slot, index = 0) {
  const position = slot.position || slot
  const halfExtents = slot.halfExtents || {}
  const halfWidth = Array.isArray(halfExtents) ? halfExtents[0] : halfExtents.x
  const halfDepth = Array.isArray(halfExtents) ? halfExtents[2] : halfExtents.z
  return {
    id: slot.id || `rack-slot-${index}`,
    x: position.x,
    y: position.y,
    z: position.z,
    yaw: slot.yaw || 0,
    width: slot.width || (halfWidth ? halfWidth * 2 : 1.34),
    depth: slot.depth || (halfDepth ? halfDepth * 2 : 1.12),
    positionTolerance: slot.positionTolerance ?? .17,
    yawTolerance: slot.yawTolerance ?? 8 * DEG,
    occupiedBy: slot.occupiedBy || null,
    initialOccupiedBy: slot.occupiedBy || null,
    enabled: slot.enabled ?? true,
  }
}

export function testForkPalletEngagement(fork, pallet) {
  const dx = pallet.x - fork.baseX
  const dz = pallet.z - fork.baseZ
  const lateral = dx * fork.rightX + dz * fork.rightZ
  const longitudinal = dx * fork.forwardX + dz * fork.forwardZ
  const palletForwardX = -Math.sin(pallet.yaw || 0)
  const palletForwardZ = -Math.cos(pallet.yaw || 0)
  const directionAlignment = Math.abs(fork.forwardX * palletForwardX + fork.forwardZ * palletForwardZ)
  const requiredAlignment = Math.cos(fork.maximumApproachAngle ?? 18 * DEG)
  const frontDistance = longitudinal - pallet.depth * .5
  const penetration = THREE.MathUtils.clamp(fork.length - Math.max(0, frontDistance), 0, pallet.depth)
  const tineOuterEdge = fork.spread * .5 + fork.tineWidth * .5
  const lateralLimit = Math.max(0, pallet.width * .5 - tineOuterEdge)
  const forkTop = fork.baseY + fork.thickness * .5
  const pocketBottom = pallet.y + (pallet.pocketMin ?? DEFAULT_PALLET_SPEC.pocketMin)
  const pocketTop = pallet.y + (pallet.pocketMax ?? DEFAULT_PALLET_SPEC.pocketMax)
  const horizontalEligible = directionAlignment >= requiredAlignment
    && Math.abs(lateral) <= lateralLimit + EPSILON
    && longitudinal + pallet.depth * .5 >= 0
    && frontDistance <= fork.length
    && penetration >= (fork.minimumPenetration ?? DEFAULT_FORK_SPEC.minimumPenetration)
  const verticalEligible = forkTop >= pocketBottom - .025 && forkTop <= pocketTop + .025
  return {
    eligible: horizontalEligible && verticalEligible,
    horizontalEligible,
    verticalEligible,
    penetration,
    lateral,
    longitudinal,
    forkTop,
    directionAlignment,
  }
}

export function findRackSlotPlacement(pallet, slots, options = {}) {
  const landingTolerance = options.landingTolerance ?? DEFAULT_FORK_SPEC.landingTolerance
  let best = null
  let bestScore = Infinity
  for (const slot of slots) {
    if (!slot.enabled || (slot.occupiedBy && slot.occupiedBy !== pallet.id)) continue
    const local = worldToLocal2({ x: slot.x, z: slot.z, heading: slot.yaw || 0 }, pallet.x, pallet.z)
    const xLimit = Math.max(0, (slot.width - pallet.width) * .5) + slot.positionTolerance
    const zLimit = Math.max(0, (slot.depth - pallet.depth) * .5) + slot.positionTolerance
    const yawError = Math.abs(normalizeAngle((pallet.yaw || 0) - (slot.yaw || 0)))
    const reverseYawError = Math.abs(Math.PI - yawError)
    const alignedYawError = Math.min(yawError, reverseYawError)
    const heightError = Math.abs(pallet.y - slot.y)
    if (Math.abs(local.x) > xLimit || Math.abs(local.z) > zLimit) continue
    if (alignedYawError > slot.yawTolerance || heightError > landingTolerance) continue
    const score = Math.hypot(local.x / Math.max(xLimit, .01), local.z / Math.max(zLimit, .01))
      + alignedYawError / Math.max(slot.yawTolerance, .01)
      + heightError / Math.max(landingTolerance, .01)
    if (score < bestScore) {
      bestScore = score
      best = slot
    }
  }
  return best
}

function readForkPose(frame, specification) {
  frame.updateWorldMatrix(true, false)
  const localBase = new THREE.Vector3(...specification.localBase)
  const base = frame.localToWorld(localBase)
  const quaternion = frame.getWorldQuaternion(new THREE.Quaternion())
  const forward = new THREE.Vector3(...specification.localForward).normalize().applyQuaternion(quaternion)
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion)
  return {
    baseX: base.x,
    baseY: base.y,
    baseZ: base.z,
    forwardX: forward.x,
    forwardZ: forward.z,
    rightX: right.x,
    rightZ: right.z,
    ...specification,
  }
}

// A racked or grounded pallet does not move, so its obstacle is built once and
// reused until the pallet's state actually changes. Rebuilding all of them every
// frame cost three Vector3/Quaternion allocations each across ~150 stored loads,
// which is real GC pressure on a standalone headset.
function palletObstacle(body) {
  if (body.obstacleCache) return body.obstacleCache
  const pose = worldPose(body.object)
  body.pose = pose
  body.obstacleCache = refreshObstacleBounds({
    id: `load:${body.id}`,
    shape: 'obb',
    kind: 'pallet',
    label: 'Stored load',
    solid: true,
    palletId: body.id,
    x: pose.x,
    z: pose.z,
    heading: pose.yaw,
    halfWidth: body.width * .5,
    halfLength: body.depth * .5,
    minY: pose.y,
    maxY: pose.y + body.height,
  })
  return body.obstacleCache
}

// What a contact with each class of facility hardware means to an evaluator.
// A rack upright strike is the incident that closes an aisle and can bring a
// run down, so it is scored harder than brushing a beam or a stored load.
const CONTACT_RULES = {
  cone: { type: 'cone-contact', severity: 'minor' },
  pallet: { type: 'load-contact', severity: 'major' },
  'pallet-stack': { type: 'load-contact', severity: 'major' },
  'rack-beam': { type: 'rack-contact', severity: 'major' },
  'rack-upright': { type: 'rack-contact', severity: 'critical' },
  pedestrian: { type: 'pedestrian-contact', severity: 'critical' },
}
const DEFAULT_CONTACT_RULE = { type: 'facility-contact', severity: 'critical' }

export class WarehouseLoadPhysics {
  constructor(options = {}) {
    this.truckRoot = options.truckRoot || null
    this.forkFrame = options.forkFrame || null
    this.truckColliders = (Array.isArray(options.truckColliders) ? options.truckColliders : [options.truckCollider || DEFAULT_TRUCK_COLLIDER]).map(normalizeCollider)
    this.forkSpecification = { ...DEFAULT_FORK_SPEC, ...(options.forkSpecification || {}) }
    this.floorY = options.floorY ?? 0
    this.fixedStep = options.fixedStep || 1 / 90
    this.onEvent = options.onEvent || (() => {})
    this.obstacles = []
    this.pallets = []
    this.rackSlots = []
    this.carried = null
    this.contactIds = new Set()
    this.coneAccumulator = 0
    this.lastForkTop = null
    ;(options.obstacles || []).forEach((obstacle) => this.registerObstacle(obstacle))
    ;(options.rackSlots || []).forEach((slot) => this.registerRackSlot(slot))
    ;(options.pallets || []).forEach((pallet) => this.registerPallet(pallet))
  }

  registerObstacle(specification) {
    const obstacle = normalizeObstacle(specification, this.obstacles.length)
    obstacle.initialX = obstacle.x
    obstacle.initialZ = obstacle.z
    obstacle.initialPosition = obstacle.object?.position.clone?.() || null
    obstacle.initialQuaternion = obstacle.object?.quaternion.clone?.() || null
    if (obstacle.knockable) {
      obstacle.solid = specification.solid ?? false
      obstacle.velocityX = 0
      obstacle.velocityZ = 0
      obstacle.tilt = 0
      obstacle.knocked = false
    }
    this.obstacles.push(obstacle)
    return obstacle
  }

  registerRackSlot(specification) {
    const slot = normalizeSlot(specification, this.rackSlots.length)
    this.rackSlots.push(slot)
    return slot
  }

  registerPallet(specification) {
    const body = normalizePallet(specification, this.pallets.length)
    const slot = body.slotId && this.rackSlots.find((candidate) => candidate.id === body.slotId)
    if (slot) {
      slot.occupiedBy = body.id
      slot.initialOccupiedBy = body.id
    }
    this.pallets.push(body)
    return body
  }

  configureTruck({ truckRoot, forkFrame, truckColliders, forkSpecification } = {}) {
    if (truckRoot) this.truckRoot = truckRoot
    if (forkFrame) this.forkFrame = forkFrame
    if (truckColliders) this.truckColliders = truckColliders.map(normalizeCollider)
    if (forkSpecification) this.forkSpecification = { ...this.forkSpecification, ...forkSpecification }
  }

  activeObstacles() {
    const loads = this.pallets
      .filter((body) => body !== this.carried)
      .map(palletObstacle)
    return [...this.obstacles, ...loads]
  }

  carriedCollider() {
    if (!this.carried?.truckLocal) return null
    const body = this.carried
    return {
      id: `carried:${body.id}`,
      offsetX: body.truckLocal.x,
      offsetZ: body.truckLocal.z,
      halfWidth: body.width * .5,
      halfLength: body.depth * .5,
      heading: body.truckLocal.heading,
      minY: body.pose.y,
      maxY: body.pose.y + body.height,
    }
  }

  // A pallet on the floor is not a bollard. Pressing a truck into one shoves it,
  // scrubbing across the concrete: it never keeps up with the truck, it stops
  // the instant the truck does, and a heavy load barely moves at all. Modeled as
  // displacement while in contact rather than as an impulse, because friction
  // between wood and sealed concrete is high enough that a shoved pallet has no
  // meaningful coast -- and because displacement cannot jitter.
  pushEfficiency(body) {
    const mass = (body.weight || 0) * POUND
    const ratio = PALLET_PUSH.referenceMass / (PALLET_PUSH.referenceMass + mass)
    return THREE.MathUtils.clamp(ratio, PALLET_PUSH.minEfficiency, PALLET_PUSH.maxEfficiency)
  }

  pushBlockingPallets(result, from, to) {
    const dx = to.x - from.x
    const dz = to.z - from.z
    const distance = Math.hypot(dx, dz)
    if (distance < 1e-5) return false
    const remaining = distance * (1 - result.fraction)
    if (remaining < 1e-5) return false
    let moved = false
    for (const contact of result.blockingContacts) {
      const palletId = contact.obstacle.palletId
      if (!palletId) continue
      const body = this.pallets.find((candidate) => candidate.id === palletId)
      // Racked loads stay put: nudging a beam-level pallet with the mast should
      // be scored as a rack strike, not turned into a shoving match.
      if (!body || body === this.carried || body.status !== 'floor') continue
      const step = remaining * this.pushEfficiency(body)
      if (step < 1e-5) continue
      setWorldPose(body.object, {
        x: body.pose.x + (dx / distance) * step,
        y: body.pose.y,
        z: body.pose.z + (dz / distance) * step,
        yaw: body.pose.yaw,
      })
      body.pose = worldPose(body.object)
      body.obstacleCache = null
      body.pushedDistance = (body.pushedDistance || 0) + step
      moved = true
      this.onEvent({
        type: 'load-pushed',
        severity: 'major',
        label: 'Load pushed across the floor instead of carried',
        pallet: body,
        obstacle: contact.obstacle,
        distance: body.pushedDistance,
      })
    }
    return moved
  }

  resolveTruckMotion(previousPose, proposedPose, options = {}) {
    const colliders = [...this.truckColliders]
    const carried = this.carriedCollider()
    if (carried) colliders.push(carried)
    let result = sweepPose(previousPose, proposedPose, colliders, this.activeObstacles(), options)
    // If the block was a floor pallet, shove it and re-solve so the truck
    // advances into the space it just cleared.
    if (result.blocked && this.pushBlockingPallets(result, previousPose, proposedPose)) {
      result = sweepPose(previousPose, proposedPose, colliders, this.activeObstacles(), options)
    }
    const currentContactIds = new Set(result.contacts.map((contact) => contact.obstacle.id))
    for (const contact of result.contacts) {
      const registeredObstacle = this.obstacles.find((candidate) => candidate.id === contact.obstacle.id)
      const obstacle = registeredObstacle || contact.obstacle
      if (!this.contactIds.has(contact.obstacle.id)) {
        const rule = CONTACT_RULES[obstacle.kind] || DEFAULT_CONTACT_RULE
        this.onEvent({
          ...rule,
          obstacle,
          collider: contact.collider,
          label: obstacle.label || obstacle.kind || 'facility',
          carriedLoad: contact.collider.id.startsWith('carried:'),
          blocking: contact.blocking,
        })
      }
      if (obstacle.knockable) this.knockObstacle(obstacle, previousPose, proposedPose, options.speed || 0)
    }
    this.contactIds = currentContactIds
    return result
  }

  knockObstacle(obstacle, previousPose, proposedPose, speed) {
    if (obstacle.knocked) return
    obstacle.knocked = true
    obstacle.solid = false
    let dx = obstacle.x - proposedPose.x
    let dz = obstacle.z - proposedPose.z
    let length = Math.hypot(dx, dz)
    if (length < .05) {
      dx = proposedPose.x - previousPose.x
      dz = proposedPose.z - previousPose.z
      length = Math.hypot(dx, dz)
    }
    if (length < EPSILON) {
      const direction = Math.sign(speed || 1)
      dx = -Math.sin(proposedPose.heading || 0) * direction
      dz = -Math.cos(proposedPose.heading || 0) * direction
      length = 1
    }
    const impulse = THREE.MathUtils.clamp(Math.abs(speed) * .42 + .35, .35, 2.4)
    obstacle.velocityX = dx / length * impulse
    obstacle.velocityZ = dz / length * impulse
  }

  stepCones(dt) {
    this.coneAccumulator += Math.min(Math.max(dt, 0), .1)
    let steps = 0
    while (this.coneAccumulator >= this.fixedStep && steps < 12) {
      for (const obstacle of this.obstacles) {
        if (!obstacle.knockable || !obstacle.knocked) continue
        obstacle.x += obstacle.velocityX * this.fixedStep
        obstacle.z += obstacle.velocityZ * this.fixedStep
        refreshObstacleBounds(obstacle)
        const damping = Math.exp(-5.2 * this.fixedStep)
        obstacle.velocityX *= damping
        obstacle.velocityZ *= damping
        obstacle.tilt = THREE.MathUtils.damp(obstacle.tilt, 1.38, 9, this.fixedStep)
      }
      this.coneAccumulator -= this.fixedStep
      steps += 1
    }
    for (const obstacle of this.obstacles) {
      if (!obstacle.knockable || !obstacle.object || !obstacle.knocked) continue
      obstacle.object.position.x = obstacle.x
      obstacle.object.position.z = obstacle.z
      const direction = Math.atan2(obstacle.velocityX, obstacle.velocityZ)
      obstacle.object.rotation.x = Math.cos(direction) * obstacle.tilt
      obstacle.object.rotation.z = -Math.sin(direction) * obstacle.tilt
      obstacle.object.updateMatrixWorld(true)
    }
  }

  attachPallet(body, forkPose) {
    if (!this.forkFrame || this.carried) return false
    const pose = worldPose(body.object)
    this.forkFrame.updateWorldMatrix(true, false)
    body.carryPosition.copy(this.forkFrame.worldToLocal(new THREE.Vector3(pose.x, pose.y, pose.z)))
    // Seat the load against the backrest. The forks are shorter than the pallet
    // is deep, so a load picked up "fully" still ended up carried wherever the
    // approach happened to stop -- which pushed the cartons back through the
    // mast, the chains and the overhead guard, and buried the fork camera
    // inside them. Real trucks stop the load at the backrest; so does this.
    if (Number.isFinite(this.forkSpecification.heelLocalZ)) {
      const seated = this.forkSpecification.heelLocalZ - body.depth * .5
      body.carryPosition.z = Math.min(body.carryPosition.z, seated)
    }
    const forkQuaternion = this.forkFrame.getWorldQuaternion(new THREE.Quaternion()).invert()
    body.carryQuaternion.copy(forkQuaternion.multiply(body.object.getWorldQuaternion(new THREE.Quaternion())))
    body.originSupportY = body.supportY
    body.lastBaseY = pose.y
    body.wasClear = false
    if (body.slotId) {
      const slot = this.rackSlots.find((candidate) => candidate.id === body.slotId)
      if (slot?.occupiedBy === body.id) slot.occupiedBy = null
    }
    body.slotId = null
    body.status = 'carried'
    body.candidateForkY = null
    body.obstacleCache = null
    this.carried = body
    this.syncCarriedPallet()
    this.onEvent({ type: 'pallet-engaged', pallet: body, fork: forkPose, severity: 'info' })
    return true
  }

  syncCarriedPallet() {
    const body = this.carried
    if (!body || !this.forkFrame) return
    this.forkFrame.updateWorldMatrix(true, false)
    const position = this.forkFrame.localToWorld(body.carryPosition.clone())
    const quaternion = this.forkFrame.getWorldQuaternion(new THREE.Quaternion()).multiply(body.carryQuaternion)
    if (body.object.parent) {
      body.object.parent.updateWorldMatrix(true, false)
      body.object.parent.worldToLocal(position)
      quaternion.premultiply(body.object.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
    }
    body.object.position.copy(position)
    body.object.quaternion.copy(quaternion)
    body.object.updateMatrixWorld(true)
    body.pose = worldPose(body.object)
    if (this.truckRoot) {
      const truckPose = worldPose(this.truckRoot)
      const local = worldToLocal2({ x: truckPose.x, z: truckPose.z, heading: truckPose.yaw }, body.pose.x, body.pose.z)
      body.truckLocal = {
        x: local.x,
        z: local.z,
        heading: normalizeAngle(body.pose.yaw - truckPose.yaw),
      }
    }
  }

  settleCarriedPallet(slot = null) {
    const body = this.carried
    if (!body) return false
    const target = slot
      ? { x: slot.x, y: slot.y, z: slot.z, yaw: slot.yaw }
      : { x: body.pose.x, y: this.floorY, z: body.pose.z, yaw: body.pose.yaw }
    setWorldPose(body.object, target)
    body.pose = worldPose(body.object)
    body.status = slot ? 'racked' : 'floor'
    body.slotId = slot?.id || null
    body.supportY = target.y
    body.candidateForkY = null
    body.truckLocal = null
    body.obstacleCache = null
    if (slot) slot.occupiedBy = body.id
    this.carried = null
    this.onEvent({ type: slot ? 'pallet-racked' : 'pallet-grounded', pallet: body, slot, severity: 'info' })
    return true
  }

  releaseCarried(options = {}) {
    if (!this.carried) return false
    const slot = options.slotId && this.rackSlots.find((candidate) => candidate.id === options.slotId)
    if (slot && slot.occupiedBy && slot.occupiedBy !== this.carried.id) return false
    if (!options.force) {
      const pallet = { ...this.carried.pose, ...this.carried }
      const validSlot = slot || findRackSlotPlacement(pallet, this.rackSlots, this.forkSpecification)
      if (!validSlot && Math.abs(this.carried.pose.y - this.floorY) > this.forkSpecification.landingTolerance) return false
      return this.settleCarriedPallet(validSlot)
    }
    return this.settleCarriedPallet(slot || null)
  }

  update(dt, options = {}) {
    this.stepCones(dt)
    if (!this.forkFrame) return this.snapshot()
    const fork = readForkPose(this.forkFrame, this.forkSpecification)
    const forkTop = fork.baseY + fork.thickness * .5

    if (this.carried) {
      this.syncCarriedPallet()
      const body = this.carried
      const descending = body.pose.y < body.lastBaseY - .0002
      body.wasClear ||= body.pose.y > body.originSupportY + this.forkSpecification.dropClearance
      const slot = findRackSlotPlacement({ ...body.pose, ...body }, this.rackSlots, this.forkSpecification)
      if (body.wasClear && descending && slot) this.settleCarriedPallet(slot)
      else if (body.wasClear && descending && body.pose.y <= this.floorY + this.forkSpecification.landingTolerance) this.settleCarriedPallet(null)
      else body.lastBaseY = body.pose.y
    } else {
      let best = null
      for (const body of this.pallets) {
        const pose = worldPose(body.object)
        body.pose = pose
        const engagement = testForkPalletEngagement(fork, { ...body, ...pose })
        if (!engagement.horizontalEligible) {
          body.candidateForkY = null
          continue
        }
        if (engagement.eligible && body.candidateForkY === null) body.candidateForkY = forkTop
        if (body.candidateForkY !== null && forkTop - body.candidateForkY >= this.forkSpecification.pickupClearance) {
          if (!best || engagement.penetration > best.engagement.penetration) best = { body, engagement }
        }
      }
      if (best) this.attachPallet(best.body, fork)
    }

    this.lastForkTop = forkTop
    return this.snapshot()
  }

  snapshot() {
    return {
      carriedPalletId: this.carried?.id || null,
      carriedWeight: this.carried?.weight || 0,
      pallets: this.pallets.map((body) => ({
        id: body.id,
        status: body.status,
        slotId: body.slotId,
        supportY: body.supportY,
      })),
      slots: this.rackSlots.map((slot) => ({ id: slot.id, occupiedBy: slot.occupiedBy })),
    }
  }

  reset() {
    this.carried = null
    this.contactIds.clear()
    this.coneAccumulator = 0
    this.lastForkTop = null
    for (const obstacle of this.obstacles) {
      if (!obstacle.knockable) continue
      obstacle.x = obstacle.initialX
      obstacle.z = obstacle.initialZ
      obstacle.velocityX = 0
      obstacle.velocityZ = 0
      obstacle.tilt = 0
      obstacle.knocked = false
      obstacle.disabled = false
      refreshObstacleBounds(obstacle)
      if (obstacle.object && obstacle.initialPosition && obstacle.initialQuaternion) {
        obstacle.object.position.copy(obstacle.initialPosition)
        obstacle.object.quaternion.copy(obstacle.initialQuaternion)
        obstacle.object.updateMatrixWorld(true)
      }
    }
    this.rackSlots.forEach((slot) => { slot.occupiedBy = slot.initialOccupiedBy })
    for (const body of this.pallets) {
      setWorldPose(body.object, body.initialPose)
      body.pose = { ...body.initialPose }
      body.status = body.initialStatus
      body.slotId = body.initialSlotId
      body.supportY = body.initialPose.y
      body.originSupportY = body.initialPose.y
      body.lastBaseY = body.initialPose.y
      body.candidateForkY = null
      body.truckLocal = null
      body.wasClear = false
      body.obstacleCache = null
      body.pushedDistance = 0
    }
  }
}

export function createWarehouseLoadPhysics(options) {
  return new WarehouseLoadPhysics(options)
}
