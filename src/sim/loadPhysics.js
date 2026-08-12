import * as THREE from 'three'

// Lightweight deterministic collision and load handling for ProLTO. This is
// intentionally a focused warehouse solver, not a general rigid-body engine.
// Dimensions are meters and headings use the truck root's Y rotation.

const EPSILON = 1e-7
const DEG = Math.PI / 180
const IN = .0254
const POUND = .45359237
const BEAM_SUPPORT_SKIN = .015

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
  // Require a small positive lift command, then attach when the blade top
  // reaches the underside of the pallet deck. A generic 35 mm rise cannot fit
  // above the thicker low-lift blades inside a real GMA opening.
  pickupClearance: .002,
  pickupContactTolerance: .003,
  dropClearance: .06,
  landingTolerance: .045,
  // Integration hook only. The Simulator must supply the current provisional
  // derated capacity; no manufacturer plate value is inferred here.
  maximumLoadWeight: Infinity,
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
  // Authored GMA geometry has .7 in bottom boards and stringers ending at
  // 4.4 in. Keep a 4 mm wood clearance at each surface.
  pocketMin: .7 * IN + .004,
  pocketMax: 4.4 * IN - .004,
  // GMA stringer geometry matching src/sim/warehouse.js. Each tine must remain
  // wholly inside one of the two openings, not merely inside the pallet outline.
  stringerWidth: 1.4 * IN,
  edgeStringerInset: .06,
  channelClearance: .006,
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
  // Equipment capacities are authored in pounds, as are pallet weights. Wire
  // the selected reference configuration into engagement at the module
  // boundary so an integration cannot accidentally leave the default Infinity
  // in place. A live derated limit can still be supplied through
  // engagementEligibility.
  if (Number.isFinite(profile.capacity)) specification.maximumLoadWeight = profile.capacity

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
    //
    // metrics.heelZ is TRUCK-LOCAL -- measureForks runs during rig mapping,
    // before the Simulator moves the truck to its start position. Subtracting a
    // WORLD frame position from it mixed the two spaces and put `seated` about
    // 13 m ahead of the forks, which is why a picked-up pallet shot forty feet
    // down the aisle while still tracking lift. Both terms must be truck-local.
    const frameLocal = forkFrame.getWorldPosition(new THREE.Vector3())
    if (rig.root) rig.root.worldToLocal(frameLocal)
    specification.heelLocalZ = metrics.heelZ - frameLocal.z
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
    // Fork metadata is retained so the pallet narrow phase can distinguish a
    // tine inside a real GMA channel from a tine cutting through wood.
    forkTine: localCollider.forkTine === true,
    forkSetId: localCollider.forkSetId || 'forks',
    maximumApproachAngle: localCollider.maximumApproachAngle,
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

function contactKey(contact) {
  return `${contact.collider.id}\u0000${contact.obstacle.id}`
}

function horizontalContactPenetration(collider, obstacle) {
  if (obstacle.shape === 'circle') {
    const local = worldToLocal2(collider, obstacle.x, obstacle.z)
    const overlapX = collider.halfWidth + obstacle.radius - Math.abs(local.x)
    const overlapZ = collider.halfLength + obstacle.radius - Math.abs(local.z)
    return Math.min(overlapX, overlapZ)
  }

  const box = obstacle.shape === 'obb'
    ? obstacle
    : {
        x: (obstacle.minX + obstacle.maxX) * .5,
        z: (obstacle.minZ + obstacle.maxZ) * .5,
        halfWidth: (obstacle.maxX - obstacle.minX) * .5,
        halfLength: (obstacle.maxZ - obstacle.minZ) * .5,
        heading: 0,
      }
  const deltaX = box.x - collider.x
  const deltaZ = box.z - collider.z
  const colliderCosine = Math.cos(collider.heading || 0)
  const colliderSine = Math.sin(collider.heading || 0)
  const boxCosine = Math.cos(box.heading || 0)
  const boxSine = Math.sin(box.heading || 0)
  const colliderAxes = [
    { x: colliderCosine, z: -colliderSine },
    { x: colliderSine, z: colliderCosine },
  ]
  const boxAxes = [
    { x: boxCosine, z: -boxSine },
    { x: boxSine, z: boxCosine },
  ]
  let penetration = Infinity
  for (const axis of [...colliderAxes, ...boxAxes]) {
    const distance = Math.abs(deltaX * axis.x + deltaZ * axis.z)
    const colliderRadius = collider.halfWidth * Math.abs(colliderAxes[0].x * axis.x + colliderAxes[0].z * axis.z)
      + collider.halfLength * Math.abs(colliderAxes[1].x * axis.x + colliderAxes[1].z * axis.z)
    const boxRadius = box.halfWidth * Math.abs(boxAxes[0].x * axis.x + boxAxes[0].z * axis.z)
      + box.halfLength * Math.abs(boxAxes[1].x * axis.x + boxAxes[1].z * axis.z)
    penetration = Math.min(penetration, colliderRadius + boxRadius - distance)
  }
  return penetration
}

function verticalContactPenetration(collider, obstacle) {
  const colliderMin = collider.minY ?? -Infinity
  const colliderMax = collider.maxY ?? Infinity
  const obstacleMin = obstacle.minY ?? -Infinity
  const obstacleMax = obstacle.maxY ?? Infinity
  const fromBelow = colliderMax - obstacleMin
  const fromAbove = obstacleMax - colliderMin
  return Math.min(fromBelow, fromAbove)
}

function contactPenetration(collider, obstacle) {
  const horizontalPenetration = horizontalContactPenetration(collider, obstacle)
  const verticalPenetration = verticalContactPenetration(collider, obstacle)
  return {
    horizontalPenetration,
    verticalPenetration,
    // Minimum translation in any separating direction is the relevant 3D
    // overlap. This is what lets a lift or lower operation prove it is escaping
    // an existing contact instead of looking unchanged in the XZ projection.
    penetration: Math.min(horizontalPenetration, verticalPenetration),
  }
}

