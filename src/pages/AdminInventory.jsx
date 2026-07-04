import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { DEFAULT_PRICE_BANDS } from '../data/skuInventory.js'
import AdminLeads from './AdminLeads.jsx'
import AdminCustomers from './AdminCustomers.jsx'
import SessionTimeoutModal from '../components/SessionTimeoutModal.jsx'
import { useSessionTimeout } from '../hooks/useSessionTimeout.js'
import { SESSION_TIMEOUT_MINUTES, SESSION_WARN_MINUTES } from '../lib/roles.js'
import { logAdminAction } from '../lib/auditLog.js'

// Panel/Inverter/Battery are no longer fixed 3-slot groups — any number of
// products can exist per category, and tier is derived from price, not
// assigned. They're rendered by ProductCategorySection below, driven live
// from whatever rows exist in the database, plus a "+ Add Item" form.
const CATEGORY_META = {
  panel:    { title: '☀️ Solar Panels', capacityField: 'watts_each', capacityLabel: 'Watts',  capacityUnit: 'W'   },
  inverter: { title: '⚡ Inverters',    capacityField: 'kw_each',    capacityLabel: 'Capacity', capacityUnit: 'kW' },
  battery:  { title: '🔋 Batteries',    capacityField: 'kwh_each',   capacityLabel: 'Capacity', capacityUnit: 'kWh'},
}

