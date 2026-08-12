import * as THREE from 'three'

// Procedural PBR surfacing for the fleet and the facility.
//
// WHY THIS EXISTS
// Every material in the exported fleet was a flat Principled value -- eight GLBs
// with 15 to 33 materials each and ZERO image textures. assets-src/lib/materials.py
// says why: "only flat Principled values survive glTF export (procedural node
// trees do not)". That is true, but the conclusion drawn from it was wrong. The
// fix for a node tree that will not export is to BAKE it, and nothing was baked.
// Uniform roughness across a whole vehicle is the single strongest "this is CG"
// tell there is, ahead of polygon count by a wide margin.
//
// WHY TRIPLANAR
// Only 7 to 28 of the 85 to 164 primitives per truck carry TEXCOORD_0, so ~85%
// of the geometry has no UV layout at all. Rather than block realism behind a
// full UV-unwrap and re-export of eight parametric models, this samples in world
// space and projects along the three cardinal planes, blended by the surface
// normal. No UVs, no seams, no re-export, and detail stays at a fixed real-world
// scale across parts of wildly different size -- which is exactly right for
// machinery, where the grain of molded plastic does not get bigger on a bigger
// panel.
//
// WHAT IT PRODUCES
// One packed RGBA detail map per surface family, baked from a real height field:
//   R,G = surface slope (finite-differenced from the height field)
//   B   = roughness modulation around neutral 0.5
//   A   = grime / wear mask
// The shader takes three samples of that one map and drives normal perturbation,
// roughness breakup, and dirt accumulation from it. Three fetches total, which
// is the same budget a conventional normal + roughness map pair would cost.

const SIZE = 512
const latticeCache = new Map()

function lattice(frequency, seed) {
  const key = `${frequency}:${seed}`
  const cached = latticeCache.get(key)
  if (cached) return cached
  const values = new Float32Array(frequency * frequency)
  let state = (seed * 2654435761) >>> 0
  for (let index = 0; index < values.length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    values[index] = state / 4294967296
  }
  latticeCache.set(key, values)
  return values
}

// Wrapped lattice sampling, so every map tiles seamlessly under world-space
// repeat. A visible tile seam on a fork blade would be worse than no texture.
function sampleLattice(values, frequency, u, v) {
  const x = u * frequency
  const y = v * frequency
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const i0 = ((x0 % frequency) + frequency) % frequency
  const j0 = ((y0 % frequency) + frequency) % frequency
  const i1 = (i0 + 1) % frequency
  const j1 = (j0 + 1) % frequency
  const a = values[j0 * frequency + i0]
  const b = values[j0 * frequency + i1]
  const c = values[j1 * frequency + i0]
  const d = values[j1 * frequency + i1]
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy
}

function fbm(u, v, octaves, baseFrequency, seed) {
  let sum = 0
  let amplitude = 1
  let normal = 0
  let frequency = baseFrequency
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * sampleLattice(lattice(frequency, seed + octave * 17), frequency, u, v)
    normal += amplitude
    amplitude *= .5
    frequency *= 2
  }
  return sum / normal
}

const saturate = (value) => (value < 0 ? 0 : value > 1 ? 1 : value)

// --- Surface family painters -------------------------------------------------
// Each returns { height, rough, grime } in 0..1 for one texel. `rough` is a
// modulation around 0.5, not an absolute -- the authored Principled roughness
// stays the base value and this breaks it up.