function forkTineChannelAtPallet(collider, obstacle) {
  if (!collider.forkTine || obstacle.kind !== 'pallet') return null
  const palletWidth = obstacle.width ?? obstacle.halfWidth * 2
  const local = worldToLocal2(obstacle, collider.x, collider.z)
  const angle = normalizeAngle((collider.heading || 0) - (obstacle.heading || 0))
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const directionAlignment = Math.abs(cosine)
  const requiredAlignment = Math.cos(collider.maximumApproachAngle ?? DEFAULT_FORK_SPEC.maximumApproachAngle)
  const lateralHalfSpan = collider.halfWidth * Math.abs(cosine) + collider.halfLength * Math.abs(sine)
  const sweptMin = local.x - lateralHalfSpan
  const sweptMax = local.x + lateralHalfSpan
  const clearance = obstacle.channelClearance ?? DEFAULT_PALLET_SPEC.channelClearance
  const stringerWidth = obstacle.stringerWidth ?? DEFAULT_PALLET_SPEC.stringerWidth
  const edgeInset = obstacle.edgeStringerInset ?? DEFAULT_PALLET_SPEC.edgeStringerInset
  const edgeCenter = palletWidth * .5 - edgeInset
  const halfStringer = stringerWidth * .5
  const channels = [
    { min: -edgeCenter + halfStringer + clearance, max: -halfStringer - clearance },
    { min: halfStringer + clearance, max: edgeCenter - halfStringer - clearance },
  ]
  const channel = channels.findIndex((candidate) => (
    sweptMin >= candidate.min - EPSILON && sweptMax <= candidate.max + EPSILON
  ))
  const pocketBottom = (obstacle.minY ?? 0) + (obstacle.pocketMin ?? DEFAULT_PALLET_SPEC.pocketMin)
  const pocketTop = (obstacle.minY ?? 0) + (obstacle.pocketMax ?? DEFAULT_PALLET_SPEC.pocketMax)
  const verticalEligible = collider.minY >= pocketBottom - EPSILON && collider.maxY <= pocketTop + EPSILON
  return {
    channel,
    eligible: channel >= 0 && verticalEligible && directionAlignment >= requiredAlignment,
    directionAlignment,
    verticalEligible,
    sweptMin,
    sweptMax,
  }
}

function forkChannelAccess(collider, obstacle, worldColliders) {
  const entry = forkTineChannelAtPallet(collider, obstacle)
  if (!entry?.eligible) return null
  const peers = worldColliders.filter((candidate) => (
    candidate.forkTine
    && (candidate.forkSetId || 'forks') === (collider.forkSetId || 'forks')
  ))
  const peerEntries = peers.map((candidate) => ({
    collider: candidate,
    channel: forkTineChannelAtPallet(candidate, obstacle),
  }))
  const distinctChannels = new Set(
    peerEntries.filter((candidate) => candidate.channel?.eligible).map((candidate) => candidate.channel.channel),
  )
  // A valid pickup uses two physical tines in the two separate GMA openings.
  // One tine, crossed tines, or two tines in one opening still hit pallet wood.
  if (peers.length < 2 || peerEntries.some((candidate) => !candidate.channel?.eligible) || distinctChannels.size < 2) return null
  return entry
}

function collisionQueryWorld(worldColliders, obstacles) {
  const contacts = []
  for (const collider of worldColliders) {
    const carriedPallet = collider.id.startsWith('carried:')
    const colliderRadius = Math.hypot(collider.halfWidth, collider.halfLength)
    for (const obstacle of obstacles) {
      if (obstacle.disabled) continue
      const reach = colliderRadius + (obstacle.boundRadius ?? 0)
      const dx = collider.x - (obstacle.boundX ?? 0)
      const dz = collider.z - (obstacle.boundZ ?? 0)
      if (dx * dx + dz * dz > reach * reach) continue
      if (!colliderIntersectsObstacle(collider, obstacle)) continue
      // A pallet may skim or settle onto a beam's top face. It may not enter the
      // steel horizontally from below. The carriage is never exempted: only the
      // actual carried pallet gets this narrow support-surface allowance.
      const onBeamTop = carriedPallet
        && obstacle.kind === 'rack-beam'
        && obstacle.blocksCarriedLoads === false
        && Number.isFinite(obstacle.maxY)
        && collider.minY >= obstacle.maxY - BEAM_SUPPORT_SKIN
      const channelAccess = forkChannelAccess(collider, obstacle, worldColliders)
      const penetration = contactPenetration(collider, obstacle)
      contacts.push({
        collider,
        obstacle,
        blocking: !onBeamTop && !channelAccess && obstacle.solid !== false,
        supportContact: onBeamTop,
        channelAccess: Boolean(channelAccess),
        tineChannel: channelAccess?.channel ?? null,
        ...penetration,
      })
    }
  }
  return contacts
}

