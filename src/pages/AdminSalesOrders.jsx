// RhiPower — Sales Orders (the "stock out" half of the ERP build-out).
// Created via the "Convert to Sales Order" button on an accepted lead (see
// AdminLeads.jsx + lib/salesOrders.js). Confirming reserves stock (the one
// point stock_qty decreases); fulfilling a line just records delivery
// progress — it does NOT touch stock_qty again, since those units already
// left the sellable pool at confirmation. Cancelling before any fulfillment
// releases the reservation back into stock.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { logAdminAction } from '../lib/auditLog.js'
import { logStockMovement } from '../lib/inventory.js'

const STATUS_OPTIONS = [
  { value: 'draft',                label: 'Draft',                color: 'bg-gray-100  text-gray-600'  },
  { value: 'confirmed',            label: 'Confirmed',            color: 'bg-blue-100  text-blue-800'  },
  { value: 'partially_fulfilled',  label: 'Partially Fulfilled',  color: 'bg-amber-100 text-amber-800' },
  { value: 'fulfilled',            label: 'Fulfilled',            color: 'bg-green-100 text-green-800' },
  { value: 'cancelled',            label: 'Cancelled',            color: 'bg-red-100   text-red-600'   },
]
const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]))
const ZONE_LABELS = { zoneA: 'Zone A — Solar Array', zoneB: 'Zone B — Battery Bank', zoneC: 'Zone C — AC Distribution', labor: 'Labour', logistics: 'Logistics' }

function FulfillLineRow({ so, line, item, session, onFulfilled }) {
  const remaining = line.qty - line.qty_fulfilled
  const [qty, setQty] = useState(String(remaining))
  const [busy, setBusy] = useState(false)
  const canFulfill = ['confirmed', 'partially_fulfilled'].includes(so.status) && remaining > 0

  async function fulfill() {
    const n = parseFloat(qty)
    if (!n || n <= 0 || n > remaining) return
    setBusy(true)
    const newQtyFulfilled = line.qty_fulfilled + n
    const { error } = await supabase.from('sales_order_lines').update({ qty_fulfilled: newQtyFulfilled }).eq('id', line.id)
    if (!error) {
      logAdminAction(session, 'sales_order_line_fulfilled', so.id, { role_key: line.role_key, qty: n })
      onFulfilled({ lineId: line.id, qtyFulfilled: newQtyFulfilled })
    }
    setBusy(false)
  }

  return (
    <div className="flex items-center justify-between gap-2 text-sm py-1.5">
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-gray-700 truncate">{line.qty}× {line.description}</div>
        <div className="text-xs text-gray-400">
          {ZONE_LABELS[line.zone] || line.zone} · Fulfilled {line.qty_fulfilled}/{line.qty}
          {item?.stock_qty != null && line.is_stock_deducting && ` · ${item.stock_qty} in stock`}
        </div>
      </div>
      {canFulfill ? (
        <div className="flex items-center gap-1 shrink-0">
          <input type="number" value={qty} onChange={e => setQty(e.target.value)}
            className="w-16 border-2 border-blue-400 rounded-lg px-2 py-1 text-xs font-mono outline-none" />
          <button onClick={fulfill} disabled={busy}
            className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-2 py-1 rounded-lg transition disabled:opacity-50">
            {busy ? '…' : 'Fulfill'}
          </button>
        </div>
      ) : (
        <span className="text-xs text-gray-400 shrink-0">{remaining <= 0 ? '✓ Done' : '—'}</span>
      )}
    </div>
  )
}

