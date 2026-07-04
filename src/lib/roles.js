// RhiPower roles — single source of truth, adapted from the HustleSasa pattern
// but scaled to what RhiPower actually needs: two accounts types, not ten.
// 'customer' has no admin_profiles row; 'admin' and 'technician' do.

export const ROLES = {
  CUSTOMER:   'customer',
  TECHNICIAN: 'technician',
  ADMIN:      'admin',
}

export const ROLE_LABELS = {
  customer:   'Customer',
  technician: 'Field Technician',
  admin:      'System Administrator',
}

// Inactivity timeout per role (minutes) — admin controls live pricing and
// customer leads, so it gets logged out fast; a browsing customer doesn't.
export const SESSION_TIMEOUT_MINUTES = {
  admin:      20,
  technician: 30,
  customer:   10_080, // 7 days — not security-sensitive, just convenience
}

// Warning shown N minutes before logout
export const SESSION_WARN_MINUTES = 2

export function getRoleLabel(role) {
  return ROLE_LABELS[role] ?? ROLE_LABELS.customer
}
