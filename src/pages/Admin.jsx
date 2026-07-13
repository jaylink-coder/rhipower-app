import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh, sellPrice } from '../lib/calculator.js'
import { DEFAULT_PRICE_BANDS } from '../data/skuInventory.js'
import AdminHome from './AdminHome.jsx'
import AdminLeads from './AdminLeads.jsx'
import AdminCustomers from './AdminCustomers.jsx'
import SessionTimeoutModal from '../components/SessionTimeoutModal.jsx'
import { useSessionTimeout } from '../hooks/useSessionTimeout.js'
import { SESSION_TIMEOUT_MINUTES, SESSION_WARN_MINUTES } from '../lib/roles.js'
import { logAdminAction } from '../lib/auditLog.js'
import { toProduct } from '../lib/inventory.js'
import AdminSuppliers from './AdminSuppliers.jsx'
import AdminPurchaseOrders from './AdminPurchaseOrders.jsx'
import AdminSalesOrders from './AdminSalesOrders.jsx'
import AdminInvoices from './AdminInvoices.jsx'
import AdminSettings from './AdminSettings.jsx'
import AdminReports from './AdminReports.jsx'
import AdminAccounting from './AdminAccounting.jsx'
import AdminVendorBills from './AdminVendorBills.jsx'
import AdminFixedAssets from './AdminFixedAssets.jsx'
import AdminInvestorSnapshot from './AdminInvestorSnapshot.jsx'
import AdminNewOrder from './AdminNewOrder.jsx'
import { fetchOrgSettings, FALLBACK as BUSINESS_FALLBACK } from '../lib/orgSettings.js'
import ItemForm from './ItemForm.tsx'
import { productSpecRows } from '../lib/productSpecs.js'
import HardwareCompatibilityMatrix from '../components/HardwareCompatibilityMatrix.jsx'

// KRA VAT categories — 'standard' (taxed at the org's VAT rate), 'zero_rated'
// (taxed at 0%, still technically vatable) and 'exempt' (no VAT, no input
// VAT claim) are genuinely different KRA treatments, not just "0% vs not" —
// see migration 016's comment for why this is modeled per item rather than
// as one org-wide rate.
const VAT_STATUS_OPTIONS = [
  { value: 'standard',    label: 'Standard-rated' },
  { value: 'zero_rated',  label: 'Zero-rated' },
  { value: 'exempt',      label: 'Exempt' },
]

// Panel/Inverter/Battery are no longer fixed 3-slot groups — any number of
// products can exist per category, and tier is derived from price, not
// assigned. They're rendered by ProductCategorySection below, driven live
// from whatever rows exist in the database, plus a "+ Add Item" form.
const CATEGORY_META = {
  panel:    { title: '☀️ Solar Panels', capacityField: 'watts_each', capacityLabel: 'Watts',  capacityUnit: 'W'   },
  inverter: { title: '⚡ Inverters',    capacityField: 'kw_each',    capacityLabel: 'Capacity', capacityUnit: 'kW' },
  battery:  { title: '🔋 Batteries',    capacityField: 'kwh_each',   capacityLabel: 'Capacity', capacityUnit: 'kWh'},
}

// ── Zone groups (unchanged — shared BOM parts, not price-banded) ───────────
const GROUPS = [
  { title: '🔌 Zone A — Solar Array Protection', items: [
    { key: 'zoneA_breaker',  label: 'DC Isolator Breaker 63A',    spec: 'Chint NBI-63DC · per unit'    },
    { key: 'zoneA_spd',      label: 'DC Surge Protection Device', spec: 'Chint NU6 Type 2 · per unit'  },
    { key: 'zoneA_fuse',     label: 'PV Fuse Holder 15A',         spec: 'Mersen · per unit'            },
    { key: 'zoneA_cable6',   label: '6mm² DC Solar Cable',        spec: 'Kinu Copper · per metre'      },
    { key: 'zoneA_cable10',  label: '10mm² DC Solar Cable',       spec: 'Kinu Copper · per metre'      },
    { key: 'zoneA_mounting', label: 'Roof Mounting Structure',    spec: 'Rails, clamps, L-feet · per kWp' },
    { key: 'zoneA_earthing', label: 'Earthing & Lightning Kit',   spec: 'Rods, arrestor, bonding cable · per system' },
  ]},
  { title: '🔋 Zone B — Battery Bank Connections', items: [
    { key: 'zoneB_mccb',     label: 'Battery MCCB 400A',              spec: 'Chint NM8N · per unit'    },
    { key: 'zoneB_busbar',   label: 'Copper Interconnection Busbar',  spec: 'Tinned Copper · per set'  },
    { key: 'zoneB_lug_m8',   label: '50mm² Copper Lug M8 (Battery)', spec: 'Tinned · each'            },
    { key: 'zoneB_lug_m10',  label: '50mm² Copper Lug M10 (Inverter)',spec: 'Tinned · each'           },
    { key: 'zoneB_batcable', label: '50mm² Battery Cable',            spec: 'Rubber Heat-Res · per metre'},
  ]},
  { title: '⚙️ Zone C — AC Distribution', items: [
    { key: 'zoneC_mcb',       label: '3-Phase MCB 63A',           spec: 'Chint · per unit'    },
    { key: 'zoneC_smart',     label: 'Smart Wi-Fi DIN Breaker',   spec: 'Tuya 40A · per unit' },
    { key: 'zoneC_contactor', label: 'AC Contactor 40A',          spec: 'Chint · per unit'    },
  ]},
]

