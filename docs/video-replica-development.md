# Video replica development

The Crown SP 3500 and site-specific Raymond 7500 are candidate assets developed
in parallel with ProLTO's shipped fleet. They must not be mapped in
`src/sim/vehicleFactory.js` until their reference and in-app QA gates pass.

## Candidate modules

| Candidate | Source module | Intended treatment |
| --- | --- | --- |
| Crown SP 3500 | `assets-src/trucks/crown_sp3500.py` | New equipment variant. Do not replace the Crown SP 1500 profile. |
| Raymond 7500 site replica | `assets-src/trucks/raymond_7500_video_replica.py` | Candidate visual upgrade for the existing Raymond 7500 profile after approval. |

## Evidence

Primary evidence is the two supplied 1080p walkthrough videos. Public Crown and
Raymond specification sheets, manuals, brochures, equipment listings and
walkaround videos fill views that were not captured. Published dimensions take
priority over perspective estimates.

The Crown video establishes the older full-width vertical console, large
steering handwheel, horizontal travel grip, vertical switch bank, front pane,
storage trough, safety rails and accessory tether. It does not establish the
exact mast option or serial-specific fork length.

The Raymond video establishes the red Universal Stance body, lithium enclosure,
ACR marking, molded cowl, steering and hydraulic-control locations, lean pad,
terminal mount, overhead sensors and observed side labels. The public 7500
single-reach sheet remains the dimensional authority.

## Approval gates

1. Hero, side, rear-quarter and operator render silhouettes match references.
2. Operator-eye control positions and sight restrictions match the footage.
3. Every required rig node and physical control action passes ProLTO validation.
4. Fork geometry engages the existing pallet physics without offsets.
5. Quest-target scene remains within the agreed triangle, draw-call and texture
   budgets.
6. A separate preview deployment is reviewed before any asset mapping changes.

## Building without replacing production

Run the manual `Build replica model candidates` GitHub workflow. It uploads the
two GLBs and QA renders as a workflow artifact. It does not commit exports and
does not change `public/models/raymond_7500.glb`,
`public/models/crown_sp1500.glb`, or the runtime asset map.