const FAMILIES = {
  // Clearcoated bodywork: fine orange peel, tight and shallow.
  paint(u, v) {
    const peel = fbm(u, v, 3, 48, 11)
    const wide = fbm(u, v, 2, 6, 29)
    return {
      height: peel * .55 + wide * .45,
      rough: .5 + (peel - .5) * .22 + (wide - .5) * .12,
      grime: saturate((1 - wide) * .55 - .2),
    }
  },
  // Painted structural steel: mill-scale mottling and shallow pitting.
  structuralSteel(u, v) {
    const scale = fbm(u, v, 4, 12, 3)
    const pit = fbm(u, v, 2, 64, 41)
    const pitting = pit < .3 ? (.3 - pit) * 2.2 : 0
    return {
      height: scale * .7 - pitting * .3,
      rough: .5 + (scale - .5) * .5 + pitting * .3,
      grime: saturate((1 - scale) * .8 - .12),
    }
  },
  // Fork blades and cylinder rods: directional wear, scuffs, polished highs.
  machinedSteel(u, v) {
    const along = fbm(u * .12, v, 4, 96, 7)
    const scratch = fbm(u * .04, v, 2, 220, 61)
    const wear = fbm(u, v, 3, 8, 83)
    const groove = scratch < .34 ? (.34 - scratch) * 2.4 : 0
    return {
      height: along * .5 - groove * .5,
      // Blades polish bright where pallets slide across them and stay dull
      // where they do not. That contrast is most of what reads as "used".
      rough: .5 + (along - .5) * .35 + groove * .38 - (wear > .62 ? .3 : 0),
      grime: saturate((1 - wear) * .5 - .18),
    }
  },
  // Molded compartment plastic: fine stipple grain, matte, holds dirt.
  moldedPlastic(u, v) {
    const grain = fbm(u, v, 2, 150, 19)
    const sharpened = saturate((grain - .38) * 2.6)
    const wide = fbm(u, v, 3, 9, 37)
    return {
      height: sharpened * .55 + wide * .2,
      rough: .5 + (sharpened - .5) * .3 + (wide - .5) * .16,
      grime: saturate((1 - wide) * .85 - .1),
    }
  },
  // Tires, grips, floor mats: coarse matte grain, very little specular life.
  rubber(u, v) {
    const coarse = fbm(u, v, 3, 70, 23)
    const wide = fbm(u, v, 2, 11, 53)
    return {
      height: coarse * .8,
      rough: .5 + (coarse - .5) * .2,
      grime: saturate((1 - wide) * .9 - .05),
    }
  },
  // Diamond tread floorplate: analytic raised pattern, polished by boots on the
  // highs, packed with dirt in the valleys. The strongest bump in the set.
  treadPlate(u, v) {
    const tile = 7
    const x = (u * tile) % 1
    const y = (v * tile) % 1
    const row = Math.floor(v * tile)
    const shifted = (x + (row % 2 ? .5 : 0)) % 1
    const diamond = 1 - saturate((Math.abs(shifted - .5) + Math.abs(y - .5)) * 2.6)
    const raised = saturate(diamond * 1.6)
    const wear = fbm(u, v, 3, 14, 71)
    return {
      height: raised,
      rough: .5 - raised * .3 + (1 - raised) * .18 + (wear - .5) * .12,
      grime: saturate((1 - raised) * .85 * (1.15 - wear * .5)),
    }
  },
  // Printed legends and labels: near-neutral so the artwork stays legible.
  decal(u, v) {
    const grain = fbm(u, v, 2, 90, 13)
    return { height: grain * .2, rough: .5 + (grain - .5) * .12, grime: saturate((1 - grain) * .3 - .12) }
  },
  // Facility concrete: coarse aggregate, pitting, power-trowel swirl.
  concrete(u, v) {
    const aggregate = fbm(u, v, 4, 26, 5)
    const fine = fbm(u, v, 3, 110, 47)
    const pit = fine < .26 ? (.26 - fine) * 2.6 : 0
    return {
      height: aggregate * .6 + fine * .25 - pit * .5,
      rough: .5 + (aggregate - .5) * .34 + pit * .3,
      grime: saturate((1 - aggregate) * .7 - .1),
    }
  },
  // Pallet lumber: directional grain, saw kerf, chipped edges.
  wood(u, v) {
    const grain = fbm(u * .05, v, 4, 130, 31)
    const ring = Math.abs(Math.sin((v * 9 + grain * 2.4) * Math.PI))
    const rough = fbm(u, v, 3, 20, 67)
    return {
      height: ring * .45 + grain * .4,
      rough: .5 + (1 - ring) * .22 + (rough - .5) * .18,
      grime: saturate((1 - rough) * .7 - .12),
    }
  },
  // Corrugated shipping cartons: fiber tooth plus flute ribbing.
  cardboard(u, v) {
    const fiber = fbm(u, v, 3, 120, 43)
    const flute = Math.abs(Math.sin(u * Math.PI * 64)) * .25
    return {
      height: fiber * .6 + flute,
      rough: .5 + (fiber - .5) * .2 + .1,
      grime: saturate((1 - fiber) * .5 - .18),
    }
  },
}

