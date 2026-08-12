// Physical chassis geometry for the simulation models.
//
// This is deliberately separate from equipment.js. That file carries the
// operator-facing specification an evaluator reads; this one carries the
// dimensions the steering and stability solvers integrate. Splitting them keeps
// a display-copy edit from silently changing vehicle behavior.
//
// FRAME CONVENTION (three.js, matching rig_root):
//   -Z is forward, toward the forks.  +Z is aft, toward the operator station.
//   +X is the operator's right.        +Y is up from the floor.
// Every distance is meters, every mass kilograms, every angle degrees.
//
// PROVENANCE: mixed, and the difference matters.
//
// PUBLISHED figures, taken from manufacturer specification sheets and marked at
// the value they annotate:
//   Crown SC 6200   wheelbase 60.9 in, fork 36 in, capacity 4000 lb @ 24 in
//   Crown RR 5725   service weight 2.74 t, wheelbase 59.6-64.0 in, fork 36 in
//   Crown SP 1500   wheelbase 51-52 in, service 6845 lb + 1520 lb battery
//   Crown PE 4500-60 capacity 6000 lb, wheelbase consistent with 48 in forks
//
// RECONSTRUCTED estimates for everything else -- CG heights and positions, all
// Raymond masses, steer rates -- derived from footprint drawings and turning
// radii, then checked for internal consistency. Three of the four corrections
// above replaced estimates that were wrong by 13% to 54%, so treat any value
// not listed as published as provisional.
//
// The boundary in docs/realism-fidelity-audit.md applies either way: validate
// against the exact truck's data plate and capacity chart before any hiring
// decision. Published brochure figures are not a data plate.

const IN = .0254

