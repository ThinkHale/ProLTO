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
- Mouse drag on open space: look around
- VR trigger: point to, grab, and move a physical control
- Control: toggle operator-presence or deadman control; entering operator mode engages it automatically
- W / S or arrow up / down: travel
- A / D or arrow left / right: steer
- E / Q: lift / lower
- R / F: reach / retract
- T / G: tilt back / forward
- Z / C: sideshift left / right
- B: service brake
- Space: horn

Thumbsticks remain available as an accessibility fallback in VR. The primary VR interaction is grabbing the modeled truck controls.

## Equipment behavior

- Crown RR 5725-45 and Raymond 7500 reach trucks: separate side-stance and universal-stance compartments, manufacturer-specific steering and multifunction controls, presence pads, rear drive and steer, outriggers, mast chains, and reach carriages.
- Crown SP 1500 and Raymond 5300 order pickers: distinct power units and operator enclosures, opposing hand controls, deadman pedals, elevating platforms and viewpoints, and lift-height-dependent travel speed.
- Crown PE 4500 and Raymond 8210 pallet trucks: end-control rider and walkie configurations with distinct power units, operator positions, articulated tillers, travel controls, lift rockers, emergency reverse switches, forks, and load wheels.
- Crown SC 6200 and Raymond 4460 counterbalance trucks: four-wheel and three-wheel chassis, seated cabs, steering wheels, independent pedals and hydraulic levers, rear steering, mast tilt, sideshift, and counterweight swing.

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