// ── Login screen ────────────────────────────────────────────────────────────
function LoginScreen({ onBack }) {
  const [email,    setEmail]    = useState('jaylinkpowersystems@gmail.com')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setError(error.message)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🔒</div>
          <h2 className="text-xl font-black text-gray-800">Admin Login</h2>
          <p className="text-sm text-gray-500 mt-1">RhiPower — Leads & Inventory</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-gray-200 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-1">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              placeholder="••••••••"
              className="w-full border border-gray-200 p-3 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
          {error && <p className="text-red-600 text-xs font-semibold bg-red-50 p-2 rounded-lg">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-blue-700 hover:bg-blue-800 text-white font-bold p-3 rounded-xl transition disabled:opacity-50">
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        <button onClick={onBack} className="w-full mt-4 text-xs text-gray-400 hover:text-gray-600 transition">
          ← Back to App
        </button>
      </div>
    </div>
  )
}

// One combined price-band editor row — min/max Ksh for one (category, tier).
function PriceBandRow({ category, tier, band, session, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [min,     setMin]     = useState(String(band?.min_price ?? 0))
  const [max,     setMax]     = useState(band?.max_price != null ? String(band.max_price) : '')
  const [saving,  setSaving]  = useState(false)

  async function save() {
    setSaving(true)
    const payload = {
      category, tier,
      min_price: parseFloat(min) || 0,
      max_price: max === '' ? null : parseFloat(max),
    }
    const { data, error } = await supabase.from('price_bands')
      .upsert(payload, { onConflict: 'category,tier' }).select().single()
    setSaving(false)
    if (!error && data) {
      onSaved(data)
      setEditing(false)
      logAdminAction(session, 'price_band_update', `${category}_${tier}`, payload)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input type="number" value={min} onChange={e => setMin(e.target.value)}
          className="w-24 border-2 border-blue-400 rounded-lg px-2 py-1 text-xs font-mono outline-none" />
        <span className="text-xs text-gray-400">to</span>
        <input type="number" placeholder="∞" value={max} onChange={e => setMax(e.target.value)}
          className="w-24 border-2 border-blue-400 rounded-lg px-2 py-1 text-xs font-mono outline-none" />
        <button onClick={save} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-2 py-1 rounded-lg disabled:opacity-50">
          {saving ? '…' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-400 px-1">✕</button>
      </div>
    )
  }
  return (
    <button onClick={() => setEditing(true)} className="text-xs font-mono text-gray-700 hover:text-blue-600 hover:underline">
      {formatKsh(band?.min_price ?? 0)} – {band?.max_price != null ? formatKsh(band.max_price) : '∞'}
    </button>
  )
}

function PriceBandsPanel({ priceBands, session, onChange }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 hover:bg-gray-100 transition">
        <h3 className="font-black text-gray-700 text-sm">📐 Price Bands — what Ksh range counts as each tier</h3>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="p-4 overflow-x-auto">
          <p className="text-xs text-gray-400 mb-3">A product's tier is derived from its buying price falling inside these ranges — not typed in per product. Edit a range, and every product with a price inside it re-tiers automatically.</p>
          <table className="text-sm">
            <thead>
              <tr className="text-xs text-gray-400 uppercase">
                <th className="text-left pr-4 py-1">Category</th>
                <th className="text-left pr-4 py-1">💡 Budget</th>
                <th className="text-left pr-4 py-1">✅ Balanced</th>
                <th className="text-left pr-4 py-1">⭐ Premium</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(CATEGORY_META).map(cat => (
                <tr key={cat}>
                  <td className="pr-4 py-1.5 font-semibold text-gray-700">{CATEGORY_META[cat].title}</td>
                  {['budget', 'balanced', 'premium'].map(tier => (
                    <td key={tier} className="pr-4 py-1.5">
                      <PriceBandRow category={cat} tier={tier} band={priceBands?.[cat]?.[tier]} session={session}
                        onSaved={row => onChange(cat, tier, row)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ItemForm now lives in its own file — src/pages/ItemForm.tsx — as
// RhiPower's first TypeScript + Zod component (extracted here since it
// was already being rebuilt with a much larger spec-field set; Zod
// validates the data before it reaches Supabase, which matters more here
// than almost anywhere else since there's no human code reviewer).

// Stock movement ledger — fetched on demand per item, not preloaded for
// every row, since it's a "why did this change" lookup, not a primary view.
function StockHistoryToggle({ roleKey }) {
  const [open,   setOpen]   = useState(false)
  const [rows,   setRows]   = useState(null)
  const [loading, setLoading] = useState(false)

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (rows === null) {
      setLoading(true)
      const { data } = await supabase.from('stock_movements')
        .select('*').eq('role_key', roleKey).order('created_at', { ascending: false }).limit(20)
      setRows(data || [])
      setLoading(false)
    }
  }

  return (
    <div className="mt-1">
      <button onClick={toggle} className="text-xs text-gray-400 hover:text-blue-600 underline">
        {open ? 'Hide history' : 'History'}
      </button>
      {open && (
        <div className="mt-1 max-h-32 overflow-y-auto bg-gray-50 border border-gray-100 rounded-lg p-2 space-y-1 min-w-[200px]">
          {loading ? (
            <div className="text-xs text-gray-400">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-gray-400 italic">No changes logged yet.</div>
          ) : rows.map(r => (
            <div key={r.id} className="text-xs">
              <span className={r.quantity_changed >= 0 ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
                {r.quantity_changed >= 0 ? '+' : ''}{r.quantity_changed}
              </span>{' '}
              <span className="text-gray-500">{new Date(r.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}</span>
              {r.reason && <div className="text-gray-400 italic">{r.reason}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Serial-number tracking — inverters only (see migration 008 for why).
function SerialsToggle({ roleKey, session }) {
  const [open,   setOpen]   = useState(false)
  const [serials, setSerials] = useState(null)
  const [loading, setLoading] = useState(false)
  const [newSerial, setNewSerial] = useState('')
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('product_serials')
      .select('*').eq('role_key', roleKey).order('created_at', { ascending: false })
    setSerials(data || [])
    setLoading(false)
  }

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (serials === null) await load()
  }

  async function addSerial() {
    if (!newSerial.trim()) return
    setAdding(true)
    const { error } = await supabase.from('product_serials').insert({ role_key: roleKey, serial_number: newSerial.trim() })
    setAdding(false)
    if (!error) {
      setNewSerial('')
      await load()
      logAdminAction(session, 'serial_added', roleKey, { serial_number: newSerial.trim() })
    }
  }

  async function updateStatus(id, status) {
    await supabase.from('product_serials').update({ status }).eq('id', id)
    setSerials(p => p.map(s => s.id === id ? { ...s, status } : s))
    logAdminAction(session, 'serial_status_update', roleKey, { id, status })
  }

  return (
    <div className="mt-1">
      <button onClick={toggle} className="text-xs text-gray-400 hover:text-blue-600 underline">
        {open ? 'Hide serials' : `Serials${serials ? ` (${serials.length})` : ''}`}
      </button>
      {open && (
        <div className="mt-1 bg-gray-50 border border-gray-100 rounded-lg p-2 space-y-1.5 min-w-[220px] max-h-48 overflow-y-auto">
          {loading ? (
            <div className="text-xs text-gray-400">Loading…</div>
          ) : (
            <>
              {serials.length === 0 && <div className="text-xs text-gray-400 italic">No serials tracked yet.</div>}
              {serials.map(s => (
                <div key={s.id} className="text-xs flex items-center justify-between gap-1">
                  <span className="font-mono text-gray-700">{s.serial_number}</span>
                  <select value={s.status} onChange={e => updateStatus(s.id, e.target.value)}
                    className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white">
                    <option value="available">Available</option>
                    <option value="reserved">Reserved</option>
                    <option value="installed">Installed</option>
                    <option value="defective">Defective</option>
                  </select>
                </div>
              ))}
              <div className="flex gap-1 pt-1">
                <input type="text" placeholder="Serial number" value={newSerial}
                  onChange={e => setNewSerial(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addSerial() }}
                  className="flex-1 border border-gray-200 rounded px-1.5 py-1 text-xs" />
                <button onClick={addSerial} disabled={adding}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-2 py-1 rounded disabled:opacity-50">
                  {adding ? '…' : 'Add'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const ROLE_KEY_COLUMN = { panel: 'panel_role_key', inverter: 'inverter_role_key', battery: 'battery_role_key' }

// Zoho-style item detail modal — Overview / Transactions / History, plus
// Clone / Mark Active-Inactive / Delete. Layered on top of the existing
// inline table editing rather than replacing it, since that already works.
// Read-only view (+ Clone/Mark Inactive/Delete actions) — editing values
// happens exclusively through EditItemForm, reached via the table row's
// single "Edit" button, never through this modal. Keeping "view" and
// "edit" as two distinct surfaces (rather than an edit mode bolted onto
// this modal) avoids the exact bug this replaced: two different edit
// forms for the same fields, each with its own state, showing different
// results depending on which one was used last.
function ItemDetailModal({ row, category, onClose, onChanged, onCloneRequested, session }) {
  const meta = CATEGORY_META[category]
  // Same productSpecRows() the customer-facing product detail page uses —
  // a single source of truth so the admin's own view of an item's specs
  // never drifts from what a customer actually sees.
  const specs = meta ? productSpecRows(category, toProduct(row)) : []
  const [tab, setTab] = useState('overview')
  const [transactions, setTransactions] = useState(null)
  const [loadingTx, setLoadingTx] = useState(false)
  const [history, setHistory] = useState(null)
  const [loadingHist, setLoadingHist] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteBlocked, setDeleteBlocked] = useState(null)

  useEffect(() => {
    if (tab === 'transactions' && transactions === null) {
      const col = ROLE_KEY_COLUMN[category]
      if (!col) { setTransactions([]); return }
      setLoadingTx(true)
      supabase.from('quotation_requests')
        .select('id, client_name, created_at, grand_total_kes, status')
        .eq(col, row.role_key).order('created_at', { ascending: false }).limit(20)
        .then(({ data }) => { setTransactions(data || []); setLoadingTx(false) })
    }
    if (tab === 'history' && history === null) {
      setLoadingHist(true)
      supabase.from('stock_movements')
        .select('*').eq('role_key', row.role_key).order('created_at', { ascending: false }).limit(20)
        .then(({ data }) => { setHistory(data || []); setLoadingHist(false) })
    }
  }, [tab, category, history, row.role_key, transactions])

  async function toggleActive() {
    const next = !(row.is_active !== false)
    setBusy(true)
    const { error } = await supabase.from('inventory_prices').update({ is_active: next }).eq('role_key', row.role_key)
    setBusy(false)
    if (!error) {
      onChanged({ ...row, is_active: next })
      logAdminAction(session, next ? 'item_reactivated' : 'item_marked_inactive', row.role_key, {})
    }
  }

  async function handleDelete() {
    setBusy(true)
    const col = ROLE_KEY_COLUMN[category]
    const [{ count: txCount }, { count: histCount }] = await Promise.all([
      col ? supabase.from('quotation_requests').select('id', { count: 'exact', head: true }).eq(col, row.role_key) : Promise.resolve({ count: 0 }),
      supabase.from('stock_movements').select('id', { count: 'exact', head: true }).eq('role_key', row.role_key),
    ])
    if ((txCount || 0) > 0 || (histCount || 0) > 0) {
      setBusy(false)
      setDeleteBlocked(`This item has ${txCount || 0} quote(s) and ${histCount || 0} stock change(s) on record — delete is blocked to protect that history. Use "Mark Inactive" instead.`)
      return
    }
    const { error } = await supabase.from('inventory_prices').delete().eq('role_key', row.role_key)
    setBusy(false)
    if (!error) {
      logAdminAction(session, 'item_deleted', row.role_key, { sku: row.sku })
      onChanged(null)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <div className="text-xs font-mono text-gray-400">#{row.item_code ?? '—'} · {row.sku}</div>
            <h3 className="font-black text-gray-800 text-lg">{row.description}</h3>
            {row.is_active === false && <span className="text-xs font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">Inactive</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex gap-1 px-5 pt-3 border-b border-gray-100">
          {[['overview', 'Overview'], ['transactions', 'Transactions'], ['history', 'History']].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 text-sm font-bold border-b-2 transition ${tab === id ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === 'overview' && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-400">Brand / model</span><span className="font-bold">{row.sku}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Description</span><span className="font-bold text-right max-w-xs">{row.description}</span></div>
              {meta && <div className="flex justify-between"><span className="text-gray-400">{meta.capacityLabel}</span><span className="font-bold">{row[meta.capacityField] != null ? `${row[meta.capacityField]}${meta.capacityUnit}` : '—'}</span></div>}
              <div className="flex justify-between"><span className="text-gray-400">Weight</span><span className="font-bold">{row.unit_weight_kg != null ? `${row.unit_weight_kg} kg` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Buying price</span><span className="font-bold">{formatKsh(row.buying_price_kes)}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Selling price{row.margin_pct != null ? ` (${row.margin_pct}% margin)` : ' (35% default margin)'}</span><span className="font-bold text-emerald-700">{formatKsh(sellPrice(Number(row.buying_price_kes), row.margin_pct))}</span></div>
              {row.wholesale_price_kes != null && row.wholesale_min_qty != null && (
                <div className="flex justify-between"><span className="text-gray-400">Wholesale (at ≥{row.wholesale_min_qty} pcs)</span><span className="font-bold text-blue-700">{formatKsh(row.wholesale_price_kes)}</span></div>
              )}
              <div className="flex justify-between"><span className="text-gray-400">Stock on hand</span><span className="font-bold">{row.stock_qty ?? 'Not tracked'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Reorder point</span><span className="font-bold">{row.reorder_point ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Supplier</span><span className="font-bold">{row.supplier || '—'}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">VAT status</span><span className="font-bold">{VAT_STATUS_OPTIONS.find(o => o.value === (row.vat_status || 'standard'))?.label}</span></div>
              <div className="flex justify-between"><span className="text-gray-400">Status</span><span className="font-bold">{row.is_active === false ? 'Inactive' : 'Active'}{row.in_stock === false ? ' · Marked out of stock' : ''}</span></div>
              {specs.length > 0 && (
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <div className="text-xs font-bold uppercase text-gray-400 tracking-wider mb-1.5">Specifications</div>
                  <div className="space-y-1.5">
                    {specs.map(([k, v]) => (
                      <div key={k} className="flex justify-between"><span className="text-gray-400">{k}</span><span className="font-bold">{v}</span></div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {tab === 'transactions' && (
            loadingTx ? <div className="text-xs text-gray-400">Loading…</div> :
            !transactions?.length ? <div className="text-xs text-gray-400 italic">No quotes have used this exact product yet (only tracked from when this feature shipped — 2026-07-04 onward).</div> :
            <div className="space-y-2">
              {transactions.map(t => (
                <div key={t.id} className="flex justify-between text-sm border-b border-gray-50 pb-2">
                  <div>
                    <div className="font-semibold text-gray-700">{t.client_name || 'Unnamed'}</div>
                    <div className="text-xs text-gray-400">{new Date(t.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })} · {t.status}</div>
                  </div>
                  <div className="font-mono font-bold">{formatKsh(t.grand_total_kes)}</div>
                </div>
              ))}
            </div>
          )}
          {tab === 'history' && (
            loadingHist ? <div className="text-xs text-gray-400">Loading…</div> :
            !history?.length ? <div className="text-xs text-gray-400 italic">No stock changes logged yet.</div> :
            <div className="space-y-1.5">
              {history.map(h => (
                <div key={h.id} className="flex justify-between text-sm">
                  <span className={h.quantity_changed >= 0 ? 'text-green-700 font-bold' : 'text-red-700 font-bold'}>
                    {h.quantity_changed >= 0 ? '+' : ''}{h.quantity_changed}
                  </span>
                  <span className="text-gray-400 text-xs">{h.reason || '—'}</span>
                  <span className="text-gray-400 text-xs">{new Date(h.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' })}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {deleteBlocked && <div className="mx-5 mb-3 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{deleteBlocked}</div>}

        <div className="p-5 border-t border-gray-100 flex flex-wrap gap-2">
          <button onClick={() => onCloneRequested(row)} className="text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg transition">
            Clone Item
          </button>
          <button onClick={toggleActive} disabled={busy} className="text-xs font-bold bg-amber-100 hover:bg-amber-200 text-amber-800 px-3 py-2 rounded-lg transition disabled:opacity-50">
            {row.is_active === false ? 'Mark Active' : 'Mark Inactive'}
          </button>
          <button onClick={handleDelete} disabled={busy} className="text-xs font-bold bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg transition disabled:opacity-50 ml-auto">
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// The InventoryTable sub-view keeps price bands in the same shape the DB
// rows already have ({min_price, max_price}) rather than the [min,max]
// tuples used elsewhere, since that's what's directly rendered/edited here.
function defaultBandsAsRows() {
  const out = {}
  Object.entries(DEFAULT_PRICE_BANDS).forEach(([category, tiers]) => {
    out[category] = {}
    Object.entries(tiers).forEach(([tier, [min_price, max_price]]) => {
      out[category][tier] = { min_price, max_price }
    })
  })
  return out
}

function getTierBadge(category, price, priceBands) {
  const tiers = priceBands?.[category]
  if (!tiers) return null
  for (const tier of ['budget', 'balanced', 'premium']) {
    const band = tiers[tier]
    if (!band) continue
    if (price >= band.min_price && (band.max_price == null || price < band.max_price)) return tier
  }
  return null
}

// ── Inventory table (headless — header/sub-nav live in the outer panel's top bar) ──
function InventoryTable({ session, invSection, business }) {
  const [rows,       setRows]       = useState({})
  const [priceBands, setPriceBands] = useState(defaultBandsAsRows)
  const [loading, setLoading] = useState(true)
  // The one and only place editing/adding an item happens: null, or
  // { category, mode: 'add'|'edit', editRow?, cloneFrom? }. Replaces what
  // used to be three separate inline editors (price, stock, and a modal
  // edit form) each with their own state — see ItemForm's comment.
  const [formState, setFormState] = useState(null)
  const [viewingItem, setViewingItem] = useState(null)  // { row, category } for the read-only detail modal

  useEffect(() => {
    Promise.all([
      supabase.from('inventory_prices').select('*'),
      supabase.from('price_bands').select('*'),
    ]).then(([{ data }, { data: bandRows }]) => {
      if (data) { const m = {}; data.forEach(r => { m[r.role_key] = r }); setRows(m) }
      if (bandRows?.length) {
        const b = {}
        bandRows.forEach(row => { b[row.category] = b[row.category] || {}; b[row.category][row.tier] = row })
        setPriceBands(prev => ({ ...prev, ...b }))
      }
      setLoading(false)
    })
  }, [])

  function handleBandSaved(category, tier, row) {
    setPriceBands(p => ({ ...p, [category]: { ...p[category], [tier]: row } }))
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading inventory…</div>

  if (invSection === 'compatibility') return <HardwareCompatibilityMatrix />

  // Panel/Inverter/Battery groups are computed live from whatever rows exist
  // for that category — any number of products, tier shown as a derived badge.
  const productGroups = Object.keys(CATEGORY_META).map(category => {
    const meta = CATEGORY_META[category]
    const items = Object.values(rows)
      .filter(r => r.category === category)
      .map(r => {
        const capacityValue = r[meta.capacityField] != null ? Number(r[meta.capacityField]) : null
        const capacity = capacityValue != null ? `${capacityValue}${meta.capacityUnit}` : '—'
        const weight   = r.unit_weight_kg != null ? `${r.unit_weight_kg} kg` : ''
        const tier     = getTierBadge(category, Number(r.buying_price_kes || 0), priceBands)
        const tierTxt  = tier ? { budget: '💡 Budget', balanced: '✅ Balanced', premium: '⭐ Premium' }[tier] : '—'
        return { key: r.role_key, label: r.description, spec: [capacity, weight, tierTxt].filter(Boolean).join(' · '), capacityValue }
      })
      // Group same-capacity items together (e.g. all 620W panels), largest capacity first;
      // items with no recorded capacity sink to the bottom.
      .sort((a, b) => (b.capacityValue ?? -Infinity) - (a.capacityValue ?? -Infinity))
    return { title: meta.title, category, items, capacityUnit: meta.capacityUnit, groupByCapacity: true }
  })
  const allGroups = [...productGroups, ...GROUPS]

  const lowStockItems = allGroups.flatMap(g => g.items)
    .map(item => ({ item, row: rows[item.key] }))
    .filter(({ row }) => row?.stock_qty != null && row?.reorder_point != null && row.stock_qty <= row.reorder_point)

  // Add/Edit is a full page, not an inline panel in the list — this is
  // the only "Edit" entry point in the app (see ItemForm's comment), and
  // giving it its own page keeps a long form from cramping the table view
  // it was previously squeezed into.
  if (formState) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <button onClick={() => setFormState(null)} className="text-xs font-bold text-gray-400 hover:text-gray-600">← Back to Inventory</button>
        <h2 className="text-lg font-black text-gray-800">
          {formState.mode === 'edit' ? `Edit Item: ${formState.editRow.description}` : 'Add New Item'}
        </h2>
        <ItemForm category={formState.category} mode={formState.mode} session={session} business={business}
          editRow={formState.editRow} cloneFrom={formState.cloneFrom}
          onCancel={() => setFormState(null)}
          onSaved={row => { setRows(p => ({ ...p, [row.role_key]: row })); setFormState(null) }} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {lowStockItems.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          <strong>⚠️ {lowStockItems.length} item{lowStockItems.length !== 1 ? 's' : ''} at or below reorder point:</strong>{' '}
          {lowStockItems.map(({ item, row }) => `${item.label} (${row.stock_qty} left)`).join(' · ')}
        </div>
      )}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-1">
        <div><strong>To change anything about an item</strong> — price, stock, description, specs — click <strong>Edit</strong> on its row. That's the only place item fields are edited; there's no separate quick-edit anywhere else, so there's never a question of which value is current.</div>
        <div><strong>Tier is automatic:</strong> it's derived from where a product's buying price falls in the Price Bands panel below — add a second or third brand to any category and it'll slot into the right tier on its own.</div>
      </div>

      {invSection === 'products' && (
        <PriceBandsPanel priceBands={priceBands} session={session} onChange={handleBandSaved} />
      )}

      {(invSection === 'products' ? productGroups : GROUPS).map(group => {
        // For capacity-grouped categories (panels/inverters/batteries), count
        // how many items share each capacity value so the subheader can show
        // "620W · 3 items" — computed once per group, not per row.
        const capacityCounts = {}
        if (group.groupByCapacity) {
          group.items.forEach(item => {
            capacityCounts[item.capacityValue] = (capacityCounts[item.capacityValue] || 0) + 1
          })
        }
        let lastCapacity = Symbol('none') // sentinel so the very first row always renders a subheader
        return (
        <div key={group.title} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 flex items-center justify-between">
            <h3 className="font-black text-gray-700 text-sm">{group.title}</h3>
            {group.category && (
              <button onClick={() => setFormState({ category: group.category, mode: 'add' })}
                className="text-xs font-bold text-blue-600 hover:text-blue-800">
                + Add Item
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="px-5 py-2 text-left font-bold">Item</th>
                  <th className="px-4 py-2 text-right font-bold">Buying Price</th>
                  <th className="px-4 py-2 text-right font-bold">Selling Price</th>
                  <th className="px-4 py-2 text-center font-bold">In Stock</th>
                  <th className="px-4 py-2 text-left font-bold">Stock Qty / Supplier</th>
                  <th className="px-4 py-2 text-left font-bold">Updated</th>
                  <th className="px-4 py-2 w-24"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {group.items.map(item => {
                  const row     = rows[item.key] || {}
                  const buying  = Number(row.buying_price_kes || 0)
                  const selling = Math.round(sellPrice(buying, row.margin_pct))
                  const inStock = row.in_stock !== false
                  const updated = row.updated_at
                    ? new Date(row.updated_at).toLocaleDateString('en-KE', { day:'2-digit', month:'short' })
                    : '—'
                  const isInactive = row.is_active === false
                  const showSubheader = group.groupByCapacity && item.capacityValue !== lastCapacity
                  if (showSubheader) lastCapacity = item.capacityValue
                  return (
                    <Fragment key={item.key}>
                      {showSubheader && (
                        <tr>
                          <td colSpan={7} className="bg-gray-50/70 px-5 py-1.5 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                            {item.capacityValue != null ? `${item.capacityValue}${group.capacityUnit}` : 'Unspecified capacity'}
                            <span className="ml-1.5 font-normal normal-case text-gray-400">
                              · {capacityCounts[item.capacityValue]} item{capacityCounts[item.capacityValue] !== 1 ? 's' : ''}
                            </span>
                          </td>
                        </tr>
                      )}
                      <tr className={`hover:bg-gray-50 transition ${!inStock || isInactive ? 'opacity-50' : ''}`}>
                      <td className="px-5 py-3">
                        {group.category ? (
                          <button onClick={() => setViewingItem({ row, category: group.category })} className="text-left">
                            <div className="font-semibold text-gray-800 text-sm hover:text-blue-600 transition">
                              {row.item_code != null && <span className="text-gray-300 font-mono mr-1">#{row.item_code}</span>}
                              {item.label}
                              {isInactive && <span className="ml-1.5 text-[10px] font-bold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full align-middle">Inactive</span>}
                            </div>
                            <div className="text-xs text-gray-400">{item.spec}</div>
                          </button>
                        ) : (
                          <>
                            <div className="font-semibold text-gray-800 text-sm">{item.label}</div>
                            <div className="text-xs text-gray-400">{item.spec}</div>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-gray-800 tabular-nums">{formatKsh(buying)}</td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                        {formatKsh(selling)}
                        {row.wholesale_price_kes != null && row.wholesale_min_qty != null && (
                          <div className="text-[10px] font-sans font-normal text-blue-500 normal-case">{formatKsh(row.wholesale_price_kes)} at ≥{row.wholesale_min_qty}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-bold px-2 py-1 rounded-full ${inStock ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                          {inStock ? 'In Stock' : 'Out of Stock'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {row.stock_qty != null ? (
                          <div className={`text-xs font-bold tabular-nums ${
                            row.reorder_point != null && row.stock_qty <= row.reorder_point ? 'text-red-600' : 'text-gray-700'}`}>
                            {row.stock_qty} unit{row.stock_qty !== 1 ? 's' : ''}
                            {row.reorder_point != null && row.stock_qty <= row.reorder_point && ' ⚠️ Low'}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-300 italic">Not tracked</div>
                        )}
                        {row.supplier && <div className="text-xs text-gray-400">{row.supplier}</div>}
                        {row.stock_qty != null && <StockHistoryToggle roleKey={item.key} />}
                        {group.category === 'inverter' && <SerialsToggle roleKey={item.key} session={session} />}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{updated}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => setFormState({ category: row.category, mode: 'edit', editRow: row })}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition">
                          Edit
                        </button>
                      </td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        )
      })}

      {viewingItem && (
        <ItemDetailModal
          row={viewingItem.row}
          category={viewingItem.category}
          session={session}
          onClose={() => setViewingItem(null)}
          onChanged={updatedRow => {
            if (updatedRow === null) {
              setRows(p => { const n = { ...p }; delete n[viewingItem.row.role_key]; return n })
            } else {
              setRows(p => ({ ...p, [updatedRow.role_key]: updatedRow }))
              // Keep the open modal's own row in sync too — it's a snapshot
              // captured at open time, not reactively derived from `rows`,
              // so without this a save would look like it did nothing until
              // the modal was closed and reopened.
              setViewingItem(v => v && v.row.role_key === updatedRow.role_key ? { ...v, row: updatedRow } : v)
            }
          }}
          onCloneRequested={sourceRow => {
            setFormState({ category: viewingItem.category, mode: 'add', cloneFrom: sourceRow })
            setViewingItem(null)
          }}
        />
      )}
    </div>
  )
}

// ── Main admin panel — auth gate + tabs ─────────────────────────────────────
// Grouped by function (Sales & CRM / Purchasing & Inventory / Finance /
// System) now that the flat list grew to 15 tabs — Command Centre stays
// ungrouped at top since it's the default landing tab, not a category
// member. SECTIONS stays a flat list (derived below) since the top-bar
// title lookup and the tab-content switch don't care about grouping.
const NAV_GROUPS = [
  { title: null, items: [
    { id: 'home', label: '🏠 Command Centre' },
  ]},
  { title: 'Sales & CRM', items: [
    { id: 'neworder',    label: '🛒 New Order (Phone/Walk-in)' },
    { id: 'leads',       label: '📋 Leads & Pipeline' },
    { id: 'salesorders', label: '📑 Sales Orders' },
    { id: 'invoices',    label: '💵 Invoices' },
    { id: 'customers',   label: '👥 Customers' },
  ]},
  { title: 'Purchasing & Inventory', items: [
    { id: 'inventory',   label: '📦 Inventory & Prices' },
    { id: 'suppliers',   label: '🏭 Suppliers' },
    { id: 'purchasing',  label: '🧾 Purchase Orders' },
    { id: 'vendorbills', label: '💳 Vendor Bills' },
  ]},
  { title: 'Finance', items: [
    { id: 'accounting',  label: '📚 Accounting' },
    { id: 'fixedassets', label: '🏗️ Fixed Assets' },
    { id: 'reports',     label: '📊 Reports' },
    { id: 'snapshot',    label: '🚀 Investor Snapshot' },
  ]},
  { title: 'System', items: [
    { id: 'settings', label: '⚙️ Settings' },
  ]},
]
const SECTIONS = NAV_GROUPS.flatMap(g => g.items)

const INVENTORY_SUBS = [
  { id: 'products',      label: '📦 Products' },
  { id: 'components',    label: '🔧 BOM Components' },
  { id: 'compatibility', label: '🔗 Compatibility' },
]

export default function Admin({ onBack }) {
  const [session,     setSession]     = useState(undefined)
  const [activeTab,   setActiveTab]   = useState('home')
  const [invSection,  setInvSection]  = useState('products')  // Inventory's sub-nav, shown in the top bar
  const [showWarning, setShowWarning] = useState(false)
  // Cross-navigation: jump to another section AND auto-expand a specific
  // record — e.g. "View Sales Order" from a lead, or "View Invoice" from a
  // Sales Order — instead of leaving the admin to hunt for it themselves.
  const [focusId, setFocusId] = useState(null)
  function navigateTo(tab, id = null) {
    setActiveTab(tab)
    setFocusId(id)
  }
  // Org settings (VAT rate, numbering prefixes, business info) — fetched
  // once here since Admin renders as its own tree outside App.jsx, and
  // passed down to every admin page that formats a document number or
  // needs business contact info. Settings itself refetches after a save so
  // every other tab reflects a change immediately, no reload needed.
  const [business, setBusiness] = useState(BUSINESS_FALLBACK)
  useEffect(() => { fetchOrgSettings().then(setBusiness) }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setSession(null)
  }

  // Auto sign-out an idle admin — this session controls live pricing and every
  // customer lead, so it doesn't get to stay open indefinitely like a browsing visitor's.
  const { staySignedIn } = useSessionTimeout({
    timeoutMinutes: SESSION_TIMEOUT_MINUTES.admin,
    enabled:        Boolean(session),
    onWarn:         () => setShowWarning(true),
    onTimeout:      () => { setShowWarning(false); handleLogout() },
  })

  if (session === undefined) return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">Checking session…</div>
  )
  if (!session) return <LoginScreen onBack={onBack} />

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {showWarning && (
        <SessionTimeoutModal
          minutesLeft={SESSION_WARN_MINUTES}
          onStay={() => { staySignedIn(); setShowWarning(false) }}
          onSignOutNow={handleLogout}
        />
      )}

      {/* Left sidebar — main sections */}
      <aside className="w-56 shrink-0 bg-gray-900 text-white h-screen sticky top-0 flex flex-col print:hidden">
        <div className="px-5 py-5 border-b border-gray-800">
          <h1 className="text-lg font-black">⚡ RhiPower</h1>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{session.user?.email}</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((group, gi) => (
            <div key={gi}>
              {group.title && (
                <div className="px-3 pb-1.5 text-[10px] font-black text-gray-500 uppercase tracking-wider">{group.title}</div>
              )}
              <div className="space-y-1">
                {group.items.map(s => (
                  <button key={s.id} onClick={() => setActiveTab(s.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-bold transition
                      ${activeTab === s.id ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-gray-800 space-y-1">
          <button onClick={onBack} className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-gray-400 hover:text-white hover:bg-gray-800 transition">← Back to App</button>
          <button onClick={handleLogout} className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold bg-red-900/40 text-red-300 hover:bg-red-900/70 transition">Sign Out</button>
        </div>
      </aside>

      {/* Right side: top bar (sub-navigation for the active section) + content */}
      <div className="flex-1 min-w-0">
        <div className="bg-white border-b border-gray-100 px-6 py-3 sticky top-0 z-10 print:hidden">
          {activeTab === 'inventory' ? (
            <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 w-fit">
              {INVENTORY_SUBS.map(s => (
                <button key={s.id} onClick={() => setInvSection(s.id)}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition
                    ${invSection === s.id ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          ) : (
            <h2 className="text-lg font-black text-gray-800">
              {SECTIONS.find(s => s.id === activeTab)?.label}
            </h2>
          )}
        </div>

        <div className="max-w-7xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
          {activeTab === 'home'        && <AdminHome session={session} onNavigate={navigateTo} />}
          {activeTab === 'neworder'    && <AdminNewOrder session={session} onNavigate={navigateTo} />}
          {activeTab === 'leads'       && <AdminLeads session={session} onNavigate={navigateTo} focusId={focusId} business={business} />}
          {activeTab === 'inventory'   && <InventoryTable session={session} invSection={invSection} business={business} />}
          {activeTab === 'suppliers'   && <AdminSuppliers session={session} onNavigate={navigateTo} business={business} />}
          {activeTab === 'purchasing'  && <AdminPurchaseOrders session={session} business={business} focusId={focusId} />}
          {activeTab === 'vendorbills' && <AdminVendorBills session={session} focusId={focusId} />}
          {activeTab === 'salesorders' && <AdminSalesOrders session={session} onNavigate={navigateTo} focusId={focusId} business={business} />}
          {activeTab === 'invoices'    && <AdminInvoices session={session} onNavigate={navigateTo} focusId={focusId} business={business} />}
          {activeTab === 'customers'   && <AdminCustomers session={session} onNavigate={navigateTo} business={business} />}
          {activeTab === 'accounting'  && <AdminAccounting session={session} />}
          {activeTab === 'fixedassets' && <AdminFixedAssets session={session} />}
          {activeTab === 'reports'     && <AdminReports session={session} />}
          {activeTab === 'snapshot'    && <AdminInvestorSnapshot business={business} />}
          {activeTab === 'settings'    && <AdminSettings session={session} onSettingsChanged={setBusiness} />}
        </div>
      </div>
    </div>
  )
}
