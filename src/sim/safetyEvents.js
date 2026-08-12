// Canonical assessment mapping for physical contacts. Keeping scoring outside
// the React callback makes it testable and prevents a solver event from being
// silently dropped when a new obstacle kind is introduced.

export function contactAssessment(event) {
  if (event?.type === 'rack-contact') {
    const upright = event.obstacle?.kind === 'rack-upright'
    const label = event.obstacle?.label || (upright ? 'rack upright' : 'rack beam')
    return {
      type: 'rack-contact',
      label: `Contact with ${label}`,
      severity: upright ? 'critical' : 'major',
      deduction: upright ? 20 : 12,
      cooldown: 2500,
      activeControl: `Rack contact: ${label}`,
    }
  }
  if (event?.type === 'pedestrian-contact') {
    return {
      type: 'pedestrian-contact',
      label: 'Vehicle contact with pedestrian',
      severity: 'critical',
      deduction: 25,
      cooldown: 10000,
      activeControl: 'Pedestrian contact',
    }
  }
  return null
}
