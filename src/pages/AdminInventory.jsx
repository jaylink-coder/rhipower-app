import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'

const GROUPS = [
  {
    title: '☀️ Solar Panels',
    items: [
      { key: 'premium_panel',    label: 'Premium — LONGi Hi-MO 7 620W',        spec: '620W · 33.5 kg · IEC 61215' },
      { key: 'balanced_panel',   label: 'Balanced — LONGi Hi-MO 7 620W',       spec: '620W · 33.5 kg · IEC 61215' },
      { key: 'budget_panel',     label: 'Budget — Tier-1 550W Monocrystalline', spec: '550W · 28 kg'                },
    ],
  },
  {
    title: '⚡ Inverters',
    items: [
      { key: 'premium_inverter',  label: 'Premium — Victron Quattro 15kVA',    spec: '15 kW · 45 kg · IEC 62109' },
      { key: 'balanced_inverter', label: 'Balanced — Felicity 20kW 3-Phase',   spec: '20 kW · 42 kg'             },
      { key: 'budget_inverter',   label: 'Budget — Must Energy 5.2kW',         spec: '5.2 kW · 12 kg'            },
    ],
  },
  {
    title: '🔋 Batteries',
    items: [
      { key: 'premium_battery',  label: 'Premium — BYD 15.4 kWh LiFePO₄',    spec: '15.4 kWh · 140 kg · IEC 62619' },
      { key: 'balanced_battery', label: 'Balanced — Felicity 15 kWh LiFePO₄', spec: '15 kWh · 125 kg · IEC 62619'   },
      { key: 'budget_battery',   label: 'Budget — Generic 10.2 kWh',           spec: '10.2 kWh · 85 kg'              },
    ],
  },
  {
    title: '🔌 Zone A — Solar Array Protection',
    items: [
      { key: 'zoneA_breaker', label: 'DC Isolator Breaker 63A',          spec: 'Chint NBI-63DC · per unit'   },
      { key: 'zoneA_spd',     label: 'DC Surge Protective Device',        spec: 'Chint NU6 Type 2 · per unit' },
      { key: 'zoneA_fuse',    label: 'PV Fuse Holder + Link 15A',         spec: 'Mersen · per unit'           },
      { key: 'zoneA_cable6',  label: '6mm² DC Solar Cable',               spec: 'Kinu Copper · per metre'     },
      { key: 'zoneA_cable10', label: '10mm² DC Solar Cable',              spec: 'Kinu Copper · per metre'     },
    ],
  },
  {
    title: '🔋 Zone B — Battery Bank Connections',
    items: [
      { key: 'zoneB_mccb',     label: 'Battery MCCB 400A',               spec: 'Chint NM8N · per unit'    },
      { key: 'zoneB_busbar',   label: 'Copper Interconnection Busbar',    spec: 'Tinned Copper · per set'  },
      { key: 'zoneB_lug_m8',   label: '50mm² Copper Lug M8 (Battery)',   spec: 'Tinned · each'            },
      { key: 'zoneB_lug_m10',  label: '50mm² Copper Lug M10 (Inverter)', spec: 'Tinned · each'            },
      { key: 'zoneB_batcable', label: '50mm² Battery Cable',              spec: 'Rubber Heat-Res · per metre'},
    ],
  },
  {
    title: '⚙️ Zone C — AC Distribution',
    items: [
      { key: 'zoneC_mcb',       label: '3-Phase MCB 63A',                spec: 'Chint · per unit'      },
      { key: 'zoneC_smart',     label: 'Smart Wi-Fi DIN-Rail Breaker',   spec: 'Tuya 40A · per unit'   },
      { key: 'zoneC_contactor', label: 'AC Contactor 40A',               spec: 'Chint · per unit'      },
    ],
  },
]

function LoginScreen({ onBack }) {
  const [email,    setEmail]    = useState('jaylinkpowersystems@gmail.com')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
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
          <p className="text-sm text-gray-500 mt-1">RhiPower Inventory Management</p>
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

        <div className="mt-5 p-3 bg-blue-50 rounded-xl text-xs text-blue-700">
          <strong>First time?</strong> Go to Supabase → Authentication → Users → Create user
          with your email and a password, then sign in here.
        </div>

        <button onClick={onBack} className="w-full mt-4 text-xs text-gray-400 hover:text-gray-600 transition">
          ← Back to App
        </button>
      </div>
    </div>
  )
}

