// Ported from the HustleSasa campaign platform's session-timeout pattern —
// logs an idle admin out automatically instead of leaving a pricing-control
// session open indefinitely.
import { useEffect, useRef, useCallback } from 'react'
import { SESSION_WARN_MINUTES } from '../lib/roles.js'

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']

export function useSessionTimeout({ timeoutMinutes, onWarn, onTimeout, enabled = true }) {
  const warnTimer    = useRef(null)
  const logoutTimer  = useRef(null)
  const warnedRef    = useRef(false)
  const onWarnRef    = useRef(onWarn)
  const onTimeoutRef = useRef(onTimeout)

  onWarnRef.current    = onWarn
  onTimeoutRef.current = onTimeout

  const clearTimers = useCallback(() => {
    if (warnTimer.current)   { clearTimeout(warnTimer.current);   warnTimer.current   = null }
    if (logoutTimer.current) { clearTimeout(logoutTimer.current); logoutTimer.current = null }
    warnedRef.current = false
  }, [])

  const startTimers = useCallback(() => {
    clearTimers()
    const totalMs = timeoutMinutes * 60 * 1000
    const warnMs  = (timeoutMinutes - SESSION_WARN_MINUTES) * 60 * 1000

    if (warnMs > 0) {
      warnTimer.current = setTimeout(() => {
        warnedRef.current = true
        onWarnRef.current()
      }, warnMs)
    }
    logoutTimer.current = setTimeout(() => onTimeoutRef.current(), totalMs)
  }, [timeoutMinutes, clearTimers])

  const resetActivity = useCallback(() => {
    if (!enabled) return
    if (warnedRef.current) return   // in the warning window — user must click "Stay Signed In"
    startTimers()
  }, [enabled, startTimers])

  useEffect(() => {
    if (!enabled) return
    startTimers()
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, resetActivity, { passive: true }))
    return () => {
      clearTimers()
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, resetActivity))
    }
  }, [enabled, startTimers, resetActivity, clearTimers])

  const staySignedIn = useCallback(() => startTimers(), [startTimers])

  return { staySignedIn }
}
