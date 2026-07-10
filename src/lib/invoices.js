// RhiPower — Sales Order → Invoice generation, and the overdue display check.
//
// Invoice lines are a SUMMARIZED view of a Sales Order's ~20 granular BOM
// rows, grouped by (zone, vat_status) into ~5-8 readable lines (one per
// zone/tax-treatment combination + labour + logistics) — a customer invoice
// should read like a project quote, not an itemized fastener count. Most
// jobs have every item in a zone sharing the same vat_status, so this is
// still ~5 lines in the common case; a genuinely mixed zone (say, a
// zero-rated panel brand alongside standard-rated BOS hardware) splits into
// more than one line rather than blending tax treatments together.
//
// Each zone/vat-status group's SELL-price share is apportioned from the
// Sales Order's materials_kes using that group's BUYING-cost weight
// (sales_order_lines.unit_cost_kes × qty), since the calculator only ever
// produced one aggregate materials total, not a per-line sell price.
//
// VAT per line depends on org_settings.vatPricingMode:
//   'inclusive' (the default, matching this app's existing behaviour) — the
//     group's sell share is treated as ALREADY including VAT; standard-rated
//     lines back the tax out (pretax = sell / (1 + rate)), so the invoice
//     total never changes from what was quoted. zero_rated/exempt lines have
//     no VAT to back out — the whole sell share is pretax.
//   'exclusive' — the group's sell share is treated as a PRE-TAX amount;
//     standard-rated lines have VAT added on top (vat = pretax * rate), so
//     the invoice total can exceed what was quoted for the standard-rated
//     portion. zero_rated/exempt lines are unaffected either way.
// Each line's pretax/VAT amounts round independently to the nearest
// shilling; the invoice's subtotal_kes/vat_kes/total_kes are the exact sums
// of those rounded line values (total_kes = subtotal_kes + vat_kes always
// holds), which can differ from the Sales Order's total by at most a few
// shillings of rounding — not worth forcing an exact match at the cost of
// a less transparent per-line breakdown.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'
import { recordPayment } from './payments.js'
import { fetchOrgSettings } from './orgSettings.js'
import { postJournalEntry } from './ledger.js'
import { formatDocNumber } from './docNumbers.js'

const ZONE_DESCRIPTIONS = {
  zoneA: 'Solar Array & Combiner (Zone A)',
  zoneB: 'Battery Bank & Power Plant (Zone B)',
  zoneC: 'AC Distribution (Zone C)',
}
const VAT_STATUS_LABELS = {
  zero_rated: 'Zero-rated',
  exempt:     'Exempt',
}

export function isOverdue(invoice) {
  if (!['sent', 'partially_paid'].includes(invoice.status)) return false
  if (!invoice.due_date) return false
  return new Date(invoice.due_date) < new Date(new Date().toDateString())
}

