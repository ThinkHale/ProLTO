// Verify the production wheel binder against every shipped truck GLB.
//   node scripts/verify-wheel-articulation.mjs
import { readFileSync } from 'node:fs'
import * as THREE from 'three'

const stubContext = new Proxy({}, { get: () => () => {} })
globalThis.document = globalThis.document || {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubContext }),
}
globalThis.self = globalThis.self || globalThis

const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
const { __mapRigForTest } = await import('../src/sim/vehicleFactory.js')
const { getEquipment } = await import('../src/data/equipment.js')

const EXPECT = {
  crown_pe4500: {
    profile: getEquipment('Crown', 'pallet'),
    roles: { 'drive-steer': 1, load: 4 },
    radii: { 'drive-steer': .125, load: .034 },
  },
  crown_rr5725: {
    profile: getEquipment('Crown', 'reach'),
    roles: { 'drive-steer': 1, load: 4 },
    radii: { 'drive-steer': .1715, load: .0635 },
  },
  crown_sc6200: {
    profile: getEquipment('Crown', 'counterbalance'),
    roles: { 'front-drive': 2, 'rear-steer': 2 },
    radii: { 'front-drive': .2285, 'rear-steer': .1905 },
  },
  crown_sp1500: {
    profile: getEquipment('Crown', 'order-picker'),
    roles: { 'drive-steer': 1, load: 2 },
    radii: { 'drive-steer': .16, load: .0635 },
  },
  raymond_4460: {
    profile: getEquipment('Raymond', 'counterbalance'),
    roles: { 'front-drive': 2, 'rear-steer': 1 },
    radii: { 'front-drive': .2285, 'rear-steer': .175 },
  },
  raymond_5300: {
    profile: getEquipment('Raymond', 'order-picker'),
    roles: { 'drive-steer': 1, load: 2 },
    radii: { 'drive-steer': .16, load: .0635 },
  },
  raymond_7500: {
    profile: getEquipment('Raymond', 'reach'),
    roles: { 'drive-steer': 1, load: 4 },
    radii: { 'drive-steer': .1715, load: .0635 },
  },
  raymond_8210: {
    profile: getEquipment('Raymond', 'pallet'),
    roles: { 'drive-steer': 1, load: 4 },
    radii: { 'drive-steer': .127, load: .041 },
  },
}

const loader = new GLTFLoader()
const EPSILON = 1e-5
const RADIUS_EPSILON = 1e-4
const DISTANCE = .071
const STEER_ANGLE = .32

function parse(path) {
  const buffer = readFileSync(path)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  return new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject))
}

function close(left, right, epsilon = EPSILON) {
  return Math.abs(left - right) <= epsilon
}

function vectorClose(left, right, epsilon = EPSILON) {
  return left.distanceTo(right) <= epsilon
}

function quaternionClose(left, right, epsilon = EPSILON) {
  return 1 - Math.abs(left.dot(right)) <= epsilon
}

function vector(values) {
  return new THREE.Vector3(...values)
}

function radialAxis(axleAxis) {
  return axleAxis === 'x' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
}

function wrapAngle(angle) {
  return THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI
}

