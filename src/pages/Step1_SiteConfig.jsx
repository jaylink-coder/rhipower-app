import { TIER_META } from '../data/skuInventory.js'
import { KENYA_LOCATIONS } from '../lib/nasaPower.js'

const PROFILES = [
  { value: 'airbnb',        label: 'Airbnb / Premium Hospitality' },
  { value: 'residential',   label: 'Standard Domestic Residential' },
  { value: 'commercial',    label: 'Commercial / Agro-Processing' },
  { value: 'manufacturing', label: 'Industrial / Manufacturing' },
  { value: 'farm',          label: 'Farm / Agricultural' },
]

const MONTH_BAR_MAX = 8.0 // kWh/m²/day — used to scale the chart bars

export default function Step1_SiteConfig({ config, nasaLoading, onChange, onNext }) {
  function set(key, value) {
    onChange({ [key]: value })
  }

  const loc = KENYA_LOCATIONS[config.location]

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">

      <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded-r-xl mb-8 text-sm text-blue-950">
        Welcome to the <strong>RhiPower</strong> deployment wizard. Complete each step to receive a
        fully engineered solar system design and itemised Bill of Materials.
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-6">
        <h2 className="text-lg font-bold border-b border-gray-100 pb-3 mb-5 text-blue-800">
          📍 Step 1 of 3 — Site Geography &amp; Project Intent
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">

          {/* Location */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Site Location</label>
            <select value={config.location} onChange={e => set('location', e.target.value)}
              className="w-full border border-gray-200 p-3 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition">
              {Object.entries(KENYA_LOCATIONS).map(([key, l]) => (
                <option key={key} value={key}>{l.label}</option>
              ))}
            </select>
          </div>

          {/* Profile */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Application Profile</label>
            <select value={config.profile} onChange={e => set('profile', e.target.value)}
              className="w-full border border-gray-200 p-3 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition">
              {PROFILES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {/* DC Cable Distance */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              DC Cable Distance: Roof Panels → Inverter Room (Meters)
            </label>
            <input type="number" min="1" value={config.wireDistM}
              onChange={e => set('wireDistM', parseFloat(e.target.value) || 1)}
              className="w-full border border-gray-200 p-3 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition font-mono font-bold text-blue-700" />
            <p className="text-xs text-gray-500 mt-1">
              Determines correct cable size (mm²) to keep voltage drop below 2%.
              {config.wireDistM > 120 &&
                <strong className="text-orange-600"> &gt;120m detected → 10mm² cable required.</strong>}
            </p>
          </div>

          {/* Site Distance */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              Distance from RhiPower Nairobi Office (km)
            </label>
            <input type="number" min="1" value={config.siteKm}
              onChange={e => set('siteKm', parseFloat(e.target.value) || 1)}
              className="w-full border border-gray-200 p-3 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition font-mono font-bold text-orange-600" />
            <p className="text-xs text-gray-500 mt-1">
              Determines transport vehicle type and technician per-diem allowance.
              {config.siteKm > 80 &&
                <strong className="text-orange-600"> &gt;80km → upcountry per-diem applies.</strong>}
            </p>
          </div>
        </div>

        {/* NASA POWER Solar Data Panel */}
        <div className={`rounded-xl border p-4 mb-6 transition-all
          ${nasaLoading ? 'border-gray-200 bg-gray-50' : config.pshSource === 'nasa' ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>

          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-base">🛰️</span>
              <span className="text-sm font-bold text-gray-800">
                {nasaLoading ? 'Fetching NASA satellite data…' :
                  config.pshSource === 'nasa'
                    ? `NASA POWER Data — ${loc?.label}`
                    : `Standard Estimates — ${loc?.label}`}
              </span>
            </div>
            {!nasaLoading && (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full
                ${config.pshSource === 'nasa'
                  ? 'bg-green-200 text-green-800'
                  : 'bg-amber-200 text-amber-800'}`}>
                {config.pshSource === 'nasa' ? '✅ Live Data' : '⚠️ Estimate'}
              </span>
            )}
          </div>

          {nasaLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Connecting to NASA Langley Research Center…
            </div>
          ) : (
            <>
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-3xl font-black text-blue-800 font-mono">{config.psh}</span>
                <span className="text-sm text-gray-600 font-semibold">Peak Sun Hours / day (annual average)</span>
              </div>

              {/* Monthly bar chart */}
              {config.pshMonthly?.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wider">
                    Monthly Solar Yield
                  </p>
                  <div className="flex items-end gap-1 h-14">
                    {config.pshMonthly.map(({ month, psh }) => (
                      <div key={month} className="flex-1 flex flex-col items-center gap-0.5">
                        <div
                          className="w-full rounded-t bg-blue-400 hover:bg-blue-600 transition"
                          style={{ height: `${(psh / MONTH_BAR_MAX) * 100}%` }}
                          title={`${month}: ${psh} PSH`} />
                        <span className="text-gray-400" style={{ fontSize: '8px' }}>{month}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    Lowest month: <strong className="text-orange-600">
                      {Math.min(...config.pshMonthly.map(m => m.psh)).toFixed(1)} PSH
                    </strong> — your system is sized for this worst-case month.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Hardware Tier Selection */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-3">Hardware Tier</label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(TIER_META).map(([key, t]) => (
              <button key={key} onClick={() => set('tier', key)}
                className={`p-4 rounded-xl border-2 text-left transition
                  ${config.tier === key
                    ? 'border-blue-600 bg-blue-50 shadow-sm'
                    : 'border-gray-200 hover:border-blue-300 bg-white'}`}>
                <div className="font-bold text-sm text-gray-800 mb-1">{t.label}</div>
                <div className="text-xs text-gray-500 leading-snug">{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <button onClick={onNext}
        disabled={nasaLoading}
        className="w-full bg-gradient-to-r from-blue-700 to-indigo-800 hover:opacity-90 disabled:opacity-50 text-white font-black p-5 rounded-2xl shadow-lg transition text-lg tracking-wide">
        Continue to Step 2: Add Your Electrical Loads →
      </button>
    </div>
  )
}
