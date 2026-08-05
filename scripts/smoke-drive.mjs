// Runtime smoke test: load every profile, drive it, and assert the new steering,
// stability, and surfacing wiring runs in a real WebGL context without throwing.
// The kinematics MATH is proven by scripts/verify-dynamics.mjs; this proves the
// wiring, the shader compile, and that the scene stays alive under input.
import { chromium } from 'playwright'

const FAMILY_LABEL = {
  reach: 'Reach Truck',
  'order-picker': 'Order Picker',
  pallet: 'Pallet Truck',
  counterbalance: 'Sit-down Counterbalance',
}
const url = 'http://localhost:4173'
const outDir = process.argv[2] || '.'
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader'] })
let failures = 0

const readTelemetry = async (page) => {
  const text = await page.locator('.telemetry-bar').innerText()
  const number = (label) => {
    const match = text.match(new RegExp(`${label}\\s*([-\\d.,]+)`, 'i'))
    return match ? Number(match[1].replace(/,/g, '')) : null
  }
  return { speed: number('Speed'), fork: number('Fork height'), load: number('Load'), stability: number('Stability') }
}

for (const [family, manufacturer] of [
  ['counterbalance', 'Crown'], ['counterbalance', 'Raymond'],
  ['reach', 'Crown'], ['reach', 'Raymond'],
  ['pallet', 'Crown'], ['pallet', 'Raymond'],
  ['order-picker', 'Crown'], ['order-picker', 'Raymond'],
]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (/X4122|cannot be represented accurately/.test(text)) return // benign ANGLE/HLSL notes
    errors.push(text)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: FAMILY_LABEL[family] }).click()
  await page.locator('.manufacturer-select select').selectOption(manufacturer)
  await page.waitForTimeout(3200)
  await page.getByRole('button', { name: 'Enter operator station' }).click()
  await page.waitForTimeout(400)

  const idle = await readTelemetry(page)

  await page.keyboard.down('ControlLeft')   // operator presence
  await page.waitForTimeout(150)
  // Drive straight at the training pallet sitting square in the aisle ahead.
  // Fork travel now bottoms out with the blades on the floor and the pallet is
  // oriented for a head-on approach, so this should engage without maneuvering.
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
  await page.keyboard.up('ControlLeft')

  await page.locator('.simulator-shell').screenshot({ path: `${outDir}/${manufacturer.toLowerCase()}-${family}.png` })

  const drove = rolling.speed > .4
  const engaged = picked.load > 0
  const stabilitySane = [idle, rolling, turning, lifted].every((t) => t.stability >= 0 && t.stability <= 100)
  const ok = drove && engaged && stabilitySane && errors.length === 0
  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS ' : 'FAIL '} ${manufacturer.padEnd(8)} ${family.padEnd(15)} ` +
    `speed=${rolling.speed}mph load=${picked.load}lb fork=${lifted.fork}in ` +
    `stability idle=${idle.stability}% turning=${turning.stability}% lifted=${lifted.stability}%` +
    `${engaged ? '' : '  <-- NO PICKUP'}` +
    (errors.length ? `\n      ERRORS: ${errors.slice(0, 3).join(' | ')}` : ''),
  )
  await page.close()
}

await browser.close()
console.log(failures ? `\n${failures} profile(s) FAILED` : '\nAll 8 profiles drove, lifted, and rendered cleanly')
process.exit(failures ? 1 : 0)
