const DEFAULT_TIMEOUT_MS = 15000

export async function fetchArrayBuffer(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error(`No fetch implementation is available for ${url}`)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError('asset timeout must be a positive finite number')

  const controller = new AbortController()
  const externalSignal = options.signal
  const abortFromExternal = () => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) abortFromExternal()
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true })
  const timeout = globalThis.setTimeout(
    () => controller.abort(new Error(`Asset request timed out after ${timeoutMs} ms`)),
    timeoutMs,
  )

  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: 'same-origin' })
    if (!response.ok) throw new Error(`Asset request failed with HTTP ${response.status} for ${url}`)
    return await response.arrayBuffer()
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error(`Asset request timed out after ${timeoutMs} ms for ${url}`, { cause: error })
    }
    throw error
  } finally {
    globalThis.clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortFromExternal)
  }
}

