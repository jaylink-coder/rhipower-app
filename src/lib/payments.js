// RhiPower — Payment recording, shared by manual entry (Invoices admin
// panel) and the deposit auto-credit in lib/invoices.js. Keeps
// invoices.amount_paid_kes/status in sync with the payments ledger in one
// place rather than duplicating the recompute logic per call site — this
// codebase has no DB triggers, so that sync has to happen here in the client.
import { supabase } from './supabase.js'
import { logAdminAction } from './auditLog.js'
import { postJournalEntry } from './ledger.js'

const METHOD_TO_ACCOUNT = { mpesa: 'mpesa_till', bank_transfer: 'bank_operating', cash: 'petty_cash', cheque: 'bank_operating' }

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

  // Known, accepted limitation: a completed M-Pesa booking deposit is
  // journaled here (via generateInvoiceFromSalesOrder()'s auto-credit call)
  // on the INVOICE's issue date, not the date the deposit actually arrived
  // in M-Pesa — the deposit itself has no GL entry until an invoice exists
  // to apply it to. Fixing that properly means posting from the Daraja
  // webhook edge function, outside this file's reach; flagged, not solved.
  await postJournalEntry({
    entryDate: (paidAt || new Date().toISOString()).slice(0, 10),
    memo: `Payment received for invoice against ${invoice.client_name}`,
    sourceType: 'payment', sourceId: invoice.id,
    lines: [
      { accountKey: METHOD_TO_ACCOUNT[method] || 'bank_operating', debit:  amountKes },
      { accountKey: 'accounts_receivable',                         credit: amountKes },
    ],
  }, session)

  logAdminAction(session, 'payment_recorded', invoice.id, { amount: amountKes, method })
  return updated
}
