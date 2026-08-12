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
