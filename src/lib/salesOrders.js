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
import { fetchInventory, toProduct, logStockMovement } from './inventory.js'
import { runCalculation } from './calculator.js'
import { DEFAULT_APPLIANCES } from '../data/appliances.js'
import { logAdminAction } from './auditLog.js'
import { postJournalEntry, reverseJournalEntry } from './ledger.js'

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
    vat_status: item.vatStatus || 'standard',
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
    { zone: 'labor',      description: 'Installation Labour',           sku_snapshot: null, role_key: null, qty: 1, unit_cost_kes: results.totalLabor,     vat_status: 'standard', is_stock_deducting: false },
    { zone: 'logistics',  description: 'Logistics & Site Transport',    sku_snapshot: null, role_key: null, qty: 1, unit_cost_kes: results.totalLogistics, vat_status: 'standard', is_stock_deducting: false },
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

// Called by BOTH confirmSO() and fastTrack() in AdminSalesOrders.jsx — this
// is the single place stock actually leaves the sellable pool (see the file
// header comment: fulfilling a line only records delivery progress, it
// never touches stock_qty), so it's also the single place COGS gets
// posted. Keeping both in one function means the ledger and the stock
// count can never drift out of sync with each other the way two
// independently-maintained inline loops eventually would.
//
// Re-fetches CURRENT stock_qty/weighted_avg_cost_kes/buying_price_kes fresh
// from inventory_prices for the involved role_keys rather than trusting the
// caller's possibly-stale UI state — this is a financial posting, so it
// reads its own numbers.
//
// Tradeoff, deliberately accepted rather than engineered around: COGS
// posts at CONFIRM time, which is when stock actually decreases — not at
// invoice/fulfillment time. On an order that sits "confirmed" for a while
// before being invoiced, this means COGS can land in the GL slightly ahead
// of its matching revenue. Given this app's "Fast-track" button (confirm +
// fulfill + invoice as one click for the common case), that gap is usually
// zero. A stricter design would route confirm-time deductions through a
// "Reserved Inventory" holding account and reclassify to COGS only at
// invoice time — not built here, to avoid over-engineering a single-admin
// SME's books for a gap that rarely occurs in practice.
export async function reserveSalesOrderStock(so, deductingLines, session) {
  if (deductingLines.length === 0) return { stockUpdates: {} }

  const roleKeys = deductingLines.map(l => l.role_key)
  const { data: freshItems } = await supabase.from('inventory_prices')
    .select('role_key, stock_qty, weighted_avg_cost_kes, buying_price_kes').in('role_key', roleKeys)
  const itemByKey = {}
  ;(freshItems || []).forEach(r => { itemByKey[r.role_key] = r })

  const soLabel = `SO-${String(so.so_number).padStart(4, '0')}`
  const stockUpdates = {}
  let totalCost = 0
  for (const line of deductingLines) {
    const item = itemByKey[line.role_key]
    if (!item || item.stock_qty == null) continue  // not tracked — nothing to reserve
    const newStock = item.stock_qty - line.qty
    await supabase.from('inventory_prices').update({ stock_qty: newStock, updated_at: new Date().toISOString() }).eq('role_key', line.role_key)
    await logStockMovement({
      roleKey: line.role_key, quantityChanged: -line.qty, session,
      movementType: 'reservation', sourceType: 'sales_order', sourceId: so.id,
      reason: `Reserved for ${soLabel}`,
    })
    stockUpdates[line.role_key] = newStock
    totalCost += (item.weighted_avg_cost_kes ?? item.buying_price_kes ?? 0) * line.qty
  }

  if (totalCost > 0) {
    await postJournalEntry({
      entryDate: new Date().toISOString().slice(0, 10),
      memo: `Cost of goods sold — ${soLabel} confirmed`,
      sourceType: 'sales_order_confirm', sourceId: so.id,
      lines: [
        { accountKey: 'cogs',             debit:  totalCost },
        { accountKey: 'inventory_asset',  credit: totalCost },
      ],
    }, session)
  }

  return { stockUpdates }
}

// Called by cancelSO(), only ever while status='confirmed' with zero lines
// fulfilled — always a full, clean undo of exactly what
// reserveSalesOrderStock() just did. That's why this reverses the EXACT
// original journal entry (reverseJournalEntry) rather than recomputing
// current costs — a partial/re-derived undo would be wrong here in a way
// it wouldn't be for a fresh posting.
export async function reverseSalesOrderStock(so, deductingLines, session) {
  if (deductingLines.length === 0) return { stockUpdates: {} }

  const roleKeys = deductingLines.map(l => l.role_key)
  const { data: freshItems } = await supabase.from('inventory_prices')
    .select('role_key, stock_qty').in('role_key', roleKeys)
  const itemByKey = {}
  ;(freshItems || []).forEach(r => { itemByKey[r.role_key] = r })

  const soLabel = `SO-${String(so.so_number).padStart(4, '0')}`
  const stockUpdates = {}
  for (const line of deductingLines) {
    const item = itemByKey[line.role_key]
    if (!item || item.stock_qty == null) continue
    const newStock = item.stock_qty + line.qty
    await supabase.from('inventory_prices').update({ stock_qty: newStock, updated_at: new Date().toISOString() }).eq('role_key', line.role_key)
    await logStockMovement({
      roleKey: line.role_key, quantityChanged: line.qty, session,
      movementType: 'reservation_release', sourceType: 'sales_order', sourceId: so.id,
      reason: `Cancelled ${soLabel}`,
    })
    stockUpdates[line.role_key] = newStock
  }

  const { data: originalEntry } = await supabase.from('journal_entries')
    .select('id').eq('source_type', 'sales_order_confirm').eq('source_id', so.id).eq('status', 'posted').maybeSingle()
  if (originalEntry) {
    await reverseJournalEntry(originalEntry.id, { memo: `Cancelled ${soLabel} — stock reservation released` }, session)
  }

  return { stockUpdates }
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
