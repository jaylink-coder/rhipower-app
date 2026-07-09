// RhiPower — Quote → Sales Order conversion.
// A Sales Order is created manually (a button on an accepted lead), never
// auto-triggered by the status dropdown — that dropdown is a soft, easily
// reversible CRM pipeline choice with no confirmation step, and this action
// reserves real stock, so the two must stay deliberately separate actions.
//
// Converting re-runs the same runCalculation() engine the customer saw,
// using the quote's saved raw_state (site config, quantities, custom
// appliances) and its tier_selected — plus the three product role_keys it
// recorded — to reconstruct the exact BOM as Sales Order lines. If a
// recorded product has since been deactivated/deleted, runCalculation falls
// back to the cheapest current option in that tier (the same fallback it
// already uses when no override is given).
import { supabase } from './supabase.js'
import { fetchInventory, toProduct } from './inventory.js'
import { runCalculation } from './calculator.js'
import { DEFAULT_APPLIANCES } from '../data/appliances.js'
import { logAdminAction } from './auditLog.js'

function buildCostByRoleKey(inventory, overrideByKey) {
  const map = {}
  Object.values(inventory.products || {}).flat().forEach(p => { if (p.roleKey) map[p.roleKey] = p.cost })
  Object.values(inventory.zones    || {}).flat().forEach(z => { if (z.roleKey) map[z.roleKey] = z.cost })
  Object.values(overrideByKey).forEach(p => { map[p.roleKey] = p.cost })
  return map
}

function lineFromBOM(zone, item, costByRoleKey) {
  const qtyNum = typeof item.qty === 'number' ? item.qty : parseFloat(String(item.qty).replace(/,/g, '')) || 0
  return {
    zone,
    description: item.label,
    sku_snapshot: item.sku || null,
    role_key: item.roleKey || null,
    qty: qtyNum,
    unit_cost_kes: item.roleKey ? (costByRoleKey[item.roleKey] ?? null) : null,
    is_stock_deducting: Boolean(item.roleKey),
  }
}

// Throws with a message suitable for direct display if reconstruction fails.
export async function convertQuoteToSalesOrder(quote, session) {
  const raw = quote.raw_state || {}
  const allAppliances = [...DEFAULT_APPLIANCES, ...(raw.customAppliances || [])]
  const quantities     = raw.quantities || {}
  const siteConfig     = { ...(raw.siteConfig || {}), tier: quote.tier_selected || 'balanced' }
  const backupDays     = raw.backupDays || quote.backup_days || 1

  const inventory = await fetchInventory()

  const roleKeys = [quote.panel_role_key, quote.inverter_role_key, quote.battery_role_key].filter(Boolean)
  const overrideByKey = {}
  if (roleKeys.length) {
    const { data } = await supabase.from('inventory_prices').select('*').in('role_key', roleKeys)
    ;(data || []).forEach(r => { overrideByKey[r.role_key] = toProduct(r) })
  }
  const selection = {
    panel:    overrideByKey[quote.panel_role_key],
    inverter: overrideByKey[quote.inverter_role_key],
    battery:  overrideByKey[quote.battery_role_key],
  }

  const results = runCalculation({ ...siteConfig, backupDays }, allAppliances, quantities, inventory, selection)
  if (!results) {
    throw new Error("Couldn't reconstruct this quote's system design from its saved data — it may predate the resume-snapshot feature or have no appliance quantities recorded.")
  }

  const costByRoleKey = buildCostByRoleKey(inventory, overrideByKey)
  const lines = [
    ...results.zoneA.map(l => lineFromBOM('zoneA', l, costByRoleKey)),
    ...results.zoneB.map(l => lineFromBOM('zoneB', l, costByRoleKey)),
    ...results.zoneC.map(l => lineFromBOM('zoneC', l, costByRoleKey)),
    { zone: 'labor',      description: 'Installation Labour',           sku_snapshot: null, role_key: null, qty: 1, unit_cost_kes: results.totalLabor,     is_stock_deducting: false },
    { zone: 'logistics',  description: 'Logistics & Site Transport',    sku_snapshot: null, role_key: null, qty: 1, unit_cost_kes: results.totalLogistics, is_stock_deducting: false },
  ]

  const { data: so, error } = await supabase.from('sales_orders').insert({
    quotation_id:     quote.id,
    customer_user_id: quote.user_id || null,
    client_name:      quote.client_name,
    client_phone:     quote.client_phone,
    client_email:     quote.client_email,
    site_address:     quote.site_address,
    status:           'draft',
    materials_kes:    results.materialsAtSellPrice,
    labor_kes:        results.totalLabor,
    logistics_kes:    results.totalLogistics,
    total_kes:        results.grandTotal,
    admin_id:         session?.user?.id || null,
    admin_email:      session?.user?.email || null,
  }).select().single()
  if (error) throw error

  const { data: lineRows, error: lineErr } = await supabase.from('sales_order_lines')
    .insert(lines.map(l => ({ sales_order_id: so.id, ...l }))).select()
  if (lineErr) throw lineErr

  logAdminAction(session, 'sales_order_created', so.id, { quotation_id: quote.id, total: results.grandTotal })
  return { ...so, sales_order_lines: lineRows || [] }
}

// Called whenever a Sales Order reaches 'fulfilled' (per-line fulfillment or
// the fast-track action) — closes the loop back to Leads & Pipeline so
// "the job shipped" doesn't also require a separate manual status update.
// Never downgrades a lead that's already Installed or explicitly Lost.
export async function syncLeadStatusToInstalled(so, session) {
  if (!so.quotation_id) return
  const { data: lead } = await supabase.from('quotation_requests').select('status').eq('id', so.quotation_id).single()
  if (!lead || lead.status === 'installed' || lead.status === 'lost') return
  await supabase.from('quotation_requests').update({ status: 'installed' }).eq('id', so.quotation_id)
  logAdminAction(session, 'lead_status_change', so.quotation_id, { status: 'installed', reason: 'sales_order_fulfilled' })
}
