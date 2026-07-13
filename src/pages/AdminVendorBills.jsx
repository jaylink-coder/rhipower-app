// RhiPower — Vendor Bills / Accounts Payable (Accounting Module, Phase 3).
// Bills for inventory are created automatically when stock is received
// against a Purchase Order (see AdminPurchaseOrders.jsx's ReceiveLineRow +
// lib/vendorBills.js's receivePOLineToBill). The "+ New Bill" form here is
// only for non-inventory operating expenses that never go through a PO at
// all — fuel, rent, subscriptions, professional fees.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { fetchChartOfAccounts } from '../lib/ledger.js'
import { createStandaloneBill, voidVendorBill } from '../lib/vendorBills.js'
import { recordSupplierPayment } from '../lib/supplierPayments.js'

const STATUS_OPTIONS = [
  { value: 'unpaid',          label: 'Unpaid',          color: 'bg-amber-100 text-amber-800' },
  { value: 'partially_paid',  label: 'Partially Paid',  color: 'bg-blue-100  text-blue-800'  },
  { value: 'paid',            label: 'Paid',            color: 'bg-green-100 text-green-800' },
  { value: 'void',            label: 'Void',            color: 'bg-gray-200  text-gray-500'  },
]
const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]))
const METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mpesa',         label: 'M-Pesa' },
  { value: 'cash',          label: 'Cash' },
  { value: 'cheque',        label: 'Cheque' },
]

function blankExpenseLine() { return { description: '', accountId: '', qty: '1', unitCostKes: '', vatStatus: 'standard' } }

