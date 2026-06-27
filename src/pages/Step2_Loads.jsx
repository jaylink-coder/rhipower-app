import { useState } from 'react'
import CustomApplianceModal from '../components/CustomApplianceModal.jsx'
import { CATEGORIES }       from '../data/appliances.js'

export default function Step2_Loads({
  appliances, quantities, siteConfig,
  onQuantitiesChange, onBack, onResults, onAddAppliance
}) {
  const [showModal,       setShowModal]       = useState(false)
  const [expandedCats,    setExpandedCats]    = useState(() => {
    // Start with the first two categories expanded
    const initial = {}
    CATEGORIES.slice(0, 2).forEach(c => { initial[c] = true })
    return initial
  })

  function setQty(id, value) {
    const qty = Math.max(0, parseInt(value) || 0)
    onQuantitiesChange(prev => ({ ...prev, [id]: qty }))
  }

  function toggleCategory(cat) {
    setExpandedCats(prev => ({ ...prev, [cat]: !prev[cat] }))
  }

  function handleCalculate() {
    const hasAny = appliances.some(a => (quantities[a.id] || 0) > 0)
    if (!hasAny) {
      alert('Please set a quantity for at least one appliance before calculating.')
      return
    }
    onResults()   // App.jsx runs the calculation for all 3 tiers
  }

  // Count totals
  const selectedCount = appliances.filter(a => (quantities[a.id] || 0) > 0).length
  const totalRunningW = appliances.reduce((sum, a) => sum + (a.watts * (quantities[a.id] || 0)), 0)

  // Separate custom appliances (injected by user) from default ones
  const customAppliances  = appliances.filter(a => a.id.startsWith('custom_'))
  const defaultAppliances = appliances.filter(a => !a.id.startsWith('custom_'))

  // Group default appliances by category
  const byCategory = {}
  defaultAppliances.forEach(app => {
    if (!byCategory[app.category]) byCategory[app.category] = []
    byCategory[app.category].push(app)
  })

  function ApplianceRow({ app }) {
    const qty = quantities[app.id] || 0
    return (
      <div className={`flex items-center justify-between py-3 px-3 rounded-xl transition
        ${qty > 0 ? 'bg-blue-50 border border-blue-100' : 'hover:bg-gray-50'}`}>
        <div className="pr-4 flex-1 min-w-0">
          <span className={`font-semibold block text-sm truncate
            ${qty > 0 ? 'text-blue-800' : 'text-gray-800'}`}>
            {app.name}
          </span>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            <span className="text-xs font-mono bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
              {app.watts.toLocaleString()}W
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold
              ${app.type === 'inductive' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700'}`}>
              {app.type}
            </span>
            {app.surgeFactor > 1 && (
              <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded font-semibold">
                {app.surgeFactor}× surge
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setQty(app.id, qty - 1)}
            className="w-7 h-7 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold text-sm transition">
            −
          </button>
          <span className={`w-8 text-center font-mono font-bold text-sm
            ${qty > 0 ? 'text-blue-700' : 'text-gray-400'}`}>
            {qty}
          </span>
          <button onClick={() => setQty(app.id, qty + 1)}
            className={`w-7 h-7 rounded-lg font-bold text-sm transition
              ${qty > 0
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-600'}`}>
            +
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      {/* Header stats bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 mb-4 flex flex-wrap gap-4 items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-blue-800">🔌 Step 2 of 3 — Connected Electrical Loads</h2>
          {selectedCount > 0
            ? <p className="text-xs text-green-700 font-semibold mt-0.5">
                {selectedCount} type{selectedCount !== 1 ? 's' : ''} selected · {(totalRunningW / 1000).toFixed(2)} kW total running load
              </p>
            : <p className="text-xs text-gray-400 mt-0.5">Select the appliances this system must power</p>}
        </div>
        <button onClick={() => setShowModal(true)}
          className="text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 px-4 py-2 rounded-xl font-bold transition border border-blue-200 shrink-0">
          ➕ Add Custom Machine
        </button>
      </div>

      {/* Appliances by category */}
      <div className="space-y-3 mb-4">
        {Object.entries(byCategory).map(([cat, apps]) => {
          const catSelected = apps.filter(a => (quantities[a.id] || 0) > 0).length
          const expanded    = expandedCats[cat] ?? false
          return (
            <div key={cat} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <button
                onClick={() => toggleCategory(cat)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition">
                <div className="flex items-center gap-3">
                  <span className="text-base font-bold text-gray-700">{cat}</span>
                  {catSelected > 0 && (
                    <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-bold">
                      {catSelected} selected
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{apps.length} items</span>
                  <span className="text-gray-400 text-sm">{expanded ? '▲' : '▼'}</span>
                </div>
              </button>
              {expanded && (
                <div className="px-4 pb-4 space-y-2 border-t border-gray-50">
                  {apps.map(app => <ApplianceRow key={app.id} app={app} />)}
                </div>
              )}
            </div>
          )
        })}

        {/* Custom injected appliances */}
        {customAppliances.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-yellow-200 overflow-hidden">
            <div className="px-5 py-3.5 bg-yellow-50 border-b border-yellow-100 flex items-center gap-2">
              <span className="font-bold text-gray-700">⚙️ Your Custom Machines</span>
              <span className="text-xs bg-yellow-400 text-yellow-900 px-2 py-0.5 rounded-full font-bold">
                {customAppliances.length} added
              </span>
            </div>
            <div className="px-4 py-4 space-y-2">
              {customAppliances.map(app => <ApplianceRow key={app.id} app={app} />)}
            </div>
          </div>
        )}
      </div>

      {/* Tip */}
      {selectedCount === 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-xs text-blue-700 mb-4 text-center">
          Click a category above to expand it, then use + / − to set how many of each appliance you need.
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={onBack}
          className="px-6 py-4 border-2 border-gray-200 rounded-2xl text-gray-600 hover:bg-gray-50 font-bold transition">
          ← Back
        </button>
        <button onClick={handleCalculate}
          className="flex-1 bg-gradient-to-r from-blue-700 to-indigo-800 hover:opacity-90 text-white font-black p-4 rounded-2xl shadow-lg transition text-lg tracking-wide">
          ⚡ Generate Engineering Proposal &amp; Bill of Materials
        </button>
      </div>

      {showModal && (
        <CustomApplianceModal
          onClose={() => setShowModal(false)}
          onAdd={app => { onAddAppliance(app); setShowModal(false) }} />
      )}
    </div>
  )
}
