# ProLTO research and validation basis

## Regulatory model

The assessment structure follows 29 CFR 1910.178(l): formal instruction, practical training, and evaluation of workplace performance. ProLTO can support interactive instruction and controlled practical exercises while collecting evidence for a qualified evaluator. It cannot replace the employer's workplace evaluation or certify an operator by itself.

The knowledge bank and safety detectors cover truck controls, differences from automobiles, visibility, steering and rear swing, load stability, capacity and data plates, operating limitations, pre-operation inspection, pedestrian separation, blind intersections, fork height during travel, grades, ramps, docks, unattended-truck shutdown, and refresher triggers.

## Equipment profiles

- Crown RR 5700 reach truck: side-stance operator compartment, Multi-Task Control Handle, forks-first and power-unit-first travel, power-unit swing, reach, tilt, sideshift, and configuration-dependent steering.
- Raymond 7000 Series reach truck: universal-stance variants, single-axis multifunction handle, simultaneous hydraulic functions, reach, tilt, and sideshift.
- Crown SP 1500 order picker: elevating operator platform, dual-position tiller, right-hand control, visibility openings, restraint, and height-dependent travel behavior.
- Raymond 5000 Series order picker: multifunction travel and lift control, deadman brake pedal, elevating platform, fall protection, and overhead awareness.
- Crown PE 4500 end-control rider pallet truck: X10 control handle, twist travel control, fork raise/lower, coast behavior, and heavy-load stopping distance.
- Raymond 8210 walkie pallet truck: tiller brake zones, butterfly travel control, emergency reverse, Click2Creep behavior, and anti-roll braking.
- Crown SC 6200 sit-down counterbalance: seated electric three-wheel layout, steering wheel, pedals, hydraulic controls, rear swing, operator restraint, and data plate capacity.
- Raymond 4460 sit-down counterbalance: seated three-wheel layout, tilt steering column, cowl hydraulic levers, integral sideshift, and automatic parking brake behavior.

## Validation gates before production use

1. Obtain the exact model, serial range, option list, attachment list, current operator manual, and truck data plate for every deployed profile.
2. Have an experienced operator and qualified evaluator validate control direction, hand placement, steering mode, braking, plugging, hydraulic interlocks, visibility, alarms, and shutdown procedure on the physical truck.
3. Tune acceleration, braking, turn radius, mast velocity, reach speed, maximum travel speed by lift height, stability deductions, collision envelopes, and task tolerances with measured truck behavior.
4. Validate each assessment against the employer's facility traffic plan, aisle widths, rack geometry, dock conditions, loads, pedestrian controls, and applicable state-plan requirements.
5. Run Quest 3 comfort testing at target frame rate. Reduce acceleration changes and camera motion where needed without masking unsafe control behavior.
6. Establish scoring validity with a pilot cohort of known-qualified and known-novice operators before using thresholds in hiring decisions.

## Technical architecture

React manages the evaluator interface, knowledge assessment, truck profiles, and state. Three.js renders a shared warehouse around four separate equipment-family rigs. Each rig owns its operator eye point, control geometry, control raycast targets, hydraulic animation, and family dynamics. Desktop users drag the modeled controls directly. Quest users point at a control, hold a controller trigger, and move the control through its axis. GitHub Pages supplies the HTTPS secure context required by WebXR. No server is required for the current local-only prototype. Candidate record persistence and organization access control should be added before production use.

## Primary references

- [OSHA 29 CFR 1910.178, Powered industrial trucks](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.178)
- [OSHA, Developing a Training Program for Powered Industrial Truck Operators](https://www.osha.gov/training/library/powered-industrial-trucks/training-program)
- [OSHA interpretation on triennial knowledge and skills evaluation](https://www.osha.gov/laws-regs/standardinterpretations/2005-08-01)
- [Crown current operator manual library](https://www.crown.com/en-us/operator-manuals.html)
- [Crown RR/RD Series reach truck](https://www.crown.com/en-us/forklifts/reach-trucks/rr-rd-rider-deep-reach-truck.html)
- [Crown SP 1500 order picker](https://www.crown.com/en-us/forklifts/man-up-order-pickers/sp-1500-stockpicker.html)
- [Raymond 7000 Series reach truck brochure](https://www.raymond-central.com/-/media/raymond/literature/truck-literature/reach-trucks/raymond7000-series-reach-trucks-brochure.pdf)
- [Raymond 8210 walkie pallet truck](https://www.raymondcorp.com/forklifts/electric-pallet-jack/8210-walkie-pallet-truck)
- [Raymond 4460 sit-down counterbalance truck](https://www.raymondcorp.com/forklifts/counterbalanced-trucks/4460-sit-down-forklift)
- [MDN WebXR session startup and security requirements](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Startup_and_shutdown)
- [Three.js WebXR manager](https://threejs.org/docs/pages/WebXRManager.html)
