# ProLTO

ProLTO is a WebXR-first powered lift truck knowledge and practical-assessment prototype for Meta Quest 3 and desktop browsers. It provides first-person, equipment-specific operator stations for eight Crown and Raymond profiles, direct manipulation of visible controls, a responsive 3D warehouse exercise, an OSHA-grounded knowledge assessment, live safety-event capture, an evaluator checklist, and an evidence score.

## Run locally

```powershell
npm install
npm run dev
```

Open the local URL in a desktop browser. WebXR immersive sessions require HTTPS and a compatible headset browser, so use the GitHub Pages deployment or another secure host for Quest testing.

## Controls

- Mouse or touch: drag visible controls in the operator station
- Mouse drag on open space: unrestricted 360-degree cockpit inspection
- Home: recenter the desktop operator view
- VR trigger or hand pinch: reach to, grab, and move the modeled physical control through its constrained axis
- VR presence control: hold the modeled deadman pedal or presence control continuously
- Control key: toggle operator presence in desktop accessibility mode
- W / S or arrow up / down: travel
- A / D or arrow left / right: steer
- E / Q: lift / lower
- R / F: reach / retract
- T / G: tilt back / forward
- Z / C: sideshift left / right
- B: service brake
- Space: horn

Laser selection and thumbstick driving are disabled during the practical assessment. They can be enabled explicitly in the control guide as an accessibility fallback. The default VR interaction uses near-hand pickup, controller or hand models, local mechanism axes, neutral detent haptics, and spring return.

## Vehicle behavior and stability

Steering uses steered-axle kinematics: one axle is fixed and the other steers, so
the truck pivots about its fixed axle and the steered end sweeps outside the
turn. Rear counterweight swing on a sit-down truck, power-unit swing on a reach
truck, and platform swing on an end-control pallet truck are consequences of that
geometry rather than scripted effects.

Stability solves the combined center of gravity of truck, load, and elevated
operator against the truck's real support polygon — a triangle for counterbalance
trucks, because the rear axle pivots on a center trunnion — displaced by the
centrifugal and braking forces acting at that moment. Rated capacity derates with
load center, lift height, and pantograph extension, so a load that is legal on
the floor can become an overload at height.

See [the simulation model](docs/simulation-model.md) for what each model
approximates and where the approximation stops being defensible.

## Warehouse exercise

The practical area uses swept truck collision envelopes, solid walls, columns, fixtures and pallet stacks, knockable safety cones, solid pedestrians, and individually tracked 48 x 40 inch palletized loads. Selective rack is modeled as hardware: a collider per upright frame and per beam at its own elevation, so bay openings are genuinely open and forks enter a bottom-level position while a full-height truck body does not. A pallet engages only when both forks enter its pockets with sufficient alignment and penetration, then lift clear of the floor or rack support. An engaged pallet follows the animated carriage or reach assembly as a rigid load and can be lowered onto the floor, placed into an open rack slot, or removed from an occupied slot. Reset restores the truck, every pallet and rack slot, and all cones to their initial state.

## Equipment behavior

- Crown RR 5725-45 36V and Raymond 7500 Universal Stance reach trucks: fixed pilot configurations with separate side-stance and universal-stance compartments, manufacturer-specific steering and travel mechanisms, presence controls, open-view masts, outriggers, and reach carriages.
- Crown SP 1500 and Raymond 5300 order pickers: distinct power units and operator enclosures, opposing hand controls, deadman pedals, elevating platforms and viewpoints, and lift-height-dependent travel speed.
- Crown PE 4500 and Raymond 8210 pallet trucks: end-control rider and walkie configurations with distinct power units, operator positions, articulated tillers, travel controls, lift rockers, emergency reverse switches, forks, and load wheels.
- Crown SC 6200 manual-lever and Raymond 4460 legacy counterbalance trucks: fixed cockpit configurations with four-wheel and three-wheel chassis, seated cabs, steering wheels, pedals, mechanical hydraulic levers, rear steering, mast tilt, sideshift, and counterweight swing.

## Equipment assets

Trucks are authored as parametric Blender models under [assets-src/](assets-src/) and
shipped as articulated glTF binaries in [public/models/](public/models/). The simulator
binds to named rig nodes for mast, carriage, reach, platform, control, and wheel
motion, and reads control metadata from glTF `extras`. See
[the asset pipeline](docs/asset-pipeline.md) for the build commands, the rig
contract, and the visual QA loops.

The models are reconstructed from traceable public Crown and Raymond references.
See [the web reference modeling record](docs/web-reference-modeling.md) for source
links, modeling decisions, and validation limits.

## Important scope boundary

This prototype is a decision-support and controlled-practice tool. It does not issue OSHA certification. Under 29 CFR 1910.178(l), the employer remains responsible for formal instruction, practical training, and evaluation of operator performance in the workplace by a person with the necessary knowledge, training, and experience.

Before using a truck profile for hiring decisions, validate the control mapping, steering configuration, performance envelope, warnings, and attachments against the exact truck's current operator manual and data plate. The current reference-built models are assessment assets, not manufacturer-approved digital twins.

Meta Quest 3 does not provide native foot tracking. Pedal geometry and interlocks are represented, but a practical evaluation of real foot placement, pedal travel, and pedal force requires a supported external pedal or tracker.