function collisionQuery(pose, colliders, obstacles) {
  return collisionQueryWorld(colliders.map((collider) => colliderAtPose(pose, collider)), obstacles)
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
  const stepDistance = Math.max(options.stepDistance || .055, .001)
  // Never enlarge the step to satisfy a cap. Doing so can jump a pushed load
  // across thin rack steel or a pedestrian during a large correction.
  const steps = Math.max(1, Math.ceil(Math.max(distance, angularDistance) / stepDistance))
  const contactsById = new Map()
  const initialContacts = collisionQuery(
    { ...from, heading: normalizeAngle(from.heading || 0) },
    normalizedColliders,
    normalizedObstacles,
  )
  const initialBlocking = new Map(
    initialContacts.filter((contact) => contact.blocking).map((contact) => [contactKey(contact), contact.penetration]),
  )

  const allowEscape = (contacts) => contacts.map((contact) => {
    if (!contact.blocking) return contact
    const initialPenetration = initialBlocking.get(contactKey(contact))
    if (initialPenetration === undefined || contact.penetration >= initialPenetration - EPSILON) return contact
    return { ...contact, blocking: false, escaping: true }
  })
  let safePose = { ...from, heading: normalizeAngle(from.heading || 0) }
  let safeFraction = 0
  let blockingContacts = []

  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps
    const pose = interpolatePose(from, to, fraction)
    const contacts = allowEscape(collisionQuery(pose, normalizedColliders, normalizedObstacles))
    contacts.forEach((contact) => contactsById.set(contactKey(contact), contact))
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
    const contacts = allowEscape(collisionQuery(pose, normalizedColliders, normalizedObstacles))
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

function normalizeHydraulicCollider(collider, index, label) {
  const id = collider?.id || `hydraulic-collider-${index}`
  const required = ['x', 'z', 'halfWidth', 'halfLength', 'minY', 'maxY']
  for (const key of required) {
    if (!Number.isFinite(collider?.[key])) {
      throw new TypeError(`${label} collider ${id} requires a finite ${key}`)
    }
  }
  if (collider.halfWidth <= 0 || collider.halfLength <= 0) {
    throw new RangeError(`${label} collider ${id} requires positive half extents`)
  }
  if (collider.maxY < collider.minY) {
    throw new RangeError(`${label} collider ${id} has maxY below minY`)
  }
  return {
    ...collider,
    id,
    heading: normalizeAngle(collider.heading || 0),
    forkSetId: collider.forkSetId || 'forks',
  }
}

function normalizeHydraulicConfiguration(configuration, label) {
  if (!configuration || !Array.isArray(configuration.colliders)) {
    throw new TypeError(`${label} hydraulic configuration requires a colliders array`)
  }
  const colliders = configuration.colliders.map((collider, index) => normalizeHydraulicCollider(collider, index, label))
  const ids = new Set(colliders.map((collider) => collider.id))
  if (ids.size !== colliders.length) throw new RangeError(`${label} hydraulic collider ids must be unique`)
  return {
    ...configuration,
    values: { ...(configuration.values || {}) },
    colliders,
  }
}

function interpolateHydraulicValues(currentValues, proposedValues, fraction) {
  const values = {}
  const keys = new Set([...Object.keys(currentValues), ...Object.keys(proposedValues)])
  for (const key of keys) {
    const current = currentValues[key]
    const proposed = proposedValues[key]
    values[key] = Number.isFinite(current) && Number.isFinite(proposed)
      ? THREE.MathUtils.lerp(current, proposed, fraction)
      : fraction >= 1 ? proposed : current
  }
  return values
}

function interpolateHydraulicConfiguration(current, proposed, proposedById, fraction) {
  return {
    ...current,
    values: interpolateHydraulicValues(current.values, proposed.values, fraction),
    colliders: current.colliders.map((from) => {
      const to = proposedById.get(from.id)
      const headingDelta = normalizeAngle((to.heading || 0) - (from.heading || 0))
      return {
        ...from,
        ...to,
        x: THREE.MathUtils.lerp(from.x, to.x, fraction),
        z: THREE.MathUtils.lerp(from.z, to.z, fraction),
        halfWidth: THREE.MathUtils.lerp(from.halfWidth, to.halfWidth, fraction),
        halfLength: THREE.MathUtils.lerp(from.halfLength, to.halfLength, fraction),
        minY: THREE.MathUtils.lerp(from.minY, to.minY, fraction),
        maxY: THREE.MathUtils.lerp(from.maxY, to.maxY, fraction),
        heading: normalizeAngle((from.heading || 0) + headingDelta * fraction),
      }
    }),
  }
}

function hydraulicMotionDistance(current, proposedById) {
  let distance = 0
  for (const collider of current.colliders) {
    const proposed = proposedById.get(collider.id)
    const translation = Math.hypot(proposed.x - collider.x, proposed.z - collider.z)
    const vertical = Math.max(
      Math.abs(proposed.minY - collider.minY),
      Math.abs(proposed.maxY - collider.maxY),
    )
    const radial = Math.max(
      Math.hypot(collider.halfWidth, collider.halfLength),
      Math.hypot(proposed.halfWidth, proposed.halfLength),
    )
    const angular = Math.abs(normalizeAngle(proposed.heading - collider.heading)) * radial
    const resize = Math.max(
      Math.abs(proposed.halfWidth - collider.halfWidth),
      Math.abs(proposed.halfLength - collider.halfLength),
    )
    distance = Math.max(distance, translation, vertical, angular, resize)
  }
  return distance
}

function penetrationDifference(current, initial) {
  if (current === initial) return 0
  return current - initial
}

function assessHydraulicContacts(contacts, initialBlocking, tolerance) {
  return contacts.map((contact) => {
    if (!contact.blocking) return contact
    const initial = initialBlocking.get(contactKey(contact))
    const newContact = initial === undefined
    const horizontalPenetrationDelta = newContact
      ? contact.horizontalPenetration
      : penetrationDifference(contact.horizontalPenetration, initial.horizontalPenetration)
    const verticalPenetrationDelta = newContact
      ? contact.verticalPenetration
      : penetrationDifference(contact.verticalPenetration, initial.verticalPenetration)
    const penetrationDelta = Math.max(horizontalPenetrationDelta, verticalPenetrationDelta)
    // Treat the horizontal and vertical separating depths independently. A
    // shallow vertical overlap must not hide a reach command that drives much
    // deeper into steel, and vice versa. Escape is accepted only when no axis
    // worsens and at least one axis improves.
    const worsened = newContact
      || horizontalPenetrationDelta > tolerance
      || verticalPenetrationDelta > tolerance
    return {
      ...contact,
      physicalBlocking: true,
      blocking: worsened,
      newContact,
      worsened,
      escaping: !newContact
        && !worsened
        && (horizontalPenetrationDelta < -tolerance || verticalPenetrationDelta < -tolerance),
      initialPenetration: initial?.penetration ?? null,
      initialHorizontalPenetration: initial?.horizontalPenetration ?? null,
      initialVerticalPenetration: initial?.verticalPenetration ?? null,
      penetrationDelta,
      horizontalPenetrationDelta,
      verticalPenetrationDelta,
    }
  })
}

// Resolve simultaneous lift, reach, sideshift, and platform motion as a swept
// set of world-space OBBs. The solver compares every candidate point with the
// starting 3D penetration. New overlap and deeper overlap stop at the last safe
// configuration; lowering or retracting out of a pre-existing overlap remains
// possible so a machine can never become permanently trapped by correction.
export function resolveHydraulicMotion(currentConfiguration, proposedConfiguration, obstacles, options = {}) {
  const current = normalizeHydraulicConfiguration(currentConfiguration, 'current')
  const proposed = normalizeHydraulicConfiguration(proposedConfiguration, 'proposed')
  const proposedById = new Map(proposed.colliders.map((collider) => [collider.id, collider]))
  if (current.colliders.length !== proposed.colliders.length
    || current.colliders.some((collider) => !proposedById.has(collider.id))) {
    throw new RangeError('current and proposed hydraulic configurations must contain the same collider ids')
  }
  const normalizedObstacles = obstacles.map((obstacle, index) => (
    obstacle.__normalized ? obstacle : normalizeObstacle(obstacle, index)
  ))
  const penetrationTolerance = Math.max(options.penetrationTolerance ?? 1e-5, 0)
  const stepDistance = Math.max(options.stepDistance ?? .025, .001)
  const steps = Math.max(1, Math.ceil(hydraulicMotionDistance(current, proposedById) / stepDistance))
  const contactsById = new Map()
  const initialRawContacts = collisionQueryWorld(current.colliders, normalizedObstacles)
  const initialBlocking = new Map(
    initialRawContacts.filter((contact) => contact.blocking).map((contact) => [contactKey(contact), contact]),
  )
  const initialContacts = assessHydraulicContacts(initialRawContacts, initialBlocking, penetrationTolerance)
  initialContacts.forEach((contact) => contactsById.set(contactKey(contact), contact))

  let safeFraction = 0
  let blockingFraction = null
  let blockingContacts = []
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps
    const configuration = interpolateHydraulicConfiguration(current, proposed, proposedById, fraction)
    const contacts = assessHydraulicContacts(
      collisionQueryWorld(configuration.colliders, normalizedObstacles),
      initialBlocking,
      penetrationTolerance,
    )
    contacts.forEach((contact) => contactsById.set(contactKey(contact), contact))
    blockingContacts = contacts.filter((contact) => contact.blocking)
    if (blockingContacts.length) {
      blockingFraction = fraction
      break
    }
    safeFraction = fraction
  }

  if (blockingFraction === null) {
    const acceptedConfiguration = interpolateHydraulicConfiguration(current, proposed, proposedById, 1)
    return {
      acceptedConfiguration,
      blocked: false,
      fraction: 1,
      contacts: [...contactsById.values()],
      blockingContacts: [],
      initialContacts,
    }
  }

  let low = safeFraction
  let high = blockingFraction
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const middle = (low + high) * .5
    const configuration = interpolateHydraulicConfiguration(current, proposed, proposedById, middle)
    const contacts = assessHydraulicContacts(
      collisionQueryWorld(configuration.colliders, normalizedObstacles),
      initialBlocking,
      penetrationTolerance,
    )
    if (contacts.some((contact) => contact.blocking)) {
      high = middle
      blockingContacts = contacts.filter((contact) => contact.blocking)
    } else {
      low = middle
    }
  }
  const fractionBackoff = Math.max(options.fractionBackoff ?? .0005, 0)
  const acceptedFraction = Math.max(0, low - fractionBackoff)
  return {
    acceptedConfiguration: interpolateHydraulicConfiguration(current, proposed, proposedById, acceptedFraction),
    blocked: true,
    fraction: low,
    contacts: [...contactsById.values()],
    blockingContacts,
    initialContacts,
  }
}

