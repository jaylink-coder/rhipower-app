// Admin-side customer directory — lists everyone with a saved account,
// mirroring HustleSasa's admin/users pattern but scaled to what RhiPower
// actually needs (no roles/rosters/watchlists, just accounts + their quotes).
//
// CustomerDetailModal adds a real transaction history view (Overview/Leads &
// Quotes/Sales Orders/Invoices), modeled on the customer detail pane in the
// user's real Zoho Invoice account — but scoped to data RhiPower actually
// has: no Comments/Mails tabs (no internal notes field or email system for
// customers), no per-customer "Configure Portal" (there's already a single
// org-wide signup toggle in Settings -> Customer Portal), no Merge/Clone
// (edge cases not worth the complexity at this scale). Phone/address are
// read from the customer's most recent quote rather than stored on
// customer_profiles itself — that table intentionally stays thin (id,
// email, full_name, status); a customer's contact details already live on
// every quote they've submitted, so duplicating them here would just be
// another place for that data to go stale.
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

const LEAD_STATUS_COLORS = {
  new: 'bg-blue-100 text-blue-800', contacted: 'bg-yellow-100 text-yellow-800', site_surveyed: 'bg-purple-100 text-purple-800',
  proposal_accepted: 'bg-orange-100 text-orange-800', installed: 'bg-green-100 text-green-800', lost: 'bg-gray-100 text-gray-500',
}
const SO_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600', confirmed: 'bg-blue-100 text-blue-800', partially_fulfilled: 'bg-amber-100 text-amber-800',
  fulfilled: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-600',
}
const INV_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-800', partially_paid: 'bg-amber-100 text-amber-800',
  paid: 'bg-green-100 text-green-800', void: 'bg-gray-200 text-gray-500',
}

