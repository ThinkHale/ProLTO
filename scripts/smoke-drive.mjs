// Runtime smoke test: load every profile, drive, turn, lift, pick a load, and
// assert that stability and surfacing wiring run in a real WebGL context without
// throwing. Pixel fidelity still requires the separate visual acceptance pass.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { getEquipment } from '../src/data/equipment.js'

const FAMILY_LABEL = {
  reach: 'Reach Truck',
  'order-picker': 'Order Picker',
  pallet: 'Pallet Truck',
  counterbalance: 'Sit-down Counterbalance',
}
const url = process.env.PROLTO_SMOKE_URL || 'http://127.0.0.1:4173'
const outDir = process.env.PROLTO_SMOKE_OUTPUT || process.argv[2] || '.'
const launchArgs = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-unsafe-swiftshader']
  : ['--enable-unsafe-swiftshader']
const ASSET_OR_INIT_FAILURE = /procedural fallback|MODEL_(?:LOAD|PARSE|PROFILE|IDENTITY|RIG)|asset readiness failure|simulator init failed/iu
// One inch of blade-bottom clearance is inside the authored GMA fork openings
// for every measured fleet tine, including the 75 mm walkie blades. Waiting on
// exact telemetry makes this setup deterministic across browser frame rates.
const PRE_APPROACH_FORK_HEIGHT_IN = 1
const isTruckModelRequest = (requestUrl) => /\/models\/(?:crown|raymond)_[^/?]+\.glb(?:[?#]|$)/iu.test(requestUrl)
mkdirSync(outDir, { recursive: true })
const browser = await chromium.launch({ args: launchArgs })
let failures = 0

const readTelemetry = async (page) => {
  const telemetry = page.locator('.telemetry-bar')
  const text = await telemetry.innerText()
  const pose = await telemetry.evaluate((node) => ({
    heading: Number(node.dataset.heading),
    steerAngle: Number(node.dataset.steerAngle),
    exactFork: Number(node.dataset.forkHeight),
  }))
  const number = (label) => {
    const match = text.match(new RegExp(`${label}\\s*([-\\d.,]+)`, 'i'))
    return match ? Number(match[1].replace(/,/g, '')) : null
  }
  return { speed: number('Speed'), fork: number('Fork height'), load: number('Load'), stability: number('Stability'), ...pose }
}

for (const [family, manufacturer] of [
  ['counterbalance', 'Crown'], ['counterbalance', 'Raymond'],
  ['reach', 'Crown'], ['reach', 'Raymond'],
  ['pallet', 'Crown'], ['pallet', 'Raymond'],
  ['order-picker', 'Crown'], ['order-picker', 'Raymond'],
]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.setDefaultTimeout(20000)
  const errors = []
  let selectedModelResponses = 0
  const profile = getEquipment(manufacturer, family)
  page.on('console', (m) => {
    const text = m.text()
    if (/X4122|cannot be represented accurately/.test(text)) return // benign ANGLE/HLSL notes
    if (m.type() === 'error' || ASSET_OR_INIT_FAILURE.test(text)) errors.push(`console ${m.type()}: ${text}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (request) => {
    if (isTruckModelRequest(request.url())) {
      errors.push(`model request failed: ${request.url()} (${request.failure()?.errorText || 'unknown error'})`)
    }
  })
  page.on('response', (response) => {
    if (!isTruckModelRequest(response.url())) return
    if (!response.ok()) errors.push(`model response failed: ${response.status()} ${response.url()}`)
    else if (response.url().includes(`/models/${profile.assetId}.glb`)) selectedModelResponses += 1
  })

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: FAMILY_LABEL[family] }).click()
  await page.locator('.manufacturer-select select').selectOption(manufacturer)
  await page.waitForFunction(
    (expected) => document.querySelector('.sim-topbar span:nth-child(2)')?.textContent?.trim() === expected,
    `${manufacturer} ${profile.model}`,
  )
  const desktopButton = page.getByRole('button', { name: /Desktop Mode|Focus Desktop/iu })
  await desktopButton.click()
  const inputSurface = page.locator('[data-testid="simulator-input-surface"]')
  await inputSurface.waitFor({ state: 'visible' })
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('data-testid') === 'simulator-input-surface',
  )

  const idle = await readTelemetry(page)

  await page.keyboard.down('ShiftLeft')   // operator presence
  await page.waitForTimeout(150)
  await page.keyboard.down('KeyE')
  await page.waitForFunction(
    (minimum) => Number(document.querySelector('[data-testid="simulator-input-surface"]')?.dataset.forkHeight) >= minimum,
    PRE_APPROACH_FORK_HEIGHT_IN,
  )
  await page.keyboard.up('KeyE')
  await page.waitForTimeout(80)
  // Drive straight at the training pallet sitting square in the aisle ahead.
  // The pallet is oriented for a head-on approach and the tines have been
  // feathered into the physical GMA pocket above its bottom boards.
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(2600)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(300)
  await page.keyboard.down('KeyE')
  await page.waitForTimeout(900)
  await page.keyboard.up('KeyE')
  await page.waitForTimeout(400)
  const picked = await readTelemetry(page)

  await page.keyboard.down('KeyW')          // travel
  await page.waitForTimeout(900)
  const rolling = await readTelemetry(page)
  await page.keyboard.down('KeyD')          // steer right into a turn
  await page.waitForTimeout(1200)
  const turning = await readTelemetry(page)
  await page.keyboard.up('KeyW')
  await page.keyboard.up('KeyD')
  // Lift the forks to load the stability model at height.
  await page.keyboard.down('KeyE')
  await page.waitForTimeout(1500)
  await page.keyboard.up('KeyE')
  await page.waitForTimeout(300)
  const lifted = await readTelemetry(page)
  await page.keyboard.up('ShiftLeft')

  await page.locator('.simulator-shell').screenshot({ path: `${outDir}/${manufacturer.toLowerCase()}-${family}.png` })

  const drove = rolling.speed > .4
  const headingChange = Math.abs(Math.atan2(
    Math.sin(turning.heading - rolling.heading),
    Math.cos(turning.heading - rolling.heading),
  ))
  const turned = headingChange > .005 && Math.abs(turning.steerAngle) > 1
  const engaged = picked.load > 0
  const raised = Math.max(picked.exactFork, lifted.exactFork) > idle.exactFork + 1
  const stabilitySane = [idle, rolling, turning, lifted].every((t) => t.stability >= 0 && t.stability <= 100)
  if (!selectedModelResponses) errors.push(`no successful ${profile.assetId}.glb response observed`)
  const ok = drove && turned && engaged && raised && stabilitySane && errors.length === 0
  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS ' : 'FAIL '} ${manufacturer.padEnd(8)} ${family.padEnd(15)} ` +
    `speed=${rolling.speed}mph turn=${(headingChange * 180 / Math.PI).toFixed(1)}deg load=${picked.load}lb fork=${Math.max(picked.fork, lifted.fork)}in ` +
    `stability idle=${idle.stability}% turning=${turning.stability}% lifted=${lifted.stability}%` +
    `${engaged ? '' : '  <-- NO PICKUP'}${raised ? '' : '  <-- NO LIFT'}${turned ? '' : '  <-- NO TURN'}` +
    (errors.length ? `\n      ERRORS: ${errors.slice(0, 3).join(' | ')}` : ''),
  )
  await page.close()
}

await browser.close()
console.log(failures ? `\n${failures} profile(s) FAILED` : '\nAll 8 profiles drove, turned, lifted, picked, and passed the WebGL smoke test')
process.exit(failures ? 1 : 0)
