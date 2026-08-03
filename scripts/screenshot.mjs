// In-app screenshot harness: drives the running dev/preview server and captures
// the simulator canvas for a given equipment profile.
//   node scripts/screenshot.mjs --family reach --manufacturer Crown --out qa/app/crown-reach.png \
//        [--url http://localhost:5173] [--enter] [--hold KeyE:1200] [--look -200,60]
import { chromium } from 'playwright'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, index, all) => {
    if (token.startsWith('--')) pairs.push([token.slice(2), all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : 'true'])
    return pairs
  }, []),
)

const FAMILY_LABEL = {
  reach: 'Reach Truck',
  'order-picker': 'Order Picker',
  pallet: 'Pallet Truck',
  counterbalance: 'Sit-down Counterbalance',
}

const url = args.url || 'http://localhost:5173'
const family = args.family || 'reach'
const manufacturer = args.manufacturer || 'Crown'
const out = args.out || `qa/app/${manufacturer.toLowerCase()}-${family}.png`

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') console.log('[page]', message.text()) })
await page.goto(url, { waitUntil: 'networkidle' })

await page.getByRole('button', { name: FAMILY_LABEL[family] }).click()
await page.locator('.manufacturer-select select').selectOption(manufacturer)
await page.waitForTimeout(3500) // GLB + HDRI load

if (args.enter) {
  await page.getByRole('button', { name: 'Enter operator station' }).click()
  await page.waitForTimeout(600)
}
if (args.hold) {
  for (const spec of args.hold.split(',')) {
    const [code, ms] = spec.split(':')
    await page.keyboard.down(code)
    await page.waitForTimeout(Number(ms || 800))
    await page.keyboard.up(code)
  }
  await page.waitForTimeout(400)
}
if (args.look) {
  const canvas = page.locator('.simulator-canvas canvas')
  const box = await canvas.boundingBox()
  const [dx, dy] = args.look.split(',').map(Number)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(cx + dx, cy + dy, { steps: 12 })
  await page.mouse.up({ button: 'right' })
  await page.waitForTimeout(300)
}

const target = args.full ? page : page.locator('.simulator-shell')
await target.screenshot({ path: out })
console.log(`SCREENSHOT ${out}`)
await browser.close()
