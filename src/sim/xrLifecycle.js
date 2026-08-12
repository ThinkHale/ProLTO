export const XR_SESSION_CONFIGURATIONS = Object.freeze([
  Object.freeze({ optionalFeatures: Object.freeze(['local-floor', 'bounded-floor', 'hand-tracking']) }),
  Object.freeze({ optionalFeatures: Object.freeze(['local-floor']) }),
  Object.freeze({}),
])

export async function requestImmersiveSessionWithFallback(xr, assertActive, onRefusal = () => {}) {
  let refusal = null
  for (const configuration of XR_SESSION_CONFIGURATIONS) {
    await assertActive()
    try {
      const session = await xr.requestSession('immersive-vr', configuration)
      await assertActive(session)
      return { session, configuration, refusal }
    } catch (error) {
      if (error.name === 'AbortError') throw error
      refusal = error
      onRefusal(configuration, error)
    }
  }
  await assertActive()
  return { session: null, configuration: null, refusal }
}

export async function hasLocalFloorReferenceSpace(session) {
  try {
    await session.requestReferenceSpace('local-floor')
    return true
  } catch {
    return false
  }
}

export function xrOriginHeight(baseHeight, floorTracked, fallbackEyeHeight) {
  return baseHeight + (floorTracked ? 0 : fallbackEyeHeight)
}

export function assertXRSessionActive(activeSession, expectedSession) {
  if (activeSession === expectedSession) return
  const error = new Error('XR session ended before startup completed')
  error.name = 'AbortError'
  throw error
}

export function finishXRStartup(activeSession, expectedSession, markRunning) {
  assertXRSessionActive(activeSession, expectedSession)
  markRunning()
}

export function releaseRemovedXRInputSources(state, removedSources, endInteraction) {
  const removed = new Set(removedSources || [])
  state.xrDrags.forEach((drag, controller) => {
    if (removed.has(drag.source)) endInteraction(controller)
  })
  removed.forEach((source) => state.squeezePresenceSources.delete(source))
  state.utilityButtons.forEach((_value, source) => {
    if (removed.has(source)) state.utilityButtons.delete(source)
  })
  return removed.size
}
