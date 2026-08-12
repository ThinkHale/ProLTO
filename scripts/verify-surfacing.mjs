// Surfacing coverage and bake verification.  node scripts/verify-surfacing.mjs
//
// The fleet shipped with ZERO image textures across all eight GLBs -- every
// material was a flat Principled value, which is the strongest "this is CG"
// tell there is. src/sim/surfacing.js bakes procedural detail instead, keyed by
// material NAME so it survives an asset rebuild.
//
// That name binding is the fragile part: rename a material in
// assets-src/lib/materials.py and the treatment silently degrades to an
// inferred default with nobody noticing. This asserts every material in every
// shipped model is deliberately mapped or deliberately excluded, and that each
// baked map actually carries signal.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

globalThis.self = globalThis.self || globalThis
const {
  SURFACE_TREATMENTS,
  SURFACE_MATERIAL_MAP,
  surfaceTreatmentFor,
  __familyTextureForTest,
} = await import('../src/sim/surfacing.js')

const surfacingSource = readFileSync('src/sim/surfacing.js', 'utf8')
assert.match(surfacingSource, /#ifdef USE_INSTANCING/, 'surfacing must include dynamic instance transforms')
assert.match(
  surfacingSource,
  /proltoSurfaceMatrix\s*=\s*modelMatrix\s*\*\s*instanceMatrix/,
  'instanced load normals and floor grime must follow their individual world poses',
)

// --- every shipped material is accounted for ---------------------------------
// The runtime model directory contains the eight fleet vehicles only. Facility
// geometry is original procedural Three.js content and is verified separately.
const models = readdirSync('public/models')
  .filter((name) => name.endsWith('.glb'))
assert.ok(models.length === 8, `expected the full fleet, found ${models.length} models`)

const unmapped = new Map()
let materialCount = 0
let texturedPrimitives = 0
let totalPrimitives = 0

for (const file of models) {
  const buffer = readFileSync(`public/models/${file}`)
  const gltf = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'))
  for (const material of gltf.materials || []) {
    materialCount += 1
    const name = material.name || ''
    // `undefined` means the name is unknown to the treatment table; `null` means
    // deliberately excluded. Only the former is a failure.
    if (surfaceTreatmentFor(name) !== undefined) continue
    if (!unmapped.has(name)) unmapped.set(name, new Set())
    unmapped.get(name).add(file)
  }
  for (const mesh of gltf.meshes || []) {
    for (const primitive of mesh.primitives) {
      totalPrimitives += 1
      if (primitive.attributes.TEXCOORD_0 != null) texturedPrimitives += 1
    }
  }
  // The premise of the triplanar approach: most geometry has no UVs at all, so
  // any future switch to conventional mapping needs a re-export first.
  assert.equal((gltf.images || []).length, 0, `${file} now ships images; revisit the surfacing strategy`)

  // ANY mesh the Simulator binds a LIVE texture to must carry UVs. Without them
  // the sampler reads texel (0,0) for every fragment and the panel renders as
  // one flat colour -- which is what every instrument screen in the fleet and
  // the fork camera monitor were doing. Triplanar rescues untextured surfaces;
  // it does not apply to these, because they use a real map.
  for (const node of gltf.nodes || []) {
    if (node.mesh == null) continue
    const name = node.name || ''
    if (!/screen/i.test(name) && name !== 'forkcam_display') continue
    for (const primitive of gltf.meshes[node.mesh].primitives) {
      assert.ok(
        primitive.attributes.TEXCOORD_0 != null,
        `${file}: ${name} takes a live texture but has no UVs, so it will render as a single flat colour. Wrap it in P.planar_uv().`,
      )
    }
  }
}

if (unmapped.size) {
  const detail = [...unmapped.entries()]
    .map(([name, files]) => `  ${name}  (${[...files].join(', ')})`)
    .join('\n')
  assert.fail(
    `these shipped materials have no explicit surfacing treatment and would fall back to an inferred default:\n${detail}\n` +
    'Add them to MATERIAL_TREATMENTS or EXCLUDED in src/sim/surfacing.js.',
  )
}

// Every treatment must name a family that actually exists.
for (const [name, treatment] of Object.entries(SURFACE_TREATMENTS)) {
  assert.ok(treatment.family, `treatment ${name} has no family`)
  assert.ok(treatment.scale > 0, `treatment ${name} needs a positive world scale`)
}
for (const [material, treatment] of Object.entries(SURFACE_MATERIAL_MAP)) {
  assert.ok(SURFACE_TREATMENTS[treatment], `material ${material} maps to unknown treatment ${treatment}`)
}

// --- the baked maps carry real signal ----------------------------------------
// A map that bakes flat would compile and render but do nothing, which is the
// exact failure this whole module exists to fix.
for (const family of new Set(Object.values(SURFACE_TREATMENTS).map((entry) => entry.family))) {
  const texture = __familyTextureForTest(family)
  const data = texture.image.data
  assert.ok(data.length === texture.image.width * texture.image.height * 4, `${family} bake is the wrong size`)

  const channels = [0, 1, 2, 3].map((offset) => {
    let min = 255
    let max = 0
    let sum = 0
    const samples = data.length / 4
    for (let index = offset; index < data.length; index += 4) {
      const value = data[index]
      if (value < min) min = value
      if (value > max) max = value
      sum += value
    }
    return { min, max, mean: sum / samples }
  })

  const [slopeX, slopeY, roughness, grime] = channels
  assert.ok(slopeX.max - slopeX.min > 8, `${family} slope X is flat (range ${slopeX.max - slopeX.min})`)
  assert.ok(slopeY.max - slopeY.min > 8, `${family} slope Y is flat (range ${slopeY.max - slopeY.min})`)
  assert.ok(roughness.max - roughness.min > 8, `${family} roughness modulation is flat`)
  // Slope is a derivative, so it must sit around neutral or the surface is
  // uniformly tilted and lighting skews to one side.
  assert.ok(Math.abs(slopeX.mean - 127.5) < 14, `${family} slope X is biased (mean ${slopeX.mean.toFixed(1)})`)
  assert.ok(Math.abs(slopeY.mean - 127.5) < 14, `${family} slope Y is biased (mean ${slopeY.mean.toFixed(1)})`)
  // Grime must be a mask, not a flood: a fully dirty truck reads as broken.
  assert.ok(grime.mean < 190, `${family} grime mask is too heavy (mean ${grime.mean.toFixed(1)})`)
}

const uvPercent = ((texturedPrimitives / totalPrimitives) * 100).toFixed(0)
console.log(
  `PASS surfacing: ${materialCount} materials across ${models.length} models mapped, ` +
  `${Object.keys(SURFACE_TREATMENTS).length} treatments baked (${uvPercent}% of primitives carry UVs, hence triplanar)`,
)
