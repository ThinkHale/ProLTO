# Visual fidelity ledger

Reference concept: `design/prolto-concept.png`

Stage 2 control-layout target: `design/stage2-reach-cockpit-reference.png`

Verified browser render: `qa/desktop-final-1536x1024.png`

Stage 2 verified renders: `qa/stage2-reach-final.png` and `qa/stage2-walkie-final.png`

Stage 4 web-reference modeling boards: `design/stage4-crown-fleet-reference.png` and `design/stage4-raymond-fleet-reference.png`

Stage 4 verified fleet renders: `qa/stage4-crown-rr5725-final.png`, `qa/stage4-raymond-7500-final.png`, `qa/stage4-crown-sp1500-final.png`, `qa/stage4-raymond-5300-final.png`, `qa/stage4-crown-pe4500-final.png`, `qa/stage4-raymond-8210-final.png`, `qa/stage4-crown-sc6200-final.png`, and `qa/stage4-raymond-4460-final.png`

Stage 5 Blender asset renders: `qa/blender/<truck>/` — one directory per truck with hero, side, cab, and component closeups

Stage 5 verified operator stations: `qa/app/<manufacturer>-<family>-cab.png` — all eight profiles captured from the running application at the operator eye point

## Comparison points

1. Information architecture: the left navigation, equipment rail, central simulator viewport, evaluator rail, telemetry, and readiness controls follow the concept's screen hierarchy. The rendered viewport preserves the same dominant center-of-gravity and evaluator visibility.
2. Palette: the concept's graphite, slate, safety amber, white, and restrained green status colors were carried into shared CSS tokens. The final render avoids unrelated gradients, purple, neon, and decorative badges.
3. Typography: the implementation uses Inter for application text and Barlow Condensed for operational chrome and telemetry. Control typography is explicitly sized throughout the navigation, simulator HUD, checklist, modal, and responsive views.
4. Controls and copy: the primary `Enter VR` and secondary `Desktop Mode` actions, equipment families, manufacturer selector, candidate block, safety events, observation checklist, score, and readiness check are preserved. Added copy is limited to required exercise instructions, status, and regulatory scope.
5. Evaluator panel: the live candidate, equipment identity, progress, safety-event stream, observation checklist, evidence score, and knowledge/practical breakdown retain the concept's dense right-rail anatomy. Seeded fake events and scores from the concept were intentionally replaced with live empty state.
6. Simulator viewport: the concept's warehouse, floor lanes, racking, pallets, cones, and pedestrians are represented as interactive Three.js geometry with collision and telemetry hooks. The original chase camera and single shared truck were removed. All eight Crown and Raymond profiles now have reference-built first-person operator stations, distinct body geometry, control geometry, eye points, hydraulics, steering behavior, and safety interlocks.
7. Direct control manipulation: desktop pointer raycasting and WebXR controller raycasting operate the actual visible control meshes. Spring-return controls neutralize on release. Steering controls retain their selected position. A keyboard and thumbstick mapping remains as an accessibility fallback.
8. Responsive behavior: the 1536 by 1024 viewport has no page overflow. The 390 by 844 viewport collapses navigation, stacks evaluator sections, preserves the usable simulator, and contains horizontal overflow to the equipment selector only.

## Above-the-fold copy diff

No unapproved marketing copy, claims, certification language, hero eyebrow, or promotional metrics were added. `Pallet Jack` was changed to the more inclusive `Pallet Truck` because the current profile includes both an end-control rider and a walkie model. `Overall Score` is labeled `Overall evidence score` to avoid implying certification.

## Stage 5 equipment realism

9. Truck geometry moved from runtime Three.js primitives to parametric Blender models exported as articulated glTF binaries. Bodywork is lofted and subdivided rather than beveled boxes, structural members are extruded profiles, and recognition hardware — mast chains, cylinders with chrome rods, bolt circles, guard tubing, tread plate, labels, and displays — is modeled explicitly. Each truck lands between 10k and 31k triangles, inside the Quest budget.
10. Operator eye points are derived from anthropometry against each truck's own floor or seat height rather than copied between profiles: standing stations place the eye 1.63 m above the compartment floor, seated stations 0.73 m above the seat cushion. Default view pitch is set per family so the truck's primary controls fall inside the resting sightline.
11. The warehouse was rebuilt to real dimensions: 12 ft aisle, selective pallet rack on 8 ft beam elevations with teardrop uprights and wire decking, 48x40 GMA pallets, 28 ft clear height with open-web joists and high-bay fixtures, saw-cut concrete, pedestrian walkway hatching, and hi-vis personnel. Static structure is merged per material to hold the draw-call budget.
12. Lighting uses a CC0 warehouse HDRI through `PMREMGenerator` for image-based lighting plus a shadow-casting key light that tracks the truck. Tone mapping is Khronos PBR Neutral, which preserves saturated manufacturer paint that AgX and ACES desaturate.

## Intentional deviations

- Manufacturer photography is used as modeling evidence but is not embedded in the application. The models are optimized for Quest and can be refined as more measurements become available.
- The concept's ten checklist items are consolidated to eight evidence categories in this prototype. The checklist is data-driven and ready for company-specific expansion.
- Manufacturer logos are not reproduced. Manufacturer and model names identify the selected control profile only.

## Verification result

The application shell, first-person interaction hierarchy, responsive layout, eight equipment-profile sightlines, pointer control selection, palette, typography, controls, and evaluator workflow were verified in the browser. The stage 4 Crown and Raymond modeling boards are the fleet visual targets. The original 3D art should not be treated as a manufacturer-approved digital twin.