export async function generateInvoiceFromSalesOrder(so, session) {
  const settings = await fetchOrgSettings()
  const lines = so.sales_order_lines || []

  // Group zone lines by (zone, vat_status) — usually one group per zone.
  const groupMap = {}
  lines.forEach(l => {
    if (!ZONE_DESCRIPTIONS[l.zone]) return
    const vatStatus = l.vat_status || 'standard'
    const key = `${l.zone}|${vatStatus}`
    if (!groupMap[key]) groupMap[key] = { zone: l.zone, vatStatus, buyingCost: 0 }
    groupMap[key].buyingCost += Number(l.unit_cost_kes || 0) * Number(l.qty || 0)
  })
  const zoneGroups  = Object.values(groupMap)
  const totalBuying = zoneGroups.reduce((s, g) => s + g.buyingCost, 0)
  const materials   = Number(so.materials_kes || 0)
  const zonesOfSameKind = zone => zoneGroups.filter(g => g.zone === zone).length

  const sellGroups = [
    ...zoneGroups.map(g => ({
      vatStatus: g.vatStatus,
      category: 'materials',
      desc: ZONE_DESCRIPTIONS[g.zone] + (zonesOfSameKind(g.zone) > 1 && VAT_STATUS_LABELS[g.vatStatus] ? ` — ${VAT_STATUS_LABELS[g.vatStatus]}` : ''),
      sell: totalBuying > 0 ? materials * (g.buyingCost / totalBuying) : materials / (zoneGroups.length || 1),
    })),
    { vatStatus: 'standard', category: 'labour',    desc: 'Installation Labour',        sell: Number(so.labor_kes || 0) },
    { vatStatus: 'standard', category: 'logistics', desc: 'Logistics & Site Transport', sell: Number(so.logistics_kes || 0) },
  ]

  const rate = settings.vatRatePct / 100
  const mode = settings.vatPricingMode  // 'inclusive' | 'exclusive'

  let allocatedSubtotal = 0, allocatedVat = 0
  const invoiceLines = sellGroups.map((g, i) => {
    let pretax, vatAmt
    if (g.vatStatus === 'standard') {
      if (mode === 'exclusive') { pretax = g.sell; vatAmt = g.sell * rate }
      else                      { pretax = g.sell / (1 + rate); vatAmt = g.sell - pretax }
    } else {
      pretax = g.sell
      vatAmt = 0
    }
    pretax = Math.round(pretax)
    vatAmt = Math.round(vatAmt)
    allocatedSubtotal += pretax
    allocatedVat      += vatAmt
    return { description: g.desc, qty: 1, unit_price_kes: pretax, vat_status: g.vatStatus, vat_amount_kes: vatAmt, sort_order: i, revenue_category: g.category }
  })

  const subtotal = allocatedSubtotal
  const vat      = allocatedVat
  const total    = subtotal + vat

  const { data: invoice, error } = await supabase.from('invoices').insert({
    sales_order_id:   so.id,
    customer_user_id: so.customer_user_id || null,
    client_name:      so.client_name,
    client_phone:     so.client_phone,
    client_email:     so.client_email,
    site_address:     so.site_address,
    issue_date:       new Date().toISOString().slice(0, 10),
    due_date:         new Date(Date.now() + settings.invoiceDueDays * 86400000).toISOString().slice(0, 10),
    status:           'draft',
    subtotal_kes:     subtotal,
    vat_rate_pct:     settings.vatRatePct,
    vat_kes:          vat,
    total_kes:        total,
    admin_id:         session?.user?.id || null,
    admin_email:      session?.user?.email || null,
  }).select().single()
  if (error) throw error

  const { data: lineRows, error: lineErr } = await supabase.from('invoice_lines')
    .insert(invoiceLines.map(l => ({ invoice_id: invoice.id, ...l }))).select().order('sort_order')
  if (lineErr) throw lineErr

  // Revenue recognition — Dr Accounts Receivable for the full total, Cr each
  // Sales Revenue sub-account for its pretax share, Cr Output VAT Payable
  // for the tax collected. Posted before the deposit auto-credit below so
  // the two journal entries land in the correct chronological order
  // (revenue recognized, then cash received against it).
  const sumWhere = category => invoiceLines.filter(l => l.revenue_category === category).reduce((s, l) => s + l.unit_price_kes, 0)
  await postJournalEntry({
    entryDate: invoice.issue_date,
    memo: `Invoice ${formatDocNumber(settings.invoicePrefix, invoice.invoice_number, { year: new Date(invoice.issue_date).getFullYear() })} issued to ${invoice.client_name}`,
    sourceType: 'invoice', sourceId: invoice.id,
    lines: [
      { accountKey: 'accounts_receivable',       debit:  total },
      { accountKey: 'sales_revenue_materials',   credit: sumWhere('materials') },
      { accountKey: 'sales_revenue_labour',      credit: sumWhere('labour') },
      { accountKey: 'sales_revenue_logistics',   credit: sumWhere('logistics') },
      { accountKey: 'output_vat',                credit: vat },
    ],
  }, session)

  logAdminAction(session, 'invoice_generated', invoice.id, { sales_order_id: so.id, total, vat_pricing_mode: mode })

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
