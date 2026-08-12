// Exercise production vehicle loading against real GLBs, including the failure
// path. A broken or mismatched replica must never turn into a procedural truck
// unless a developer opts in explicitly while running a development build.
//   node scripts/verify-vehicle-loading.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { equipmentProfiles } from '../src/data/equipment.js'
import { MODEL_CONTRACTS } from '../src/data/modelContracts.js'
import { fetchArrayBuffer } from '../src/sim/assetFetch.js'

const stubContext = new Proxy({}, { get: () => () => {} })
globalThis.document = globalThis.document || {
  createElement: () => ({ width: 0, height: 0, getContext: () => stubContext }),
}
globalThis.self = globalThis.self || globalThis

const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
const {
  __allowsProceduralFallbackForTest,
  __loadVehicleRigForTest,
} = await import('../src/sim/vehicleFactory.js')

const loader = new GLTFLoader()

function parse(assetId) {
  const buffer = readFileSync(`public/models/${assetId}.glb`)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  return new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject))
}

async function withExpectedConsole(method, callback) {
  const original = console[method]
  console[method] = () => {}
  try {
    return await callback()
  } finally {
    console[method] = original
  }
}

const productionEnv = { DEV: false, BASE_URL: '/' }
const crownReach = equipmentProfiles['Crown:reach']
const valid = await parse(crownReach.assetId)
const rig = await __loadVehicleRigForTest(crownReach, {
  env: productionEnv,
  loadAsset: async (url) => {
    assert.equal(url, `/models/${crownReach.assetId}.glb?v=${MODEL_CONTRACTS[crownReach.assetId].contentRevision}`)
    return valid
  },
})
assert.equal(rig.assetSource, 'gltf')
assert.deepEqual(rig.assetIdentity, {
  assetId: crownReach.assetId,
  assetSpec: crownReach.assetSpec,
  configurationId: null,
  validationStatus: 'reference-only-unverified',
})

await withExpectedConsole('error', async () => {
  await assert.rejects(
    __loadVehicleRigForTest(
      { ...crownReach, assetSpec: 'Wrong truck identity' },
      { env: productionEnv, loadAsset: async () => parse(crownReach.assetId) },
    ),
    (error) => error?.code === 'MODEL_IDENTITY_MISMATCH' && /expected "Wrong truck identity"/u.test(error.message),
  )
})

await withExpectedConsole('error', async () => {
  await assert.rejects(
    __loadVehicleRigForTest(crownReach, {
      env: productionEnv,
      loadAsset: async () => {
        const gltf = await parse(crownReach.assetId)
        gltf.scene.getObjectByName('rig_carriage').name = 'broken_carriage'
        return gltf
      },
    }),
    (error) => error?.code === 'MODEL_RIG_INVALID' && /rig_carriage/u.test(error.message),
  )
})

await withExpectedConsole('error', async () => {
  await assert.rejects(
    __loadVehicleRigForTest(crownReach, {
      env: productionEnv,
      loadAsset: async () => { throw new Error('synthetic network failure') },
    }),
    (error) => error?.code === 'MODEL_LOAD_FAILED' && /synthetic network failure/u.test(error.message),
  )
})

assert.equal(__allowsProceduralFallbackForTest({ DEV: false, VITE_ALLOW_PROCEDURAL_FALLBACK: 'true' }), false)
assert.equal(__allowsProceduralFallbackForTest({ DEV: true, VITE_ALLOW_PROCEDURAL_FALLBACK: 'false' }), false)
assert.equal(__allowsProceduralFallbackForTest({ DEV: true, VITE_ALLOW_PROCEDURAL_FALLBACK: 'true' }), true)

const fallback = await withExpectedConsole('warn', () => __loadVehicleRigForTest(crownReach, {
  env: { DEV: true, VITE_ALLOW_PROCEDURAL_FALLBACK: 'true', BASE_URL: '/' },
  loadAsset: async () => { throw new Error('synthetic development failure') },
}))
assert.equal(fallback.assetSource, 'procedural-development')
assert.equal(fallback.assetIdentity.validationStatus, 'development-fallback')
assert.equal(fallback.assetIdentity.fallbackCause, 'MODEL_LOAD_FAILED')

await assert.rejects(
  fetchArrayBuffer('/models/stalled.glb', {
    timeoutMs: 10,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
  }),
  /timed out after 10 ms/u,
)

console.log('PASS vehicle loading: versioned GLB accepted, mismatch and missing rig rejected, timeout fails closed, development fallback requires explicit opt-in')