function CustomerDetailModal({ row, onClose, onNavigate, business, onToggled, toggling }) {
  const [tab, setTab] = useState('overview')
  const [leads,       setLeads]       = useState(null)
  const [salesOrders, setSalesOrders] = useState(null)
  const [invoices,    setInvoices]    = useState(null)
  const [payments,    setPayments]    = useState(null)
  const [range,       setRange]       = useState('this_year')

  useEffect(() => {
    Promise.all([
      supabase.from('quotation_requests').select('id, status, grand_total_kes, created_at, client_phone, site_address')
        .eq('user_id', row.id).order('created_at', { ascending: false }),
      supabase.from('sales_orders').select('id, so_number, status, total_kes, created_at')
        .eq('customer_user_id', row.id).order('created_at', { ascending: false }),
      supabase.from('invoices').select('id, invoice_number, issue_date, status, total_kes, amount_paid_kes, balance_due_kes')
        .eq('customer_user_id', row.id).order('created_at', { ascending: false }),
    ]).then(([leadsRes, soRes, invRes]) => {
      setLeads(leadsRes.data || [])
      setSalesOrders(soRes.data || [])
      setInvoices(invRes.data || [])
      const invoiceIds = (invRes.data || []).map(i => i.id)
      if (invoiceIds.length) {
        supabase.from('payments').select('invoice_id, amount_kes, paid_at, method, reference')
          .in('invoice_id', invoiceIds).then(({ data }) => setPayments(data || []))
      } else {
        setPayments([])
      }
    })
  }, [row.id])

  const latestQuote = leads?.[0]
  const nonVoidInvoices = (invoices || []).filter(i => i.status !== 'void')
  const totalInvoiced = nonVoidInvoices.reduce((s, i) => s + Number(i.total_kes || 0), 0)
  const totalPaid      = nonVoidInvoices.reduce((s, i) => s + Number(i.amount_paid_kes || 0), 0)
  const totalDue        = nonVoidInvoices.reduce((s, i) => s + Number(i.balance_due_kes || 0), 0)

  function jump(tabId, id) {
    onNavigate?.(tabId, id)
    onClose()
  }

  // Statement ledger — every non-void invoice (debit) and every payment
  // against one (credit), sorted oldest-first, with a running balance.
  // Entries dated before the selected range collapse into an opening
  // balance rather than disappearing, so the closing balance always ties
  // out to the customer's real total outstanding regardless of range.
  const { start: rangeStart, end: rangeEnd } = rangeBounds(range)
  const ledgerEntries = (() => {
    if (!invoices || !payments) return null
    const all = [
      ...nonVoidInvoices.map(i => ({ date: i.issue_date, description: `Invoice ${formatDocNumber(business.invoicePrefix, i.invoice_number, { year: new Date(i.issue_date).getFullYear() })}`, debit: Number(i.total_kes || 0), credit: 0 })),
      ...payments.filter(p => nonVoidInvoices.some(i => i.id === p.invoice_id)).map(p => ({ date: p.paid_at, description: `Payment${p.reference ? ` — ${p.reference}` : ''} (${(p.method || '').replace(/_/g, ' ')})`, debit: 0, credit: Number(p.amount_kes || 0) })),
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
            <h3 className="font-black text-gray-800 text-lg">{row.full_name || 'Unnamed'}</h3>
            <div className="text-xs text-gray-400">{row.email}{latestQuote?.client_phone ? ` · ${latestQuote.client_phone}` : ''}</div>
            {latestQuote?.site_address && <div className="text-xs text-gray-400">{latestQuote.site_address}</div>}
            {row.status === 'suspended' && <span className="inline-block mt-1 text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Suspended</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex gap-1 px-5 pt-3 border-b border-gray-100">
          {[['overview', 'Overview'], ['leads', `Leads & Quotes${leads ? ` (${leads.length})` : ''}`], ['salesorders', `Sales Orders${salesOrders ? ` (${salesOrders.length})` : ''}`], ['invoices', `Invoices${invoices ? ` (${invoices.length})` : ''}`], ['statement', 'Statement']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-bold border-b-2 transition ${tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'overview' && (
            <div className="space-y-4">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-1.5 text-sm">
                <div className="font-black text-gray-700 text-xs uppercase tracking-wider mb-1">Receivables</div>
                <div className="flex justify-between"><span className="text-gray-400">Total Invoiced</span><span className="font-bold">{formatKsh(totalInvoiced)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Paid to Date</span><span className="font-bold text-green-700">{formatKsh(totalPaid)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Outstanding Balance</span><span className={`font-bold ${totalDue > 0 ? 'text-red-700' : 'text-gray-400'}`}>{formatKsh(totalDue)}</span></div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-blue-50 rounded-xl p-3"><div className="text-lg font-black text-blue-800">{leads?.length ?? '…'}</div><div className="text-xs text-blue-600">Leads/Quotes</div></div>
                <div className="bg-purple-50 rounded-xl p-3"><div className="text-lg font-black text-purple-800">{salesOrders?.length ?? '…'}</div><div className="text-xs text-purple-600">Sales Orders</div></div>
                <div className="bg-pink-50 rounded-xl p-3"><div className="text-lg font-black text-pink-800">{invoices?.length ?? '…'}</div><div className="text-xs text-pink-600">Invoices</div></div>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-xs text-gray-400">Joined {new Date(row.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                <button onClick={() => onToggled(row)} disabled={toggling}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition disabled:opacity-50">
                  {toggling ? '…' : row.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                </button>
              </div>
            </div>
          )}

          {tab === 'leads' && (
            !leads ? <div className="text-xs text-gray-400">Loading…</div> :
            !leads.length ? <div className="text-xs text-gray-400 italic">No quotes submitted yet.</div> :
            <div className="space-y-2">
              {leads.map(l => (
                <button key={l.id} onClick={() => jump('leads', l.id)} className="w-full flex justify-between text-sm border-b border-gray-50 pb-2 text-left hover:bg-gray-50 rounded-lg px-1 -mx-1 transition">
                  <div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full mr-2 ${LEAD_STATUS_COLORS[l.status] || LEAD_STATUS_COLORS.new}`}>{(l.status || 'new').replace(/_/g, ' ')}</span>
                    <span className="text-gray-400 text-xs">{new Date(l.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </div>
                  <div className="font-mono font-bold">{formatKsh(l.grand_total_kes || 0)}</div>
                </button>
              ))}
            </div>
          )}

          {tab === 'salesorders' && (
            !salesOrders ? <div className="text-xs text-gray-400">Loading…</div> :
            !salesOrders.length ? <div className="text-xs text-gray-400 italic">No sales orders yet.</div> :
            <div className="space-y-2">
              {salesOrders.map(so => (
                <button key={so.id} onClick={() => jump('salesorders', so.id)} className="w-full flex justify-between text-sm border-b border-gray-50 pb-2 text-left hover:bg-gray-50 rounded-lg px-1 -mx-1 transition">
                  <div>
                    <span className="font-semibold text-gray-700 mr-2">{formatDocNumber(business.soPrefix, so.so_number)}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${SO_STATUS_COLORS[so.status] || SO_STATUS_COLORS.draft}`}>{so.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="font-mono font-bold">{formatKsh(so.total_kes || 0)}</div>
                </button>
              ))}
            </div>
          )}

          {tab === 'invoices' && (
            !invoices ? <div className="text-xs text-gray-400">Loading…</div> :
            !invoices.length ? <div className="text-xs text-gray-400 italic">No invoices yet.</div> :
            <div className="space-y-2">
              {invoices.map(inv => (
                <button key={inv.id} onClick={() => jump('invoices', inv.id)} className="w-full flex justify-between text-sm border-b border-gray-50 pb-2 text-left hover:bg-gray-50 rounded-lg px-1 -mx-1 transition">
                  <div>
                    <span className="font-semibold text-gray-700 mr-2">{formatDocNumber(business.invoicePrefix, inv.invoice_number, { year: new Date(inv.issue_date).getFullYear() })}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${INV_STATUS_COLORS[inv.status] || INV_STATUS_COLORS.draft}`}>{inv.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-bold">{formatKsh(inv.total_kes || 0)}</div>
                    {Number(inv.balance_due_kes) > 0 && <div className="text-xs text-red-600">{formatKsh(inv.balance_due_kes)} due</div>}
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
                      customer: { name: row.full_name, phone: latestQuote?.client_phone },
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

export default function AdminCustomers({ session, onNavigate, business = BUSINESS_FALLBACK }) {
  const [customers, setCustomers] = useState([])
  const [loading,    setLoading]  = useState(true)
  const [toggling,   setToggling] = useState({})
  const [viewing,    setViewing]  = useState(null)
  const [adding,     setAdding]   = useState(false)
  const [newEmail,    setNewEmail]    = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [inviting,    setInviting]    = useState(false)
  const [inviteMsg,   setInviteMsg]   = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: profiles }, { data: quotes }] = await Promise.all([
      supabase.from('customer_profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('quotation_requests').select('user_id, grand_total_kes').not('user_id', 'is', null),
    ])

    const stats = {}
    ;(quotes || []).forEach(q => {
      const s = stats[q.user_id] || { count: 0, total: 0 }
      s.count += 1
      s.total += Number(q.grand_total_kes || 0)
      stats[q.user_id] = s
    })

    setCustomers((profiles || []).map(p => ({ ...p, ...(stats[p.id] || { count: 0, total: 0 }) })))
    setLoading(false)
  }

  async function toggleSuspend(customer) {
    const next = customer.status === 'suspended' ? 'active' : 'suspended'
    setToggling(p => ({ ...p, [customer.id]: true }))
    const { error } = await supabase.from('customer_profiles').update({ status: next }).eq('id', customer.id)
    setToggling(p => ({ ...p, [customer.id]: false }))
    if (!error) {
      setCustomers(p => p.map(c => c.id === customer.id ? { ...c, status: next } : c))
      setViewing(v => v && v.id === customer.id ? { ...v, status: next } : v)
      logAdminAction(session, 'customer_status_change', customer.id, { email: customer.email, status: next })
    }
  }

  async function inviteCustomer() {
    if (!newEmail.trim()) return
    setInviting(true); setInviteMsg(null)
    const { data, error } = await supabase.functions.invoke('invite-customer', {
      body: { email: newEmail.trim(), fullName: newFullName.trim() },
    })
    setInviting(false)
    if (error || data?.error) {
      setInviteMsg({ ok: false, text: data?.error || error.message || 'Invite failed.' })
    } else {
      setInviteMsg({ ok: true, text: data.message })
      setNewEmail(''); setNewFullName('')
      load()
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading customers…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Accounts appear here from self-signup, or add one directly if a customer signed up isn't practical (e.g. a walk-in or phone order).
        </p>
        <button onClick={() => { setAdding(a => !a); setInviteMsg(null) }} className="text-xs font-bold text-blue-600 hover:text-blue-800 shrink-0 ml-3">
          {adding ? '✕ Cancel' : '+ Add Customer'}
        </button>
      </div>

      {adding && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Email" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            <input placeholder="Full name (optional)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" value={newFullName} onChange={e => setNewFullName(e.target.value)} />
          </div>
          {inviteMsg && <div className={`text-xs font-semibold ${inviteMsg.ok ? 'text-green-700' : 'text-red-700'}`}>{inviteMsg.text}</div>}
          <button onClick={inviteCustomer} disabled={inviting || !newEmail.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
            {inviting ? 'Sending…' : 'Send Invite'}
          </button>
          <p className="text-xs text-blue-600">Sends a Supabase Auth invite email — the customer sets their own password from that email, and the account appears in the list right away.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl p-4 bg-blue-50 text-blue-800">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">Total Accounts</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{customers.length}</div>
        </div>
        <div className="rounded-2xl p-4 bg-green-50 text-green-800">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">With Saved Quotes</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{customers.filter(c => c.count > 0).length}</div>
        </div>
        <div className="rounded-2xl p-4 bg-red-50 text-red-700">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">Suspended</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{customers.filter(c => c.status === 'suspended').length}</div>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
          No customer accounts yet — they appear here once someone signs up to save a design.
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="px-5 py-2 text-left font-bold">Customer</th>
                  <th className="px-4 py-2 text-left font-bold">Joined</th>
                  <th className="px-4 py-2 text-right font-bold">Quotes</th>
                  <th className="px-4 py-2 text-right font-bold">Total Value</th>
                  <th className="px-4 py-2 text-center font-bold">Status</th>
                  <th className="px-4 py-2 w-28"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customers.map(c => (
                  <tr key={c.id} className={`hover:bg-gray-50 transition ${c.status === 'suspended' ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-3">
                      <button onClick={() => setViewing(c)} className="text-left">
                        <div className="font-semibold text-gray-800 hover:text-blue-600 transition">{c.full_name || 'Unnamed'}</div>
                        <div className="text-xs text-gray-400">{c.email}</div>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(c.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{c.count}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">{formatKsh(c.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${c.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {c.status === 'suspended' ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSuspend(c)} disabled={toggling[c.id]}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition disabled:opacity-50">
                        {toggling[c.id] ? '…' : c.status === 'suspended' ? 'Reactivate' : 'Suspend'}
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
        <CustomerDetailModal
          row={viewing}
          onClose={() => setViewing(null)}
          onNavigate={onNavigate}
          business={business}
          toggling={toggling[viewing.id]}
          onToggled={toggleSuspend}
        />
      )}
    </div>
  )
}
