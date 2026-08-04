# Equipment asset pipeline

ProLTO's trucks are authored as parametric Blender models and shipped to the
browser as articulated glTF binaries. This replaced the earlier approach of
assembling trucks from Three.js primitives at runtime, which could not produce
the surface quality or hardware density operators recognize.

## Why Blender instead of runtime primitives

Runtime primitive assembly limits every part to a box, cylinder, or sphere with
a bevel. Real powered industrial trucks are pressed and molded shells with
compound curvature, structural rolled sections, and dense visible hardware. The
Blender pipeline gives us lofted bodywork, extruded structural profiles, swept
tubing, lathed hardware, and subdivision surfaces, then bakes the result to a
static mesh the browser loads in one request.

## Layout

| Path | Contents |
| --- | --- |
| `assets-src/build.py` | Headless entry point run by Blender |
| `assets-src/lib/parts.py` | Parametric component library (shells, masts, forks, guards, wheels, controls) |
| `assets-src/lib/materials.py` | Shared PBR material palette |
| `assets-src/lib/rig.py` | Node-naming contract and glTF export |
| `assets-src/lib/qa.py` | HDRI-lit GPU render harness |
| `assets-src/trucks/<truck>.py` | One module per truck, exposing `build()` |
| `public/models/<truck>.glb` | Exported runtime assets |
| `qa/blender/<truck>/` | Reference renders per truck |
| `qa/app/` | In-app screenshots from the Playwright harness |

## Building a truck

Blender is not vendored in the repository. Install Blender 4.2+ or newer, then:

```bash
BLENDER=/path/to/blender
"$BLENDER" -b -P assets-src/build.py -- --truck crown_rr5725 --render --views hero,side,cab
"$BLENDER" -b -P assets-src/build.py -- --truck crown_rr5725 --export
```

`--render` writes QA views to `qa/blender/<truck>/` using Cycles on the GPU when
one is available. `--export` writes `public/models/<truck>.glb`. The QA floor and
cameras are prefixed `qa_` and are excluded from export.

## Coordinate and unit convention

Models are authored at real scale in meters. In Blender the forks point toward
`+Y`, the operator station is toward `-Y`, and up is `+Z`. The glTF exporter
converts this to the Y-up, forks-toward `-Z` orientation the simulator drives.

## Rig contract

`src/sim/vehicleFactory.js` binds to nodes by name, so renaming a node in a truck
module silently disables the motion it drives. The full list lives in
`assets-src/lib/rig.py`; the load-bearing ones are `rig_root`, `rig_mast`,
`rig_carriage`, `rig_reachGroup`, `rig_platform`, the control pivots, the wheel
meshes, `rig_cameraMount`, and `rig_xrOrigin`.

Two rules make the animation code correct:

- Rig empties are authored unrotated. The simulator writes absolute Euler angles
  to the pivots, so any rest tilt belongs on a child mesh, not the pivot.
- The simulator adds motion to a node's authored rest position rather than
  overwriting it, so a carriage or reach group may sit at a non-zero offset.

Interactive controls are meshes tagged with `ctrl_action`, `ctrl_label`,
`ctrl_axis`, `ctrl_spring`, optional `ctrl_motion`, and `ctrl_scale` custom
properties. These export as glTF `extras` and are read back into
`object.userData` in the browser. `ctrl_motion` records the operator-relative
travel axis, such as radial, fore and aft, horizontal, or vertical.
`ctrl_scale` is normally `1` and is `-1` for a negative half of a split control,
such as a dedicated Lower button.

### Multi-axis controls

Some real controls are one physical part the operator moves on two orthogonal
axes. Modeling those as two adjacent meshes teaches the wrong motor pattern, so
a control may declare a second axis:

| Property | Meaning |
| --- | --- |
| `ctrl_action2` / `ctrl_motion2` | second action bound to a second, orthogonal drag axis |
| `ctrl_shift2` | what `ctrl_action2` becomes while a modifier switch is held |
| `ctrl_detents` | felt detents per half travel; neutral always pulses harder |
| `ctrl_inverted` | reverse-acting pedal: pressed is released, lifted applies |
| `ctrl_modifier` | this mesh is a held modifier switch and commands nothing itself |

The Crown RR 5725 is the reference case. Its Multi-Task handle travels fore and
aft while lifting on the vertical axis, so `rig_liftPivot` nests inside
`rig_travelPivot` and carries the grip. Its thumb ball tilts on the vertical
axis and reaches on the fore and aft axis, so `rig_reachPivot` nests inside
`rig_tiltPivot` and carries one ball. Holding `mt_back_switch` re-maps that
reach axis to sideshift. The Raymond 7500 deliberately does the opposite: a
fixed grip with a discrete actuator per function, which is the contrast the
two-brand assessment depends on.

