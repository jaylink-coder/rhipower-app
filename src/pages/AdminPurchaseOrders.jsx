// RhiPower — Purchase Orders (Phase 1 of the ERP build-out).
// The "stock in" workflow: create a PO against a supplier with line items,
// then receive stock against it (partial receiving supported), which bumps
// inventory_prices.stock_qty and writes a properly-tagged stock_movements
// row via the shared logStockMovement() helper. Replaces manual stock_qty
// typing as the primary way stock enters the system — manual adjustment
// stays available in Inventory & Prices for corrections/shrinkage.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { logAdminAction } from '../lib/auditLog.js'
import { logStockMovement } from '../lib/inventory.js'
import { formatDocNumber } from '../lib/docNumbers.js'
import { FALLBACK as BUSINESS_FALLBACK } from '../lib/orgSettings.js'
import { receivePOLineToBill } from '../lib/vendorBills.js'

const STATUS_OPTIONS = [
  { value: 'draft',               label: 'Draft',               color: 'bg-gray-100  text-gray-600'  },
  { value: 'ordered',             label: 'Ordered',             color: 'bg-blue-100  text-blue-800'  },
  { value: 'partially_received',  label: 'Partially Received',  color: 'bg-amber-100 text-amber-800' },
  { value: 'received',            label: 'Received',            color: 'bg-green-100 text-green-800' },
  { value: 'cancelled',           label: 'Cancelled',           color: 'bg-red-100   text-red-600'   },
]
const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]))

function blankLine(business) {
  return {
    role_key: '', qty_ordered: '1', unit_cost_kes: '',
    // Invoice calculator (optional, per line) — a supplier invoice line is
    // usually a bulk total (qty × unit price, minus any negotiated discount,
    // possibly VAT-inclusive), not a clean per-unit ex-VAT cost. These fields
    // let an admin type exactly what's printed on the invoice and derive the
    // correct unit_cost_kes instead of hand-calculating it.
    useCalculator: false,
    invoiceAmount: '',
    discountPct:   '',
    vatInclusive:  business?.vatPricingMode === 'inclusive',
  }
}

// Ex-VAT, net-of-discount cost per unit from what's actually printed on a
// supplier invoice line (a lump total for `qty_ordered` units).
function computeUnitCostFromInvoice(line, business) {
  const amount = parseFloat(line.invoiceAmount)
  const qty    = parseFloat(line.qty_ordered)
  if (!amount || !qty) return null
  const discountPct  = parseFloat(line.discountPct) || 0
  const afterDiscount = amount * (1 - discountPct / 100)
  const vatRate       = (business?.vatRatePct ?? 16) / 100
  const exVat          = line.vatInclusive ? afterDiscount / (1 + vatRate) : afterDiscount
  return exVat / qty
}

