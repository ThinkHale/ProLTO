const INTERACTIVE_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'])

export function isNativeInteractiveTarget(target) {
  if (!target || typeof target !== 'object') return false
  if (target.isContentEditable) return true
  if (INTERACTIVE_TAGS.has(target.tagName)) return true
  return typeof target.closest === 'function'
    && Boolean(target.closest('button, input, select, textarea, a[href], [contenteditable="true"], [role="button"]'))
}

export function isBellyControlActive(value, threshold = 0.2) {
  return Number.isFinite(value) && Math.abs(value) > threshold
}

export function desktopPresenceHeld(keys, pointerDrags) {
  const keyboardHeld = keys?.has?.('ShiftLeft') || keys?.has?.('ShiftRight')
  const pointerHeld = [...(pointerDrags?.values?.() || [])].some((drag) => drag.presenceOnly)
  return Boolean(keyboardHeld || pointerHeld)
}

export function removePointerDrag(pointerDrags, pointerId) {
  const drag = pointerDrags.get(pointerId) || null
  pointerDrags.delete(pointerId)
  return drag
}

export function applyModifierTransition(manual, activeDrags, held) {
  for (const drag of activeDrags || []) {
    const control = drag.object?.userData?.control
    if (!control?.shift2) continue
    const inactiveAction = held ? control.action2 : control.shift2
    if (inactiveAction) manual[inactiveAction] = 0
  }
  return Boolean(held)
}

export function setCommandSource(sources, source, action, value) {
  let commands = sources.get(source)
  if (!commands) {
    commands = new Map()
    sources.set(source, commands)
  }
  commands.set(action, value)
  let aggregate = 0
  for (const candidate of sources.values()) {
    const candidateValue = candidate.get(action) || 0
    if (Math.abs(candidateValue) > Math.abs(aggregate)) aggregate = candidateValue
  }
  return aggregate
}

export function removeCommandSource(sources, source) {
  const removed = sources.get(source)
  if (!removed) return new Map()
  sources.delete(source)
  const aggregate = new Map()
  for (const action of removed.keys()) {
    let value = 0
    for (const candidate of sources.values()) {
      const candidateValue = candidate.get(action) || 0
      if (Math.abs(candidateValue) > Math.abs(value)) value = candidateValue
    }
    aggregate.set(action, value)
  }
  return aggregate
}

export function controlReturnsToNeutral(control) {
  return Boolean(control?.spring || ['horn', 'belly', 'brake'].includes(control?.action))
}

export function releaseManualControl(manual, sources, source, control) {
  if (!controlReturnsToNeutral(control)) return false
  if (source) {
    removeCommandSource(sources, source).forEach((value, action) => { manual[action] = value })
  } else {
    manual[control.action] = 0
    if (control.action2) manual[control.action2] = 0
    if (control.shift2) manual[control.shift2] = 0
  }
  return true
}
