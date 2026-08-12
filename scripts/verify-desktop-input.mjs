import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { isBellyControlActive } from '../src/sim/inputSafety.js'

const url = process.env.PROLTO_INPUT_URL || process.env.PROLTO_SMOKE_URL || 'http://127.0.0.1:4173'
const localOrigin = new URL(url).origin
const launchArgs = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-unsafe-swiftshader']
  : ['--enable-unsafe-swiftshader']
const browser = await chromium.launch({ args: launchArgs })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
await page.addInitScript(() => {
  class TestAudioNode {
    connect() { return this }
    disconnect() {}
  }
  class TestOscillator extends TestAudioNode {
    constructor() {
      super()
      this.type = 'square'
      this.frequency = { value: 0 }
      this.listeners = new Map()
    }
    addEventListener(type, listener) { this.listeners.set(type, listener) }
    start() {
      window.__proltoHornStarts = (window.__proltoHornStarts || 0) + 1
      window.__proltoHornActive = (window.__proltoHornActive || 0) + 1
    }
    stop() {
      window.__proltoHornStops = (window.__proltoHornStops || 0) + 1
      window.__proltoHornActive = Math.max(0, (window.__proltoHornActive || 0) - 1)
      this.listeners.get('ended')?.()
    }
  }
  class TestGain extends TestAudioNode {
    constructor() {
      super()
      this.gain = {
        value: .055,
        cancelScheduledValues() {},
        setValueAtTime(value) { this.value = value },
        exponentialRampToValueAtTime(value) { this.value = value },
      }
    }
  }
  class TestAudioContext {
    constructor() {
      this.currentTime = 0
      this.destination = new TestAudioNode()
      this.state = 'running'
    }
    createOscillator() { return new TestOscillator() }
    createGain() { return new TestGain() }
    async resume() { this.state = 'running' }
    async close() { this.state = 'closed' }
  }
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: TestAudioContext })
})
const externalRequests = []
const browserErrors = []
const environmentRequests = []
let modelRequestCount = 0
let releaseModel
let signalModelRequest
let delayedFirstModel = true
let failModels = false
const modelGate = new Promise((resolve) => { releaseModel = resolve })
const modelRequested = new Promise((resolve) => { signalModelRequest = resolve })

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const speed = async () => {
  const text = await page.locator('.telemetry-bar').innerText()
  const match = text.match(/Speed\s*([-\d.]+)/iu)
  return match ? Number(match[1]) : Number.NaN
}
const forkHeight = async () => {
  const text = await page.locator('.telemetry-bar').innerText()
  const match = text.match(/Fork height\s*([\d.]+)/iu)
  return match ? Number(match[1]) : Number.NaN
}
const waitFor = async (predicate, label, timeout = 5000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await delay(80)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

page.on('request', (request) => {
  const requestUrl = new URL(request.url())
  if (['http:', 'https:'].includes(requestUrl.protocol) && requestUrl.origin !== localOrigin) externalRequests.push(request.url())
  if (/\/models\/[^/?]+\.glb(?:[?#]|$)/u.test(requestUrl.href)) modelRequestCount += 1
  if (/\/env\/warehouse_1k\.hdr(?:[?#]|$)/u.test(requestUrl.href)) environmentRequests.push(requestUrl.href)
})
page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (failModels && /asset readiness failure|simulator init failed|Failed to load resource: net::ERR_FAILED/iu.test(message.text())) return
  if (message.type() === 'error' && !/X4122|cannot be represented accurately/u.test(message.text())) {
    browserErrors.push(`console: ${message.text()}`)
  }
})
await page.route(/\/models\/[^/?]+\.glb(?:[?#]|$)/u, async (route) => {
  if (failModels) {
    await route.abort('failed')
    return
  }
  if (delayedFirstModel) {
    delayedFirstModel = false
    signalModelRequest()
    await modelGate
  }
  await route.continue()
})

try {
  assert.equal(isBellyControlActive(-1), true, 'negative-scale Raymond emergency reverse must be active')
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await Promise.race([
    modelRequested,
    delay(5000).then(() => { throw new Error('Truck model request was not observed') }),
  ])

  const desktopButton = page.getByRole('button', { name: /Desktop Mode|Focus Desktop/iu })
  assert.equal(await desktopButton.isDisabled(), true, 'desktop entry must be disabled while the model is loading')
  assert.match(await page.locator('.launch-bar').innerText(), /Scene loading/iu, 'readiness must report loading truthfully')
  releaseModel()

  await waitFor(async () => !(await desktopButton.isDisabled()), 'simulator readiness', 20000)
  assert.match(await page.locator('.launch-bar').innerText(), /Scene ready/iu, 'readiness must report the ready phase')
  assert.equal(environmentRequests.length, 1, 'the required environment map must be requested once')
  assert.match(environmentRequests[0], /\?v=[a-f0-9]{12}$/u, 'the environment map request must carry its content revision')

  const initialModelRequests = modelRequestCount
  await page.getByRole('button', { name: /Reach Truck/iu }).click()
  await delay(250)
  assert.equal(modelRequestCount, initialModelRequests, 'clicking the selected family must not reload the model')
  assert.equal(await desktopButton.isDisabled(), false, 'clicking the selected family must preserve readiness')
  assert.match(await page.locator('.launch-bar').innerText(), /Scene ready/iu, 'selected-family activation must not leave a false loading state')

  await desktopButton.focus()
  await page.keyboard.press('Space')
  await waitFor(async () => page.locator('.simulator-shell').evaluate((node) => node.classList.contains('running')), 'native Space button activation')
  assert.equal(
    await page.locator('[data-testid="simulator-input-surface"]').evaluate((node) => document.activeElement === node),
    true,
    'desktop entry must focus the labeled simulator input surface',
  )

  await page.getByRole('button', { name: /Knowledge test/iu }).click()
  const knowledgeModal = page.locator('.knowledge-modal')
  const modalButtons = knowledgeModal.locator('button:not(:disabled)')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await modalButtons.last().evaluate((node) => document.activeElement === node), true, 'Shift+Tab from the dialog heading must wrap to the last enabled control')
  await page.keyboard.press('Tab')
  assert.equal(await modalButtons.first().evaluate((node) => document.activeElement === node), true, 'Tab from the final control must wrap to the first control')
  const firstAnswer = page.locator('.answer').first()
  await firstAnswer.focus()
  await page.keyboard.press('Space')
  assert.equal(await firstAnswer.evaluate((node) => node.classList.contains('selected')), true, 'Space must retain native answer-button activation')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.knowledge-modal').count(), 0, 'Escape must close the modal')
  assert.equal(await page.getByRole('button', { name: /Knowledge test/iu }).evaluate((node) => document.activeElement === node), true, 'closing the modal must restore focus')

  await page.locator('[data-testid="simulator-input-surface"]').focus()
  await page.keyboard.down('Space')
  await delay(400)
  assert.equal(await page.evaluate(() => window.__proltoHornActive), 1, 'the horn tone must continue for the full button hold')
  assert.equal(await page.evaluate(() => window.__proltoHornStops || 0), 0, 'the held horn must not stop on a fixed timer')
  await page.keyboard.up('Space')
  await waitFor(async () => (await page.evaluate(() => window.__proltoHornActive)) === 0, 'horn release cleanup')

  const candidateInput = page.getByRole('textbox', { name: 'Candidate name' })
  await candidateInput.focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('KeyW')
  assert.equal(await candidateInput.inputValue(), 'w', 'focused editable content must receive keyboard input')
  await delay(350)
  assert.equal(await speed(), 0, 'focused evaluator UI must not operate the vehicle')

  await desktopButton.focus()
  await page.keyboard.press('Space')
  await waitFor(
    async () => page.locator('[data-testid="simulator-input-surface"]').evaluate((node) => document.activeElement === node),
    'desktop simulator refocus',
  )
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyW')
  await waitFor(async () => (await speed()) > .2, 'vehicle motion before blur', 5000)
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await waitFor(async () => (await speed()) === 0, 'vehicle release after blur', 5000)
  assert.match(await page.locator('.machine-status i').innerText(), /Presence released/iu, 'blur must release presence')
  await page.keyboard.up('KeyW')
  await page.keyboard.up('ShiftLeft')

  await desktopButton.focus()
  await page.keyboard.press('Space')
  await waitFor(
    async () => page.locator('[data-testid="simulator-input-surface"]').evaluate((node) => document.activeElement === node),
    'desktop simulator refocus before reset',
  )
  await page.keyboard.down('ShiftLeft')
  await page.keyboard.down('KeyE')
  await waitFor(async () => (await forkHeight()) > 2, 'fork motion before reset', 5000)
  await page.keyboard.up('KeyE')
  await page.keyboard.up('ShiftLeft')
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Restart current candidate assessment and exit VR' }).click()
  assert.equal((await forkHeight()) > 2, true, 'cancelling the destructive restart must preserve assessment state')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Restart current candidate assessment and exit VR' }).click()
  await waitFor(async () => (await forkHeight()) === 0, 'fork reset', 5000)
  assert.equal(await page.locator('.simulator-shell').evaluate((node) => node.classList.contains('running')), false, 'assessment reset must stop desktop operation')

  failModels = true
  await page.getByRole('button', { name: /Order Picker/iu }).click()
  await waitFor(async () => /Scene failed/iu.test(await page.locator('.launch-bar').innerText()), 'failed readiness state', 5000)
  assert.equal(await desktopButton.isDisabled(), true, 'desktop entry must remain disabled after initialization failure')
  assert.match(await page.locator('.start-overlay').innerText(), /Simulator unavailable/iu, 'the in-scene fallback must expose initialization failure')
  assert.equal(await page.locator('.readiness-error').count(), 1, 'failed readiness must expose a sanitized error')

  failModels = false
  await page.getByRole('button', { name: /Retry simulator/iu }).click()
  await waitFor(async () => !(await desktopButton.isDisabled()), 'simulator retry readiness', 20000)
  assert.match(await page.locator('.launch-bar').innerText(), /Scene ready/iu, 'retry must recover a failed simulator')

  const contextLossSupported = await page.locator('canvas').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
    const extension = gl?.getExtension('WEBGL_lose_context')
    if (!extension) return false
    window.__proltoContextLossExtension = extension
    extension.loseContext()
    return true
  })
  if (contextLossSupported) {
    await waitFor(async () => /Scene failed/iu.test(await page.locator('.launch-bar').innerText()), 'graphics context loss state', 5000)
    assert.match(await page.locator('.readiness-error').innerText(), /graphics device reset/iu, 'context loss must be surfaced truthfully')
    await page.evaluate(() => window.__proltoContextLossExtension.restoreContext())
    await waitFor(async () => !(await desktopButton.isDisabled()), 'graphics context restoration', 20000)
  }

  assert.deepEqual(externalRequests, [], `external runtime requests observed: ${externalRequests.join(', ')}`)
  assert.deepEqual(browserErrors, [], `browser errors observed: ${browserErrors.join(' | ')}`)
  console.log('Desktop input, modal focus trap, held horn, confirmed reset, loading/ready/failure/retry/context recovery, blur fail-safe, native Space, UI isolation, versioned assets, and same-origin runtime request checks passed')
} catch (error) {
  releaseModel()
  mkdirSync('output/playwright', { recursive: true })
  await page.screenshot({ path: 'output/playwright/desktop-input-failure.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser.close()
}
