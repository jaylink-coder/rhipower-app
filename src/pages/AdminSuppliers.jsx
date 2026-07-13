// RhiPower — Suppliers directory (Phase 1 of the ERP build-out).
// Replaces the old free-text `supplier` column on inventory_prices with a
// real entity that Purchase Orders reference. Existing supplier names were
// migrated into rows here automatically (see migration 010).
//
// SupplierDetailModal mirrors AdminCustomers.jsx's CustomerDetailModal —
// same Overview/transactions/Statement shape, just the accounts-payable
// side instead of accounts-receivable: Purchase Orders instead of Leads &
// Quotes, Vendor Bills instead of Invoices, a payables statement (bills as
// debits, supplier_payments as credits) instead of a receivables one.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { logAdminAction } from '../lib/auditLog.js'
import { formatDocNumber } from '../lib/docNumbers.js'
import { FALLBACK as BUSINESS_FALLBACK } from '../lib/orgSettings.js'
import { generateStatementPDF } from '../lib/pdfStatement.js'

const RANGE_OPTIONS = [
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_year',  label: 'This Year' },
  { value: 'all',        label: 'All Time' },
]

function rangeBounds(value) {
  const now = new Date()
  if (value === 'this_month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null }
  if (value === 'last_month') return { start: new Date(now.getFullYear(), now.getMonth() - 1, 1), end: new Date(now.getFullYear(), now.getMonth(), 1) }
  if (value === 'this_year')  return { start: new Date(now.getFullYear(), 0, 1), end: null }
  return { start: null, end: null }
}

const PO_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-indigo-100 text-indigo-800', accepted: 'bg-purple-100 text-purple-800',
  delivered: 'bg-cyan-100 text-cyan-800', partially_received: 'bg-amber-100 text-amber-800',
  received: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-600',
}
const BILL_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600', unpaid: 'bg-amber-100 text-amber-800', partially_paid: 'bg-blue-100 text-blue-800',
  paid: 'bg-green-100 text-green-800', void: 'bg-gray-200 text-gray-500',
}
function billNumber(b) { return `BILL-${String(b.bill_number).padStart(4, '0')}` }

function blankForm() {
  return { name: '', contact_person: '', phone: '', email: '', address: '', kra_pin: '', payment_terms: '', lead_time_days: '', notes: '' }
}

