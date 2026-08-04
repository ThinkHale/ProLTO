# Reach-truck cockpit fidelity audit

This audit treats manufacturer cockpit plates as the visual authority. Generated concepts and generic reach-truck imagery are not acceptance targets.

## Fixed pilot configurations

- Crown RR 5725-45 36V, standard non-S operator compartment.
- Raymond 7500 Universal Stance 36V, integrated display and optional secondary handle.

## Crown RR 5725-45

Authority: [official operator manual page 11](https://www.crown.com/content/dam/crown/pdfs/operator-manuals/english/reach-trucks/rr5700_pf18340-f_en.pdf#page=11) and [official operator-angle control photograph](https://www.crown.com/content/dam/crown/images/forklift-series/features/rr5700-precise-control.jpg).

| Fidelity point | Required evidence | Current implementation | Status |
| --- | --- | --- | --- |
| Operator position | Standard variable side stance, not the RR 5700S seated compartment | Standing side stance with separate desktop eye and tracked-floor XR origin | Pass for configuration and sightline |
| Console silhouette | Tall charcoal wraparound molding with integrated arched cluster | Rebuilt compound console wall, arched insert, switch row, status lamps, and shallow live display | Photo-matched, measurement validation pending |
| Steering | Left Crown palm tiller and knob | Dedicated radial steering mesh and pivot | Pass for layout and mechanism family |
| Travel and hydraulics | Right Multi-Task handle with push/pull travel, lift/lower and thumb functions | Articulated handle, travel pivot, lift, reach, tilt, horn, spring return and local-axis VR manipulation | Pass for control mapping, force curve pending |
| Floor controls | Left brake, right presence pad, Entry Bar and suspended floor | Separate brake mesh, presence pad, entry bar, tread floor and continuous-hold VR interlock | Pass for layout |
| Surface finish | Molded grain, printed legends, seams and real wear | Original PBR materials, modeled legends and hard points, plus runtime procedural surfacing: baked roughness breakup, molded grain, tread relief and floor-height grime, triplanar-projected in object space. No manufacturer photograph textures | Improved, scan-quality surface detail pending |

Current application evidence: [Crown reach cockpit capture](../qa/app/crown-reach-cab.png).

## Raymond 7500 Universal Stance

Authority: [official product page](https://www.raymondcorp.com/forklifts/reach-fork-trucks/7500-universal-stance), [official maintenance manual](https://iparts.raymondcorp.net/iparts/docs/matrix/7500-7520_31001-Up_MM_1112860E.pdf), and [official Universal Stance image](https://www.raymondcorp.com/-/media/raymond/trucks/reach-trucks/hero-features-820x725/820x725universal3positions.jpg?la=en&w=1640). The manual's physical pages 248 to 249 establish the complete compartment. Physical pages 272 to 275 establish the primary handle controls.

| Fidelity point | Required evidence | Current implementation | Status |
| --- | --- | --- | --- |
| Compartment architecture | Broad asymmetric molded hood and open Universal Stance floor | Replaced the generic corner pod with a full-width sculpted hood, wraparound cowl, open floor and rear secondary-handle pocket | Photo-matched, measurement validation pending |
| Steering | Large left steering disc with spinner | Flush steering cup, separate disc, hub and spinner with radial near-hand manipulation | Pass for layout and mechanism family |
| Display and power controls | Forward-center display, right key and red EPO | Integrated live display surface, status points, key hardware and red disconnect | Pass for visible hard points |
| Primary handle | Fixed black grip with travel paddle, lift knob, reach buttons, horn and tilt/sideshift control | Fixed grip plus separately articulated travel, lift, reach, tilt and horn meshes | Pass for control mapping, force curve pending |
| Presence control | One low-profile deadman brake pedal | One modeled pedal requiring continuous VR hold | Pass for layout and interlock |
| Mast sightline | Nested rails, chains and crossbars without a giant center cylinder | Open-view mast with outboard hydraulics and no center cylinder | Pass for principal occlusion geometry |

Current application evidence: [Raymond reach cockpit capture](../qa/app/raymond-reach-cab.png).

## Runtime interaction acceptance

- WebXR reference origin sits on the compartment floor. Headset height supplies the user's physical eye height only once.
- Default qualification input uses near-hand control contact. Controller lasers and thumbstick driving are off until the evaluator enables accessibility mode.
- Control travel is computed in the control's local mechanical frame. Steering discs use radial motion. Travel handles and paddles use fore and aft motion. Hydraulic thumb controls use their local axes.
- Spring controls return to neutral. Controller haptics signal pickup and detent crossings.
- Desktop retains visible-control dragging and keyboard accessibility controls.

## Vehicle behavior

Steering, stability, and facility collision are documented separately in
[the simulation model](simulation-model.md), including what each model
approximates and where the approximation stops being defensible. In summary:
steering uses steered-axle kinematics referenced to the fixed axle, so tail
swing is geometric rather than scripted; stability solves a combined center of
gravity against the truck's real support polygon under the inertial forces
acting that frame; racks are modeled per upright and per beam so bays are open.
Chassis masses, CG heights, and axle positions are reconstructed working values,
not data-plate figures, and carry the same validation boundary as the geometry.

## Acceptance boundary

These cabs are original photo-matched reconstructions, not production CAD, scans, or manufacturer-approved digital twins. Public material does not provide hidden dimensions, exact control forces, every serial-range change, or the complete steering and hydraulic calibration. A viable hiring assessment still requires validation by an experienced operator against a named serial range, data plate, option list and current operator manual. Exact digital-twin status requires manufacturer CAD or a measured physical scan plus operator approval.
