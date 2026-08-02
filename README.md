# ProLTO

ProLTO is a WebXR-first powered lift truck knowledge and practical-assessment prototype for Meta Quest 3 and desktop browsers. It provides first-person, equipment-specific operator stations, direct manipulation of visible controls, a responsive 3D warehouse exercise, an OSHA-grounded knowledge assessment, live safety-event capture, an evaluator checklist, and an evidence score.

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

- Reach truck: side-stance cab, left steering tiller, right multifunction handle, presence pad, rear drive and steer, reach carriage, and elevated-fork speed reduction.
- Order picker: opposing hand controls, deadman pedal, elevating operator platform and viewpoint, and lift-height-dependent travel speed.
- Pallet truck: Crown end-control rider or Raymond walkie configuration, articulated tiller, butterfly or X10-style travel control, low lift range, and emergency reverse switch.
- Counterbalance: seated cab, steering wheel, independent pedals and hydraulic levers, front drive, rear steering, mast tilt, sideshift, and counterweight swing.

## Important scope boundary

This prototype is a decision-support and controlled-practice tool. It does not issue OSHA certification. Under 29 CFR 1910.178(l), the employer remains responsible for formal instruction, practical training, and evaluation of operator performance in the workplace by a person with the necessary knowledge, training, and experience.

Before using a truck profile for hiring decisions, validate the control mapping, steering configuration, performance envelope, warnings, and attachments against the exact truck's current operator manual and data plate. The current procedural models are an interaction prototype, not manufacturer-approved digital twins.