// Bake one family to a packed RGBA texture. Slope comes from central
// differences on the height field, which is what makes the lighting respond
// like real relief rather than like a painted-on pattern.
function bakeFamily(name) {
  const painter = FAMILIES[name]
  const height = new Float32Array(SIZE * SIZE)
  const rough = new Float32Array(SIZE * SIZE)
  const grime = new Float32Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const sample = painter(x / SIZE, y / SIZE)
      const index = y * SIZE + x
      height[index] = sample.height
      rough[index] = sample.rough
      grime[index] = sample.grime
    }
  }
  const data = new Uint8Array(SIZE * SIZE * 4)
  const at = (x, y) => height[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)]
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const index = y * SIZE + x
      const slopeX = (at(x + 1, y) - at(x - 1, y)) * .5
      const slopeY = (at(x, y + 1) - at(x, y - 1)) * .5
      data[index * 4] = saturate(slopeX * 4 + .5) * 255
      data[index * 4 + 1] = saturate(slopeY * 4 + .5) * 255
      data[index * 4 + 2] = saturate(rough[index]) * 255
      data[index * 4 + 3] = saturate(grime[index]) * 255
    }
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

const bakedTextures = new Map()
function familyTexture(name) {
  if (!bakedTextures.has(name)) bakedTextures.set(name, bakeFamily(name))
  return bakedTextures.get(name)
}

// --- Treatment table ---------------------------------------------------------
// `scale` is tiles per meter of world space. `normal`, `rough`, and `grime` are
// strengths. `floorGrime` adds height-dependent soiling: on a real lift truck
// everything below about knee height is visibly dirtier than everything above.
const TREATMENTS = {
  paint: { family: 'paint', scale: 5.5, normal: .35, rough: .3, grime: .1, floorGrime: .16 },
  structuralSteel: { family: 'structuralSteel', scale: 4.5, normal: .8, rough: .45, grime: .3, floorGrime: .3 },
  machinedSteel: { family: 'machinedSteel', scale: 3.2, normal: .7, rough: .55, grime: .22, floorGrime: .34 },
  moldedPlastic: { family: 'moldedPlastic', scale: 14, normal: .55, rough: .32, grime: .22, floorGrime: .18 },
  rubber: { family: 'rubber', scale: 16, normal: .6, rough: .22, grime: .3, floorGrime: .35 },
  treadPlate: { family: 'treadPlate', scale: 3.4, normal: 1.35, rough: .5, grime: .45, floorGrime: .2 },
  decal: { family: 'decal', scale: 18, normal: .16, rough: .16, grime: .07, floorGrime: .06 },
  concrete: { family: 'concrete', scale: 1.1, normal: .75, rough: .4, grime: .3, floorGrime: 0 },
  wood: { family: 'wood', scale: 6.5, normal: .8, rough: .38, grime: .32, floorGrime: .14 },
  cardboard: { family: 'cardboard', scale: 7.5, normal: .5, rough: .26, grime: .2, floorGrime: .1 },
}

// Material name -> treatment. Names come from assets-src/lib/materials.py and the
// per-truck modules, and are stable across re-exports, so this survives an asset
// rebuild. Anything unmatched falls through to a conservative default by type.
const MATERIAL_TREATMENTS = {
  crown_ivory: 'paint',
  raymond_red: 'paint',
  safety_orange: 'paint',
  warning_amber: 'paint',
  button_red: 'paint',
  mast_steel: 'structuralSteel',
  frame_black: 'structuralSteel',
  steel_dark: 'structuralSteel',
  chain_steel: 'structuralSteel',
  steel_forks: 'machinedSteel',
  chrome_rod: 'machinedSteel',
  plastic_molded: 'moldedPlastic',
  plastic_dark: 'moldedPlastic',
  rr_console_charcoal: 'moldedPlastic',
  rr_control_gray: 'moldedPlastic',
  rr_switch_black: 'moldedPlastic',
  seat_vinyl: 'moldedPlastic',
  grip_rubber: 'rubber',
  grip_tan: 'rubber',
  rubber_tire: 'rubber',
  poly_wheel: 'rubber',
  poly_amber_7500: 'rubber',
  floor_mat: 'treadPlate',
  // The PE 4500's platform entry strip is the surface the operator steps on
  // every cycle, so it wears like a floorplate rather than like bodywork.
  entry_wear: 'treadPlate',
  decal_white: 'decal',
  decal_dark: 'decal',
  // Per-truck hardware and compartment plastics.
  ray_console_charcoal: 'moldedPlastic',
  ray_console_inset: 'moldedPlastic',
  ray_control_black: 'moldedPlastic',
  x10_reverse_gray: 'moldedPlastic',
  forks_rocker_gray: 'moldedPlastic',
  power_rocker_gray: 'moldedPlastic',
  ray_hw_gray: 'structuralSteel',
  ray_hw_dark: 'structuralSteel',
  sc_guard_gray: 'structuralSteel',
  alu_canister: 'machinedSteel',
  estop_yellow: 'paint',
  raymond_fork_red: 'paint',
}

