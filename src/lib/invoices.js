// RhiPower — Sales Order → Invoice generation, and the overdue display check.
//
// Invoice lines are a SUMMARIZED view of a Sales Order's ~20 granular BOM
// rows, grouped by zone into ~5 readable lines (one per zone + labour +
// logistics) — a customer invoice should read like a project quote, not an
// itemized fastener count. Each zone's SELL-price share is apportioned from
// the Sales Order's materials_kes using that zone's BUYING-cost weight
// (sales_order_lines.unit_cost_kes × qty), since the calculator only ever
// produced one aggregate materials total, not a per-zone sell price.
//
// VAT is backed out of the Sales Order's existing VAT-inclusive total
// (subtotal = round(total / 1.16)) rather than added on top, so the
// customer-facing total never changes at the invoice stage — only the
// breakdown becomes itemized. vat_kes is the exact remainder so
// subtotal + vat === total with no rounding drift.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'
import { recordPayment } from './payments.js'

const ZONE_DESCRIPTIONS = {
  zoneA: 'Solar Array & Combiner (Zone A)',
  zoneB: 'Battery Bank & Power Plant (Zone B)',
  zoneC: 'AC Distribution (Zone C)',
}

export function isOverdue(invoice) {
  if (!['sent', 'partially_paid'].includes(invoice.status)) return false
  if (!invoice.due_date) return false
  return new Date(invoice.due_date) < new Date(new Date().toDateString())
}

export async function generateInvoiceFromSalesOrder(so, session) {
  const lines = so.sales_order_lines || []
  const zoneBuyingCost = { zoneA: 0, zoneB: 0, zoneC: 0 }
  lines.forEach(l => {
    if (zoneBuyingCost[l.zone] != null) zoneBuyingCost[l.zone] += Number(l.unit_cost_kes || 0) * Number(l.qty || 0)
  })
  const totalZoneBuyingCost = zoneBuyingCost.zoneA + zoneBuyingCost.zoneB + zoneBuyingCost.zoneC
  const evenShare = totalZoneBuyingCost > 0 ? null : Number(so.materials_kes || 0) / 3

  const groups = [
    { zone: 'zoneA', desc: ZONE_DESCRIPTIONS.zoneA, sell: evenShare ?? Number(so.materials_kes || 0) * (zoneBuyingCost.zoneA / totalZoneBuyingCost) },
    { zone: 'zoneB', desc: ZONE_DESCRIPTIONS.zoneB, sell: evenShare ?? Number(so.materials_kes || 0) * (zoneBuyingCost.zoneB / totalZoneBuyingCost) },
    { zone: 'zoneC', desc: ZONE_DESCRIPTIONS.zoneC, sell: evenShare ?? Number(so.materials_kes || 0) * (zoneBuyingCost.zoneC / totalZoneBuyingCost) },
    { zone: 'labor',     desc: 'Installation Labour',        sell: Number(so.labor_kes || 0) },
    { zone: 'logistics', desc: 'Logistics & Site Transport', sell: Number(so.logistics_kes || 0) },
  ]

  const total    = Number(so.total_kes || 0)
  const subtotal = Math.round(total / 1.16)
  const vat      = total - subtotal
  const totalSell = groups.reduce((s, g) => s + g.sell, 0) || 1

  let allocated = 0
  const invoiceLines = groups.map((g, i) => {
    const isLast = i === groups.length - 1
    const amt = isLast ? (subtotal - allocated) : Math.round(subtotal * (g.sell / totalSell))
    allocated += amt
    return { description: g.desc, qty: 1, unit_price_kes: amt, sort_order: i }
  })

  const { data: invoice, error } = await supabase.from('invoices').insert({
    sales_order_id:   so.id,
    customer_user_id: so.customer_user_id || null,
    client_name:      so.client_name,
    client_phone:     so.client_phone,
    client_email:     so.client_email,
    site_address:     so.site_address,
    issue_date:       new Date().toISOString().slice(0, 10),
    due_date:         new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    status:           'draft',
    subtotal_kes:     subtotal,
    vat_rate_pct:     16,
    vat_kes:          vat,
    total_kes:        total,
    admin_id:         session?.user?.id || null,
    admin_email:      session?.user?.email || null,
  }).select().single()
  if (error) throw error

  const { data: lineRows, error: lineErr } = await supabase.from('invoice_lines')
    .insert(invoiceLines.map(l => ({ invoice_id: invoice.id, ...l }))).select().order('sort_order')
  if (lineErr) throw lineErr

  logAdminAction(session, 'invoice_generated', invoice.id, { sales_order_id: so.id, total })

  // Auto-credit an existing completed booking deposit for this quote, if any,
  // so the invoice shows real progress from the moment it's created rather
  // than a $0-paid balance the customer already partly settled.
  let finalInvoice = invoice
  if (so.quotation_id) {
    const { data: deposit } = await supabase.from('deposit_transactions')
      .select('*').eq('quotation_id', so.quotation_id).eq('status', 'completed').maybeSingle()
    if (deposit) {
      finalInvoice = await recordPayment(invoice, {
        amountKes: Math.min(Number(deposit.amount_kes), total),
        method: 'mpesa',
        reference: deposit.mpesa_receipt || null,
        depositTxnId: deposit.id,
      }, session)
    }
  }

  return { ...finalInvoice, invoice_lines: lineRows || [] }
}
