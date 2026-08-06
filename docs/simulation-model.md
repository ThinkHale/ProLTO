# Simulation model

What the simulator actually computes, what it approximates, and where the
approximation stops being good enough to defend. The same boundary in
[the fidelity audit](realism-fidelity-audit.md) applies: these are reconstructed
working models, not manufacturer engineering data.

Physical chassis geometry lives in [`src/data/chassis.js`](../src/data/chassis.js),
separate from `equipment.js` so a display-copy edit cannot silently change
vehicle behavior. Distances are meters, masses kilograms, `-Z` is forward.

## Steering

`src/sim/vehicleDynamics.js`

A lift truck is not a car. One axle is fixed and body-aligned, the other steers,
so the truck rotates about a point on the **fixed axle line** and the steered end
sweeps a wide arc outside the turn. Which end steers is the defining handling
difference between the families:

| Family | Fixed axle | Steered axle | What swings |
| --- | --- | --- | --- |
| Counterbalance | Front drive axle | Rear axle | Rear counterweight |
| Reach / order picker | Outrigger load wheels | Rear drive wheel | Power unit |
| Pallet truck | Load wheels at the fork tips | Tiller / drive wheel | Operator platform |

The integrator is the standard kinematic bicycle re-referenced to the fixed axle:

```
psi_dot = v * tan(delta) / L
```

the fixed axle midpoint advances along the body's forward axis, and the rest of
the truck follows from the new heading. Tail swing is not scripted — it falls out
of the geometry, which is why `tailSwingRadius()` can be reported to the trainee
as a real number. Steering is rate-limited to the truck's hydraulic slew rate, so
full lock is not reachable in one frame.

**What this replaced.** A direct heading rate, `heading -= steer * turnRate *
steerRatio * sign(speed) * dt`, which pivoted the truck about its own origin and
produced *zero* tail swing. The `steerRatio` and `turnRate` tuning constants are
gone.

**Limits.** Purely kinematic: no tire slip, no understeer, no load transfer into
the steering. Valid at warehouse speeds, wrong at the limit of adhesion. Grades
and ramps are not modeled.

## Stability

`src/sim/stability.js`

1. Build the **support polygon** from the chassis. A four-wheel counterbalance
   truck is still a *triangle*, because its rear axle pivots on a center
   trunnion — that single fact is why forklifts tip sideways. Straddle trucks get
   a quadrilateral from the outriggers; pallet trucks a tricycle.
2. Combine truck, load, and (for order pickers) the elevated operator into one
   center of gravity. Load position follows fork height, reach extension, tilt,
   and sideshift.
3. Displace that CG by the inertial forces acting this frame — centrifugal from
   the turn radius the steering model already solved, longitudinal from braking
   and acceleration — to get where the resultant meets the floor.
4. Report the normalized margin to the nearest polygon edge, and **which** edge,
   so warnings can name the actual failure mode.

Rated capacity derates with load center, lift height, and pantograph extension,
so a load that is legal on the floor becomes an overload at height. Overload is
scored against the derated figure, not the plate figure.

**What this replaced.** A tuned linear scalar:
`100 - speed*4.5 - fork*.085 - |steer|*speed*7.5 - |sideshift|*18`. It moved in
roughly the right direction but had no mass, no load moment, no support geometry,
and no notion of which way the truck was about to go over.

**Limits.** Rigid body, level floor. No suspension, no tire deflection, no
dynamic load swing, no mast deflection under load. The stability *triangle* is
the correct static model and is what operator training teaches; a real tipover is
a dynamic event this does not integrate through. Treat margin as a training
signal, not a prediction of whether a specific truck goes over.

**Masses and CG heights are reconstructed**, derived from published capacity
charts, footprints, and turning radii and checked for internal consistency. They
are not data-plate values. Validate before any hiring decision.

## Facility collision

`src/sim/loadPhysics.js`, `src/sim/warehouse.js`

Selective rack is modeled as the hardware it is: a collider per upright frame
(unbounded in Y, because posts run floor to roof), a wider footplate collider at
the base, and a collider per beam per bay per level bounded to that elevation.
The bay opening between them is genuinely open, so forks enter a bottom-level
position and a full-height truck body does not.

Beams do not hard-block a *carried* load — a pallet has to be able to come down
onto them — but the contact is still recorded, so setting a load down on the rack
face is visible to the evaluator. Uprights block everything.

Contacts are classified and scored by what they mean: an upright strike is
critical because it closes an aisle and can bring a run down; a beam or stored
load is major; a cone is minor. Pedestrians are solid and critical.

**What this replaced.** One box collider per rack run, spanning every bay from
the floor to infinity — the entire rack face was a solid wall, so a trainee could
never enter a bay or judge an approach. Pedestrians had no collider at all and
could be driven straight through.

A pallet on the floor is not a bollard. Pressing a truck into one shoves it
across the concrete, modeled as displacement while in contact rather than as an
impulse: friction between wood and sealed concrete is high enough that a shoved
load has no meaningful coast, it stops the instant the truck does, and it never
quite keeps up. Resistance scales with load — an empty pallet skitters, a
2400 lb load barely shifts. Racked loads are excluded, because nudging a
beam-level pallet with the mast is a rack strike, not a shoving match. Pushing
is scored, since carrying is the correct technique.

**Limits.** Kinematic sweep with a binary search on first contact, not impulse
resolution. Pushed loads translate but do not rotate, tip, or spill, and loads
on the forks are rigid — they do not shift or slip. Racks do not deflect or
fail; a strike is scored, not simulated.

## Verification

`npm run verify` covers the models headlessly, including
`scripts/verify-dynamics.mjs` (tail swing, turn radius, rate limiting, stability
triangle, capacity derating) and `scripts/verify-facility.mjs` (bay openness,
beam elevations, solid pedestrians). Shader compilation and the wired simulation
loop need a real WebGL context and are covered by `scripts/smoke-drive.mjs`
against a running server.