export default function AdminSalesOrders({ session }) {
  const [sos,      setSos]      = useState([])
  const [items,    setItems]    = useState({})
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState('all')
  const [expanded, setExpanded] = useState(null)
  const [confirmWarnings, setConfirmWarnings] = useState({})
  const [busyConfirm, setBusyConfirm] = useState({})
  const [busyCancel,  setBusyCancel]  = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: soRows }, { data: itemRows }] = await Promise.all([
      supabase.from('sales_orders').select('*, sales_order_lines(*)').order('created_at', { ascending: false }),
      supabase.from('inventory_prices').select('role_key, description, stock_qty, is_active'),
    ])
    setSos(soRows || [])
    const m = {}
    ;(itemRows || []).forEach(r => { m[r.role_key] = r })
    setItems(m)
    setLoading(false)
  }

  function poNumber(so) { return `SO-${String(so.so_number).padStart(4, '0')}` }

  async function confirmSO(so, force = false) {
    const deductingLines = (so.sales_order_lines || []).filter(l => l.is_stock_deducting && l.role_key)
    if (!force) {
      const shortages = deductingLines
        .map(l => ({ line: l, item: items[l.role_key] }))
        .filter(({ line, item }) => item?.stock_qty != null && item.stock_qty < line.qty)
      if (shortages.length > 0) {
        setConfirmWarnings(p => ({ ...p, [so.id]: shortages }))
        return
      }
    }
    setBusyConfirm(p => ({ ...p, [so.id]: true }))
    const stockUpdates = {}
    for (const line of deductingLines) {
      const item = items[line.role_key]
      if (!item || item.stock_qty == null) continue  // not tracked — nothing to reserve
      const newStock = item.stock_qty - line.qty
      await supabase.from('inventory_prices').update({ stock_qty: newStock, updated_at: new Date().toISOString() }).eq('role_key', line.role_key)
      await logStockMovement({
        roleKey: line.role_key, quantityChanged: -line.qty, session,
        movementType: 'reservation', sourceType: 'sales_order', sourceId: so.id,
        reason: `Reserved for ${poNumber(so)}`,
      })
      stockUpdates[line.role_key] = newStock
    }
    await supabase.from('sales_orders').update({ status: 'confirmed', updated_at: new Date().toISOString() }).eq('id', so.id)
    logAdminAction(session, 'sales_order_confirmed', so.id, { quotation_id: so.quotation_id })
    setItems(p => { const n = { ...p }; Object.entries(stockUpdates).forEach(([k, v]) => { n[k] = { ...n[k], stock_qty: v } }); return n })
    setSos(p => p.map(x => x.id === so.id ? { ...x, status: 'confirmed' } : x))
    setConfirmWarnings(p => { const n = { ...p }; delete n[so.id]; return n })
    setBusyConfirm(p => ({ ...p, [so.id]: false }))
  }

  async function cancelSO(so) {
    setBusyCancel(p => ({ ...p, [so.id]: true }))
    if (so.status === 'confirmed') {
      const deductingLines = (so.sales_order_lines || []).filter(l => l.is_stock_deducting && l.role_key)
      for (const line of deductingLines) {
        const item = items[line.role_key]
        if (!item || item.stock_qty == null) continue
        const newStock = item.stock_qty + line.qty
        await supabase.from('inventory_prices').update({ stock_qty: newStock, updated_at: new Date().toISOString() }).eq('role_key', line.role_key)
        await logStockMovement({
          roleKey: line.role_key, quantityChanged: line.qty, session,
          movementType: 'reservation_release', sourceType: 'sales_order', sourceId: so.id,
          reason: `Cancelled ${poNumber(so)}`,
        })
        setItems(p => ({ ...p, [line.role_key]: { ...p[line.role_key], stock_qty: newStock } }))
      }
    }
    await supabase.from('sales_orders').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', so.id)
    logAdminAction(session, 'sales_order_cancelled', so.id, {})
    setSos(p => p.map(x => x.id === so.id ? { ...x, status: 'cancelled' } : x))
    setBusyCancel(p => ({ ...p, [so.id]: false }))
  }

  function handleLineFulfilled(so, { lineId, qtyFulfilled }) {
    setSos(p => p.map(x => {
      if (x.id !== so.id) return x
      const lines = x.sales_order_lines.map(l => l.id === lineId ? { ...l, qty_fulfilled: qtyFulfilled } : l)
      const allDone = lines.every(l => l.qty_fulfilled >= l.qty)
      const anyDone = lines.some(l => l.qty_fulfilled > 0)
      const status  = allDone ? 'fulfilled' : anyDone ? 'partially_fulfilled' : x.status
      if (status !== x.status) supabase.from('sales_orders').update({ status }).eq('id', x.id).then(() => {})
      return { ...x, sales_order_lines: lines, status }
    }))
  }

  const filtered = filter === 'all' ? sos : sos.filter(s => s.status === filter)
  const openValue = sos.filter(s => ['draft', 'confirmed', 'partially_fulfilled'].includes(s.status))
                        .reduce((s, x) => s + Number(x.total_kes || 0), 0)

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading sales orders…</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Open Orders', value: sos.filter(s => ['draft','confirmed','partially_fulfilled'].includes(s.status)).length, c: 'bg-blue-50 text-blue-800'  },
          { label: 'Open Value',  value: formatKsh(openValue),                                                                       c: 'bg-amber-50 text-amber-800' },
          { label: 'Fulfilled',   value: sos.filter(s => s.status === 'fulfilled').length,                                          c: 'bg-green-50 text-green-800' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.c}`}>
            <div className="text-xs font-bold uppercase tracking-wider opacity-60">{s.label}</div>
            <div className="text-xl font-black font-mono mt-1 tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <p className="text-sm text-gray-500 bg-blue-50 border border-blue-200 rounded-xl p-3">
        Sales Orders are created from Leads &amp; Pipeline — open a lead with status "Proposal Accepted" or later and use "Convert to Sales Order."
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        {[{ value: 'all', label: `All (${sos.length})` }, ...STATUS_OPTIONS.map(s => ({ value: s.value, label: `${s.label} (${sos.filter(x=>x.status===s.value).length})` }))].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${filter===f.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-xs text-gray-400 hover:text-gray-600 font-semibold">↻ Refresh</button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">No sales orders in this category yet.</div>
      ) : filtered.map(so => {
        const st = STATUS_MAP[so.status] || STATUS_MAP.draft
        const isOpen = expanded === so.id
        const lines = so.sales_order_lines || []
        const warnings = confirmWarnings[so.id]

        return (
          <div key={so.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button onClick={() => setExpanded(isOpen ? null : so.id)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
              <div className="flex-1 min-w-0">
                <div className="font-black text-gray-800 truncate">{poNumber(so)} · {so.client_name}</div>
                <div className="text-xs text-gray-400 truncate">{lines.length} line item(s) · {so.client_phone}</div>
              </div>
              <div className="font-black text-gray-800 font-mono text-sm tabular-nums shrink-0">{formatKsh(so.total_kes || 0)}</div>
              <span className="text-gray-300 text-sm ml-1">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 px-5 py-4 space-y-3 bg-gray-50">
                <div className="bg-white rounded-xl p-3 divide-y divide-gray-50">
                  {lines.map(line => (
                    <FulfillLineRow key={line.id} so={so} line={line} item={items[line.role_key]} session={session}
                      onFulfilled={change => handleLineFulfilled(so, change)} />
                  ))}
                </div>

                {warnings && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 space-y-1">
                    <div className="font-bold">⚠️ Not enough stock for {warnings.length} line(s):</div>
                    {warnings.map(({ line, item }) => (
                      <div key={line.id}>{line.description} — need {line.qty}, have {item.stock_qty}</div>
                    ))}
                    <div className="pt-1">
                      <button onClick={() => confirmSO(so, true)} className="text-xs font-bold bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg transition">
                        Confirm Anyway (backorder)
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  {so.status === 'draft' && (
                    <button onClick={() => confirmSO(so)} disabled={busyConfirm[so.id]}
                      className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg transition disabled:opacity-50">
                      {busyConfirm[so.id] ? 'Confirming…' : 'Confirm Order (reserve stock)'}
                    </button>
                  )}
                  {['draft', 'confirmed'].includes(so.status) && !lines.some(l => l.qty_fulfilled > 0) && (
                    <button onClick={() => cancelSO(so)} disabled={busyCancel[so.id]}
                      className="text-xs font-bold bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg transition disabled:opacity-50">
                      {busyCancel[so.id] ? 'Cancelling…' : 'Cancel Order'}
                    </button>
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
