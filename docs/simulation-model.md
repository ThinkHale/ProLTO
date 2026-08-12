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
the truck follows from the new heading. Tail swing is not scripted; it falls out
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
   trunnion. That single fact is why forklifts tip sideways. Straddle trucks get
   a quadrilateral from the outriggers; pallet trucks a tricycle.
2. Combine truck, load, and (for order pickers) the elevated operator into one
   center of gravity. Load position follows fork height, reach extension, tilt,
   and sideshift.
3. Displace that CG by the inertial forces acting this frame: centrifugal from
   the turn radius the steering model already solved, longitudinal from braking
   and acceleration, to get where the resultant meets the floor.
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

Beam steel blocks the carriage and carried pallet during horizontal entry. A
narrow top-surface tolerance permits a correctly elevated pallet to settle onto
two separated support beams without treating the contact skin as penetration.
Rack placement is rejected when the target slot lacks physical support geometry.
Uprights block everything.

Contacts are classified and scored by what they mean: an upright strike is
critical because it closes an aisle and can bring a run down; a beam or stored
load is major; a cone is minor. Pedestrians are solid and critical.

**What this replaced.** One box collider per rack run, spanning every bay from
the floor to infinity. The entire rack face was a solid wall, so a trainee could
never enter a bay or judge an approach. Pedestrians had no collider at all and
could be driven straight through.

A movable pallet on the floor can be shoved across the concrete, modeled as
displacement while in contact rather than as an impulse. Each displacement is
swept and stops at rack steel, walls, pedestrians, or another load. Resistance
scales with load, so an empty pallet moves farther than a loaded one. Loads marked
immovable and racked loads remain solid. Pushing is scored, since carrying is the
correct technique.

**Limits.** Kinematic sweep with a binary search on first contact, not impulse
resolution. Pushed loads translate conservatively but do not rotate, tip, or
spill, and loads on the forks are rigid. They do not shift or slip. Racks do not
deflect or fail; a strike is scored, not simulated.

## Hydraulic motion and physical forks

`src/sim/loadPhysics.js`

Lift, reach, sideshift, tilt, carried-load motion, and an order-picker platform
do not move with the truck root. They therefore use a separate full 3D swept
configuration resolver, `resolveHydraulicMotion`. A configuration contains:

```js
{
  values: { lift, reach, tilt, sideshift },
  colliders: [{ id, x, z, heading, halfWidth, halfLength, minY, maxY }],
}
```

Current and proposed configurations must contain the same unique collider IDs.
Invalid or incomplete OBBs fail closed. The resolver interpolates horizontal,
vertical, angular, and size changes at no more than 25 mm per step, then binary
searches the first blocked interval. It returns `acceptedConfiguration`, the
accepted fraction, deduplicated contact evidence, and the blocking contacts.

Penetration is compared independently in the horizontal and vertical separating
directions. A new contact, or any axis becoming deeper, is blocked. Lowering or
retracting from an existing overlap is accepted when neither axis becomes worse.
This escape rule is necessary because imported geometry or a corrected collider
can otherwise trap a machine permanently inside a contact.

The two fork blades are generated from the live fork frame by
`forkTineCollidersForFrame`. They are solid against rack steel, walls,
pedestrians, loads, and pallet wood during both hydraulic movement and truck
travel. A narrow pallet exception applies only when both blades are inside the
two distinct GMA stringer openings, aligned with the 48 inch travel axis, and
vertically contained in the fork pocket. One blade, both blades in one opening,
side entry, stringer intersection, or deck intersection remains blocking.

Hydraulic contact events use the same canonical rack, pedestrian, load, cone,
and facility classifications as travel contacts. Multiple moving colliders that
hit one obstacle emit one scoreable event, and held input does not emit another
event until contact clears.

The selected equipment profile capacity is copied into
`forkSpecification.maximumLoadWeight` by `forkConfigurationForProfile`, in the
same pounds unit used by pallet metadata. `engagementEligibility` remains the
module-boundary hook for a lower live capacity computed from height, load center,
and reach extension.

### Simulator integration order

For each fixed simulation step:

1. Resolve truck travel first. The load solver automatically transforms its last
   accepted hydraulic configuration into truck-local sweep bodies, so carriage,
   platform, carried load, and both tines remain solid during travel.
2. Snapshot the current hydraulic values and world colliders. Include the
   carriage or backrest, both results from `forkTineCollidersForFrame`, the
   carried pallet when present, and the elevated order-picker platform. The
   order-picker power unit stays in the fixed body collider; its platform must
   not remain in that floor-fixed envelope.
3. Compute the proposed values, temporarily apply all rig transforms, update
   world matrices, synchronize the carried pallet, and capture the proposed
   colliders with the same IDs.
4. Call `loadPhysics.resolveHydraulicMotion(current, proposed)`. Copy
   `result.acceptedConfiguration.values` back to simulation state, apply those
   accepted transforms, update matrices again, and synchronize the carried load.
   Do not leave the scene at the rejected proposed transforms.
5. Build and commit an initial current configuration immediately after truck
   setup, before the first travel step. `reset()` clears the stored configuration,
   so reset must commit the rebuilt rest configuration before travel resumes.

Pitch is represented by a conservative yaw-oriented OBB with the full vertical
extent of the tilted blade. This prevents tunneling without claiming triangle
mesh contact or tine flex. Rack deflection, mast flex, chain stretch, and load
slip remain outside this solver.

## Verification

`npm run verify` covers the models headlessly, including
`scripts/verify-dynamics.mjs` (tail swing, turn radius, rate limiting, stability
triangle, capacity derating) and `scripts/verify-facility.mjs` (bay openness,
beam elevations, solid pedestrians). Shader compilation and the wired simulation
loop need a real WebGL context and are covered by `scripts/smoke-drive.mjs`
against a running server.
