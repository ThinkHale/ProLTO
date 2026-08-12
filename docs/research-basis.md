# ProLTO research and validation basis

## Regulatory model

The assessment structure follows 29 CFR 1910.178(l): formal instruction, practical training, and evaluation of workplace performance. ProLTO can support interactive instruction and controlled practical exercises while collecting evidence for a qualified evaluator. It cannot replace the employer's workplace evaluation or certify an operator by itself.

The knowledge bank and safety detectors cover truck controls, differences from automobiles, visibility, steering and rear swing, load stability, capacity and data plates, operating limitations, pre-operation inspection, pedestrian separation, blind intersections, fork height during travel, grades, ramps, docks, unattended-truck shutdown, and refresher triggers.

## Equipment profiles

Every listed truck is a reference-only, unverified configuration. Runtime metadata pins the shipped GLB identity and modeled control package, while unknown mast codes, serial ranges, installed options, and data-plate details remain explicitly unset. The labels do not imply manufacturer approval or an exact physical twin.

- Crown RR 5725-45 reach truck: side-stance operator compartment, Multi-Task Control Handle, forks-first and power-unit-first travel, power-unit swing, reach, tilt, sideshift, and configuration-dependent steering. The current Crown specification publishes power-unit-first empty/loaded speeds of 7.2/6.3 mph and forks-first empty/loaded speeds of 6.3/5.3 mph; those four values now bound the reference profile.
- Raymond 7000 Series reach truck: universal-stance variants, single-axis multifunction handle, simultaneous hydraulic functions, reach, tilt, and sideshift.
- Crown SP 1500 fixed-fork order picker reference configuration: elevating operator platform, dual-position tiller, right-hand control, visibility openings, restraint, and height-dependent travel behavior. The auxiliary-lift variant is not modeled.
- Raymond 5300 order picker: the intended 3000 lb, 240 in reference is the published three-stage configuration. The current GLB contains only `mast_rail_s0_*` and `mast_rail_s1_*`; its third stage and staged lift sequencing are not modeled, so exact mast fidelity remains a release blocker pending a Blender re-export and physical validation.
- Crown PE 4500-60, 6000 lb end-control rider pallet truck reference configuration: standard X10 rider controls, twist travel control, fork raise/lower, emergency reverse, and heavy-load stopping distance. QuickPick and QuickCoast are excluded. The published empty power-unit-first maximum is 9.0 mph and now bounds the reference profile.
- Raymond 8210 walkie pallet truck: tiller brake zones, butterfly travel control, emergency reverse, Click2Creep behavior, and anti-roll braking.
- Crown SC 6200 sit-down counterbalance: seated electric four-wheel layout, standard manual-lever configuration, steering wheel, pedals, rear swing, operator restraint, and data plate capacity.
- Raymond 4460 sit-down counterbalance: fixed legacy three-wheel configuration with tilt steering column, cowl hydraulic levers, monochrome display and open-view mast. The 2024 enhanced controls are a separate configuration.

The speed and mast figures above are manufacturer series and configuration table values, not measurements from the shipped GLBs or a named physical truck. They do not establish acceleration curves, controller programming, tire condition, mast code, serial-range changes, installed options, or data-plate capacity. Exact-replica approval still requires the named serial range, data plate, option list, physical measurements, and operator validation.

## Validation gates before production use

1. Obtain the exact model, serial range, option list, attachment list, current operator manual, and truck data plate for every deployed profile.
2. Have an experienced operator and qualified evaluator validate control direction, hand placement, steering mode, braking, plugging, hydraulic interlocks, visibility, alarms, and shutdown procedure on the physical truck.
3. Tune acceleration, braking, turn radius, mast velocity, reach speed, maximum travel speed by lift height, stability deductions, collision envelopes, and task tolerances with measured truck behavior.
4. Validate each assessment against the employer's facility traffic plan, aisle widths, rack geometry, dock conditions, loads, pedestrian controls, and applicable state-plan requirements.
5. Run Quest 3 comfort testing at target frame rate. Reduce acceleration changes and camera motion where needed without masking unsafe control behavior.
6. Establish scoring validity with a pilot cohort of known-qualified and known-novice operators before using thresholds in hiring decisions.
7. Use a supported external pedal or tracker before treating foot-operated deadman, brake, or accelerator performance as validated. Quest 3 does not provide native foot tracking.

## Technical architecture

React manages the evaluator interface, knowledge assessment, truck profiles, and state. Three.js renders a shared warehouse around model-specific equipment rigs. Each rig owns a desktop operator eye, a separate tracked-floor XR origin, control geometry, near-hand targets, carriage and control animation, and family dynamics. Desktop users drag the modeled controls directly and can inspect the full cockpit through unrestricted 360-degree look. Quest users reach to a control, hold trigger or pinch, and move it through its local mechanical axis. Laser and thumbstick input is an explicit accessibility mode. Wheel steering and roll follow measured asset pivots and accepted poses. Nested mast stages, chains, cylinders, and pantographs still require validated kinematics and production articulation.

A deterministic warehouse solver performs swept compound-body collision against racks, fixtures, palletized loads, and knockable cones. Fork engagement requires alignment, pocket-height eligibility, insertion depth, and lift clearance. Carried loads remain rigidly attached to the animated fork frame and can settle on the floor or in an available rack slot. GitHub Pages supplies the HTTPS secure context required by WebXR. No application backend is required for the current reference build, but a static web origin is required to serve its modules and assets. Candidate record persistence and organization access control should be added before production use.

## Primary references

- [OSHA 29 CFR 1910.178, Powered industrial trucks](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.178)
- [OSHA, Developing a Training Program for Powered Industrial Truck Operators](https://www.osha.gov/training/library/powered-industrial-trucks/training-program)
- [OSHA interpretation on triennial knowledge and skills evaluation](https://www.osha.gov/laws-regs/standardinterpretations/2005-08-01)
- [Crown current operator manual library](https://www.crown.com/en-us/operator-manuals.html)
- [Crown RR/RD Series reach truck](https://www.crown.com/en-us/forklifts/reach-trucks/rr-rd-rider-deep-reach-truck.html)
- [Crown RR 5700 current specifications](https://www.crown.com/content/dam/crown/pdfs/en-us/brochures/reach-trucks/rr-5700-specifications.pdf)
- [Crown SP 1500 order picker](https://www.crown.com/en-us/forklifts/man-up-order-pickers/sp-1500-stockpicker.html)
- [Crown PE 4500 specifications](https://www.crown.com/content/dam/crown/pdfs/en-la/specifications/pe-4500-specifications.pdf)
- [Raymond 5300 configuration announcement](https://www.raymondcorp.com/news/2018/raymond-announces-5300-orderpicker)
- [Raymond 7000 Series reach truck brochure](https://www.raymond-central.com/-/media/raymond/literature/truck-literature/reach-trucks/raymond7000-series-reach-trucks-brochure.pdf)
- [Raymond 8210 walkie pallet truck](https://www.raymondcorp.com/forklifts/electric-pallet-jack/8210-walkie-pallet-truck)
- [Raymond 4460 sit-down counterbalance truck](https://www.raymondcorp.com/forklifts/counterbalanced-trucks/4460-sit-down-forklift)
- [MDN WebXR session startup and security requirements](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Startup_and_shutdown)
- [Three.js WebXR manager](https://threejs.org/docs/pages/WebXRManager.html)