let failed = 0
for (const [assetId, expected] of Object.entries(EXPECT)) {
  const problems = []
  try {
    const gltf = await parse(`public/models/${assetId}.glb`)
    const rig = __mapRigForTest(gltf.scene, expected.profile)
    const articulation = rig.wheelArticulation
    if (!articulation?.bindings?.length) throw new Error('production mapper did not create wheelArticulation')

    const roleCounts = {}
    const rests = new Map()
    articulation.bindings.forEach((binding) => {
      roleCounts[binding.role] = (roleCounts[binding.role] || 0) + 1
      if (binding.axleAxis !== 'y') problems.push(`${binding.name} inferred ${binding.axleAxis}, expected current export axle y`)
      if (!close(binding.radius, expected.radii[binding.role], RADIUS_EPSILON)) {
        problems.push(`${binding.name} radius ${binding.radius.toFixed(5)} m, expected ${expected.radii[binding.role].toFixed(5)} m`)
      }
      if (binding.spinSign !== 1) problems.push(`${binding.name} forward spin sign ${binding.spinSign}, expected +1`)
      if (!vectorClose(vector(binding.parentAxle), new THREE.Vector3(1, 0, 0))) {
        problems.push(`${binding.name} parent axle is not vehicle +X`)
      }
      if (!vectorClose(vector(binding.steeringAxis), new THREE.Vector3(0, 1, 0))) {
        problems.push(`${binding.name} steering axis is not vehicle +Y`)
      }
      rests.set(binding.name, {
        quaternion: binding.wheel.quaternion.clone(),
        position: binding.wheel.position.clone(),
        scale: binding.wheel.scale.clone(),
      })
    })
    Object.entries(expected.roles).forEach(([role, count]) => {
      if (roleCounts[role] !== count) problems.push(`${role} count ${roleCounts[role] || 0}, expected ${count}`)
    })
    Object.keys(roleCounts).forEach((role) => {
      if (!(role in expected.roles)) problems.push(`unexpected role ${role}`)
    })

    articulation.update({ distanceMeters: DISTANCE, steerAngle: STEER_ANGLE })
    articulation.bindings.forEach((binding) => {
      const rest = rests.get(binding.name)
      const expectedSpin = binding.spinSign * DISTANCE / binding.radius
      const expectedSteer = binding.steered ? -STEER_ANGLE : 0
      if (!close(binding.spinAngle, expectedSpin)) problems.push(`${binding.name} spin angle did not use its measured radius`)
      if (!close(binding.steeringAngle, expectedSteer)) problems.push(`${binding.name} steering role was applied incorrectly`)
      if (!vectorClose(binding.wheel.position, rest.position) || !vectorClose(binding.wheel.scale, rest.scale)) {
        problems.push(`${binding.name} rolling changed its authored position or scale`)
      }

      const localAxle = vector(binding.localAxle)
      const actualAxle = localAxle.clone().applyQuaternion(binding.wheel.quaternion).normalize()
      const expectedAxle = vector(binding.parentAxle)
        .applyAxisAngle(vector(binding.steeringAxis), expectedSteer)
        .normalize()
      if (!vectorClose(actualAxle, expectedAxle)) problems.push(`${binding.name} did not steer about vehicle up`)

      const localRadial = radialAxis(binding.axleAxis)
      const actualRadial = localRadial.clone().applyQuaternion(binding.wheel.quaternion).normalize()
      const expectedRadial = localRadial
        .clone()
        .applyAxisAngle(localAxle, expectedSpin)
        .applyQuaternion(rest.quaternion)
        .applyAxisAngle(vector(binding.steeringAxis), expectedSteer)
        .normalize()
      if (!vectorClose(actualRadial, expectedRadial)) problems.push(`${binding.name} did not roll about its inferred axle`)
    })

    articulation.update({ distanceMeters: -DISTANCE, steerAngle: -STEER_ANGLE })
    articulation.bindings.forEach((binding) => {
      if (!close(binding.spinAngle, 0)) problems.push(`${binding.name} forward/reverse rolling did not cancel`)
      const expectedSteer = binding.steered ? STEER_ANGLE : 0
      if (!close(binding.steeringAngle, expectedSteer)) problems.push(`${binding.name} reverse steering state is wrong`)
    })

    articulation.reset()
    articulation.bindings.forEach((binding) => {
      if (!quaternionClose(binding.wheel.quaternion, rests.get(binding.name).quaternion)) {
        problems.push(`${binding.name} reset did not restore its authored quaternion`)
      }
    })

    const fromPose = { x: 0, z: 0, heading: 0 }
    const toPose = { x: .012, z: -.12, heading: -.06 }
    articulation.update({ fromPose, toPose, steerAngle: STEER_ANGLE })
    articulation.bindings.forEach((binding) => {
      const expectedSpin = wrapAngle(binding.spinSign * binding.lastDistanceMeters / binding.radius)
      if (!Number.isFinite(binding.lastDistanceMeters)) problems.push(`${binding.name} pose-projected distance is not finite`)
      if (!close(binding.spinAngle, expectedSpin)) problems.push(`${binding.name} pose travel did not drive measured-radius roll`)
    })
    const pairedRole = expected.roles.load ? 'load' : 'front-drive'
    const pairedWheels = articulation.bindings
      .filter((binding) => binding.role === pairedRole)
      .sort((left, right) => left.rootCenter[0] - right.rootCenter[0])
    if (pairedWheels.length < 2) {
      problems.push(`${pairedRole} has no inner/outer pair for the turn regression`)
    } else {
      const inside = pairedWheels[0]
      const outside = pairedWheels[pairedWheels.length - 1]
      if (Math.abs(inside.lastDistanceMeters - outside.lastDistanceMeters) < .005) {
        problems.push(`${pairedRole} inner and outer wheels used the same turn distance`)
      }
    }
    articulation.reset()

    try {
      articulation.update({ distanceMeters: Number.NaN, steerAngle: 0 })
      problems.push('non-finite distance did not fail')
    } catch (error) {
      if (!(error instanceof TypeError)) problems.push(`non-finite distance raised ${error.name}, expected TypeError`)
    }
    try {
      articulation.update({ fromPose, steerAngle: 0 })
      problems.push('incomplete pose pair did not fail')
    } catch (error) {
      if (!(error instanceof TypeError)) problems.push(`incomplete pose pair raised ${error.name}, expected TypeError`)
    }

    if (problems.length) {
      console.log(`FAIL ${assetId}: ${problems.join('; ')}`)
      failed += 1
    } else {
      console.log(`PASS ${assetId.padEnd(16)} ${articulation.bindings.length} wheels, measured rolling and steering`)
    }
  } catch (error) {
    console.log(`FAIL ${assetId}: ${error.stack || error.message || error}`)
    failed += 1
  }
}

const simulatorSource = readFileSync(new URL('../src/components/Simulator.jsx', import.meta.url), 'utf8')
const integrationProblems = []
if (!/wheelArticulation\?\.update\(\{[\s\S]*?fromPose:\s*previousPose,[\s\S]*?toPose:\s*collision\.pose,[\s\S]*?steerAngle:\s*state\.steerAngle/.test(simulatorSource)) {
  integrationProblems.push('Simulator does not animate wheels from the accepted collision pose')
}
if (!/wheelArticulation\?\.reset\(\)/.test(simulatorSource)) {
  integrationProblems.push('Simulator reset does not restore authored wheel transforms')
}
if (/driveWheel\.rotation|loadWheel\.rotation/.test(simulatorSource)) {
  integrationProblems.push('Simulator still contains hard-coded wheel rotation')
}
if (integrationProblems.length) {
  console.log(`FAIL Simulator wheel integration: ${integrationProblems.join('; ')}`)
  failed += 1
} else {
  console.log('PASS Simulator uses accepted-pose wheel articulation and reset')
}

if (failed) {
  console.error(`\n${failed} wheel articulation verification${failed === 1 ? '' : 's'} failed`)
  process.exit(1)
}

console.log('\nWheel geometry, roles, steering, rolling, and reset passed for all eight GLBs')