// Shared by both the top-level "+ Add Supplier" form and the detail modal's
// inline Overview edit — same field set either way.
function SupplierFields({ form, set }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Supplier name *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Contact person</label>
          <input value={form.contact_person || ''} onChange={e => set('contact_person', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Phone</label>
          <input value={form.phone || ''} onChange={e => set('phone', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Email</label>
          <input value={form.email || ''} onChange={e => set('email', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Address</label>
        <input value={form.address || ''} onChange={e => set('address', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">KRA PIN</label>
          <input value={form.kra_pin || ''} onChange={e => set('kra_pin', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Payment terms</label>
          <input placeholder="e.g. Net 30" value={form.payment_terms || ''} onChange={e => set('payment_terms', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Lead time (days)</label>
          <input type="number" value={form.lead_time_days ?? ''} onChange={e => set('lead_time_days', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Notes <span className="text-gray-300">— optional</span></label>
        <textarea value={form.notes || ''} rows={2} onChange={e => set('notes', e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none" />
      </div>
    </div>
  )
}

function supplierPayload(form) {
  return {
    name: form.name.trim(),
    contact_person: form.contact_person?.trim() || null,
    phone: form.phone?.trim() || null,
    email: form.email?.trim() || null,
    address: form.address?.trim() || null,
    kra_pin: form.kra_pin?.trim() || null,
    payment_terms: form.payment_terms?.trim() || null,
    lead_time_days: form.lead_time_days === '' || form.lead_time_days == null ? null : parseInt(form.lead_time_days, 10),
    notes: form.notes?.trim() || null,
  }
}

function SupplierDetailModal({ row, onClose, onNavigate, business, onToggled, toggling, onUpdated, session }) {
  const [tab, setTab] = useState('overview')
  const [pos,      setPos]      = useState(null)
  const [bills,    setBills]    = useState(null)
  const [payments, setPayments] = useState(null)
  const [range,    setRange]    = useState('this_year')
  const [editing,  setEditing]  = useState(false)
  const [form,     setForm]     = useState(null)
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('purchase_orders').select('id, po_number, status, total_kes, order_date, expected_date, created_at')
        .eq('supplier_id', row.id).order('created_at', { ascending: false }),
      supabase.from('vendor_bills').select('id, bill_number, bill_date, status, total_kes, amount_paid_kes, balance_due_kes')
        .eq('supplier_id', row.id).order('created_at', { ascending: false }),
    ]).then(([poRes, billRes]) => {
      setPos(poRes.data || [])
      setBills(billRes.data || [])
      const billIds = (billRes.data || []).map(b => b.id)
      if (billIds.length) {
        supabase.from('supplier_payments').select('vendor_bill_id, amount_kes, paid_at, method, reference')
          .in('vendor_bill_id', billIds).then(({ data }) => setPayments(data || []))
      } else {
        setPayments([])
      }
    })
  }, [row.id])

  const nonVoidBills = (bills || []).filter(b => b.status !== 'void')
  const totalBilled = nonVoidBills.reduce((s, b) => s + Number(b.total_kes || 0), 0)
  const totalPaid    = nonVoidBills.reduce((s, b) => s + Number(b.amount_paid_kes || 0), 0)
  const totalDue      = nonVoidBills.reduce((s, b) => s + Number(b.balance_due_kes || 0), 0)

  function jump(tabId, id) {
    onNavigate?.(tabId, id)
    onClose()
  }

  function startEdit() {
    setForm({
      name: row.name || '', contact_person: row.contact_person || '', phone: row.phone || '', email: row.email || '',
      address: row.address || '', kra_pin: row.kra_pin || '', payment_terms: row.payment_terms || '',
      lead_time_days: row.lead_time_days ?? '', notes: row.notes || '',
    })
    setEditing(true)
  }

  async function saveProfile() {
    if (!form.name.trim()) return
    setSavingProfile(true)
    const { data, error } = await supabase.from('suppliers').update({ ...supplierPayload(form), updated_at: new Date().toISOString() }).eq('id', row.id).select().single()
    setSavingProfile(false)
    if (!error && data) {
      onUpdated(data)
      setEditing(false)
      logAdminAction(session, 'supplier_updated', row.id, { name: data.name })
    }
  }

  // Payables ledger — every non-void bill (debit, we owe them) and every
  // payment against one (credit, we paid it down), sorted oldest-first with
  // a running balance. Mirrors CustomerDetailModal's receivables ledger.
  const { start: rangeStart, end: rangeEnd } = rangeBounds(range)
  const ledgerEntries = (() => {
    if (!bills || !payments) return null
    const all = [
      ...nonVoidBills.map(b => ({ date: b.bill_date, description: `Bill ${billNumber(b)}`, debit: Number(b.total_kes || 0), credit: 0 })),
      ...payments.filter(p => nonVoidBills.some(b => b.id === p.vendor_bill_id)).map(p => ({ date: p.paid_at, description: `Payment${p.reference ? ` — ${p.reference}` : ''} (${(p.method || '').replace(/_/g, ' ')})`, debit: 0, credit: Number(p.amount_kes || 0) })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date))

    const before = rangeStart ? all.filter(e => new Date(e.date) < rangeStart) : []
    const inRange = all.filter(e => (!rangeStart || new Date(e.date) >= rangeStart) && (!rangeEnd || new Date(e.date) < rangeEnd))
    const opening = before.reduce((s, e) => s + e.debit - e.credit, 0)
    let running = opening
    const entries = inRange.map(e => { running += e.debit - e.credit; return { ...e, balance: running } })
    return { entries, opening, closing: running }
  })()

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h3 className="font-black text-gray-800 text-lg">{row.name}</h3>
            {row.contact_person && <div className="text-xs text-gray-500 font-semibold">{row.contact_person}</div>}
            <div className="text-xs text-gray-400">{[row.phone, row.email].filter(Boolean).join(' · ') || '—'}</div>
            {!row.is_active && <span className="inline-block mt-1 text-xs font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex gap-1 px-5 pt-3 border-b border-gray-100">
          {[['overview', 'Overview'], ['pos', `Purchase Orders${pos ? ` (${pos.length})` : ''}`], ['bills', `Vendor Bills${bills ? ` (${bills.length})` : ''}`], ['statement', 'Statement']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-bold border-b-2 transition ${tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-sm">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="font-black text-gray-700 text-xs uppercase tracking-wider">Contact Info</div>
                  {!editing && (
                    <button onClick={startEdit} className="text-xs font-bold text-blue-600 hover:text-blue-800">Edit</button>
                  )}
                </div>

                {editing ? (
                  <div className="space-y-2 pt-1">
                    <SupplierFields form={form} set={(k, v) => setForm(f => ({ ...f, [k]: v }))} />
                    <div className="flex gap-2">
                      <button onClick={saveProfile} disabled={savingProfile || !form.name.trim()} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                        {savingProfile ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between"><span className="text-gray-400">Contact Person</span><span className="font-semibold">{row.contact_person || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Phone</span><span className="font-semibold">{row.phone || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Email</span><span className="font-semibold">{row.email || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Address</span><span className="font-semibold text-right">{row.address || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">KRA PIN</span><span className="font-semibold">{row.kra_pin || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Payment Terms</span><span className="font-semibold">{row.payment_terms || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-400">Lead Time</span><span className="font-semibold">{row.lead_time_days != null ? `${row.lead_time_days} day(s)` : '—'}</span></div>
                    {row.notes && <div className="pt-1 text-xs text-gray-500 italic border-t border-gray-100 mt-1">{row.notes}</div>}
                  </div>
                )}
              </div>

              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-1.5 text-sm">
                <div className="font-black text-gray-700 text-xs uppercase tracking-wider mb-1">Payables</div>
                <div className="flex justify-between"><span className="text-gray-400">Total Billed</span><span className="font-bold">{formatKsh(totalBilled)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Paid to Date</span><span className="font-bold text-green-700">{formatKsh(totalPaid)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Outstanding Balance</span><span className={`font-bold ${totalDue > 0 ? 'text-red-700' : 'text-gray-400'}`}>{formatKsh(totalDue)}</span></div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-blue-50 rounded-xl p-3"><div className="text-lg font-black text-blue-800">{pos?.length ?? '…'}</div><div className="text-xs text-blue-600">Purchase Orders</div></div>
                <div className="bg-pink-50 rounded-xl p-3"><div className="text-lg font-black text-pink-800">{bills?.length ?? '…'}</div><div className="text-xs text-pink-600">Vendor Bills</div></div>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-xs text-gray-400">{row.created_at ? `Added ${new Date(row.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}</span>
                <button onClick={() => onToggled(row)} disabled={toggling}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition disabled:opacity-50">
                  {toggling ? '…' : row.is_active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          )}

          {tab === 'pos' && (
            !pos ? <div className="text-xs text-gray-400">Loading…</div> :
            !pos.length ? <div className="text-xs text-gray-400 italic">No purchase orders yet.</div> :
            <div className="space-y-2">
              {pos.map(po => (
                <button key={po.id} onClick={() => jump('purchasing', po.id)} className="w-full flex justify-between text-sm border-b border-gray-50 pb-2 text-left hover:bg-gray-50 rounded-lg px-1 -mx-1 transition">
                  <div>
                    <span className="font-semibold text-gray-700 mr-2">{formatDocNumber(business.poPrefix, po.po_number)}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${PO_STATUS_COLORS[po.status] || PO_STATUS_COLORS.draft}`}>{(po.status || 'draft').replace(/_/g, ' ')}</span>
                  </div>
                  <div className="font-mono font-bold">{formatKsh(po.total_kes || 0)}</div>
                </button>
              ))}
            </div>
          )}

          {tab === 'bills' && (
            !bills ? <div className="text-xs text-gray-400">Loading…</div> :
            !bills.length ? <div className="text-xs text-gray-400 italic">No vendor bills yet.</div> :
            <div className="space-y-2">
              {bills.map(b => (
                <button key={b.id} onClick={() => jump('vendorbills', b.id)} className="w-full flex justify-between text-sm border-b border-gray-50 pb-2 text-left hover:bg-gray-50 rounded-lg px-1 -mx-1 transition">
                  <div>
                    <span className="font-semibold text-gray-700 mr-2">{billNumber(b)}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${BILL_STATUS_COLORS[b.status] || BILL_STATUS_COLORS.draft}`}>{b.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold">{formatKsh(b.total_kes || 0)}</div>
                    {Number(b.balance_due_kes) > 0 && <div className="text-xs text-red-600">{formatKsh(b.balance_due_kes)} due</div>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {tab === 'statement' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <select value={range} onChange={e => setRange(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs bg-white font-semibold">
                  {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {ledgerEntries && (
                  <button
                    onClick={() => generateStatementPDF({
                      party: { name: row.name, phone: row.phone }, partyLabel: 'Supplier', docTitle: 'SUPPLIER STATEMENT',
                      entries: ledgerEntries.entries, openingBalance: ledgerEntries.opening, closingBalance: ledgerEntries.closing,
                      rangeLabel: RANGE_OPTIONS.find(o => o.value === range)?.label, business,
                    })}
                    className="text-xs font-bold bg-gray-800 hover:bg-gray-700 text-white px-3 py-1.5 rounded-lg transition">
                    ⬇ Download PDF
                  </button>
                )}
              </div>

              {!ledgerEntries ? <div className="text-xs text-gray-400">Loading…</div> : (
                <>
                  <div className="flex justify-between text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                    <span>Opening Balance: <strong>{formatKsh(ledgerEntries.opening)}</strong></span>
                    <span>Closing Balance: <strong className={ledgerEntries.closing > 0 ? 'text-red-600' : ''}>{formatKsh(ledgerEntries.closing)}</strong></span>
                  </div>
                  {ledgerEntries.entries.length === 0 ? (
                    <div className="text-xs text-gray-400 italic">No transactions in this period.</div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-gray-400 uppercase border-b border-gray-100">
                          <th className="text-left py-1.5">Date</th>
                          <th className="text-left py-1.5">Description</th>
                          <th className="text-right py-1.5">Debit</th>
                          <th className="text-right py-1.5">Credit</th>
                          <th className="text-right py-1.5">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {ledgerEntries.entries.map((e, i) => (
                          <tr key={i}>
                            <td className="py-1.5 text-gray-500">{new Date(e.date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}</td>
                            <td className="py-1.5 text-gray-700">{e.description}</td>
                            <td className="py-1.5 text-right font-mono">{e.debit ? formatKsh(e.debit) : '—'}</td>
                            <td className="py-1.5 text-right font-mono text-green-700">{e.credit ? formatKsh(e.credit) : '—'}</td>
                            <td className="py-1.5 text-right font-mono font-bold">{formatKsh(e.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AdminSuppliers({ session, onNavigate, business = BUSINESS_FALLBACK }) {
  const [suppliers, setSuppliers] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [adding,    setAdding]    = useState(false)
  const [viewing,   setViewing]   = useState(null)
  const [toggling,  setToggling]  = useState({})
  const [saving,    setSaving]    = useState(false)
  const [newForm,   setNewForm]   = useState(blankForm())

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: supplierRows }, { data: billRows }] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('vendor_bills').select('supplier_id, balance_due_kes').neq('status', 'void'),
    ])
    const payableBySupplier = {}
    ;(billRows || []).forEach(b => { payableBySupplier[b.supplier_id] = (payableBySupplier[b.supplier_id] || 0) + Number(b.balance_due_kes || 0) })
    setSuppliers((supplierRows || []).map(s => ({ ...s, outstanding: payableBySupplier[s.id] || 0 })))
    setLoading(false)
  }

  async function saveNew() {
    if (!newForm.name.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('suppliers').insert(supplierPayload(newForm)).select().single()
    setSaving(false)
    if (!error && data) {
      setSuppliers(p => [...p, { ...data, outstanding: 0 }].sort((a, b) => a.name.localeCompare(b.name)))
      setAdding(false)
      setNewForm(blankForm())
      logAdminAction(session, 'supplier_added', data.id, { name: data.name })
    }
  }

  async function toggleActive(s) {
    const next = !s.is_active
    setToggling(p => ({ ...p, [s.id]: true }))
    const { error } = await supabase.from('suppliers').update({ is_active: next }).eq('id', s.id)
    setToggling(p => ({ ...p, [s.id]: false }))
    if (!error) {
      setSuppliers(p => p.map(x => x.id === s.id ? { ...x, is_active: next } : x))
      setViewing(v => v && v.id === s.id ? { ...v, is_active: next } : v)
      logAdminAction(session, 'supplier_status_change', s.id, { is_active: next })
    }
  }

  const totalOutstanding = suppliers.reduce((s, x) => s + x.outstanding, 0)

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading suppliers…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Supplier directory used by Purchase Orders — contact info, payment terms, and typical lead time.</p>
        <button onClick={() => setAdding(a => !a)} className="text-xs font-bold text-blue-600 hover:text-blue-800 shrink-0 ml-3">
          {adding ? '✕ Cancel' : '+ Add Supplier'}
        </button>
      </div>

      {adding && (
        <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-2">
          <SupplierFields form={newForm} set={(k, v) => setNewForm(f => ({ ...f, [k]: v }))} />
          <div className="flex gap-2">
            <button onClick={saveNew} disabled={saving || !newForm.name.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
              {saving ? 'Saving…' : 'Save Supplier'}
            </button>
            <button onClick={() => { setAdding(false); setNewForm(blankForm()) }} className="text-xs text-gray-400 hover:text-gray-600 font-semibold px-2">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl p-4 bg-blue-50 text-blue-800">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">Total Suppliers</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{suppliers.length}</div>
        </div>
        <div className="rounded-2xl p-4 bg-green-50 text-green-800">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">Active</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{suppliers.filter(s => s.is_active).length}</div>
        </div>
        <div className="rounded-2xl p-4 bg-amber-50 text-amber-800">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">Outstanding Payable</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{formatKsh(totalOutstanding)}</div>
        </div>
      </div>

      {suppliers.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">No suppliers yet — add your first one above.</div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="px-5 py-2 text-left font-bold">Supplier</th>
                  <th className="px-4 py-2 text-left font-bold">Contact</th>
                  <th className="px-4 py-2 text-left font-bold">Terms</th>
                  <th className="px-4 py-2 text-left font-bold">Lead Time</th>
                  <th className="px-4 py-2 text-right font-bold">Outstanding</th>
                  <th className="px-4 py-2 text-center font-bold">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {suppliers.map(s => (
                  <tr key={s.id} className={`hover:bg-gray-50 transition ${!s.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3">
                      <button onClick={() => setViewing(s)} className="text-left">
                        <div className="font-semibold text-gray-800 hover:text-blue-600 transition">{s.name}</div>
                        {s.address && <div className="text-xs text-gray-400">{s.address}</div>}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {s.contact_person && <div>{s.contact_person}</div>}
                      {s.phone && <div className="text-gray-400">{s.phone}</div>}
                      {s.email && <div className="text-gray-400">{s.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{s.payment_terms || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{s.lead_time_days != null ? `${s.lead_time_days} day(s)` : '—'}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      <span className={s.outstanding > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>{formatKsh(s.outstanding)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive(s)} disabled={toggling[s.id]}
                        className={`relative inline-flex w-10 h-6 rounded-full transition-colors ${s.is_active ? 'bg-green-500' : 'bg-gray-300'}`}>
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${s.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewing && (
        <SupplierDetailModal
          row={viewing}
          onClose={() => setViewing(null)}
          onNavigate={onNavigate}
          business={business}
          session={session}
          toggling={toggling[viewing.id]}
          onToggled={toggleActive}
          onUpdated={updated => {
            setSuppliers(p => p.map(s => s.id === updated.id ? { ...s, ...updated } : s))
            setViewing(v => v && v.id === updated.id ? { ...v, ...updated } : v)
          }}
        />
      )}
    </div>
  )
}
