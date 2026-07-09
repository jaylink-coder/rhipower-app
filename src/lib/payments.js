// RhiPower — Payment recording, shared by manual entry (Invoices admin
// panel) and the deposit auto-credit in lib/invoices.js. Keeps
// invoices.amount_paid_kes/status in sync with the payments ledger in one
// place rather than duplicating the recompute logic per call site — this
// codebase has no DB triggers, so that sync has to happen here in the client.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'

export async function recordPayment(invoice, { amountKes, method, reference, paidAt, depositTxnId, notes }, session) {
  if (!(amountKes > 0)) throw new Error('Payment amount must be greater than zero.')

  const { error: payErr } = await supabase.from('payments').insert({
    invoice_id:     invoice.id,
    amount_kes:     amountKes,
    method:         method || 'cash',
    reference:      reference || null,
    paid_at:        paidAt || new Date().toISOString(),
    deposit_txn_id: depositTxnId || null,
    admin_id:       session?.user?.id || null,
    admin_email:    session?.user?.email || null,
    notes:          notes || null,
  })
  if (payErr) throw payErr

  const newAmountPaid = Number(invoice.amount_paid_kes || 0) + amountKes
  const newStatus = newAmountPaid >= Number(invoice.total_kes || 0) ? 'paid'
    : newAmountPaid > 0 ? 'partially_paid'
    : invoice.status

  const { data: updated, error: updErr } = await supabase.from('invoices')
    .update({ amount_paid_kes: newAmountPaid, status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', invoice.id).select().single()
  if (updErr) throw updErr

  logAdminAction(session, 'payment_recorded', invoice.id, { amount: amountKes, method })
  return updated
}
