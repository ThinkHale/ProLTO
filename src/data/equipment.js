export const equipmentFamilies = [
  { id: 'reach', label: 'Reach Truck', short: 'Reach', classLabel: 'Class II' },
  { id: 'order-picker', label: 'Order Picker', short: 'Order', classLabel: 'Class II' },
  { id: 'pallet', label: 'Pallet Truck', short: 'Pallet', classLabel: 'Class III' },
  { id: 'counterbalance', label: 'Sit-down Counterbalance', short: 'Sit-down', classLabel: 'Class I' },
]

export const equipmentProfiles = {
  'Crown:reach': {
    manufacturer: 'Crown', family: 'reach', model: 'RR 5725-45', capacity: 4500, maxLift: 400,
    maxSpeed: 8, forksFirstSpeed: 6.8, loadedPowerUnitSpeed: 7.2, loadedForksSpeed: 5.7,
    liftEmptyFpm: 153, liftLoadedFpm: 82, lowerFpm: 110, tiltForward: 3, tiltBack: 4,
    safeSpeed: 4.5, stance: 'Variable side stance', steerRatio: 1.15,
    driveUnit: 'rear', control: 'Multi-Task Control Handle', color: 0xd9d7cf,
    functions: ['Travel speed and direction', 'Lift / lower', 'Reach / retract', 'Tilt', 'Sideshift'],
    guidance: 'RR 5725-45 36V benchmark. Rated travel and hydraulic values follow Crown specifications. Site limits still govern operation.',
  },
  'Raymond:reach': {
    manufacturer: 'Raymond', family: 'reach', model: '7000 Series', capacity: 4500, maxLift: 444,
    maxSpeed: 7.5, safeSpeed: 4.5, stance: 'Universal stance', steerRatio: 1.2,
    driveUnit: 'rear', control: 'Single-axis control handle', color: 0xd94a3a,
    functions: ['Travel speed and direction', 'Lift / lower', 'Reach / retract', 'Tilt', 'Sideshift'],
    guidance: 'The control handle supports simultaneous hydraulic functions. Confirm the configured steering mode before operation.',
  },
  'Crown:order-picker': {
    manufacturer: 'Crown', family: 'order-picker', model: 'SP 1500', capacity: 3000, maxLift: 402,
    maxSpeed: 7.5, safeSpeed: 4, stance: 'Elevating operator platform', steerRatio: 1.05,
    driveUnit: 'rear', control: 'Dual-position tiller + right-hand control', color: 0xd9d7cf,
    functions: ['Travel speed and direction', 'Platform lift / lower', 'Aux lift', 'Horn'],
    guidance: 'Use the operator restraint system and remain within the platform. Travel and lift permissions change with height.',
  },
  'Raymond:order-picker': {
    manufacturer: 'Raymond', family: 'order-picker', model: '5000 Series', capacity: 3000, maxLift: 390,
    maxSpeed: 7.5, safeSpeed: 4, stance: 'Elevating operator platform', steerRatio: 1.05,
    driveUnit: 'rear', control: 'Travel / lift multifunction handle', color: 0xd94a3a,
    functions: ['Travel speed and direction', 'Platform lift / lower', 'Deadman brake', 'Horn'],
    guidance: 'The deadman brake pedal must remain engaged for operation. Maintain fall protection and overhead awareness at elevation.',
  },
  'Crown:pallet': {
    manufacturer: 'Crown', family: 'pallet', model: 'PE 4500', capacity: 8000, maxLift: 9,
    maxSpeed: 9.5, safeSpeed: 5, stance: 'End-control rider', steerRatio: 1.45,
    driveUnit: 'front', control: 'X10 control handle', color: 0xd9d7cf,
    functions: ['Twist-grip travel', 'Lift / lower', 'Horn', 'Coast control'],
    guidance: 'Keep the platform clear, use secure footing, and allow for load swing and stopping distance with heavy loads.',
  },
  'Raymond:pallet': {
    manufacturer: 'Raymond', family: 'pallet', model: '8210 Walkie', capacity: 4500, maxLift: 8,
    maxSpeed: 3.9, safeSpeed: 3.2, stance: 'Walk-behind', steerRatio: 1.6,
    driveUnit: 'front', control: 'Tiller control handle', color: 0xd94a3a,
    functions: ['Butterfly travel control', 'Lift / lower', 'Horn', 'Emergency reverse'],
    guidance: 'The tiller brake zones and emergency reverse switch are critical. Walk to the side with a clear path, never directly ahead of the load.',
  },
  'Crown:counterbalance': {
    manufacturer: 'Crown', family: 'counterbalance', model: 'SC 6200', capacity: 4000, maxLift: 312,
    maxSpeed: 10.5, safeSpeed: 5, stance: 'Seated, three-wheel', steerRatio: 0.82,
    driveUnit: 'front', control: 'Steering wheel + hydraulic levers', color: 0xd9d7cf,
    functions: ['Accelerator / brake', 'Lift / lower', 'Tilt', 'Sideshift', 'Horn'],
    guidance: 'Use the operator restraint. Rear steering causes counterweight swing. Keep the load upgrade on grades.',
  },
  'Raymond:counterbalance': {
    manufacturer: 'Raymond', family: 'counterbalance', model: '4460', capacity: 4000, maxLift: 283,
    maxSpeed: 10.2, safeSpeed: 5, stance: 'Seated, three-wheel', steerRatio: 0.82,
    driveUnit: 'front', control: 'Tilt wheel + cowl hydraulic levers', color: 0xd94a3a,
    functions: ['Accelerator / brake', 'Lift / lower', 'Tilt', 'Integral sideshift', 'Horn'],
    guidance: 'The automatic parking brake applies at a full stop. Rear swing, visibility, and attachment capacity must be managed.',
  },
}

export function getEquipment(manufacturer, family) {
  return equipmentProfiles[`${manufacturer}:${family}`]
}