`scripts/verify-models.mjs` treats an action as reachable if any control
commands it on either axis, and rejects a secondary axis that duplicates the
primary one or a `ctrl_shift2` with no modifier switch on the truck.
Desktop uses pointer picking. WebXR first tests near-hand contact, then resolves
movement in the control's own local frame. A laser ray is available only when
the evaluator enables accessibility input.

Verify all exports before committing them:

```bash
npm run verify
```

That runs, in order: ESLint; `verify-models.mjs` (rig nodes, actions, signed
control scales, motion axes, camera height, no QA geometry); `verify-rig-binding.mjs`
(the simulator's own binding code against the real GLBs); `verify-physics.mjs`
(collision sweep, fork engagement, rigid carry, rack placement); `verify-dynamics.mjs`
(steered-axle kinematics, tail swing, stability triangle, capacity derating);
`verify-facility.mjs` (rack bay openness, beam elevations, solid pedestrians);
`verify-surfacing.mjs` (material treatment coverage and bake signal); then the
production build.

Those are all headless. Shader compilation and the wired-up simulation loop need
a real WebGL context, so they are covered separately by a browser smoke test
against a running server:

```bash
npm run preview
node scripts/smoke-drive.mjs qa/app
```

It loads all eight profiles, drives and lifts each one, captures an operator-eye
screenshot, and fails on any console or page error.

## Runtime loading and fallback

`createVehicleRig(profile)` is asynchronous. It loads the GLB for the selected
manufacturer and family, maps the rig nodes, and attaches control metadata. If
the asset is missing or fails to parse, it logs a warning and falls back to the
original procedural rig in `src/sim/proceduralFactory.js`, so a bad or absent
asset degrades the visuals without breaking the assessment.

## Surface detail

The exported GLBs carry **no image textures at all** — `materials.py` notes that
procedural node trees do not survive glTF export, and nothing was baked in their
place. Uniform roughness across a whole vehicle is the strongest "this is CG"
signal there is, ahead of polygon count.

`src/sim/surfacing.js` closes that gap at runtime rather than in the asset. It
bakes one packed RGBA detail map per surface family — slope in RG from a real
height field, roughness modulation in B, a grime mask in A — and samples it with
a **triplanar projection in object space**. Two constraints drove that choice:

- Only about 15% of primitives carry `TEXCOORD_0`, so conventional mapping would
  need a full UV unwrap and re-export of all eight parametric models first.
- Sampling in world space would look right on the static facility but would make
  the detail swim across the truck's own panels as it drives. Object space locks
  the grain to the part; only the floor-soil term reads world height.

Treatments bind by **material name**, so an asset rebuild keeps its surfacing as
long as names are stable. `scripts/verify-surfacing.mjs` asserts every material
in every shipped model is explicitly mapped or explicitly excluded, so renaming
one in `materials.py` fails the build instead of silently degrading to a guess.
Emissive clusters, indicator lenses, and the segment bars are excluded by name
and by pattern — grime on a backlit display reads as broken, not real.

If the fleet is ever re-exported with UV layouts and baked maps, this becomes
redundant and should be retired rather than layered on top.

## Lighting

The simulator lights the scene with an image-based environment
(`public/env/warehouse_1k.hdr`, CC0 from Poly Haven) processed through
`PMREMGenerator`, plus a shadow-casting key light that follows the truck. PBR
paint with a clearcoat layer needs an environment to reflect; without one the
bodywork reads as flat plastic regardless of mesh quality.

## Visual QA

Two loops guard realism:

1. **Blender renders** compare each truck against the manufacturer reference
   boards in `design/` from fixed hero, side, front, rear-quarter, and cab views.
2. **In-app screenshots** capture what the trainee actually sees, including the
   operator eye point, which Blender views cannot validate:

```bash
npm run dev
node scripts/screenshot.mjs --family reach --manufacturer Crown --enter true --out qa/app/crown-reach.png
```

The harness can hold control keys (`--hold KeyE:1800`) and drag the view
(`--look -260,40`) to capture articulated states.

## Provenance

These are original parametric models reconstructed from published manufacturer
specifications, product photography, and brochures. They are not manufacturer
CAD, and they are not manufacturer-approved digital twins. See
`docs/web-reference-modeling.md` for the reference matrix and the validation
boundary that still applies before any hiring or authorization decision.