export function forkTineCollidersFromPose(fork, options = {}) {
  const length = fork.length ?? DEFAULT_FORK_SPEC.length
  const spread = fork.spread ?? DEFAULT_FORK_SPEC.spread
  const tineWidth = fork.tineWidth ?? DEFAULT_FORK_SPEC.tineWidth
  const thickness = fork.thickness ?? DEFAULT_FORK_SPEC.thickness
  const horizontalForward = Math.hypot(fork.forwardX, fork.forwardZ)
  if (horizontalForward < EPSILON) throw new RangeError('fork direction must have a horizontal component')
  const heading = Math.atan2(fork.forwardX, fork.forwardZ)
  const forwardY = fork.forwardY || 0
  const rightY = fork.rightY || 0
  const upY = Number.isFinite(fork.upY) ? fork.upY : 1
  const horizontalUp = Math.hypot(fork.upX || 0, fork.upZ || 0)
  const verticalHalfExtent = Math.abs(forwardY) * length * .5
    + Math.abs(rightY) * tineWidth * .5
    + Math.abs(upY) * thickness * .5
  const centerY = fork.baseY + forwardY * length * .5
  const prefix = options.idPrefix || 'fork-tine'
  return [-1, 1].map((side) => {
    const offset = side * spread * .5
    return {
      id: `${prefix}-${side < 0 ? 'left' : 'right'}`,
      x: fork.baseX + fork.forwardX * length * .5 + fork.rightX * offset,
      z: fork.baseZ + fork.forwardZ * length * .5 + fork.rightZ * offset,
      halfWidth: tineWidth * .5,
      halfLength: horizontalForward * length * .5 + horizontalUp * thickness * .5,
      heading,
      minY: centerY + rightY * offset - verticalHalfExtent,
      maxY: centerY + rightY * offset + verticalHalfExtent,
      forkTine: true,
      forkSetId: options.forkSetId || 'forks',
      maximumApproachAngle: fork.maximumApproachAngle ?? DEFAULT_FORK_SPEC.maximumApproachAngle,
    }
  })
}

