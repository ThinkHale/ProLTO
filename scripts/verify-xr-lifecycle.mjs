import assert from 'node:assert/strict'
import {
  assertXRSessionActive,
  finishXRStartup,
  hasLocalFloorReferenceSpace,
  releaseRemovedXRInputSources,
  requestImmersiveSessionWithFallback,
  XR_SESSION_CONFIGURATIONS,
  xrOriginHeight,
} from '../src/sim/xrLifecycle.js'

const attempts = []
const acceptedSession = { id: 'session', requestReferenceSpace: async () => ({}) }
const fallback = await requestImmersiveSessionWithFallback(
  {
    async requestSession(mode, configuration) {
      attempts.push({ mode, configuration })
      if (attempts.length < 3) throw Object.assign(new Error('unsupported option set'), { name: 'NotSupportedError' })
      return acceptedSession
    },
  },
  async () => {},
)
assert.equal(fallback.session, acceptedSession, 'the bare immersive request must remain available after optional-feature refusals')
assert.deepEqual(attempts.map(({ configuration }) => configuration), XR_SESSION_CONFIGURATIONS)
assert.equal(attempts.every(({ mode }) => mode === 'immersive-vr'), true)

let ended = 0
await assert.rejects(
  requestImmersiveSessionWithFallback(
    { requestSession: async () => ({ end: async () => { ended += 1 } }) },
    async (session) => {
      if (!session) return
      await session.end()
      throw Object.assign(new Error('cancelled'), { name: 'AbortError' })
    },
  ),
  (error) => error.name === 'AbortError',
)
assert.equal(ended, 1, 'a session accepted after cancellation must be ended')

assert.equal(await hasLocalFloorReferenceSpace(acceptedSession), true)
assert.equal(await hasLocalFloorReferenceSpace({ requestReferenceSpace: async () => { throw new Error('no floor') } }), false)
assert.equal(xrOriginHeight(.24, true, 1.66), .24, 'floor tracking must use the authored compartment floor origin')
assert.equal(xrOriginHeight(.24, false, 1.66), 1.9, 'local-space fallback height must be applied to the XR origin')
assert.doesNotThrow(() => assertXRSessionActive(acceptedSession, acceptedSession))
assert.throws(
  () => assertXRSessionActive(null, acceptedSession),
  (error) => error.name === 'AbortError' && /ended before startup completed/u.test(error.message),
  'an end event during renderer session attachment must cancel XR startup',
)
let markedRunning = 0
finishXRStartup(acceptedSession, acceptedSession, () => { markedRunning += 1 })
assert.equal(markedRunning, 1, 'an active session may transition to running exactly once')
assert.throws(() => finishXRStartup(null, acceptedSession, () => { markedRunning += 1 }), { name: 'AbortError' })
assert.equal(markedRunning, 1, 'an ended session must not be marked running')

const sourceA = { id: 'a' }
const sourceB = { id: 'b' }
const controllerA = { id: 'controller-a' }
const controllerB = { id: 'controller-b' }
const state = {
  xrDrags: new Map([
    [controllerA, { source: sourceA }],
    [controllerB, { source: sourceB }],
  ]),
  squeezePresenceSources: new Set([sourceA, sourceB]),
  utilityButtons: new Map([[sourceA, {}], [sourceB, {}]]),
}
const released = []
const removedCount = releaseRemovedXRInputSources(state, [sourceA], (controller) => {
  released.push(controller)
  state.xrDrags.delete(controller)
})
assert.equal(removedCount, 1)
assert.deepEqual(released, [controllerA])
assert.equal(state.xrDrags.has(controllerB), true, 'unrelated controller state must survive an input-source removal')
assert.equal(state.squeezePresenceSources.has(sourceA), false)
assert.equal(state.squeezePresenceSources.has(sourceB), true)
assert.equal(state.utilityButtons.has(sourceA), false)
assert.equal(state.utilityButtons.has(sourceB), true)

console.log('PASS XR lifecycle: request fallback, cancellation, floor fallback, origin height, and input-source cleanup')