// Extra comparison-spec fields per category (see migration 007) — shown in
// the Add/Edit Item form, entirely optional so nothing is ever guessed.
const SPEC_FIELDS = {
  panel:    [
    { key: 'efficiency_pct',     label: 'Efficiency (%)' },
    { key: 'warranty_years',     label: 'Warranty (yr)' },
    { key: 'degradation_pct_yr', label: 'Degradation (%/yr)' },
  ],
  inverter: [
    { key: 'efficiency_pct', label: 'Efficiency (%)' },
    { key: 'warranty_years', label: 'Warranty (yr)' },
    { key: 'mppt_count',     label: 'MPPT count' },
    { key: 'phase',          label: 'Phase (single/three)', text: true },
  ],
  battery:  [
    { key: 'cycle_life',     label: 'Cycle life' },
    { key: 'dod_pct',        label: 'DoD (%)' },
    { key: 'warranty_years', label: 'Warranty (yr)' },
  ],
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

// New-product form — any number of products per category, tier derived from price.
function AddItemForm({ category, onAdded, session }) {
  const meta = CATEGORY_META[category]
  const specFields = SPEC_FIELDS[category]
  const blank = () => {
    const f = { sku: '', description: '', buying_price_kes: '', unit_weight_kg: '', capacity: '' }
    specFields.forEach(s => { f[s.key] = '' })
    return f
  }
  const [form,   setForm]   = useState(blank())
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!form.sku.trim() || !form.description.trim() || !form.buying_price_kes) return
    setSaving(true)
    const roleKey = `${category}_${form.sku.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`
    const payload = {
      role_key: roleKey, sku: form.sku.trim(), description: form.description.trim(),
      category, tier: 'balanced', unit: 'each',
      buying_price_kes: parseFloat(form.buying_price_kes),
    }
    if (form.unit_weight_kg) payload.unit_weight_kg = parseFloat(form.unit_weight_kg)
    if (form.capacity) payload[meta.capacityField] = parseFloat(form.capacity)
    specFields.forEach(s => { if (form[s.key] !== '') payload[s.key] = s.text ? form[s.key] : parseFloat(form[s.key]) })

    const { data, error } = await supabase.from('inventory_prices').insert(payload).select().single()
    setSaving(false)
    if (!error && data) {
      onAdded(data)
      setForm(blank())
      logAdminAction(session, 'product_added', roleKey, { category, sku: data.sku })
    }
  }

  return (
    <div className="p-4 bg-blue-50 border-b border-blue-100 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Brand / model (e.g. JA Solar 700W N-Type)" value={form.sku}
          onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input placeholder="Buying price (Ksh)" type="number" value={form.buying_price_kes}
          onChange={e => setForm(f => ({ ...f, buying_price_kes: e.target.value }))}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <input placeholder="Full description (shown to customers)" value={form.description}
        onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <input placeholder={`${meta.capacityLabel} (${meta.capacityUnit})`} type="number" value={form.capacity}
          onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input placeholder="Weight (kg)" type="number" value={form.unit_weight_kg}
          onChange={e => setForm(f => ({ ...f, unit_weight_kg: e.target.value }))}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {specFields.map(s => (
          <input key={s.key} placeholder={s.label} type={s.text ? 'text' : 'number'} value={form[s.key]}
            onChange={e => setForm(f => ({ ...f, [s.key]: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
        ))}
      </div>
      <p className="text-xs text-blue-600">Leave any spec blank if you don't know it yet — it just won't show in the customer comparison.</p>
      <button onClick={save} disabled={saving}
        className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
        {saving ? 'Adding…' : 'Add Product'}
      </button>
    </div>
  )
}

// AdminInventory keeps price bands in the same shape the DB rows already
// have ({min_price, max_price}) rather than the [min,max] tuples used
// elsewhere, since that's what's directly rendered/edited here.
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

// ── Inventory table (headless — header is in the outer panel) ───────────────
function InventoryTable({ session }) {
  const [rows,       setRows]       = useState({})
  const [priceBands, setPriceBands] = useState(defaultBandsAsRows)
  const [editing, setEditing] = useState({})
  const [saving,  setSaving]  = useState({})
  const [saved,   setSaved]   = useState({})
  const [loading, setLoading] = useState(true)
  const [addingTo, setAddingTo] = useState(null)  // which category's "+ Add Item" form is open

  // Stock qty + reorder point + supplier (+ specs, for product categories) —
  // edited together as one small form, separate from price since touched far less often.
  const [editingStock, setEditingStock] = useState({})
  const [savingStock,  setSavingStock]  = useState({})
  const [savedStock,   setSavedStock]   = useState({})

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

  function startEdit(key) {
    setEditing(p => ({ ...p, [key]: String(Math.round(rows[key]?.buying_price_kes || 0)) }))
  }
  function cancelEdit(key) {
    setEditing(p => { const n = { ...p }; delete n[key]; return n })
  }
  async function savePrice(key) {
    const price = parseInt((editing[key]||'0').replace(/,/g,''), 10)
    if (!price || price <= 0) return
    setSaving(p => ({ ...p, [key]: true }))
    const { error } = await supabase
      .from('inventory_prices')
      .update({ buying_price_kes: price, updated_at: new Date().toISOString() })
      .eq('role_key', key)
    setSaving(p => ({ ...p, [key]: false }))
    if (!error) {
      const previous = rows[key]?.buying_price_kes
      setRows(p => ({ ...p, [key]: { ...p[key], buying_price_kes: price, updated_at: new Date().toISOString() } }))
      cancelEdit(key)
      setSaved(p => ({ ...p, [key]: true }))
      setTimeout(() => setSaved(p => { const n={...p}; delete n[key]; return n }), 2500)
      logAdminAction(session, 'price_update', key, { from: previous, to: price })
    }
  }
  async function toggleStock(key) {
    const next = !(rows[key]?.in_stock ?? true)
    await supabase.from('inventory_prices').update({ in_stock: next, updated_at: new Date().toISOString() }).eq('role_key', key)
    setRows(p => ({ ...p, [key]: { ...p[key], in_stock: next } }))
    logAdminAction(session, 'stock_toggle', key, { in_stock: next })
  }

  function startEditStock(key) {
    const r = rows[key] || {}
    const meta = CATEGORY_META[r.category]
    const form = {
      stock_qty:     r.stock_qty     != null ? String(r.stock_qty)     : '',
      reorder_point: r.reorder_point != null ? String(r.reorder_point) : '',
      supplier:      r.supplier || '',
    }
    // Product categories (panel/inverter/battery) also expose capacity,
    // weight, and comparison specs in this same combined form.
    if (meta) {
      form.capacity       = r[meta.capacityField] != null ? String(r[meta.capacityField]) : ''
      form.unit_weight_kg = r.unit_weight_kg != null ? String(r.unit_weight_kg) : ''
      ;(SPEC_FIELDS[r.category] || []).forEach(s => { form[s.key] = r[s.key] != null ? String(r[s.key]) : '' })
    }
    setEditingStock(p => ({ ...p, [key]: form }))
  }
  function cancelEditStock(key) {
    setEditingStock(p => { const n = { ...p }; delete n[key]; return n })
  }
  function updateEditingStock(key, field, value) {
    setEditingStock(p => ({ ...p, [key]: { ...p[key], [field]: value } }))
  }
  async function saveStock(key) {
    const form = editingStock[key] || {}
    const row  = rows[key] || {}
    const meta = CATEGORY_META[row.category]
    const payload = {
      stock_qty:     form.stock_qty     === '' ? null : parseInt(form.stock_qty, 10),
      reorder_point: form.reorder_point === '' ? null : parseInt(form.reorder_point, 10),
      supplier:      (form.supplier || '').trim() || null,
      updated_at:    new Date().toISOString(),
    }
    if (meta) {
      if (form.capacity !== undefined)       payload[meta.capacityField] = form.capacity === '' ? null : parseFloat(form.capacity)
      if (form.unit_weight_kg !== undefined) payload.unit_weight_kg      = form.unit_weight_kg === '' ? null : parseFloat(form.unit_weight_kg)
      ;(SPEC_FIELDS[row.category] || []).forEach(s => {
        if (form[s.key] === undefined) return
        payload[s.key] = form[s.key] === '' ? null : (s.text ? form[s.key] : parseFloat(form[s.key]))
      })
    }
    setSavingStock(p => ({ ...p, [key]: true }))
    const { error } = await supabase.from('inventory_prices').update(payload).eq('role_key', key)
    setSavingStock(p => ({ ...p, [key]: false }))
    if (!error) {
      setRows(p => ({ ...p, [key]: { ...p[key], ...payload } }))
      cancelEditStock(key)
      setSavedStock(p => ({ ...p, [key]: true }))
      setTimeout(() => setSavedStock(p => { const n = { ...p }; delete n[key]; return n }), 2500)
      logAdminAction(session, 'stock_level_update', key, payload)
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading inventory…</div>

  // Panel/Inverter/Battery groups are computed live from whatever rows exist
  // for that category — any number of products, tier shown as a derived badge.
  const productGroups = Object.keys(CATEGORY_META).map(category => {
    const meta = CATEGORY_META[category]
    const items = Object.values(rows)
      .filter(r => r.category === category)
      .map(r => {
        const capacity = r[meta.capacityField] != null ? `${r[meta.capacityField]}${meta.capacityUnit}` : '—'
        const weight   = r.unit_weight_kg != null ? `${r.unit_weight_kg} kg` : ''
        const tier     = getTierBadge(category, Number(r.buying_price_kes || 0), priceBands)
        const tierTxt  = tier ? { budget: '💡 Budget', balanced: '✅ Balanced', premium: '⭐ Premium' }[tier] : '—'
        return { key: r.role_key, label: r.description, spec: [capacity, weight, tierTxt].filter(Boolean).join(' · ') }
      })
    return { title: meta.title, category, items }
  })
  const allGroups = [...productGroups, ...GROUPS]

  const lowStockItems = allGroups.flatMap(g => g.items)
    .map(item => ({ item, row: rows[item.key] }))
    .filter(({ row }) => row?.stock_qty != null && row?.reorder_point != null && row.stock_qty <= row.reorder_point)

  return (
    <div className="space-y-4">
      {lowStockItems.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
          <strong>⚠️ {lowStockItems.length} item{lowStockItems.length !== 1 ? 's' : ''} at or below reorder point:</strong>{' '}
          {lowStockItems.map(({ item, row }) => `${item.label} (${row.stock_qty} left)`).join(' · ')}
        </div>
      )}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 space-y-1">
        <div><strong>To update a price:</strong> click the price → type new buying price → Save (or Enter).
        Selling price = buying × 1.35 and updates automatically on all future client quotes.</div>
        <div><strong>To track stock:</strong> click "Not tracked" / the quantity under Stock Qty → enter units on hand,
        a reorder threshold, and your supplier. Leave blank if you don't want to track a particular item — it won't affect quoting either way.</div>
        <div><strong>Tier is now automatic:</strong> it's derived from where a product's buying price falls in the Price Bands panel below — add a second or third brand to any category and it'll slot into the right tier on its own.</div>
      </div>

      <PriceBandsPanel priceBands={priceBands} session={session} onChange={handleBandSaved} />

      {allGroups.map(group => (
        <div key={group.title} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 flex items-center justify-between">
            <h3 className="font-black text-gray-700 text-sm">{group.title}</h3>
            {group.category && (
              <button onClick={() => setAddingTo(a => a === group.category ? null : group.category)}
                className="text-xs font-bold text-blue-600 hover:text-blue-800">
                {addingTo === group.category ? '✕ Cancel' : '+ Add Item'}
              </button>
            )}
          </div>
          {group.category && addingTo === group.category && (
            <AddItemForm category={group.category} session={session}
              onAdded={row => setRows(p => ({ ...p, [row.role_key]: row }))} />
          )}
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
                  const selling = Math.round(buying * 1.35)
                  const inStock = row.in_stock !== false
                  const isEdit  = item.key in editing
                  const updated = row.updated_at
                    ? new Date(row.updated_at).toLocaleDateString('en-KE', { day:'2-digit', month:'short' })
                    : '—'
                  return (
                    <tr key={item.key} className={`hover:bg-gray-50 transition ${!inStock ? 'opacity-50' : ''}`}>
                      <td className="px-5 py-3">
                        <div className="font-semibold text-gray-800 text-sm">{item.label}</div>
                        <div className="text-xs text-gray-400">{item.spec}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isEdit ? (
                          <input type="number" value={editing[item.key]} autoFocus
                            onChange={e => setEditing(p => ({ ...p, [item.key]: e.target.value }))}
                            onKeyDown={e => { if (e.key==='Enter') savePrice(item.key); if (e.key==='Escape') cancelEdit(item.key) }}
                            className="w-28 border-2 border-blue-400 rounded-lg px-2 py-1 text-right font-mono text-sm outline-none" />
                        ) : (
                          <button onClick={() => startEdit(item.key)}
                            className="font-mono font-bold text-gray-800 hover:text-blue-600 hover:underline transition tabular-nums">
                            {formatKsh(buying)}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                        {formatKsh(selling)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleStock(item.key)}
                          className={`relative inline-flex w-10 h-6 rounded-full transition-colors ${inStock ? 'bg-green-500' : 'bg-gray-300'}`}>
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${inStock ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {item.key in editingStock ? (
                          <div className="flex flex-col gap-1 min-w-[180px]">
                            <div className="flex gap-1 items-center">
                              <input type="number" placeholder="Qty" value={editingStock[item.key].stock_qty}
                                onChange={e => updateEditingStock(item.key, 'stock_qty', e.target.value)}
                                className="w-16 border-2 border-blue-400 rounded-lg px-2 py-1 text-xs font-mono outline-none" />
                              <span className="text-xs text-gray-400">reorder@</span>
                              <input type="number" placeholder="—" value={editingStock[item.key].reorder_point}
                                onChange={e => updateEditingStock(item.key, 'reorder_point', e.target.value)}
                                className="w-14 border-2 border-blue-400 rounded-lg px-2 py-1 text-xs font-mono outline-none" />
                            </div>
                            {CATEGORY_META[row.category] && (
                              <>
                                <div className="flex gap-1">
                                  <input type="number" placeholder={CATEGORY_META[row.category].capacityLabel} value={editingStock[item.key].capacity}
                                    onChange={e => updateEditingStock(item.key, 'capacity', e.target.value)}
                                    className="w-20 border-2 border-blue-400 rounded-lg px-2 py-1 text-xs font-mono outline-none" />
                                  <input type="number" placeholder="Weight kg" value={editingStock[item.key].unit_weight_kg}
                                    onChange={e => updateEditingStock(item.key, 'unit_weight_kg', e.target.value)}
                                    className="w-20 border-2 border-blue-400 rounded-lg px-2 py-1 text-xs font-mono outline-none" />
                                </div>
                                {(SPEC_FIELDS[row.category] || []).map(s => (
                                  <input key={s.key} type={s.text ? 'text' : 'number'} placeholder={s.label}
                                    value={editingStock[item.key][s.key] ?? ''}
                                    onChange={e => updateEditingStock(item.key, s.key, e.target.value)}
                                    className="border-2 border-blue-400 rounded-lg px-2 py-1 text-xs outline-none" />
                                ))}
                              </>
                            )}
                            <input type="text" placeholder="Supplier name" value={editingStock[item.key].supplier}
                              onChange={e => updateEditingStock(item.key, 'supplier', e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') saveStock(item.key); if (e.key === 'Escape') cancelEditStock(item.key) }}
                              className="border-2 border-blue-400 rounded-lg px-2 py-1 text-xs outline-none" />
                            <div className="flex gap-1">
                              <button onClick={() => saveStock(item.key)} disabled={savingStock[item.key]}
                                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-2 py-1 rounded-lg transition disabled:opacity-50">
                                {savingStock[item.key] ? '…' : 'Save'}
                              </button>
                              <button onClick={() => cancelEditStock(item.key)} className="text-xs text-gray-400 hover:text-gray-600 px-1">✕</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => startEditStock(item.key)} className="text-left hover:bg-gray-50 rounded-lg px-1 -mx-1 py-0.5 transition">
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
                            {savedStock[item.key] && <div className="text-xs text-green-600 font-bold">✓ Saved</div>}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{updated}</td>
                      <td className="px-4 py-3">
                        {isEdit ? (
                          <div className="flex gap-1">
                            <button onClick={() => savePrice(item.key)} disabled={saving[item.key]}
                              className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                              {saving[item.key] ? '…' : 'Save'}
                            </button>
                            <button onClick={() => cancelEdit(item.key)} className="text-xs text-gray-400 hover:text-gray-600 px-1">✕</button>
                          </div>
                        ) : saved[item.key] ? (
                          <span className="text-green-600 text-xs font-bold">✓ Saved</span>
                        ) : (
                          <button onClick={() => startEdit(item.key)} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">Edit</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main admin panel — auth gate + tabs ─────────────────────────────────────
export default function AdminInventory({ onBack }) {
  const [session,     setSession]     = useState(undefined)
  const [activeTab,   setActiveTab]   = useState('leads')
  const [showWarning, setShowWarning] = useState(false)

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
    <div className="min-h-screen bg-gray-50">
      {showWarning && (
        <SessionTimeoutModal
          minutesLeft={SESSION_WARN_MINUTES}
          onStay={() => { staySignedIn(); setShowWarning(false) }}
          onSignOutNow={handleLogout}
        />
      )}
      {/* Shared admin header */}
      <div className="bg-gray-900 text-white px-6 py-4 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black">⚡ RhiPower Admin</h1>
            <p className="text-xs text-gray-400 mt-0.5">{session.user?.email}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg font-semibold transition">← App</button>
            <button onClick={handleLogout} className="text-xs bg-red-800 hover:bg-red-700 px-3 py-2 rounded-lg font-semibold transition">Sign Out</button>
          </div>
        </div>
        {/* Tab bar */}
        <div className="max-w-7xl mx-auto flex gap-1 mt-3">
          {[
            { id: 'leads',     label: '📋 Leads & Pipeline' },
            { id: 'inventory', label: '📦 Inventory & Prices' },
            { id: 'customers', label: '👥 Customers' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`text-sm font-bold px-4 py-2 rounded-lg transition
                ${activeTab === tab.id ? 'bg-white text-gray-900' : 'text-gray-400 hover:text-white'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'leads'     && <AdminLeads session={session} />}
        {activeTab === 'inventory' && <InventoryTable session={session} />}
        {activeTab === 'customers' && <AdminCustomers session={session} />}
      </div>
    </div>
  )
}
