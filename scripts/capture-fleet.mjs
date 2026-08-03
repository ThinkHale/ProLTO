// Capture every equipment profile's operator station from the running app.
//   node scripts/capture-fleet.mjs [--url http://localhost:5173] [--outdir qa/app]
// One browser, one page: the scene rebuilds on each profile change, so this is
// much faster than eight separate runs and keeps framing consistent.
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

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

await mkdir(outdir, { recursive: true })
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const failures = []
page.on('console', (message) => {
  const text = message.text()
  if (text.includes('falling back') || message.type() === 'error') failures.push(text)
})
await page.goto(url, { waitUntil: 'networkidle' })

for (const [family, label, manufacturer] of PROFILES) {
  await page.getByRole('button', { name: label }).click()
  await page.locator('.manufacturer-select select').selectOption(manufacturer)
  await page.waitForTimeout(3800)
  const start = page.getByRole('button', { name: 'Enter operator station' })
  if (await start.isVisible().catch(() => false)) await start.click()
  await page.waitForTimeout(900)
  const name = `${manufacturer.toLowerCase()}-${family}`
  await page.locator('.simulator-shell').screenshot({ path: `${outdir}/${name}-cab.png` })
  console.log(`CAPTURED ${outdir}/${name}-cab.png`)
}

await browser.close()
if (failures.length) {
  console.log('\nPAGE ISSUES:')
  for (const failure of [...new Set(failures)]) console.log(' -', failure)
}
