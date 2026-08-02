# ProLTO

ProLTO is a WebXR-first powered lift truck knowledge and practical-assessment prototype for Meta Quest 3 and desktop browsers. It provides truck-specific control guidance, a responsive 3D warehouse exercise, an OSHA-grounded knowledge assessment, live safety-event capture, an evaluator checklist, and an evidence score.

## Run locally

```powershell
npm install
npm run dev
```

Open the local URL in a desktop browser. WebXR immersive sessions require HTTPS and a compatible headset browser, so use the GitHub Pages deployment or another secure host for Quest testing.

## Controls

- W / S or arrow up / down: travel
- A / D or arrow left / right: steer
- E / Q: lift / lower
- R / F: reach / retract
- T / G: tilt back / forward
- Space: horn
- VR left stick: travel and steer
- VR right stick: lift / lower
- VR right trigger / grip: reach / retract
- VR left trigger: horn

## Important scope boundary

This prototype is a decision-support and controlled-practice tool. It does not issue OSHA certification. Under 29 CFR 1910.178(l), the employer remains responsible for formal instruction, practical training, and evaluation of operator performance in the workplace by a person with the necessary knowledge, training, and experience.

Before using a truck profile for hiring decisions, validate the control mapping, steering configuration, performance envelope, warnings, and attachments against the exact truck's current operator manual and data plate.
