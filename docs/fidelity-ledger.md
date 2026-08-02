# Visual fidelity ledger

Reference concept: `design/prolto-concept.png`

Stage 2 control-layout target: `design/stage2-reach-cockpit-reference.png`

Verified browser render: `qa/desktop-final-1536x1024.png`

Stage 2 verified renders: `qa/stage2-reach-final.png` and `qa/stage2-walkie-final.png`

## Comparison points

1. Information architecture: the left navigation, equipment rail, central simulator viewport, evaluator rail, telemetry, and readiness controls follow the concept's screen hierarchy. The rendered viewport preserves the same dominant center-of-gravity and evaluator visibility.
2. Palette: the concept's graphite, slate, safety amber, white, and restrained green status colors were carried into shared CSS tokens. The final render avoids unrelated gradients, purple, neon, and decorative badges.
3. Typography: the implementation uses Inter for application text and Barlow Condensed for operational chrome and telemetry. Control typography is explicitly sized throughout the navigation, simulator HUD, checklist, modal, and responsive views.
4. Controls and copy: the primary `Enter VR` and secondary `Desktop Mode` actions, equipment families, manufacturer selector, candidate block, safety events, observation checklist, score, and readiness check are preserved. Added copy is limited to required exercise instructions, status, and regulatory scope.
5. Evaluator panel: the live candidate, equipment identity, progress, safety-event stream, observation checklist, evidence score, and knowledge/practical breakdown retain the concept's dense right-rail anatomy. Seeded fake events and scores from the concept were intentionally replaced with live empty state.
6. Simulator viewport: the concept's warehouse, floor lanes, racking, pallets, cones, and pedestrians are represented as interactive Three.js geometry with collision and telemetry hooks. The original chase camera and single shared truck were removed. Reach, order picker, pallet, and counterbalance trucks now have separate first-person operator stations, control geometry, eye points, hydraulics, steering behavior, and safety interlocks.
7. Direct control manipulation: desktop pointer raycasting and WebXR controller raycasting operate the actual visible control meshes. Spring-return controls neutralize on release. Steering controls retain their selected position. A keyboard and thumbstick mapping remains as an accessibility fallback.
8. Responsive behavior: the 1536 by 1024 viewport has no page overflow. The 390 by 844 viewport collapses navigation, stacks evaluator sections, preserves the usable simulator, and contains horizontal overflow to the equipment selector only.

## Above-the-fold copy diff

No unapproved marketing copy, claims, certification language, hero eyebrow, or promotional metrics were added. `Pallet Jack` was changed to the more inclusive `Pallet Truck` because the current profile includes both an end-control rider and a walkie model. `Overall Score` is labeled `Overall evidence score` to avoid implying certification.

## Intentional deviations

- Photorealistic product imagery and simulated mirrors are not included in the procedural build. Production still requires manufacturer-approved 3D models, measured control geometry, optimized textures, exact option packages, and Quest performance tuning.
- The concept's ten checklist items are consolidated to eight evidence categories in this prototype. The checklist is data-driven and ready for company-specific expansion.
- Manufacturer logos are not reproduced. Manufacturer and model names identify the selected control profile only.

## Verification result

The application shell, first-person interaction hierarchy, responsive layout, four equipment-family sightlines, pointer control selection, palette, typography, controls, and evaluator workflow were verified in the browser. The stage 2 reach reference is now the visual-quality target. The procedural 3D art remains a documented material deviation and should not be treated as a manufacturer-approved digital twin.
