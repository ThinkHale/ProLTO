// Capture every equipment profile's operator station from the running app.
//   node scripts/capture-fleet.mjs [--url http://localhost:5173] [--outdir qa/app]
// One browser, one page: the scene rebuilds on each profile change, so this is
// much faster than eight separate runs and keeps framing consistent.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { getEquipment } from '../src/data/equipment.js'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, index, all) => {
    if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : 'true'])
    return pairs
  }, []),
)

const url = args.url || 'http://localhost:5173'
const outdir = args.outdir || 'qa/app'
const PROFILES = [
  ['reach', 'Reach Truck', 'Crown'], ['reach', 'Reach Truck', 'Raymond'],
  ['order-picker', 'Order Picker', 'Crown'], ['order-picker', 'Order Picker', 'Raymond'],
  ['pallet', 'Pallet Truck', 'Crown'], ['pallet', 'Pallet Truck', 'Raymond'],
  ['counterbalance', 'Sit-down Counterbalance', 'Crown'], ['counterbalance', 'Sit-down Counterbalance', 'Raymond'],
]
const ASSET_OR_INIT_FAILURE = /procedural fallback|MODEL_(?:LOAD|PARSE|PROFILE|IDENTITY|RIG)|asset readiness failure|simulator init failed/iu
const isTruckModelRequest = (requestUrl) => /\/models\/(?:crown|raymond)_[^/?]+\.glb(?:[?#]|$)/iu.test(requestUrl)

await mkdir(outdir, { recursive: true })
const launchArgs = process.platform === 'win32'
  ? ['--use-angle=d3d11', '--enable-unsafe-swiftshader']
  : ['--enable-unsafe-swiftshader']
const browser = await chromium.launch({ args: launchArgs })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.setDefaultTimeout(20000)
const failures = []
const recordFailure = (kind, detail) => failures.push(`${kind}: ${detail}`)
page.on('dialog', async (dialog) => {
  if (!/Switch (?:equipment|manufacturer)\?/u.test(dialog.message())) {
    recordFailure('unexpected dialog', dialog.message())
    await dialog.dismiss()
    return
  }
  await dialog.accept()
})
page.on('console', (message) => {
  const text = message.text()
  if (message.type() === 'error' || ASSET_OR_INIT_FAILURE.test(text)) {
    recordFailure(`console ${message.type()}`, text)
  }
})
page.on('pageerror', (error) => recordFailure('pageerror', error.message))
page.on('requestfailed', (request) => {
  if (isTruckModelRequest(request.url())) {
    recordFailure('model request failed', `${request.url()} (${request.failure()?.errorText || 'unknown error'})`)
  }
})
page.on('response', (response) => {
  if (isTruckModelRequest(response.url()) && !response.ok()) {
    recordFailure('model response failed', `${response.status()} ${response.url()}`)
  }
})
await page.goto(url, { waitUntil: 'networkidle' })

for (const [family, label, manufacturer] of PROFILES) {
  const profile = getEquipment(manufacturer, family)
  await page.getByRole('button', { name: label }).click()
  await page.locator('.manufacturer-select select').selectOption(manufacturer)
  await page.waitForFunction(
    (expected) => document.querySelector('.sim-topbar span:nth-child(2)')?.textContent?.trim() === expected,
    `${manufacturer} ${profile.model}`,
  )
  const start = page.getByRole('button', { name: /Desktop Mode|Focus Desktop/iu })
  await start.click()
  await page.waitForFunction(
    () => document.activeElement?.getAttribute('data-testid') === 'simulator-input-surface',
  )
  await page.waitForTimeout(250)
  const name = `${manufacturer.toLowerCase()}-${family}`
  await page.locator('.simulator-shell').screenshot({ path: `${outdir}/${name}-cab.png` })
  console.log(`CAPTURED ${outdir}/${name}-cab.png`)
}

await browser.close()
if (failures.length) {
  console.log('\nPAGE ISSUES:')
  for (const failure of [...new Set(failures)]) console.log(' -', failure)
}
process.exit(failures.length ? 1 : 0)
