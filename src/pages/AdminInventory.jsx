import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import AdminLeads from './AdminLeads.jsx'
import AdminCustomers from './AdminCustomers.jsx'
import SessionTimeoutModal from '../components/SessionTimeoutModal.jsx'
import { useSessionTimeout } from '../hooks/useSessionTimeout.js'
import { SESSION_TIMEOUT_MINUTES, SESSION_WARN_MINUTES } from '../lib/roles.js'
import { logAdminAction } from '../lib/auditLog.js'

// ── Inventory groups ────────────────────────────────────────────────────────
const GROUPS = [
  { title: '☀️ Solar Panels', items: [
    { key: 'premium_panel',    label: 'Premium — LONGi Hi-MO 7 620W',        spec: '620W · 33.5 kg' },
    { key: 'balanced_panel',   label: 'Balanced — LONGi Hi-MO 7 620W',       spec: '620W · 33.5 kg' },
    { key: 'budget_panel',     label: 'Budget — Tier-1 550W Mono',            spec: '550W · 28 kg'   },
  ]},
  { title: '⚡ Inverters', items: [
    { key: 'premium_inverter',  label: 'Premium — Victron Quattro 15kVA',    spec: '15 kW · 45 kg'  },
    { key: 'balanced_inverter', label: 'Balanced — Felicity 20kW 3-Phase',   spec: '20 kW · 42 kg'  },
    { key: 'budget_inverter',   label: 'Budget — Must Energy 5.2kW',         spec: '5.2 kW · 12 kg' },
  ]},
  { title: '🔋 Batteries', items: [
    { key: 'premium_battery',  label: 'Premium — BYD 15.4 kWh LiFePO₄',     spec: '15.4 kWh · 140 kg' },
    { key: 'balanced_battery', label: 'Balanced — Felicity 15 kWh LiFePO₄', spec: '15 kWh · 125 kg'   },
    { key: 'budget_battery',   label: 'Budget — Generic 10.2 kWh',           spec: '10.2 kWh · 85 kg'  },
  ]},
  { title: '🔌 Zone A — Solar Array Protection', items: [
    { key: 'zoneA_breaker', label: 'DC Isolator Breaker 63A',    spec: 'Chint NBI-63DC · per unit'    },
    { key: 'zoneA_spd',     label: 'DC Surge Protection Device', spec: 'Chint NU6 Type 2 · per unit'  },
    { key: 'zoneA_fuse',    label: 'PV Fuse Holder 15A',         spec: 'Mersen · per unit'            },
    { key: 'zoneA_cable6',  label: '6mm² DC Solar Cable',        spec: 'Kinu Copper · per metre'      },
    { key: 'zoneA_cable10', label: '10mm² DC Solar Cable',       spec: 'Kinu Copper · per metre'      },
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

// ── Inventory table (headless — header is in the outer panel) ───────────────
function InventoryTable({ session }) {
  const [rows,    setRows]    = useState({})
  const [editing, setEditing] = useState({})
  const [saving,  setSaving]  = useState({})
  const [saved,   setSaved]   = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('inventory_prices').select('*').then(({ data }) => {
      if (data) { const m = {}; data.forEach(r => { m[r.role_key] = r }); setRows(m) }
      setLoading(false)
    })
  }, [])

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

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading inventory…</div>

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <strong>To update a price:</strong> click the price → type new buying price → Save (or Enter).
        Selling price = buying × 1.35 and updates automatically on all future client quotes.
      </div>

      {GROUPS.map(group => (
        <div key={group.title} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-100 px-5 py-3">
            <h3 className="font-black text-gray-700 text-sm">{group.title}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="px-5 py-2 text-left font-bold">Item</th>
                  <th className="px-4 py-2 text-right font-bold">Buying Price</th>
                  <th className="px-4 py-2 text-right font-bold">Selling Price</th>
                  <th className="px-4 py-2 text-center font-bold">In Stock</th>
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