// Emissive readouts, indicator lenses, and lamp covers must stay untouched:
// adding grime and roughness breakup to a backlit display or a tail lens makes
// it look broken, not real.
const EXCLUDED = new Set(['screen_glass', 'led_green', 'led_red', 'led_amber', 'tail_red'])
// The Raymond 7500 cluster generates one emissive material per digit
// (ray_seg_0..9), so the bar is matched by shape rather than enumerated -- a
// longer display must not silently start collecting dirt.
const EXCLUDED_PATTERNS = [/_seg_\d+$/, /^led_/]

/**
 * Resolve a material name to its treatment.
 * Returns the treatment name, `null` when deliberately excluded, or `undefined`
 * when the name is unknown -- which scripts/verify-surfacing.mjs treats as a
 * failure so a renamed material cannot silently degrade to a guess.
 */
export function surfaceTreatmentFor(name) {
  if (!name) return undefined
  if (EXCLUDED.has(name) || EXCLUDED_PATTERNS.some((pattern) => pattern.test(name))) return null
  return MATERIAL_TREATMENTS[name]
}

function inferTreatment(material) {
  const resolved = surfaceTreatmentFor(material.name)
  if (resolved !== undefined) return resolved
  if (material.emissive && material.emissive.getHex() !== 0 && material.emissiveIntensity > .5) return null
  if (material.metalness >= .6) return 'structuralSteel'
  if (material.roughness >= .8) return 'rubber'
  return 'moldedPlastic'
}

// --- Shader ------------------------------------------------------------------
const TRIPLANAR_CHUNK = /* glsl */`
uniform sampler2D uSurfMap;
uniform float uSurfScale;
uniform float uSurfNormal;
uniform float uSurfRough;
uniform float uSurfGrime;
uniform float uSurfFloorGrime;
uniform vec3 uSurfGrimeColor;
varying vec3 vSurfObj;
varying vec3 vSurfNObj;
varying vec3 vSurfN;
varying float vSurfY;

struct SurfSample { vec2 slope; float rough; float grime; };

// Sampled in OBJECT space, not world space. A world-space projection would look
// correct on the static facility but would make the detail swim across the
// truck's own panels as it drives, which is far worse than no detail at all.
// Object space locks the grain to the part; only the floor-soil term below is
// allowed to care where the part currently is in the building.
SurfSample prolto_surface(vec3 objectPosition, vec3 objectNormalDirection) {
  vec3 blend = pow(abs(objectNormalDirection), vec3(4.0));
  blend /= max(blend.x + blend.y + blend.z, 1e-4);
  vec4 sx = texture2D(uSurfMap, objectPosition.zy * uSurfScale);
  vec4 sy = texture2D(uSurfMap, objectPosition.xz * uSurfScale);
  vec4 sz = texture2D(uSurfMap, objectPosition.xy * uSurfScale);
  vec4 blended = sx * blend.x + sy * blend.y + sz * blend.z;
  SurfSample result;
  result.slope = blended.rg * 2.0 - 1.0;
  result.rough = blended.b;
  result.grime = blended.a;
  return result;
}
`

