// RhiPower — Supplier payment recording, the AP-side mirror of
// lib/payments.js. Keeps vendor_bills.amount_paid_kes/status in sync with
// the supplier_payments ledger in one place — same reasoning as payments.js:
// this codebase has no DB triggers, so that sync has to happen here.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'
import { postJournalEntry } from './ledger.js'

const METHOD_TO_ACCOUNT = { mpesa: 'mpesa_till', bank_transfer: 'bank_operating', cash: 'petty_cash', cheque: 'bank_operating' }

export async function recordSupplierPayment(bill, { amountKes, method, reference, paidAt, notes }, session) {
  if (!(amountKes > 0)) throw new Error('Payment amount must be greater than zero.')

  const { error: payErr } = await supabase.from('supplier_payments').insert({
    vendor_bill_id: bill.id,
    amount_kes:     amountKes,
    method:         method || 'bank_transfer',
    reference:      reference || null,
    paid_at:        paidAt || new Date().toISOString(),
    admin_id:       session?.user?.id || null,
    admin_email:    session?.user?.email || null,
    notes:          notes || null,
  })
  if (payErr) throw payErr

  const newAmountPaid = Number(bill.amount_paid_kes || 0) + amountKes
  const newStatus = newAmountPaid >= Number(bill.total_kes || 0) ? 'paid'
    : newAmountPaid > 0 ? 'partially_paid'
    : bill.status

  const { data: updated, error: updErr } = await supabase.from('vendor_bills')
    .update({ amount_paid_kes: newAmountPaid, status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', bill.id).select().single()
  if (updErr) throw updErr

  await postJournalEntry({
    entryDate: (paidAt || new Date().toISOString()).slice(0, 10),
    memo: `Payment sent for Bill against supplier`,
    sourceType: 'supplier_payment', sourceId: bill.id,
    lines: [
      { accountKey: 'accounts_payable',                            debit:  amountKes },
      { accountKey: METHOD_TO_ACCOUNT[method] || 'bank_operating', credit: amountKes },
    ],
  }, session)

  logAdminAction(session, 'supplier_payment_recorded', bill.id, { amount: amountKes, method })
  return updated
}