function NewPOForm({ suppliers, items, business, onSave, onCancel, saving }) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '')
  const [orderDate,  setOrderDate]  = useState(() => new Date().toISOString().slice(0, 10))
  const [expected,   setExpected]   = useState('')
  const [notes,      setNotes]      = useState('')
  const [lines,      setLines]      = useState([blankLine(business)])

  function updateLine(i, field, value) {
    setLines(ls => ls.map((l, idx) => {
      if (idx !== i) return l
      const next = { ...l, [field]: value }
      // Prefill unit cost from the item's current buying price the first time a product is picked
      if (field === 'role_key' && !l.unit_cost_kes && items[value]) {
        next.unit_cost_kes = String(items[value].buying_price_kes || '')
      }
      // Calculator fields drive unit_cost_kes automatically while the
      // calculator is on — still directly editable if toggled off.
      const calcFields = ['invoiceAmount', 'discountPct', 'vatInclusive', 'qty_ordered']
      if (next.useCalculator && calcFields.includes(field)) {
        const computed = computeUnitCostFromInvoice(next, business)
        if (computed != null) next.unit_cost_kes = String(Math.round(computed * 100) / 100)
      }
      return next
    }))
  }
  function addLine()    { setLines(ls => [...ls, blankLine(business)]) }
  function removeLine(i){ setLines(ls => ls.filter((_, idx) => idx !== i)) }

  const validLines = lines.filter(l => l.role_key && Number(l.qty_ordered) > 0 && Number(l.unit_cost_kes) >= 0)
  const total = validLines.reduce((s, l) => s + Number(l.qty_ordered) * Number(l.unit_cost_kes), 0)

  const activeItems = Object.values(items).filter(r => r.is_active !== false)

  return (
    <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <select value={supplierId} onChange={e => setSupplierId(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          {suppliers.length === 0 && <option value="">No active suppliers — add one first</option>}
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input type="date" placeholder="Expected date" value={expected} onChange={e => setExpected(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>

      <div className="space-y-1.5">
        {lines.map((l, i) => (
          <div key={i} className="bg-white rounded-lg p-2 space-y-1.5">
            <div className="flex gap-2 items-center">
              <select value={l.role_key} onChange={e => updateLine(i, 'role_key', e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                <option value="">Select item…</option>
                {activeItems.map(r => (
                  <option key={r.role_key} value={r.role_key}>#{r.item_code ?? '—'} · {r.description}</option>
                ))}
              </select>
              <input type="number" placeholder="Qty" value={l.qty_ordered}
                onChange={e => updateLine(i, 'qty_ordered', e.target.value)}
                className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
              <input type="number" placeholder="Unit cost" value={l.unit_cost_kes} disabled={l.useCalculator}
                onChange={e => updateLine(i, 'unit_cost_kes', e.target.value)}
                className={`w-28 border rounded-lg px-2 py-1.5 text-sm ${l.useCalculator ? 'bg-gray-50 text-gray-500 border-gray-100' : 'border-gray-200'}`} />
              <button onClick={() => updateLine(i, 'useCalculator', !l.useCalculator)}
                className={`text-xs font-bold px-2 py-1.5 rounded-lg transition whitespace-nowrap ${l.useCalculator ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                🧮 Invoice
              </button>
              <button onClick={() => removeLine(i)} className="text-gray-400 hover:text-red-600 text-sm px-1">✕</button>
            </div>
            {l.useCalculator && (
              <div className="flex gap-2 items-center pl-1 flex-wrap">
                <span className="text-xs text-gray-400">This line's invoice total:</span>
                <input type="number" placeholder="Invoice amount (Ksh)" value={l.invoiceAmount}
                  onChange={e => updateLine(i, 'invoiceAmount', e.target.value)}
                  className="w-36 border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                <span className="text-xs text-gray-400">less discount</span>
                <input type="number" placeholder="0" value={l.discountPct}
                  onChange={e => updateLine(i, 'discountPct', e.target.value)}
                  className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-xs" />
                <span className="text-xs text-gray-400">%</span>
                <label className="flex items-center gap-1 text-xs text-gray-500 ml-1">
                  <input type="checkbox" checked={l.vatInclusive} onChange={e => updateLine(i, 'vatInclusive', e.target.checked)} className="w-3.5 h-3.5" />
                  VAT-inclusive ({business?.vatRatePct ?? 16}%)
                </label>
                <span className="text-xs text-gray-400 ml-auto">
                  → {l.qty_ordered || '?'} pcs at <strong className="text-gray-700">{l.unit_cost_kes ? formatKsh(l.unit_cost_kes) : '—'}</strong>/unit ex-VAT
                </span>
              </div>
            )}
          </div>
        ))}
        <button onClick={addLine} className="text-xs font-bold text-blue-600 hover:text-blue-800">+ Add line</button>
      </div>

      <textarea placeholder="Notes (optional)" value={notes} rows={2} onChange={e => setNotes(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none" />

      <div className="flex items-center justify-between pt-1">
        <div className="text-sm font-bold text-gray-700">Total: {formatKsh(total)}</div>
        <div className="flex gap-2">
          <button
            onClick={() => onSave({ supplierId, orderDate, expected, notes, lines: validLines, total })}
            disabled={saving || !supplierId || validLines.length === 0}
            className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
            {saving ? 'Creating…' : 'Create Purchase Order'}
          </button>
          <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 font-semibold px-2">Cancel</button>
        </div>
      </div>
    </div>
  )
}

function ReceiveLineRow({ po, line, item, session, business, onReceived }) {
  const remaining = line.qty_ordered - line.qty_received
  const [qty, setQty] = useState(String(remaining))
  const [busy, setBusy] = useState(false)
  const [billError, setBillError] = useState('')
  // Buying price drives selling price everywhere (calculator.js / Admin
  // inventory list) — defaults to ON so receiving real invoice-based stock
  // actually updates what customers get quoted, not just the accounting-
  // only weighted_avg_cost_kes. Admin can uncheck to leave it untouched.
  const [syncBuyingPrice, setSyncBuyingPrice] = useState(true)
  const canReceive = ['ordered', 'partially_received'].includes(po.status) && remaining > 0

  async function receive() {
    const n = parseInt(qty, 10)
    if (!n || n <= 0 || n > remaining) return
    setBusy(true)
    setBillError('')
    const newQtyReceived = line.qty_received + n
    const { error } = await supabase.from('purchase_order_lines')
      .update({ qty_received: newQtyReceived }).eq('id', line.id)
    if (!error) {
      const oldStock = item?.stock_qty || 0
      const newStock = oldStock + n
      // Weighted-average cost, not FIFO — matches this codebase's single-
      // location, no-lot-tracking design (see migration 019's comment).
      const oldAvg = item?.weighted_avg_cost_kes
      const unitCost = Number(line.unit_cost_kes || 0)
      const newAvg = (oldAvg != null && oldStock > 0)
        ? Math.round(((oldAvg * oldStock) + (unitCost * n)) / newStock)
        : unitCost
      const itemUpdate = { stock_qty: newStock, weighted_avg_cost_kes: newAvg, updated_at: new Date().toISOString() }
      if (syncBuyingPrice) itemUpdate.buying_price_kes = newAvg
      await supabase.from('inventory_prices')
        .update(itemUpdate)
        .eq('role_key', line.role_key)
      await logStockMovement({
        roleKey: line.role_key, quantityChanged: n, session,
        movementType: 'purchase', sourceType: 'purchase_order', sourceId: po.id,
        reason: `Received against ${formatDocNumber(business.poPrefix, po.po_number)}`,
      })
      logAdminAction(session, 'po_line_received', po.id, { role_key: line.role_key, qty: n })
      // Stock has already physically moved by this point — a failure here
      // means the vendor bill/ledger posting needs a manual follow-up in
      // Vendor Bills, not that the receipt itself should be rolled back.
      try {
        await receivePOLineToBill(po, line, item, n, session)
      } catch (billErr) {
        setBillError(billErr.message || 'Stock received, but the vendor bill/ledger posting failed — check Vendor Bills manually.')
      }
      onReceived({ lineId: line.id, qtyReceived: newQtyReceived, roleKey: line.role_key, newStock, newAvg, newBuyingPrice: syncBuyingPrice ? newAvg : null })
    }
    setBusy(false)
  }

  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-700 truncate">{item?.description || line.role_key}</div>
          <div className="text-xs text-gray-400">Ordered {line.qty_ordered} · Received {line.qty_received} · {formatKsh(line.unit_cost_kes)}/unit</div>
        </div>
        {canReceive ? (
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex items-center gap-1">
              <input type="number" value={qty} onChange={e => setQty(e.target.value)}
                className="w-16 border-2 border-blue-400 rounded-lg px-2 py-1 text-xs font-mono outline-none" />
              <button onClick={receive} disabled={busy}
                className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-2 py-1 rounded-lg transition disabled:opacity-50">
                {busy ? '…' : 'Receive'}
              </button>
            </div>
            <label className="flex items-center gap-1 text-[10px] text-gray-400 whitespace-nowrap">
              <input type="checkbox" checked={syncBuyingPrice} onChange={e => setSyncBuyingPrice(e.target.checked)} className="w-3 h-3" />
              Update buying price too
            </label>
          </div>
        ) : (
          <span className="text-xs text-gray-400 shrink-0">{remaining === 0 ? '✓ Fully received' : '—'}</span>
        )}
      </div>
      {billError && <div className="text-xs text-red-600 mt-1">{billError}</div>}
    </div>
  )
}

export default function AdminPurchaseOrders({ session, business = BUSINESS_FALLBACK }) {
  const [pos,       setPos]       = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [items,     setItems]     = useState({})
  const [loading,   setLoading]   = useState(true)
  const [filter,    setFilter]    = useState('all')
  const [expanded,  setExpanded]  = useState(null)
  const [creating,  setCreating]  = useState(false)
  const [saving,    setSaving]    = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: poRows }, { data: supplierRows }, { data: itemRows }] = await Promise.all([
      supabase.from('purchase_orders').select('*, purchase_order_lines(*)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('inventory_prices').select('role_key, item_code, description, buying_price_kes, stock_qty, is_active, weighted_avg_cost_kes, vat_status'),
    ])
    setPos(poRows || [])
    setSuppliers(supplierRows || [])
    const m = {}
    ;(itemRows || []).forEach(r => { m[r.role_key] = r })
    setItems(m)
    setLoading(false)
  }

  async function createPO({ supplierId, orderDate, expected, notes, lines, total }) {
    setSaving(true)
    const { data: po, error } = await supabase.from('purchase_orders').insert({
      supplier_id: supplierId,
      status: 'draft',
      order_date: orderDate || null,
      expected_date: expected || null,
      notes: notes?.trim() || null,
      subtotal_kes: total,
      total_kes: total,
      admin_id: session?.user?.id || null,
      admin_email: session?.user?.email || null,
    }).select().single()

    if (!error && po) {
      const linePayload = lines.map(l => ({
        purchase_order_id: po.id,
        role_key: l.role_key,
        qty_ordered: parseInt(l.qty_ordered, 10),
        unit_cost_kes: parseFloat(l.unit_cost_kes),
      }))
      const { data: lineRows } = await supabase.from('purchase_order_lines').insert(linePayload).select()
      setPos(p => [{ ...po, purchase_order_lines: lineRows || [] }, ...p])
      setCreating(false)
      logAdminAction(session, 'po_created', po.id, { supplier_id: supplierId, total })
    }
    setSaving(false)
  }

  async function setStatus(po, status) {
    await supabase.from('purchase_orders').update({ status, updated_at: new Date().toISOString() }).eq('id', po.id)
    setPos(p => p.map(x => x.id === po.id ? { ...x, status } : x))
    logAdminAction(session, 'po_status_change', po.id, { status })
  }

  function handleLineReceived(po, { lineId, qtyReceived, roleKey, newStock, newAvg, newBuyingPrice }) {
    setItems(p => ({
      ...p,
      [roleKey]: {
        ...p[roleKey], stock_qty: newStock, weighted_avg_cost_kes: newAvg,
        ...(newBuyingPrice != null ? { buying_price_kes: newBuyingPrice } : {}),
      },
    }))
    setPos(p => p.map(x => {
      if (x.id !== po.id) return x
      const lines = x.purchase_order_lines.map(l => l.id === lineId ? { ...l, qty_received: qtyReceived } : l)
      const allDone = lines.every(l => l.qty_received >= l.qty_ordered)
      const anyDone = lines.some(l => l.qty_received > 0)
      const status  = allDone ? 'received' : anyDone ? 'partially_received' : x.status
      if (status !== x.status) supabase.from('purchase_orders').update({ status }).eq('id', x.id).then(() => {})
      return { ...x, purchase_order_lines: lines, status }
    }))
  }

  const filtered = filter === 'all' ? pos : pos.filter(p => p.status === filter)
  const openTotal = pos.filter(p => ['draft', 'ordered', 'partially_received'].includes(p.status))
                        .reduce((s, p) => s + Number(p.total_kes || 0), 0)
  const activeSuppliers = suppliers.filter(s => s.is_active)

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading purchase orders…</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Open POs',      value: pos.filter(p => ['draft','ordered','partially_received'].includes(p.status)).length, c: 'bg-blue-50 text-blue-800'  },
          { label: 'Open Value',    value: formatKsh(openTotal),                                                                 c: 'bg-amber-50 text-amber-800' },
          { label: 'Received',      value: pos.filter(p => p.status === 'received').length,                                     c: 'bg-green-50 text-green-800' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.c}`}>
            <div className="text-xs font-bold uppercase tracking-wider opacity-60">{s.label}</div>
            <div className="text-xl font-black font-mono mt-1 tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {[{ value: 'all', label: `All (${pos.length})` }, ...STATUS_OPTIONS.map(s => ({ value: s.value, label: `${s.label} (${pos.filter(p=>p.status===s.value).length})` }))].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${filter===f.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}
        <button onClick={() => setCreating(c => !c)} className="ml-auto text-xs font-bold text-blue-600 hover:text-blue-800">
          {creating ? '✕ Cancel' : '+ New Purchase Order'}
        </button>
      </div>

      {creating && (
        <NewPOForm suppliers={activeSuppliers} items={items} business={business} onSave={createPO} onCancel={() => setCreating(false)} saving={saving} />
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">No purchase orders in this category yet.</div>
      ) : filtered.map(po => {
        const st = STATUS_MAP[po.status] || STATUS_MAP.draft
        const supplier = suppliers.find(s => s.id === po.supplier_id)
        const isOpen = expanded === po.id
        const lines = po.purchase_order_lines || []

        return (
          <div key={po.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button onClick={() => setExpanded(isOpen ? null : po.id)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
              <div className="flex-1 min-w-0">
                <div className="font-black text-gray-800 truncate">{formatDocNumber(business.poPrefix, po.po_number)} · {supplier?.name || 'Unknown supplier'}</div>
                <div className="text-xs text-gray-400 truncate">{lines.length} line item(s){po.expected_date ? ` · expected ${po.expected_date}` : ''}</div>
              </div>
              <div className="font-black text-gray-800 font-mono text-sm tabular-nums shrink-0">{formatKsh(po.total_kes || 0)}</div>
              <span className="text-gray-300 text-sm ml-1">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 px-5 py-4 space-y-3 bg-gray-50">
                <div className="bg-white rounded-xl p-3 divide-y divide-gray-50">
                  {lines.map(line => (
                    <ReceiveLineRow key={line.id} po={po} line={line} item={items[line.role_key]} session={session} business={business}
                      onReceived={change => handleLineReceived(po, change)} />
                  ))}
                </div>
                {po.notes && <div className="text-xs text-gray-500 italic">{po.notes}</div>}
                <div className="flex gap-2 flex-wrap">
                  {po.status === 'draft' && (
                    <button onClick={() => setStatus(po, 'ordered')} className="text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg transition">Mark as Ordered</button>
                  )}
                  {['draft', 'ordered'].includes(po.status) && !lines.some(l => l.qty_received > 0) && (
                    <button onClick={() => setStatus(po, 'cancelled')} className="text-xs font-bold bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg transition">Cancel PO</button>
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
