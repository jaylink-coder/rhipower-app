// Tiny helper around admin_audit_log — adapted from HustleSasa's audit-log pattern.
// Fire-and-forget: an audit-log failure should never block the admin action itself.
import { supabase } from './supabase.js'

export function logAdminAction(session, action, target, details) {
  if (!session?.user) return
  supabase.from('admin_audit_log').insert({
    admin_id:    session.user.id,
    admin_email: session.user.email,
    action,
    target:      target ?? null,
    details:     details ?? null,
  }).then(({ error }) => {
    if (error) console.warn('[RhiPower] audit log failed:', error.message)
  })
}
