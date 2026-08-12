# Visual fidelity ledger

Reference concept: `design/prolto-concept.png`

Stage 2 control-layout target: `design/stage2-reach-cockpit-reference.png`

Verified browser render: `qa/desktop-final-1536x1024.png`

Stage 2 verified renders: `qa/stage2-reach-final.png` and `qa/stage2-walkie-final.png`

Stage 4 web-reference modeling boards: `design/stage4-crown-fleet-reference.png` and `design/stage4-raymond-fleet-reference.png`

Stage 4 verified fleet renders: `qa/stage4-crown-rr5725-final.png`, `qa/stage4-raymond-7500-final.png`, `qa/stage4-crown-sp1500-final.png`, `qa/stage4-raymond-5300-final.png`, `qa/stage4-crown-pe4500-final.png`, `qa/stage4-raymond-8210-final.png`, `qa/stage4-crown-sc6200-final.png`, and `qa/stage4-raymond-4460-final.png`

Stage 5 Blender asset renders: `qa/blender/<truck>/` contains historical modeling evidence for all eight trucks, but coverage is uneven. Crown RR has the complete hero, side, rear, cab, and component set; Raymond 7500 has four views; the other directories have one or two views. These renders predate the current GLBs and are not current-binary acceptance evidence.

Stage 5 operator-station history: `qa/app/<manufacturer>-<family>-cab.png` contains all eight profile views from the running application. Those named cab captures predate the current GLBs, so a deterministic current-binary capture set is still required before visual release acceptance.

## Comparison points

1. Information architecture: the left navigation, equipment rail, central simulator viewport, evaluator rail, telemetry, and readiness controls follow the concept's screen hierarchy. The rendered viewport preserves the same dominant center-of-gravity and evaluator visibility.
2. Palette: the concept's graphite, slate, safety amber, white, and restrained green status colors were carried into shared CSS tokens. The final render avoids unrelated gradients, purple, neon, and decorative badges.
3. Typography: the implementation self-hosts Inter for application text and Barlow Condensed for operational chrome and telemetry, so the simulator keeps its intended typography without a runtime CDN request. Control typography is explicitly sized throughout the navigation, simulator HUD, checklist, modal, and responsive views.
4. Controls and copy: the primary `Enter VR` and secondary `Desktop Mode` actions, equipment families, manufacturer selector, candidate block, safety events, observation checklist, score, and readiness check are preserved. Added copy is limited to required exercise instructions, status, and regulatory scope.
5. Evaluator panel: the live candidate, equipment identity, progress, safety-event stream, observation checklist, evidence score, and knowledge/practical breakdown retain the concept's dense right-rail anatomy. Seeded fake events and scores from the concept were intentionally replaced with live empty state.
6. Simulator viewport: the concept's warehouse, floor lanes, racking, pallets, cones, and pedestrians are represented as interactive Three.js geometry with collision and telemetry hooks. The original chase camera and single shared truck were removed. All eight Crown and Raymond profiles now have reference-built first-person operator stations, distinct body geometry, control geometry, eye points, hydraulics, steering behavior, and safety interlocks.
7. Direct control manipulation: desktop pointer dragging and WebXR near-hand pickup operate the actual visible control meshes. VR motion resolves in the local mechanical frame, spring controls neutralize on release, and haptics mark pickup and detents. Laser and thumbstick mappings require an explicit accessibility opt-in.
8. Responsive behavior: the 1536 by 1024 viewport has no page overflow. The 390 by 844 viewport collapses navigation, stacks evaluator sections, preserves the usable simulator, and contains horizontal overflow to the equipment selector only.

## Above-the-fold copy diff

No unapproved marketing copy, claims, certification language, hero eyebrow, or promotional metrics were added. `Pallet Jack` was changed to the more inclusive `Pallet Truck` because the current profile includes both an end-control rider and a walkie model. `Overall Score` is labeled `Overall evidence score` to avoid implying certification.

## Stage 5 equipment realism

9. Truck geometry moved from runtime Three.js primitives to parametric Blender models exported as rig-ready glTF binaries. Bodywork is lofted and subdivided rather than beveled boxes, structural members are extruded profiles, and recognition hardware such as mast chains, cylinders with chrome rods, bolt circles, guard tubing, tread plate, labels, displays and control hardware is modeled explicitly. Carriages and operator controls have named runtime pivots, but nested mast stages, chains, cylinders, and reach-link kinematics are not yet production-articulated. The intended Raymond 5300 reference is the published 3000 lb, 240 in three-stage configuration, while its current GLB exposes only `mast_rail_s0_*` and `mast_rail_s1_*`. The absent third stage and sequencing are an explicit fidelity blocker, not a completed-art claim.
10. Desktop eye points are reference-built from anthropometry against each truck's modeled floor or seat height. WebXR uses a separate `rig_xrOrigin` at the operator floor, allowing the headset's tracked height to supply physical eye height without a second authored offset. Both origins remain subject to exact physical-truck and operator validation.
11. The warehouse is original procedural geometry built from measurable training components: selective pallet rack with 96 in bays, 42 in depth, teardrop uprights, wire decking, and beam elevations at 6, 12, and 18 ft; 48x40 GMA pallets; and 28 ft clear height with open-web joists and high-bay fixtures. Saw-cut concrete, pedestrian walkway hatching, and hi-vis personnel supply working-facility cues. Static structure is merged per material. Every movable load keeps an independent mesh-free physics proxy, while pallet bases, deterministic carton variants, and transparent stretch wrap render in dynamic instanced buckets that follow push, carry, rack placement, and reset poses. Facility variation comes from a local seeded generator, so desktop, screenshot, and VR runs reproduce the same scene. No third-party facility model ships or loads at runtime.
12. Lighting uses a CC0 warehouse HDRI through `PMREMGenerator` for image-based lighting plus a shadow-casting key light that tracks the truck. Tone mapping is Khronos PBR Neutral, which preserves saturated manufacturer paint that AgX and ACES desaturate.

## Intentional deviations

- Manufacturer photography is used as modeling evidence but is not embedded in the application. The models are optimized for Quest and can be refined as more measurements become available.
- The concept's ten checklist items are consolidated to eight evidence categories in this prototype. The checklist is data-driven and ready for company-specific expansion.
- Manufacturer photography is not copied into textures. Simple manufacturer and model text identifies the selected control profile.

## Verification result

The application shell, first-person interaction hierarchy, responsive layout, equipment-profile sightlines, near-hand control selection, palette, typography, controls, and evaluator workflow were verified in the browser. Official manufacturer cockpit plates in `web-reference-modeling.md` are the control-layout authority. The original 3D art is not a manufacturer-approved digital twin.
