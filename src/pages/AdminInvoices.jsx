// RhiPower — Invoices (Phase 3 of the ERP build-out).
// Generated from a confirmed+ Sales Order (see AdminSalesOrders.jsx and
// lib/invoices.js). Payment recording routes through lib/payments.js's
// recordPayment() so amount_paid_kes/status stay in sync in one place.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { isOverdue } from '../lib/invoices.js'
import { recordPayment } from '../lib/payments.js'
import { generateInvoicePDF } from '../lib/pdfInvoice.js'
import { logAdminAction } from '../lib/auditLog.js'

const STATUS_OPTIONS = [
  { value: 'draft',           label: 'Draft',           color: 'bg-gray-100   text-gray-600'  },
  { value: 'sent',            label: 'Sent',             color: 'bg-blue-100   text-blue-800'  },
  { value: 'partially_paid',  label: 'Partially Paid',  color: 'bg-amber-100  text-amber-800' },
  { value: 'paid',            label: 'Paid',             color: 'bg-green-100  text-green-800' },
  { value: 'void',            label: 'Void',             color: 'bg-gray-200   text-gray-500'  },
]
const STATUS_MAP  = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]))
const OVERDUE_BADGE = { label: 'Overdue', color: 'bg-red-100 text-red-700' }
const METHODS = [
  { value: 'mpesa',         label: 'M-Pesa' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cash',          label: 'Cash' },
  { value: 'cheque',        label: 'Cheque' },
]

function invoiceNumber(inv) {
  const year = new Date(inv.issue_date || inv.created_at).getFullYear()
  return `INV-${year}-${String(inv.invoice_number).padStart(4, '0')}`
}

function RecordPaymentForm({ invoice, session, onRecorded }) {
  const [amount,    setAmount]    = useState(String(invoice.balance_due_kes || ''))
  const [method,    setMethod]    = useState('mpesa')
  const [reference, setReference] = useState('')
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')

  async function submit() {
    setError('')
    const n = parseFloat(amount)
    if (!n || n <= 0) { setError('Enter an amount greater than zero.'); return }
    setBusy(true)
    try {
      const updated = await recordPayment(invoice, { amountKes: n, method, reference: reference.trim() || null }, session)
      onRecorded(updated)
      setAmount('0')
      setReference('')
    } catch (err) {
      setError(err.message || 'Failed to record payment.')
    }
    setBusy(false)
  }

  return (
    <div className="bg-white rounded-xl p-3 space-y-2">
      <div className="text-xs font-black text-gray-700">Record Payment</div>
      <div className="grid grid-cols-3 gap-2">
        <input type="number" placeholder="Amount (Ksh)" value={amount} onChange={e => setAmount(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <select value={method} onChange={e => setMethod(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          {METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <input placeholder="Reference (optional)" value={reference} onChange={e => setReference(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      {error && <div className="text-xs text-red-600 font-semibold">{error}</div>}
      <button onClick={submit} disabled={busy}
        className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
        {busy ? 'Recording…' : 'Record Payment'}
      </button>
    </div>
  )
}

export default function AdminInvoices({ session }) {
  const [invoices, setInvoices] = useState([])
  const [payments, setPayments] = useState({})  // invoice_id -> payments[]
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [confirmingVoid, setConfirmingVoid] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: invRows }, { data: payRows }] = await Promise.all([
      supabase.from('invoices').select('*, invoice_lines(*)').order('created_at', { ascending: false }),
      supabase.from('payments').select('*').order('paid_at', { ascending: false }),
    ])
    setInvoices(invRows || [])
    const p = {}
    ;(payRows || []).forEach(r => { (p[r.invoice_id] = p[r.invoice_id] || []).push(r) })
    setPayments(p)
    setLoading(false)
  }

  function handlePaymentRecorded(invoice, updated) {
    setInvoices(prev => prev.map(x => x.id === invoice.id ? { ...x, ...updated } : x))
    load()  // simplest way to also refresh the new payment row into `payments`
  }

  async function markSent(inv) {
    await supabase.from('invoices').update({ status: 'sent', updated_at: new Date().toISOString() }).eq('id', inv.id)
    setInvoices(prev => prev.map(x => x.id === inv.id ? { ...x, status: 'sent' } : x))
    logAdminAction(session, 'invoice_sent', inv.id, {})
  }

  async function voidInvoice(inv) {
    await supabase.from('invoices').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', inv.id)
    setInvoices(prev => prev.map(x => x.id === inv.id ? { ...x, status: 'void' } : x))
    logAdminAction(session, 'invoice_voided', inv.id, {})
    setConfirmingVoid(null)
  }

  function downloadPDF(inv) {
    generateInvoicePDF({ invoice: inv, lines: (inv.invoice_lines || []).slice().sort((a,b) => a.sort_order - b.sort_order), payments: payments[inv.id] || [] })
  }

  const filtered = filter === 'all' ? invoices
    : filter === 'overdue' ? invoices.filter(isOverdue)
    : invoices.filter(i => i.status === filter)

  const unpaidTotal = invoices.filter(i => ['sent', 'partially_paid', 'overdue'].includes(i.status) || isOverdue(i))
                               .reduce((s, i) => s + Number(i.balance_due_kes || 0), 0)
  const overdueCount = invoices.filter(isOverdue).length

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading invoices…</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Unpaid Balance', value: formatKsh(unpaidTotal),                     c: 'bg-amber-50 text-amber-800' },
          { label: 'Overdue',        value: overdueCount,                                c: overdueCount ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500' },
          { label: 'Paid',           value: invoices.filter(i => i.status === 'paid').length, c: 'bg-green-50 text-green-800' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.c}`}>
            <div className="text-xs font-bold uppercase tracking-wider opacity-60">{s.label}</div>
            <div className="text-xl font-black font-mono mt-1 tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-500 bg-blue-50 border border-blue-200 rounded-xl p-3">
        Invoices are generated from Sales Orders — open a confirmed (or later) order in Sales Orders and use "Generate Invoice."
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {[{ value: 'all', label: `All (${invoices.length})` }, ...STATUS_OPTIONS.map(s => ({ value: s.value, label: `${s.label} (${invoices.filter(x=>x.status===s.value).length})` })), { value: 'overdue', label: `Overdue (${overdueCount})` }].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${filter===f.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-xs text-gray-400 hover:text-gray-600 font-semibold">↻ Refresh</button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">No invoices in this category yet.</div>
      ) : filtered.map(inv => {
        const overdue = isOverdue(inv)
        const st = overdue ? OVERDUE_BADGE : (STATUS_MAP[inv.status] || STATUS_MAP.draft)
        const isOpen = expanded === inv.id
        const lines = (inv.invoice_lines || []).slice().sort((a, b) => a.sort_order - b.sort_order)
        const invPayments = payments[inv.id] || []

        return (
          <div key={inv.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button onClick={() => setExpanded(isOpen ? null : inv.id)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
              <div className="flex-1 min-w-0">
                <div className="font-black text-gray-800 truncate">{invoiceNumber(inv)} · {inv.client_name}</div>
                <div className="text-xs text-gray-400 truncate">Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE') : '—'} · Balance {formatKsh(inv.balance_due_kes || 0)}</div>
              </div>
              <div className="font-black text-gray-800 font-mono text-sm tabular-nums shrink-0">{formatKsh(inv.total_kes || 0)}</div>
              <span className="text-gray-300 text-sm ml-1">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 px-5 py-4 space-y-3 bg-gray-50">
                <div className="bg-white rounded-xl p-3 divide-y divide-gray-50">
                  {lines.map(l => (
                    <div key={l.id} className="flex justify-between text-sm py-1.5">
                      <span className="text-gray-700">{l.description}</span>
                      <span className="font-mono font-semibold">{formatKsh(l.line_total_kes)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs text-gray-400 py-1.5"><span>Subtotal</span><span>{formatKsh(inv.subtotal_kes)}</span></div>
                  <div className="flex justify-between text-xs text-gray-400 py-1.5"><span>VAT ({inv.vat_rate_pct}%)</span><span>{formatKsh(inv.vat_kes)}</span></div>
                  <div className="flex justify-between text-sm font-black py-1.5"><span>Total</span><span>{formatKsh(inv.total_kes)}</span></div>
                  <div className="flex justify-between text-xs text-green-700 py-1.5"><span>Paid</span><span>{formatKsh(inv.amount_paid_kes)}</span></div>
                  <div className="flex justify-between text-sm font-black text-red-700 py-1.5"><span>Balance Due</span><span>{formatKsh(inv.balance_due_kes)}</span></div>
                </div>

                {invPayments.length > 0 && (
                  <div className="bg-white rounded-xl p-3 space-y-1">
                    <div className="text-xs font-black text-gray-700 mb-1">Payment History</div>
                    {invPayments.map(p => (
                      <div key={p.id} className="flex justify-between text-xs text-gray-600">
                        <span>{new Date(p.paid_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })} · {p.method.replace(/_/g, ' ')}{p.reference ? ` · ${p.reference}` : ''}</span>
                        <span className="font-mono font-semibold">{formatKsh(p.amount_kes)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {inv.status !== 'void' && inv.status !== 'paid' && (
                  <RecordPaymentForm invoice={inv} session={session} onRecorded={updated => handlePaymentRecorded(inv, updated)} />
                )}

                {confirmingVoid === inv.id && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-center justify-between gap-2">
                    <span>Void this invoice? This can't be undone — create a new invoice if the amount needs correcting.</span>
                    <button onClick={() => voidInvoice(inv)} className="text-xs font-bold bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition shrink-0">Confirm Void</button>
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  {inv.status === 'draft' && (
                    <button onClick={() => markSent(inv)} className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg transition">Mark as Sent</button>
                  )}
                  <button onClick={() => downloadPDF(inv)} className="text-xs font-bold bg-gray-800 hover:bg-gray-700 text-white px-3 py-2 rounded-lg transition">⬇ Download PDF</button>
                  {inv.status !== 'void' && (
                    <button onClick={() => setConfirmingVoid(inv.id)} className="text-xs font-bold bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg transition">Void Invoice</button>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