function NewBillForm({ suppliers, expenseAccounts, onSave, onCancel, saving }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [billDate,   setBillDate]   = useState(() => new Date().toISOString().slice(0, 10))
  const [dueDate,    setDueDate]    = useState('')
  const [reference,  setReference]  = useState('')
  const [notes,      setNotes]      = useState('')
  const [lines,      setLines]      = useState([blankExpenseLine()])

  function updateLine(i, field, value) { setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [field]: value } : l)) }
  function addLine()     { setLines(ls => [...ls, blankExpenseLine()]) }
  function removeLine(i) { setLines(ls => ls.filter((_, idx) => idx !== i)) }

  const validLines = lines.filter(l => l.description.trim() && l.accountId && Number(l.qty) > 0 && Number(l.unitCostKes) >= 0)
  const total = validLines.reduce((s, l) => s + Number(l.qty) * Number(l.unitCostKes), 0)

  return (
    <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          {suppliers.length === 0 && <option value="">No active suppliers — add one first</option>}
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input type="date" placeholder="Due date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <input placeholder="Supplier's invoice/receipt number (optional)" value={reference} onChange={e => setReference(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />

      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input placeholder="Description" value={l.description} onChange={e => updateLine(i, 'description', e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            <select value={l.accountId} onChange={e => updateLine(i, 'accountId', e.target.value)}
              className="w-40 border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
              <option value="">Expense account…</option>
              {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
            <input type="number" placeholder="Qty" value={l.qty} onChange={e => updateLine(i, 'qty', e.target.value)}
              className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            <input type="number" placeholder="Unit cost" value={l.unitCostKes} onChange={e => updateLine(i, 'unitCostKes', e.target.value)}
              className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
            <select value={l.vatStatus} onChange={e => updateLine(i, 'vatStatus', e.target.value)}
              className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white">
              <option value="standard">Standard</option>
              <option value="zero_rated">Zero-rated</option>
              <option value="exempt">Exempt</option>
            </select>
            <button onClick={() => removeLine(i)} className="text-gray-400 hover:text-red-600 text-sm px-1">✕</button>
          </div>
        ))}
        <button onClick={addLine} className="text-xs font-bold text-blue-600 hover:text-blue-800">+ Add line</button>
      </div>

      <textarea placeholder="Notes (optional)" value={notes} rows={2} onChange={e => setNotes(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none" />

      <div className="flex items-center justify-between pt-1">
        <div className="text-sm font-bold text-gray-700">Total (excl. VAT): {formatKsh(total)}</div>
        <div className="flex gap-2">
          <button
            onClick={() => onSave({
              supplierId, billDate, dueDate: dueDate || null, reference: reference.trim() || null, notes: notes.trim() || null,
              lines: validLines.map(l => ({ description: l.description.trim(), accountId: l.accountId, qty: Number(l.qty), unitCostKes: Number(l.unitCostKes), vatStatus: l.vatStatus })),
            })}
            disabled={saving || !supplierId || validLines.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Bill'}
          </button>
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 font-semibold px-2">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function RecordSupplierPaymentForm({ bill, session, onRecorded }) {
  const [amount,    setAmount]    = useState(String(bill.balance_due_kes || ''))
  const [method,    setMethod]    = useState('bank_transfer')
  const [reference, setReference] = useState('')
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')

  async function submit() {
    setError('')
    const n = parseFloat(amount)
    if (!n || n <= 0) { setError('Enter an amount greater than zero.'); return }
    setBusy(true)
    try {
      const updated = await recordSupplierPayment(bill, { amountKes: n, method, reference: reference.trim() || null }, session)
      onRecorded(updated)
      setAmount('0'); setReference('')
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

export default function AdminVendorBills({ session, focusId }) {
  const [bills, setBills] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [paymentsByBill, setPaymentsByBill] = useState({})
  const [expenseAccounts, setExpenseAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState('')
  const [confirmingVoid, setConfirmingVoid] = useState(null)

  useEffect(() => { load() }, [])
  // Jumped here from a supplier's detail modal ("view this bill") — expand
  // it directly instead of leaving the admin to hunt through the list.
  useEffect(() => { if (focusId && bills.some(b => b.id === focusId)) setExpanded(focusId) }, [focusId, bills])

  async function load() {
    setLoading(true)
    const [{ data: billRows }, { data: supplierRows }, { data: payRows }, accounts] = await Promise.all([
      supabase.from('vendor_bills').select('*, vendor_bill_lines(*)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('supplier_payments').select('*').order('paid_at', { ascending: false }),
      fetchChartOfAccounts({ forceRefresh: true }),
    ])
    setBills(billRows || [])
    setSuppliers(supplierRows || [])
    const p = {}
    ;(payRows || []).forEach(r => { (p[r.vendor_bill_id] = p[r.vendor_bill_id] || []).push(r) })
    setPaymentsByBill(p)
    setExpenseAccounts((accounts || []).filter(a => a.account_type === 'expense' && a.is_active !== false))
    setLoading(false)
  }

  async function createBill(form) {
    setSaving(true); setCreateError('')
    try {
      await createStandaloneBill(form, session)
      setCreating(false)
      await load()
    } catch (err) {
      setCreateError(err.message || 'Failed to create bill.')
    }
    setSaving(false)
  }

  async function handleVoid(bill) {
    setCreateError('')
    try {
      const updated = await voidVendorBill(bill, session)
      setBills(prev => prev.map(x => x.id === bill.id ? { ...x, ...updated } : x))
    } catch (err) {
      setCreateError(err.message || 'Failed to void bill.')
    }
    setConfirmingVoid(null)
  }

  function handlePaymentRecorded(bill, updated) {
    setBills(prev => prev.map(x => x.id === bill.id ? { ...x, ...updated } : x))
    load()  // simplest way to also refresh the new payment row into paymentsByBill
  }

  function billNumber(b) { return `BILL-${String(b.bill_number).padStart(4, '0')}` }

  const filtered = filter === 'all' ? bills : bills.filter(b => b.status === filter)
  const unpaidTotal = bills.filter(b => ['unpaid', 'partially_paid'].includes(b.status))
                            .reduce((s, b) => s + Number(b.balance_due_kes || 0), 0)
  const activeSuppliers = suppliers.filter(s => s.is_active)

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading vendor bills…</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Owed to Suppliers', value: formatKsh(unpaidTotal),                                              c: 'bg-amber-50 text-amber-800' },
          { label: 'Open Bills',        value: bills.filter(b => ['unpaid','partially_paid'].includes(b.status)).length, c: 'bg-blue-50 text-blue-800'   },
          { label: 'Paid',              value: bills.filter(b => b.status === 'paid').length,                        c: 'bg-green-50 text-green-800' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.c}`}>
            <div className="text-xs font-bold uppercase tracking-wider opacity-60">{s.label}</div>
            <div className="text-xl font-black font-mono mt-1 tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-500 bg-blue-50 border border-blue-200 rounded-xl p-3">
        Bills for inventory are created automatically when you receive stock against a Purchase Order — see Purchase Orders.
        Use "+ New Bill" here only for operating expenses that don't go through a PO (fuel, rent, subscriptions, professional fees).
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {[{ value: 'all', label: `All (${bills.length})` }, ...STATUS_OPTIONS.map(s => ({ value: s.value, label: `${s.label} (${bills.filter(x=>x.status===s.value).length})` }))].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${filter===f.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}
        <button onClick={() => setCreating(c => !c)} className="ml-auto text-xs font-bold text-blue-600 hover:text-blue-800">
          {creating ? '✕ Cancel' : '+ New Bill'}
        </button>
      </div>

      {creating && (
        <>
          <NewBillForm suppliers={activeSuppliers} expenseAccounts={expenseAccounts} onSave={createBill} onCancel={() => setCreating(false)} saving={saving} />
          {createError && <div className="text-xs text-red-600 font-semibold">{createError}</div>}
        </>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">No vendor bills in this category yet.</div>
      ) : filtered.map(bill => {
        const st = STATUS_MAP[bill.status] || STATUS_MAP.unpaid
        const supplier = suppliers.find(s => s.id === bill.supplier_id)
        const isOpen = expanded === bill.id
        const lines = bill.vendor_bill_lines || []
        const billPayments = paymentsByBill[bill.id] || []
        const canVoid = bill.status !== 'void' && !bill.purchase_order_id && Number(bill.amount_paid_kes) === 0

        return (
          <div key={bill.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button onClick={() => setExpanded(isOpen ? null : bill.id)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
              <div className="flex-1 min-w-0">
                <div className="font-black text-gray-800 truncate">{billNumber(bill)} · {supplier?.name || 'Unknown supplier'}</div>
                <div className="text-xs text-gray-400 truncate">{bill.purchase_order_id ? 'From Purchase Order' : 'Operating expense'} · {lines.length} line item(s)</div>
              </div>
              <div className="font-black text-gray-800 font-mono text-sm tabular-nums shrink-0">{formatKsh(bill.total_kes || 0)}</div>
              <span className="text-gray-300 text-sm ml-1">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 px-5 py-4 space-y-3 bg-gray-50">
                <div className="bg-white rounded-xl p-3 divide-y divide-gray-50">
                  {lines.map(l => (
                    <div key={l.id} className="flex justify-between text-sm py-1.5">
                      <span className="text-gray-700">{l.qty}× {l.description}</span>
                      <span className="font-mono font-semibold">{formatKsh(l.line_total_kes)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-xs text-gray-400 py-1.5"><span>Subtotal</span><span>{formatKsh(bill.subtotal_kes)}</span></div>
                  <div className="flex justify-between text-xs text-gray-400 py-1.5"><span>VAT</span><span>{formatKsh(bill.vat_kes)}</span></div>
                  <div className="flex justify-between text-sm font-black py-1.5"><span>Total</span><span>{formatKsh(bill.total_kes)}</span></div>
                  <div className="flex justify-between text-xs text-green-700 py-1.5"><span>Paid</span><span>{formatKsh(bill.amount_paid_kes)}</span></div>
                  <div className="flex justify-between text-sm font-black text-red-700 py-1.5"><span>Balance Due</span><span>{formatKsh(bill.balance_due_kes)}</span></div>
                </div>

                {billPayments.length > 0 && (
                  <div className="bg-white rounded-xl p-3 space-y-1">
                    <div className="text-xs font-black text-gray-700 mb-1">Payment History</div>
                    {billPayments.map(p => (
                      <div key={p.id} className="flex justify-between text-xs text-gray-600">
                        <span>{new Date(p.paid_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })} · {p.method.replace(/_/g, ' ')}{p.reference ? ` · ${p.reference}` : ''}</span>
                        <span className="font-mono font-semibold">{formatKsh(p.amount_kes)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {!['void', 'paid'].includes(bill.status) && (
                  <RecordSupplierPaymentForm bill={bill} session={session} onRecorded={updated => handlePaymentRecorded(bill, updated)} />
                )}

                {confirmingVoid === bill.id && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 flex items-center justify-between gap-2">
                    <span>Void this bill? This can't be undone.</span>
                    <button onClick={() => handleVoid(bill)} className="text-xs font-bold bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition shrink-0">Confirm Void</button>
                  </div>
                )}

                {canVoid && (
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setConfirmingVoid(bill.id)} className="text-xs font-bold bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg transition">Void Bill</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