function injectSurfacing(material, treatmentName) {
  const treatment = TREATMENTS[treatmentName]
  if (!treatment) return material
  const uniforms = {
    uSurfMap: { value: familyTexture(treatment.family) },
    uSurfScale: { value: treatment.scale },
    uSurfNormal: { value: treatment.normal },
    uSurfRough: { value: treatment.rough },
    uSurfGrime: { value: treatment.grime },
    uSurfFloorGrime: { value: treatment.floorGrime },
    // Warehouse dust is a warm gray, not a neutral one. Neutral grime reads as
    // underexposure rather than dirt.
    uSurfGrimeColor: { value: new THREE.Color(0x3b352d) },
  }
  material.userData.surfacing = uniforms
  material.userData.treatment = treatmentName

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSurfObj;\nvarying vec3 vSurfNObj;\nvarying vec3 vSurfN;\nvarying float vSurfY;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSurfObj = transformed;
        vSurfNObj = normalize(objectNormal);
        mat4 proltoSurfaceMatrix = modelMatrix;
        #ifdef USE_INSTANCING
          // Facility load visuals use dynamic InstancedMesh buckets. Their
          // world normal and height must include the per-load instance pose,
          // while vSurfObj deliberately remains local so the grain stays fixed.
          proltoSurfaceMatrix = modelMatrix * instanceMatrix;
        #endif
        vSurfN = normalize(mat3(proltoSurfaceMatrix) * objectNormal);
        vSurfY = (proltoSurfaceMatrix * vec4(transformed, 1.0)).y;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR_CHUNK}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        SurfSample surf = prolto_surface(vSurfObj, normalize(vSurfNObj));
        // Dirt collects in the low frequencies of the surface and, far more
        // visibly, on everything near the floor. On a real lift truck the split
        // between "below knee height" and "above" is obvious across the yard.
        float floorSoil = uSurfFloorGrime * (1.0 - smoothstep(0.05, 1.15, vSurfY));
        float soil = clamp(surf.grime * uSurfGrime + floorSoil, 0.0, 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSurfGrimeColor, soil);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (surf.rough - 0.5) * uSurfRough + soil * 0.35, 0.035, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          // The sampled slope is a 2D surface gradient with no inherent world
          // orientation, so it is applied in a tangent frame built from the
          // world normal. Exact tangent direction does not matter for grain at
          // this scale; breaking up the specular response is the whole point.
          vec3 surfWorldNormal = normalize(vSurfN);
          vec3 surfUp = abs(surfWorldNormal.y) < 0.94 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
          vec3 surfTangent = normalize(cross(surfUp, surfWorldNormal));
          vec3 surfBitangent = cross(surfWorldNormal, surfTangent);
          vec3 perturbed = normalize(
            surfWorldNormal + (surfTangent * surf.slope.x + surfBitangent * surf.slope.y) * uSurfNormal
          );
          normal = normalize((viewMatrix * vec4(perturbed, 0.0)).xyz);
          if (!gl_FrontFacing) normal = -normal;
        }`,
      )
  }
  // Without this, every clone that differs only by uniform values compiles its
  // own program. Keyed by treatment, the fleet shares a handful of variants.
  material.customProgramCacheKey = () => `prolto-surf-${treatmentName}`
  material.needsUpdate = true
  return material
}

const surfaced = new WeakSet()

export function surfaceMaterial(material, explicitTreatment) {
  if (!material || surfaced.has(material)) return material
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return material
  const treatment = explicitTreatment || inferTreatment(material)
  surfaced.add(material)
  if (!treatment) return material
  return injectSurfacing(material, treatment)
}

/** Surface every standard material under a loaded truck scene. */
export function applyFleetSurfacing(root) {
  let count = 0
  root.traverse((object) => {
    if (!object.isMesh || !object.material) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => {
      if (surfaced.has(material)) return
      surfaceMaterial(material)
      count += 1
    })
  })
  return count
}

export const SURFACE_TREATMENTS = TREATMENTS
// Exposed so scripts/verify-surfacing.mjs can assert every material name in
// every shipped GLB is deliberately mapped or deliberately excluded, rather
// than silently landing on the inferred default.
export const SURFACE_MATERIAL_MAP = MATERIAL_TREATMENTS
export const SURFACE_EXCLUDED = EXCLUDED
export const __familyTextureForTest = familyTexture