// A lift truck has one FIXED axle and one STEERED axle, so it pivots about a
// point on the fixed axle line and the steered end sweeps wide. Which end is
// which is the defining handling difference between these families:
//   counterbalance / reach / order picker -> load axle fixed, drive axle steers
//   pallet trucks                         -> load wheels fixed, tiller steers
export const CHASSIS = {
  'Crown:reach': {
    // RR 5725-45: straddle reach truck. Load wheels ride at the outrigger tips,
    // the steered drive wheel sits under the power unit behind the operator.
    fixedAxleZ: -.62, steerAxleZ: .93, trackWidth: .84,
    // The single traction wheel steers with the rear drive unit. Motor speed is
    // therefore wheel-path speed; its component along the truck falls with
    // steering angle while yaw remains bounded at full lock.
    tractionAxle: 'steered',
    maxSteerDeg: 88, steerRateDegPerSec: 165,
    // Service weight 2.74 t published (was a 4210 kg estimate, 54% heavy,
    // which inflated every stability margin). Wheelbase 59.6-64.0 in confirms
    // the 1.55 m already modelled.
    serviceWeight: 2740, cgFromFixedAxleZ: .58, cgHeight: .74,
    // Support polygon is the straddle: two outrigger load wheels forward, the
    // drive wheel and stabilizing caster aft. Wider and far more longitudinally
    // stable than a counterbalance truck -- until the pantograph reaches out.
    support: 'straddle',
    outriggerHalfWidth: .49, outriggerTipZ: -.62,
    driveHalfWidth: .27,
    ratedLoadCenter: 24 * IN, ratedCapacity: 2041, ratedHeight: 270 * IN,
    // Reach trucks lose capacity fast with height and with the reach extended,
    // because an extended pantograph puts the load outside the outriggers.
    heightDerate: .34, reachDerate: .46, maxReachExtension: 42 * IN,
    forkZ: -1.02, forkPivotZ: -.62,
  },
  'Raymond:reach': {
    fixedAxleZ: -.6, steerAxleZ: .95, trackWidth: .86,
    tractionAxle: 'steered',
    maxSteerDeg: 88, steerRateDegPerSec: 170,
    serviceWeight: 4080, cgFromFixedAxleZ: .6, cgHeight: .73,
    support: 'straddle',
    outriggerHalfWidth: .5, outriggerTipZ: -.6,
    driveHalfWidth: .28,
    ratedLoadCenter: 24 * IN, ratedCapacity: 2041, ratedHeight: 270 * IN,
    heightDerate: .34, reachDerate: .46, maxReachExtension: 42 * IN,
    forkZ: -1.0, forkPivotZ: -.6,
  },
  'Crown:order-picker': {
    // SP 1500: the operator platform and the load both rise, so the combined CG
    // climbs with lift height far more than on any other family here.
    // Wheelbase 51-52 in = 1.308 m published; the 1.88 m estimate was 0.57 m
    // long, which made the platform far more longitudinally stable than it is.
    fixedAxleZ: -.78, steerAxleZ: .528, trackWidth: .74,
    tractionAxle: 'steered',
    maxSteerDeg: 86, steerRateDegPerSec: 150,
    // 6845 lb service + 1520 lb battery = 3794 kg published.
    serviceWeight: 3794, cgFromFixedAxleZ: .74, cgHeight: .68,
    support: 'straddle',
    outriggerHalfWidth: .43, outriggerTipZ: -.78,
    driveHalfWidth: .25,
    ratedLoadCenter: 24 * IN, ratedCapacity: 1361, ratedHeight: 402 * IN,
    heightDerate: .3, reachDerate: 0, maxReachExtension: 0,
    forkZ: -.92, forkPivotZ: -.78,
    // The operator's own mass rides the platform and counts toward the elevated CG.
    platformMass: 95, platformZ: .32,
  },
  'Raymond:order-picker': {
    fixedAxleZ: -.76, steerAxleZ: 1.06, trackWidth: .73,
    tractionAxle: 'steered',
    maxSteerDeg: 86, steerRateDegPerSec: 150,
    serviceWeight: 2640, cgFromFixedAxleZ: .72, cgHeight: .67,
    support: 'straddle',
    outriggerHalfWidth: .42, outriggerTipZ: -.76,
    driveHalfWidth: .25,
    ratedLoadCenter: 24 * IN, ratedCapacity: 1361, ratedHeight: 240 * IN,
    heightDerate: .3, reachDerate: 0, maxReachExtension: 0,
    forkZ: -.9, forkPivotZ: -.76,
    platformMass: 95, platformZ: .3,
  },
  'Crown:pallet': {
    // PE 4500 end-control rider: the steered drive wheel is under the operator
    // at the aft end, so the POWER UNIT is what swings, not a counterweight.
    fixedAxleZ: -.94, steerAxleZ: .5, trackWidth: .52,
    tractionAxle: 'steered',
    maxSteerDeg: 90, steerRateDegPerSec: 210,
    serviceWeight: 726, cgFromFixedAxleZ: 1.02, cgHeight: .42,
    support: 'tricycle',
    fixedHalfWidth: .3, driveHalfWidth: .17,
    ratedLoadCenter: 24 * IN, ratedCapacity: 2722, ratedHeight: 9 * IN,
    heightDerate: 0, reachDerate: 0, maxReachExtension: 0,
    // On a pallet truck the load wheels are at the FORK TIPS, so the load sits
    // BETWEEN the axles rather than cantilevered ahead of them the way it is on
    // a counterbalance truck. forkPivotZ is therefore the fork heel at the power
    // unit -- 48 in of fork ahead of it -- not the tip. Measuring the load
    // center from the tip puts the load outside the support polygon and reports
    // a truck that is about to tip over while it is sitting still.
    forkZ: -.72, forkPivotZ: .279, forkLength: 48 * IN,
  },
  'Raymond:pallet': {
    // 8210 walkie: same topology, shorter and lighter, tiller-steered.
    fixedAxleZ: -.86, steerAxleZ: .42, trackWidth: .48,
    tractionAxle: 'steered',
    maxSteerDeg: 90, steerRateDegPerSec: 230,
    serviceWeight: 458, cgFromFixedAxleZ: .92, cgHeight: .38,
    support: 'tricycle',
    fixedHalfWidth: .28, driveHalfWidth: .15,
    ratedLoadCenter: 24 * IN, ratedCapacity: 2041, ratedHeight: 8 * IN,
    heightDerate: 0, reachDerate: 0, maxReachExtension: 0,
    // Same straddled-load topology as the PE 4500: heel at the power unit.
    forkZ: -.66, forkPivotZ: .283, forkLength: 45 * IN,
  },
  'Crown:counterbalance': {
    // SC 6200: four-wheel sit-down. Fixed drive axle forward under the mast,
    // steered rear axle under the counterweight -- the classic tail swing.
    // Wheelbase 60.9 in = 1.547 m and overall width 44.5 in = 1.130 m, from
    // the published SCF 6261-40 specification. The previous 1.35 m wheelbase
    // was a reconstructed estimate and was 0.197 m short, which made the truck
    // turn tighter than the real machine can.
    fixedAxleZ: -.16, steerAxleZ: 1.387, trackWidth: .93,
    // The front drive axle is fixed and body-aligned; the rear axle only
    // steers. Keep traction topology explicit so this truck is not integrated
    // as though its motor were mounted in the steered wheel.
    tractionAxle: 'fixed',
    maxSteerDeg: 78, steerRateDegPerSec: 120,
    serviceWeight: 3420, cgFromFixedAxleZ: .69, cgHeight: .58,
    // Four-wheel counterbalance trucks are still a TRIANGLE: the rear axle
    // pivots on a center trunnion, so the third support point is the pivot,
    // not the rear tires. This is the whole reason a forklift tips sideways.
    support: 'triangle',
    // The trunnion is ON the steered axle, so it moves with the corrected
    // wheelbase; leaving it at 1.19 would have put the stability triangle's
    // apex 0.2 m ahead of the axle it actually sits on.
    fixedHalfWidth: .465, pivotZ: 1.387,
    ratedLoadCenter: 24 * IN, ratedCapacity: 1814, ratedHeight: 187 * IN,
    heightDerate: .22, reachDerate: 0, maxReachExtension: 0,
    forkZ: -.52, forkPivotZ: -.16,
  },
  'Raymond:counterbalance': {
    // 4460 three-wheel: a real triangle in hardware. Tighter turning, and
    // markedly less lateral margin than the four-wheel truck.
    fixedAxleZ: -.18, steerAxleZ: 1.24, trackWidth: .9,
    tractionAxle: 'fixed',
    maxSteerDeg: 88, steerRateDegPerSec: 130,
    serviceWeight: 3260, cgFromFixedAxleZ: .72, cgHeight: .56,
    support: 'triangle',
    fixedHalfWidth: .45, pivotZ: 1.24,
    ratedLoadCenter: 24 * IN, ratedCapacity: 1814, ratedHeight: 187 * IN,
    heightDerate: .22, reachDerate: 0, maxReachExtension: 0,
    forkZ: -.54, forkPivotZ: -.18,
  },
}

const FALLBACK = CHASSIS['Crown:counterbalance']

export function getChassis(profile) {
  return CHASSIS[`${profile.manufacturer}:${profile.family}`] || FALLBACK
}

export function wheelbase(chassis) {
  return Math.abs(chassis.steerAxleZ - chassis.fixedAxleZ)
}
