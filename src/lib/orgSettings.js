// Fetches the singleton org_settings row from Supabase, with the same
// resilience pattern as lib/inventory.js's fetchInventory(): falls back to
// the hardcoded BUSINESS object from config.js (now just a default, not the
// live source of truth) if Supabase is unreachable or the table doesn't
// exist yet (pre-migration 016).
import { supabase, isSupabaseReady } from './supabase.js'
import { BUSINESS } from '../config.js'
import { logAdminAction } from './auditLog.js'

export const FALLBACK = {
  businessName:        BUSINESS.name,
  whatsapp:             BUSINESS.whatsapp,
  email:                BUSINESS.email,
  city:                 BUSINESS.city,
  tagline:              BUSINESS.tagline,
  kraPin:               BUSINESS.kraPin || '',
  vatRatePct:            16,
  vatPricingMode:        'inclusive',
  invoiceDueDays:        14,
  invoicePrefix:         'INV',
  poPrefix:              'PO',
  soPrefix:              'SO',
  invoiceNotesDefault:   '',
  mpesaTillDisplay:      '',
  allowCustomerSignup:  true,
}

function toSettings(row) {
  return {
    businessName:        row.business_name,
    whatsapp:             row.whatsapp,
    email:                row.email,
    city:                 row.city,
    tagline:              row.tagline,
    kraPin:               row.kra_pin || '',
    vatRatePct:           Number(row.vat_rate_pct),
    vatPricingMode:       row.vat_pricing_mode === 'exclusive' ? 'exclusive' : 'inclusive',
    invoiceDueDays:       Number(row.invoice_due_days),
    invoicePrefix:        row.invoice_prefix,
    poPrefix:             row.po_prefix,
    soPrefix:             row.so_prefix,
    invoiceNotesDefault:  row.invoice_notes_default || '',
    mpesaTillDisplay:     row.mpesa_till_display || '',
    allowCustomerSignup:  row.allow_customer_signup !== false,
  }
}

export async function fetchOrgSettings() {
  if (!isSupabaseReady) return FALLBACK
  try {
    const { data, error } = await supabase.from('org_settings').select('*').eq('id', 1).maybeSingle()
    if (error || !data) return FALLBACK
    return toSettings(data)
  } catch {
    return FALLBACK
  }
}

export async function updateOrgSettings(patch, session) {
  const payload = {
    business_name:          patch.businessName,
    whatsapp:                patch.whatsapp,
    email:                   patch.email,
    city:                    patch.city,
    tagline:                 patch.tagline,
    kra_pin:                 patch.kraPin || null,
    vat_rate_pct:            patch.vatRatePct,
    vat_pricing_mode:        patch.vatPricingMode === undefined ? undefined : (patch.vatPricingMode === 'exclusive' ? 'exclusive' : 'inclusive'),
    invoice_due_days:        patch.invoiceDueDays,
    invoice_prefix:          patch.invoicePrefix,
    po_prefix:               patch.poPrefix,
    so_prefix:               patch.soPrefix,
    invoice_notes_default:   patch.invoiceNotesDefault || null,
    mpesa_till_display:      patch.mpesaTillDisplay || null,
    allow_customer_signup:   patch.allowCustomerSignup,
    updated_at:              new Date().toISOString(),
    updated_by_email:        session?.user?.email || null,
  }
  // Strip undefined keys so a partial patch only touches the fields it named.
  Object.keys(payload).forEach(k => { if (payload[k] === undefined) delete payload[k] })

  const { data, error } = await supabase.from('org_settings').update(payload).eq('id', 1).select().single()
  if (error) throw error
  logAdminAction(session, 'org_settings_updated', 'org_settings', patch)
  return toSettings(data)
}
