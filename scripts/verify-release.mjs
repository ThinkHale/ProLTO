// Production artifact gate. This runs after Vite builds so it validates what is
// actually deployable, not only the source tree that produced it.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
const directVersions = { ...packageJson.dependencies, ...packageJson.devDependencies }

for (const [name, version] of Object.entries(directVersions)) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, `${name} must use an exact version, found ${version}`)
}
assert.match(packageJson.engines?.node || '', /^>=22\.12\.0$/, 'Node runtime floor must stay explicit')
assert.equal(packageLock.packages?.['']?.engines?.node, packageJson.engines.node, 'lockfile Node engine floor drifted')
for (const [name, version] of Object.entries(directVersions)) {
  const locked = packageLock.packages?.[`node_modules/${name}`]?.version
  assert.equal(locked, version, `${name} lockfile version ${locked} does not match ${version}`)
}

const sourceIndex = readFileSync(join(root, 'index.html'), 'utf8')
assert.match(sourceIndex, /Content-Security-Policy/i, 'index.html must ship a restrictive CSP')
assert.match(sourceIndex, /default-src 'self'/i, 'CSP must default to same-origin resources')
assert.match(sourceIndex, /object-src 'none'/i, 'CSP must block plugin objects')

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

for (const path of filesUnder(join(root, 'src'))) {
  if (!/\.(?:js|jsx|css)$/.test(path)) continue
  const source = readFileSync(path, 'utf8')
  assert.doesNotMatch(source, /https?:\/\//i, `${relative(root, path)} contains an external runtime URL`)
}

const notice = join(root, 'public', 'THIRD_PARTY_NOTICES.txt')
assert.ok(existsSync(notice), 'runtime third-party notices must ship')
for (const name of ['Inter', 'Barlow Condensed', 'three.js', 'Lucide Icons', 'Empty Warehouse 01']) {
  assert.match(readFileSync(notice, 'utf8'), new RegExp(name.replace('.', '[.]')), `notice missing ${name}`)
}

const hdr = join(root, 'public', 'env', 'warehouse_1k.hdr')
const hdrHash = createHash('sha256').update(readFileSync(hdr)).digest('hex')
assert.equal(hdrHash, '9b3d611cadc32c3a0c7e084ce5611c0650293881c4a041e7fa13748fe0dc6451', 'HDR provenance hash changed')

const modelDirectoryFiles = filesUnder(join(root, 'public', 'models'))
const sourceModels = modelDirectoryFiles.filter((path) => extname(path) === '.glb')
const unexpectedModelFiles = modelDirectoryFiles.filter((path) => (
  extname(path) !== '.glb' && !path.endsWith('truck-manifest.json')
))
assert.equal(sourceModels.length, 8, `expected 8 runtime models, found ${sourceModels.length}`)
assert.deepEqual(unexpectedModelFiles, [], 'runtime model directory contains an unexpected file')
assert.ok(sourceModels.every((path) => statSync(path).size <= 2 * 1024 * 1024), 'a truck GLB exceeds the 2 MiB transfer budget')
assert.equal(existsSync(join(root, 'public', 'models', 'facility.glb')), false, 'retired facility asset must not ship')

const dist = join(root, 'dist')
assert.ok(existsSync(join(dist, 'index.html')), 'production build output is missing')
assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), /Content-Security-Policy/i, 'production build omitted CSP')
assert.ok(existsSync(join(dist, 'THIRD_PARTY_NOTICES.txt')), 'production build omitted third-party notices')
assert.equal(existsSync(join(dist, 'models', 'facility.glb')), false, 'production build contains retired facility asset')

const artifactFiles = filesUnder(dist)
const javascript = artifactFiles.filter((path) => extname(path) === '.js')
const fonts = artifactFiles.filter((path) => /\.woff2?$/.test(path))
for (const path of javascript) {
  const source = readFileSync(path, 'utf8')
  assert.doesNotMatch(source, /(?:cdn[.]jsdelivr[.]net|@webxr-input-profiles)/i, `${relative(root, path)} contains a runtime XR CDN dependency`)
}
const total = (files) => files.reduce((sum, path) => sum + statSync(path).size, 0)
const largestJs = Math.max(0, ...javascript.map((path) => statSync(path).size))
assert.ok(largestJs <= 600 * 1024, `largest JavaScript chunk is ${(largestJs / 1024).toFixed(1)} KiB`)
assert.ok(total(javascript) <= 1024 * 1024, `JavaScript transfer budget is ${(total(javascript) / 1024).toFixed(1)} KiB`)
assert.ok(total(fonts) <= 150 * 1024, `font transfer budget is ${(total(fonts) / 1024).toFixed(1)} KiB`)
assert.ok(total(artifactFiles) <= 16 * 1024 * 1024, `production artifact is ${(total(artifactFiles) / 1024 / 1024).toFixed(1)} MiB`)

console.log(
  `PASS release: ${sourceModels.length} trucks, ${(total(javascript) / 1024).toFixed(0)} KiB JS, ` +
  `${(total(fonts) / 1024).toFixed(0)} KiB fonts, ${(total(artifactFiles) / 1024 / 1024).toFixed(1)} MiB total`,
)