export function forkTineCollidersForFrame(frame, specification = DEFAULT_FORK_SPEC, options = {}) {
  return forkTineCollidersFromPose(readForkPose(frame, { ...DEFAULT_FORK_SPEC, ...specification }), options)
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

function syncPalletVisual(body) {
  const callback = body?.object?.syncLoadVisual || body?.object?.userData?.syncVisual
  if (typeof callback === 'function') callback()
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

function palletAxes(pallet) {
  const yaw = pallet.yaw || 0
  return {
    forwardX: -Math.sin(yaw),
    forwardZ: -Math.cos(yaw),
    rightX: Math.cos(yaw),
    rightZ: -Math.sin(yaw),
  }
}

function tineChannelAt(fork, pallet, axes, tineOffset, start, end) {
  const baseDx = fork.baseX - pallet.x
  const baseDz = fork.baseZ - pallet.z
  const baseLateral = baseDx * axes.rightX + baseDz * axes.rightZ
  const rightProjection = fork.rightX * axes.rightX + fork.rightZ * axes.rightZ
  const forwardProjection = fork.forwardX * axes.rightX + fork.forwardZ * axes.rightZ
  const atStart = baseLateral + tineOffset * rightProjection + start * forwardProjection
  const atEnd = baseLateral + tineOffset * rightProjection + end * forwardProjection
  const halfTine = Math.abs(rightProjection) * fork.tineWidth * .5
  const clearance = pallet.channelClearance ?? DEFAULT_PALLET_SPEC.channelClearance
  const stringerWidth = pallet.stringerWidth ?? DEFAULT_PALLET_SPEC.stringerWidth
  const edgeInset = pallet.edgeStringerInset ?? DEFAULT_PALLET_SPEC.edgeStringerInset
  const edgeCenter = pallet.width * .5 - edgeInset
  const halfStringer = stringerWidth * .5
  const channels = [
    { min: -edgeCenter + halfStringer + clearance, max: -halfStringer - clearance },
    { min: halfStringer + clearance, max: edgeCenter - halfStringer - clearance },
  ]
  const sweptMin = Math.min(atStart, atEnd) - halfTine
  const sweptMax = Math.max(atStart, atEnd) + halfTine
  const channel = channels.findIndex((candidate) => sweptMin >= candidate.min - EPSILON && sweptMax <= candidate.max + EPSILON)
  return { channel, sweptMin, sweptMax, atStart, atEnd }
}

export function testForkPalletEngagement(fork, pallet) {
  const dx = pallet.x - fork.baseX
  const dz = pallet.z - fork.baseZ
  const lateral = dx * fork.rightX + dz * fork.rightZ
  const longitudinal = dx * fork.forwardX + dz * fork.forwardZ
  const axes = palletAxes(pallet)
  const forwardAlignment = fork.forwardX * axes.forwardX + fork.forwardZ * axes.forwardZ
  const rightAlignment = fork.forwardX * axes.rightX + fork.forwardZ * axes.rightZ
  const directionAlignment = Math.abs(forwardAlignment)
  const requiredAlignment = Math.cos(fork.maximumApproachAngle ?? 18 * DEG)
  // Project the rotated pallet footprint onto the fork travel axis, then take
  // the true interval overlap. The old expression reported full insertion when
  // the pallet was mostly behind the fork heel.
  const projectedHalfLength = Math.abs(forwardAlignment) * pallet.depth * .5 + Math.abs(rightAlignment) * pallet.width * .5
  const frontDistance = longitudinal - projectedHalfLength
  const backDistance = longitudinal + projectedHalfLength
  const overlapStart = Math.max(0, frontDistance)
  const overlapEnd = Math.min(fork.length, backDistance)
  const penetration = Math.max(0, overlapEnd - overlapStart)
  const tineOffsets = [-fork.spread * .5, fork.spread * .5]
  const tineChannels = tineOffsets.map((offset) => tineChannelAt(fork, pallet, axes, offset, overlapStart, overlapEnd))
  const channelEligible = tineChannels.every((entry) => entry.channel >= 0)
    && new Set(tineChannels.map((entry) => entry.channel)).size === 2
  const upY = Number.isFinite(fork.upY) ? fork.upY : 1
  const forwardY = fork.forwardY || 0
  const verticalHalfThickness = Math.abs(upY) * fork.thickness * .5
  const topAtStart = fork.baseY + forwardY * overlapStart + verticalHalfThickness
  const topAtEnd = fork.baseY + forwardY * overlapEnd + verticalHalfThickness
  const forkTop = fork.baseY + verticalHalfThickness
  const pocketBottom = pallet.y + (pallet.pocketMin ?? DEFAULT_PALLET_SPEC.pocketMin)
  const pocketTop = pallet.y + (pallet.pocketMax ?? DEFAULT_PALLET_SPEC.pocketMax)
  const pocketTolerance = pallet.pocketTolerance ?? .006
  const horizontalEligible = directionAlignment >= requiredAlignment
    && backDistance >= 0
    && frontDistance <= fork.length
    && penetration >= (fork.minimumPenetration ?? DEFAULT_FORK_SPEC.minimumPenetration)
    && channelEligible
  // Both ends of the portion inside the pallet must remain inside the pocket.
  // This rejects a pitched tine whose heel fits but whose tip cuts a deck board.
  const minForkTop = Math.min(topAtStart, topAtEnd)
  const maxForkTop = Math.max(topAtStart, topAtEnd)
  const verticalEligible = minForkTop >= pocketBottom - pocketTolerance && maxForkTop <= pocketTop + pocketTolerance
  const maximumLoadWeight = fork.maximumLoadWeight ?? DEFAULT_FORK_SPEC.maximumLoadWeight
  const loadEligible = !Number.isFinite(maximumLoadWeight) || (pallet.weight || 0) <= maximumLoadWeight
  const geometryEligible = horizontalEligible && verticalEligible
  return {
    eligible: geometryEligible && loadEligible,
    geometryEligible,
    horizontalEligible,
    verticalEligible,
    channelEligible,
    loadEligible,
    rejectionReason: !geometryEligible ? 'geometry' : !loadEligible ? 'overweight' : null,
    penetration,
    overlapStart,
    overlapEnd,
    lateral,
    longitudinal,
    forkTop,
    minimumForkTop: minForkTop,
    maximumForkTop: maxForkTop,
    directionAlignment,
    tineChannels,
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

export function evaluateRackPlacementSupport(pallet, slot, obstacles, options = {}) {
  if (!slot) return { eligible: false, supportY: null, beamIds: [], reason: 'no-slot' }
  const normalizedObstacles = obstacles.map((obstacle, index) => (
    obstacle.__normalized ? obstacle : normalizeObstacle(obstacle, index)
  ))
  const rackBeams = normalizedObstacles.filter((obstacle) => obstacle.kind === 'rack-beam' && !obstacle.disabled)
  // A solver can be used with abstract slots and no authored facility. Once a
  // facility supplies rack beams, however, every placement must be supported by
  // real beam geometry at the selected slot.
  if (!rackBeams.length) {
    return {
      eligible: options.requirePhysicalSupport === true ? false : true,
      supportY: slot.y,
      beamIds: [],
      reason: options.requirePhysicalSupport === true ? 'no-support-beams' : null,
      virtual: true,
    }
  }

  const verticalTolerance = options.verticalTolerance ?? .06
  const footprint = {
    x: slot.x,
    z: slot.z,
    halfWidth: pallet.width * .5,
    halfLength: pallet.depth * .5,
    heading: slot.yaw || 0,
    minY: slot.y - verticalTolerance,
    maxY: slot.y + verticalTolerance,
  }
  const supports = rackBeams.filter((beam) => (
    Number.isFinite(beam.maxY)
    && Math.abs(beam.maxY - slot.y) <= verticalTolerance
    && colliderIntersectsObstacle(footprint, beam)
  ))
  const uniqueSupports = [...new Map(supports.map((beam) => [beam.id, beam])).values()]
  const supportOffsets = uniqueSupports.map((beam) => {
    const local = worldToLocal2(
      { x: slot.x, z: slot.z, heading: slot.yaw || 0 },
      beam.boundX,
      beam.boundZ,
    )
    return local.z
  })
  const separation = supportOffsets.length > 1 ? Math.max(...supportOffsets) - Math.min(...supportOffsets) : 0
  const requiredSeparation = options.minimumBeamSeparation ?? Math.min(pallet.depth * .4, .45)
  const eligible = uniqueSupports.length >= (options.minimumSupportBeams ?? 2) && separation >= requiredSeparation
  return {
    eligible,
    supportY: eligible ? Math.max(...uniqueSupports.map((beam) => beam.maxY)) : null,
    beamIds: uniqueSupports.map((beam) => beam.id),
    separation,
    reason: eligible ? null : uniqueSupports.length < 2 ? 'insufficient-support-beams' : 'support-beams-too-close',
    virtual: false,
  }
}

function readForkPose(frame, specification) {
  frame.updateWorldMatrix(true, false)
  const localBase = new THREE.Vector3(...specification.localBase)
  const base = frame.localToWorld(localBase)
  const quaternion = frame.getWorldQuaternion(new THREE.Quaternion())
  const forward = new THREE.Vector3(...specification.localForward).normalize().applyQuaternion(quaternion)
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion)
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion)
  return {
    baseX: base.x,
    baseY: base.y,
    baseZ: base.z,
    forwardX: forward.x,
    forwardY: forward.y,
    forwardZ: forward.z,
    rightX: right.x,
    rightY: right.y,
    rightZ: right.z,
    upX: up.x,
    upY: up.y,
    upZ: up.z,
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
    width: body.width,
    depth: body.depth,
    pocketMin: body.pocketMin,
    pocketMax: body.pocketMax,
    stringerWidth: body.stringerWidth,
    edgeStringerInset: body.edgeStringerInset,
    channelClearance: body.channelClearance,
  })
  return body.obstacleCache
}

function worldColliderToLocal(pose, collider) {
  const local = worldToLocal2(pose, collider.x, collider.z)
  return {
    ...collider,
    offsetX: local.x,
    offsetZ: local.z,
    heading: normalizeAngle((collider.heading || 0) - (pose.heading || 0)),
  }
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
    this.engagementEligibility = options.engagementEligibility || null
    this.obstacles = []
    this.pallets = []
    this.rackSlots = []
    this.carried = null
    this.contactIds = new Set()
    this.hydraulicContactIds = new Set()
    this.hydraulicConfiguration = null
    this.coneAccumulator = 0
    this.lastForkTop = null
    this.lastEngagement = null
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
    syncPalletVisual(body)
    return body
  }

  configureTruck({ truckRoot, forkFrame, truckColliders, forkSpecification, engagementEligibility } = {}) {
    if (truckRoot) this.truckRoot = truckRoot
    if (forkFrame) this.forkFrame = forkFrame
    if (truckColliders) this.truckColliders = truckColliders.map(normalizeCollider)
    if (forkSpecification) this.forkSpecification = { ...this.forkSpecification, ...forkSpecification }
    if (engagementEligibility !== undefined) this.engagementEligibility = engagementEligibility
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
    if (distance < 1e-5) return { moved: false, contacts: [] }
    const remaining = distance * (1 - result.fraction)
    if (remaining < 1e-5) return { moved: false, contacts: [] }
    let moved = false
    const pushContacts = new Map()
    const attemptedPalletIds = new Set()
    for (const contact of result.blockingContacts) {
      const palletId = contact.obstacle.palletId
      if (!palletId || attemptedPalletIds.has(palletId)) continue
      attemptedPalletIds.add(palletId)
      const body = this.pallets.find((candidate) => candidate.id === palletId)
      // Racked loads stay put: nudging a beam-level pallet with the mast should
      // be scored as a rack strike, not turned into a shoving match.
      if (!body || body === this.carried || body.status !== 'floor' || body.movable === false) continue
      const step = remaining * this.pushEfficiency(body)
      if (step < 1e-5) continue
      body.pose = worldPose(body.object)
      const fromPose = { x: body.pose.x, z: body.pose.z, heading: body.pose.yaw }
      const targetPose = {
        x: body.pose.x + (dx / distance) * step,
        z: body.pose.z + (dz / distance) * step,
        heading: body.pose.yaw,
      }
      const pushedCollider = {
        id: `pushed:${body.id}`,
        offsetX: 0,
        offsetZ: 0,
        halfWidth: body.width * .5,
        halfLength: body.depth * .5,
        minY: body.pose.y,
        maxY: body.pose.y + body.height,
      }
      const obstacles = this.activeObstacles().filter((obstacle) => obstacle.palletId !== body.id)
      const pushResult = sweepPose(fromPose, targetPose, [pushedCollider], obstacles, { stepDistance: .025 })
      pushResult.contacts.forEach((pushContact) => pushContacts.set(contactKey(pushContact), pushContact))
      const acceptedDistance = Math.hypot(pushResult.pose.x - fromPose.x, pushResult.pose.z - fromPose.z)
      if (acceptedDistance < 1e-5) continue
      setWorldPose(body.object, {
        x: pushResult.pose.x,
        y: body.pose.y,
        z: pushResult.pose.z,
        yaw: pushResult.pose.heading,
      })
      body.pose = worldPose(body.object)
      syncPalletVisual(body)
      body.obstacleCache = null
      body.pushedDistance = (body.pushedDistance || 0) + acceptedDistance
      moved = true
      this.onEvent({
        type: 'load-pushed',
        severity: 'major',
        label: 'Load pushed across the floor instead of carried',
        pallet: body,
        obstacle: contact.obstacle,
        distance: body.pushedDistance,
        blocked: pushResult.blocked,
      })
    }
    return { moved, contacts: [...pushContacts.values()] }
  }

  resolveTruckMotion(previousPose, proposedPose, options = {}) {
    const collidersById = new Map(this.truckColliders.map((collider) => [collider.id, collider]))
    const carried = this.carriedCollider()
    if (carried) collidersById.set(carried.id, carried)
    // The last accepted hydraulic bodies become ordinary truck-local sweep
    // bodies during travel. This closes the old gap where forks were checked
    // while lifting but could still drive horizontally through the same steel.
    const hydraulicConfiguration = options.hydraulicConfiguration || this.hydraulicConfiguration
    for (const collider of hydraulicConfiguration?.colliders || []) {
      // A load can settle or be released after the hydraulic configuration was
      // committed. Do not keep its stale carried envelope for the next travel
      // step once the pallet has become an active world obstacle again.
      if (collider.id.startsWith('carried:') && collider.id !== `carried:${this.carried?.id || ''}`) continue
      collidersById.set(collider.id, worldColliderToLocal(previousPose, collider))
    }
    const colliders = [...collidersById.values()]
    let result = sweepPose(previousPose, proposedPose, colliders, this.activeObstacles(), options)
    // If the block was a floor pallet, shove it and re-solve so the truck
    // advances into the space it just cleared.
    const pushResult = result.blocked
      ? this.pushBlockingPallets(result, previousPose, proposedPose)
      : { moved: false, contacts: [] }
    if (pushResult.moved) {
      result = sweepPose(previousPose, proposedPose, colliders, this.activeObstacles(), options)
    }
    if (pushResult.contacts.length) {
      const combinedContacts = new Map(result.contacts.map((contact) => [contactKey(contact), contact]))
      pushResult.contacts.forEach((contact) => combinedContacts.set(contactKey(contact), contact))
      result = { ...result, contacts: [...combinedContacts.values()] }
    }
    // Support-skin and valid fork-channel contacts are evidence, not strikes.
    // Knockable objects still report even though they intentionally do not
    // block travel.
    const reportableContacts = result.contacts.filter((contact) => contact.blocking || contact.obstacle.knockable)
    const currentContactIds = new Set(reportableContacts.map((contact) => contact.obstacle.id))
    const emittedContactIds = new Set(this.contactIds)
    for (const contact of reportableContacts) {
      const registeredObstacle = this.obstacles.find((candidate) => candidate.id === contact.obstacle.id)
      const obstacle = registeredObstacle || contact.obstacle
      if (!emittedContactIds.has(contact.obstacle.id)) {
        const rule = CONTACT_RULES[obstacle.kind] || DEFAULT_CONTACT_RULE
        this.onEvent({
          ...rule,
          obstacle,
          collider: contact.collider,
          label: obstacle.label || obstacle.kind || 'facility',
          carriedLoad: contact.collider.id.startsWith('carried:'),
          blocking: contact.blocking,
        })
        emittedContactIds.add(contact.obstacle.id)
      }
      if (obstacle.knockable) this.knockObstacle(obstacle, previousPose, proposedPose, options.speed || 0)
    }
    this.contactIds = currentContactIds
    return result
  }

  resolveHydraulicMotion(currentConfiguration, proposedConfiguration, options = {}) {
    const result = resolveHydraulicMotion(
      currentConfiguration,
      proposedConfiguration,
      this.activeObstacles(),
      options,
    )
    if (options.commit !== false) this.hydraulicConfiguration = result.acceptedConfiguration

    const byObstacle = new Map()
    for (const contact of result.blockingContacts) {
      const existing = byObstacle.get(contact.obstacle.id)
      if (!existing || contact.penetration > existing.penetration) byObstacle.set(contact.obstacle.id, contact)
    }
    const currentIds = new Set(byObstacle.keys())
    if (options.emitEvents !== false) {
      for (const contact of byObstacle.values()) {
        if (this.hydraulicContactIds.has(contact.obstacle.id) || this.contactIds.has(contact.obstacle.id)) continue
        const registeredObstacle = this.obstacles.find((candidate) => candidate.id === contact.obstacle.id)
        const obstacle = registeredObstacle || contact.obstacle
        const rule = CONTACT_RULES[obstacle.kind] || DEFAULT_CONTACT_RULE
        this.onEvent({
          ...rule,
          obstacle,
          collider: contact.collider,
          label: obstacle.label || obstacle.kind || 'facility',
          carriedLoad: contact.collider.id.startsWith('carried:'),
          blocking: true,
          hydraulicMotion: true,
          penetration: contact.penetration,
          penetrationDelta: contact.penetrationDelta,
        })
      }
    }
    this.hydraulicContactIds = currentIds
    return result
  }

  commitHydraulicConfiguration(configuration) {
    this.hydraulicConfiguration = normalizeHydraulicConfiguration(configuration, 'committed')
    return this.hydraulicConfiguration
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

  evaluatePalletEngagement(body, forkPose) {
    const pose = body.pose || worldPose(body.object)
    const geometric = testForkPalletEngagement(forkPose, { ...body, ...pose })
    let hookEligible = true
    let hookReason = null
    if (this.engagementEligibility) {
      const verdict = this.engagementEligibility({ pallet: body, fork: forkPose, engagement: geometric })
      if (verdict === false) hookEligible = false
      else if (verdict && typeof verdict === 'object') {
        hookEligible = verdict.eligible !== false
        hookReason = verdict.reason || null
      }
    }
    const loadEligible = geometric.loadEligible && hookEligible
    return {
      ...geometric,
      eligible: geometric.geometryEligible && loadEligible,
      loadEligible,
      rejectionReason: !geometric.geometryEligible
        ? 'geometry'
        : !geometric.loadEligible
          ? 'overweight'
          : !hookEligible
            ? hookReason || 'load-ineligible'
            : null,
    }
  }

  attachPallet(body, forkPose, engagement = null) {
    if (!this.forkFrame || this.carried) return false
    const eligibility = engagement || this.evaluatePalletEngagement(body, forkPose)
    this.lastEngagement = { palletId: body.id, ...eligibility }
    if (!eligibility.eligible) return false
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
    syncPalletVisual(body)
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

  settleCarriedPallet(slot = null, placementSupport = null) {
    const body = this.carried
    if (!body) return false
    const support = slot
      ? placementSupport || evaluateRackPlacementSupport(body, slot, this.obstacles)
      : null
    if (slot && !support.eligible) return false
    const target = slot
      ? { x: slot.x, y: support.supportY, z: slot.z, yaw: slot.yaw }
      : { x: body.pose.x, y: this.floorY, z: body.pose.z, yaw: body.pose.yaw }
    setWorldPose(body.object, target)
    body.pose = worldPose(body.object)
    syncPalletVisual(body)
    body.status = slot ? 'racked' : 'floor'
    body.slotId = slot?.id || null
    body.supportY = target.y
    body.candidateForkY = null
    body.truckLocal = null
    body.obstacleCache = null
    if (slot) slot.occupiedBy = body.id
    this.carried = null
    this.onEvent({
      type: slot ? 'pallet-racked' : 'pallet-grounded',
      pallet: body,
      slot,
      supportBeamIds: support?.beamIds || [],
      severity: 'info',
    })
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
      const support = validSlot ? evaluateRackPlacementSupport(this.carried, validSlot, this.obstacles) : null
      if (validSlot && !support.eligible) return false
      return this.settleCarriedPallet(validSlot, support)
    }
    if (!slot) return this.settleCarriedPallet(null)
    const support = evaluateRackPlacementSupport(this.carried, slot, this.obstacles)
    return support.eligible ? this.settleCarriedPallet(slot, support) : false
  }

  update(dt) {
    this.stepCones(dt)
    if (!this.forkFrame) return this.snapshot()
    const fork = readForkPose(this.forkFrame, this.forkSpecification)
    const forkTop = fork.baseY + fork.thickness * .5

    if (this.carried) {
      this.lastEngagement = null
      this.syncCarriedPallet()
      const body = this.carried
      const descending = body.pose.y < body.lastBaseY - .0002
      body.wasClear ||= body.pose.y > body.originSupportY + this.forkSpecification.dropClearance
      const slot = findRackSlotPlacement({ ...body.pose, ...body }, this.rackSlots, this.forkSpecification)
      const support = slot ? evaluateRackPlacementSupport(body, slot, this.obstacles) : null
      if (body.wasClear && descending && slot && support.eligible) this.settleCarriedPallet(slot, support)
      else if (body.wasClear && descending && body.pose.y <= this.floorY + this.forkSpecification.landingTolerance) this.settleCarriedPallet(null)
      else body.lastBaseY = body.pose.y
    } else {
      let best = null
      let diagnostic = null
      for (const body of this.pallets) {
        const pose = worldPose(body.object)
        body.pose = pose
        const engagement = this.evaluatePalletEngagement(body, fork)
        if (!diagnostic || engagement.penetration > diagnostic.penetration) {
          diagnostic = { palletId: body.id, ...engagement }
        }
        if (!engagement.horizontalEligible || !engagement.loadEligible) {
          body.candidateForkY = null
          continue
        }
        const engagementForkTop = engagement.maximumForkTop ?? forkTop
        if (engagement.eligible && body.candidateForkY === null) {
          const pocketTop = pose.y + (body.pocketMax ?? DEFAULT_PALLET_SPEC.pocketMax)
          const contactTolerance = this.forkSpecification.pickupContactTolerance
            ?? DEFAULT_FORK_SPEC.pickupContactTolerance
          const minimumTravel = this.forkSpecification.pickupClearance
            ?? DEFAULT_FORK_SPEC.pickupClearance
          body.candidateForkY = Math.max(
            engagementForkTop + minimumTravel,
            pocketTop - contactTolerance,
          )
        }
        if (body.candidateForkY !== null && engagementForkTop >= body.candidateForkY - EPSILON) {
          if (!best || engagement.penetration > best.engagement.penetration) best = { body, engagement }
        }
      }
      this.lastEngagement = diagnostic
      if (best) this.attachPallet(best.body, fork, best.engagement)
    }

    this.lastForkTop = forkTop
    return this.snapshot()
  }

  snapshot() {
    return {
      carriedPalletId: this.carried?.id || null,
      carriedWeight: this.carried?.weight || 0,
      engagement: this.lastEngagement,
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
    this.hydraulicContactIds.clear()
    this.hydraulicConfiguration = null
    this.coneAccumulator = 0
    this.lastForkTop = null
    this.lastEngagement = null
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
      syncPalletVisual(body)
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
