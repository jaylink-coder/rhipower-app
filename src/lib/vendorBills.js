// RhiPower — Accounts Payable / Vendor Bills. Mirrors invoices.js/payments.js
// closely on purpose: vendor_bills ~ invoices, vendor_bill_lines ~
// invoice_lines. Two ways a bill gets created:
//   receivePOLineToBill() — automatic, called from AdminPurchaseOrders.jsx's
//     ReceiveLineRow.receive() for exactly the quantity just received. One
//     bill per Purchase Order, found-or-created, appended to on each partial
//     receipt.
//   createStandaloneBill() — manual, for a non-inventory operating expense
//     (fuel, rent, subscriptions) that never has a Purchase Order at all.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'
import { postJournalEntry, reverseJournalEntry } from './ledger.js'
import { fetchOrgSettings } from './orgSettings.js'

function computeVat(unitCost, qty, vatStatus, ratePct) {
  if (vatStatus !== 'standard') return 0
  return Math.round(Number(unitCost) * Number(qty) * (ratePct / 100))
}

export async function receivePOLineToBill(po, line, item, qtyReceived, session) {
  const settings = await fetchOrgSettings()
  const vatStatus = item?.vat_status || 'standard'
  const vatAmount = computeVat(line.unit_cost_kes, qtyReceived, vatStatus, settings.vatRatePct)
  const lineTotal = Number(line.unit_cost_kes) * qtyReceived

  let { data: bill } = await supabase.from('vendor_bills')
    .select('*').eq('purchase_order_id', po.id).maybeSingle()

  if (!bill) {
    const { data: created, error } = await supabase.from('vendor_bills').insert({
      supplier_id: po.supplier_id, purchase_order_id: po.id,
      bill_date: new Date().toISOString().slice(0, 10),
      status: 'unpaid', subtotal_kes: 0, vat_kes: 0, total_kes: 0,
      admin_id: session?.user?.id || null, admin_email: session?.user?.email || null,
    }).select().single()
    if (error) throw error
    bill = created
  }

  const { error: lineErr } = await supabase.from('vendor_bill_lines').insert({
    vendor_bill_id: bill.id, line_type: 'inventory', role_key: line.role_key,
    description: item?.description || line.role_key,
    qty: qtyReceived, unit_cost_kes: line.unit_cost_kes,
    vat_status: vatStatus, vat_amount_kes: vatAmount,
  })
  if (lineErr) throw lineErr

  const newSubtotal = Number(bill.subtotal_kes) + lineTotal
  const newVat       = Number(bill.vat_kes) + vatAmount
  const newTotal      = newSubtotal + newVat
  const { data: updatedBill, error: updErr } = await supabase.from('vendor_bills')
    .update({ subtotal_kes: newSubtotal, vat_kes: newVat, total_kes: newTotal, updated_at: new Date().toISOString() })
    .eq('id', bill.id).select().single()
  if (updErr) throw updErr

  await postJournalEntry({
    entryDate: new Date().toISOString().slice(0, 10),
    memo: `Stock received against PO — ${qtyReceived}× ${item?.description || line.role_key}`,
    sourceType: 'purchase_order_receipt', sourceId: po.id,
    lines: [
      { accountKey: 'inventory_asset',  debit:  lineTotal },
      { accountKey: 'input_vat',        debit:  vatAmount },
      { accountKey: 'accounts_payable', credit: lineTotal + vatAmount },
    ],
  }, session)

  logAdminAction(session, 'vendor_bill_line_added', bill.id, { purchase_order_id: po.id, role_key: line.role_key, qty: qtyReceived })
  return updatedBill
}

// lines: [{ description, accountId, qty, unitCostKes, vatStatus }]
export async function createStandaloneBill({ supplierId, billDate, dueDate, reference, lines, notes }, session) {
  const settings = await fetchOrgSettings()
  const enriched = (lines || []).map(l => ({
    ...l,
    vatAmount: computeVat(l.unitCostKes, l.qty, l.vatStatus, settings.vatRatePct),
    lineTotal: Number(l.unitCostKes) * Number(l.qty),
  }))
  if (enriched.length === 0) throw new Error('A bill needs at least one line.')
  const subtotal = enriched.reduce((s, l) => s + l.lineTotal, 0)
  const vat      = enriched.reduce((s, l) => s + l.vatAmount, 0)
  const total    = subtotal + vat

  const { data: bill, error } = await supabase.from('vendor_bills').insert({
    supplier_id: supplierId, purchase_order_id: null,
    bill_reference: reference || null, bill_date: billDate, due_date: dueDate || null,
    status: 'unpaid', subtotal_kes: subtotal, vat_kes: vat, total_kes: total,
    notes: notes || null,
    admin_id: session?.user?.id || null, admin_email: session?.user?.email || null,
  }).select().single()
  if (error) throw error

  const { data: lineRows, error: lineErr } = await supabase.from('vendor_bill_lines')
    .insert(enriched.map(l => ({
      vendor_bill_id: bill.id, line_type: 'expense', account_id: l.accountId,
      description: l.description, qty: l.qty, unit_cost_kes: l.unitCostKes,
      vat_status: l.vatStatus, vat_amount_kes: l.vatAmount,
    }))).select()
  if (lineErr) {
    await supabase.from('vendor_bills').delete().eq('id', bill.id)
    throw lineErr
  }

  // Group by account so a bill with two lines against the same expense
  // account produces one clean debit line, not two.
  const byAccount = {}
  enriched.forEach(l => { byAccount[l.accountId] = (byAccount[l.accountId] || 0) + l.lineTotal })

  await postJournalEntry({
    entryDate: billDate,
    memo: `Bill${reference ? ` (${reference})` : ''} from supplier`,
    sourceType: 'vendor_bill', sourceId: bill.id,
    lines: [
      ...Object.entries(byAccount).map(([accountId, amount]) => ({ accountId, debit: amount })),
      { accountKey: 'input_vat',        debit:  vat },
      { accountKey: 'accounts_payable', credit: total },
    ],
  }, session)

  logAdminAction(session, 'vendor_bill_created', bill.id, { supplier_id: supplierId, total })
  return { ...bill, vendor_bill_lines: lineRows || [] }
}

// Standalone (non-PO) bills only, and only before any payment has been
// recorded — a PO-linked bill's stock has already physically arrived, so
// voiding the financial side alone would leave the books and the warehouse
// disagreeing about what happened; that's out of scope here.
export async function voidVendorBill(bill, session) {
  if (bill.purchase_order_id) throw new Error('Bills created from a Purchase Order receipt cannot be voided here.')
  if (Number(bill.amount_paid_kes) > 0) throw new Error('Cannot void a bill that already has payments recorded against it.')

  const { data: entry } = await supabase.from('journal_entries')
    .select('id').eq('source_type', 'vendor_bill').eq('source_id', bill.id).eq('status', 'posted').maybeSingle()
  if (entry) {
    await reverseJournalEntry(entry.id, { memo: `Voided BILL-${String(bill.bill_number).padStart(4, '0')}` }, session)
  }

  const { data: updated, error } = await supabase.from('vendor_bills')
    .update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', bill.id).select().single()
  if (error) throw error
  logAdminAction(session, 'vendor_bill_voided', bill.id, {})
  return updated
}