function InventoryTable({ onBack, onLogout }) {
  const [rows,    setRows]    = useState({})   // { role_key: DB row }
  const [editing, setEditing] = useState({})   // { role_key: string price value }
  const [saving,  setSaving]  = useState({})   // { role_key: bool }
  const [saved,   setSaved]   = useState({})   // { role_key: bool }
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('inventory_prices').select('*').then(({ data }) => {
      if (data) {
        const map = {}
        data.forEach(r => { map[r.role_key] = r })
        setRows(map)
      }
      setLoading(false)
    })
  }, [])

  function startEdit(key) {
    const price = rows[key]?.buying_price_kes || 0
    setEditing(prev => ({ ...prev, [key]: String(Math.round(price)) }))
  }

  function cancelEdit(key) {
    setEditing(prev => { const n = { ...prev }; delete n[key]; return n })
  }

  async function savePrice(key) {
    const newPrice = parseInt((editing[key] || '0').replace(/,/g, ''), 10)
    if (!newPrice || newPrice <= 0) return
    setSaving(prev => ({ ...prev, [key]: true }))
    const { error } = await supabase
      .from('inventory_prices')
      .update({ buying_price_kes: newPrice, updated_at: new Date().toISOString() })
      .eq('role_key', key)
    setSaving(prev => ({ ...prev, [key]: false }))
    if (!error) {
      setRows(prev => ({ ...prev, [key]: { ...prev[key], buying_price_kes: newPrice, updated_at: new Date().toISOString() } }))
      cancelEdit(key)
      setSaved(prev => ({ ...prev, [key]: true }))
      setTimeout(() => setSaved(prev => { const n = { ...prev }; delete n[key]; return n }), 2500)
    }
  }

  async function toggleStock(key) {
    const current = rows[key]?.in_stock ?? true
    const next    = !current
    await supabase
      .from('inventory_prices')
      .update({ in_stock: next, updated_at: new Date().toISOString() })
      .eq('role_key', key)
    setRows(prev => ({ ...prev, [key]: { ...prev[key], in_stock: next } }))
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-gray-500">
      Loading inventory…
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gray-900 text-white px-6 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black">⚡ RhiPower Admin</h1>
            <p className="text-xs text-gray-400 mt-0.5">Inventory & Pricing Management</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onBack}
              className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg transition font-semibold">
              ← App
            </button>
            <button onClick={onLogout}
              className="text-xs bg-red-800 hover:bg-red-700 px-3 py-2 rounded-lg transition font-semibold">
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
          <strong>To update a price:</strong> click the price → type new buying price → Save (or press Enter).
          Selling price = buying × 1.35 and updates automatically on all future client quotes.
        </div>

        {/* Groups */}
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
                    const row      = rows[item.key] || {}
                    const buying   = Number(row.buying_price_kes || 0)
                    const selling  = Math.round(buying * 1.35)
                    const inStock  = row.in_stock !== false
                    const isEdit   = item.key in editing
                    const isSaving = saving[item.key]
                    const isSaved  = saved[item.key]
                    const updated  = row.updated_at
                      ? new Date(row.updated_at).toLocaleDateString('en-KE', { day:'2-digit', month:'short' })
                      : '—'

                    return (
                      <tr key={item.key} className={`hover:bg-gray-50 transition ${!inStock ? 'opacity-50' : ''}`}>
                        {/* Item name */}
                        <td className="px-5 py-3">
                          <div className="font-semibold text-gray-800 text-sm">{item.label}</div>
                          <div className="text-xs text-gray-400 mt-0.5">{item.spec}</div>
                        </td>

                        {/* Buying price — click to edit */}
                        <td className="px-4 py-3 text-right">
                          {isEdit ? (
                            <input
                              type="number"
                              value={editing[item.key]}
                              onChange={e => setEditing(p => ({ ...p, [item.key]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') savePrice(item.key); if (e.key === 'Escape') cancelEdit(item.key) }}
                              className="w-28 border-2 border-blue-400 rounded-lg px-2 py-1 text-right font-mono text-sm focus:outline-none"
                              autoFocus
                            />
                          ) : (
                            <button onClick={() => startEdit(item.key)}
                              className="font-mono font-bold text-gray-800 hover:text-blue-600 hover:underline transition tabular-nums">
                              {formatKsh(buying)}
                            </button>
                          )}
                        </td>

                        {/* Selling price — auto calculated */}
                        <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                          {formatKsh(selling)}
                        </td>

                        {/* In stock toggle */}
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleStock(item.key)}
                            title={inStock ? 'Click to mark out of stock' : 'Click to mark in stock'}
                            className={`relative inline-flex w-10 h-6 rounded-full transition-colors duration-200 ${inStock ? 'bg-green-500' : 'bg-gray-300'}`}>
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${inStock ? 'translate-x-4' : 'translate-x-0'}`} />
                          </button>
                        </td>

                        {/* Updated date */}
                        <td className="px-4 py-3 text-xs text-gray-400">{updated}</td>

                        {/* Save / Edit button */}
                        <td className="px-4 py-3">
                          {isEdit ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => savePrice(item.key)}
                                disabled={isSaving}
                                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                                {isSaving ? '…' : 'Save'}
                              </button>
                              <button onClick={() => cancelEdit(item.key)}
                                className="text-xs text-gray-400 hover:text-gray-600 px-1.5">
                                ✕
                              </button>
                            </div>
                          ) : isSaved ? (
                            <span className="text-green-600 text-xs font-bold">✓ Saved</span>
                          ) : (
                            <button onClick={() => startEdit(item.key)}
                              className="text-xs text-blue-500 hover:text-blue-700 font-semibold transition">
                              Edit
                            </button>
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

        <p className="text-xs text-gray-400 text-center pb-6">
          Price changes take effect on the next client quote calculation.
          Prices shown are exclusive of logistics and labour.
        </p>
      </div>
    </div>
  )
}

export default function AdminInventory({ onBack }) {
  const [session, setSession] = useState(undefined)  // undefined = checking, null = not logged in

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  async function handleLogout() {
    await supabase.auth.signOut()
    setSession(null)
  }

  if (session === undefined) return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">
      Checking session…
    </div>
  )

  if (!session) return <LoginScreen onBack={onBack} />

  return <InventoryTable onBack={onBack} onLogout={handleLogout} />
}
