import { useState } from 'react'

const SURGE_TYPES = [
  { value: 'resistive',        label: 'No — Resistive (Heaters, Lights, Electronics)' },
  { value: 'inductive-standard', label: 'Yes — Standard Motor (Fridge, Small Pump)' },
  { value: 'inductive-heavy',  label: 'Yes — Heavy Motor (Borehole Pump, Aircon, Lift)' },
]

const DUTY_OPTIONS = [
  { value: 0.10, label: 'Eco / Intermittent (5–10 mins per hour)' },
  { value: 0.50, label: 'Standard / Cycled (30 mins per hour)' },
  { value: 1.00, label: 'Continuous (Runs all night non-stop)' },
]

function getSurgeInsight(type, watts, phase) {
  if (!watts) {
    return { style: 'blue', text: '💡 System Advisory: Input a power value above to see real-time engineering diagnostics.' }
  }
  if (type === 'resistive') {
    return { style: 'green', text: `✅ Resistive Load: Stable ${watts}W draw, zero startup spike. Safe for smooth inverter operation.` }
  }
  if (type === 'inductive-standard') {
    const surge = (watts * 3).toFixed(0)
    return { style: 'orange', text: `⚠️ Standard Motor: Spikes up to 3× on startup. This ${watts}W machine will briefly hit ${surge}W. RhiPower will scale inverter surge thresholds.` }
  }
  if (type === 'inductive-heavy') {
    const surge = Math.round(watts * 4.5).toLocaleString()
    const phaseWarn = phase === 'single' ? ' ⚠️ Warning: Single-phase heavy motors cause severe imbalance on 3-Phase inverters!' : ''
    return { style: 'red', text: `🚨 CRITICAL HEAVY MOTOR: Spikes up to 4.5× on startup! This ${watts}W machine hits ${surge}W.${phaseWarn} Scheduled for mandatory daytime load-shedding.` }
  }
}

const INSIGHT_STYLES = {
  blue:   'bg-blue-50 border-blue-600 text-blue-900',
  green:  'bg-green-50 border-green-600 text-green-900',
  orange: 'bg-orange-50 border-orange-500 text-orange-900',
  red:    'bg-red-50 border-red-600 text-red-900',
}

export default function CustomApplianceModal({ onClose, onAdd }) {
  const [name,  setName]  = useState('')
  const [watts, setWatts] = useState('')
  const [hp,    setHp]    = useState('')
  const [amps,  setAmps]  = useState('')
  const [type,  setType]  = useState('resistive')
  const [phase, setPhase] = useState('single')
  const [duty,  setDuty]  = useState(0.50)

  function syncFromWatts(w) {
    setWatts(w)
    if (w) { setHp((w / 746).toFixed(2)); setAmps((w / 240).toFixed(1)) }
  }
  function syncFromHp(h) {
    setHp(h)
    if (h) { const w = h * 746; setWatts(Math.round(w)); setAmps((w / 240).toFixed(1)) }
  }
  function syncFromAmps(a) {
    setAmps(a)
    if (a) { const w = a * 240; setWatts(Math.round(w)); setHp((w / 746).toFixed(2)) }
  }

  const insight = getSurgeInsight(type, parseFloat(watts) || 0, phase)

  function handleInject() {
    const w = parseFloat(watts) || 0
    if (!name.trim() || w === 0) {
      alert('Please enter a name and power value.')
      return
    }
    const surgeMap = { resistive: 1, 'inductive-standard': 3, 'inductive-heavy': 4.5 }
    onAdd({
      id:          'custom_' + Date.now(),
      name:        '⚙️ ' + name.trim(),
      watts:       w,
      surgeFactor: surgeMap[type],
      type:        type.includes('inductive') ? 'inductive' : 'resistive',
    })
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 overflow-hidden animate-slide-up">

        {/* Header */}
        <div className="bg-gradient-to-r from-blue-700 to-indigo-800 text-white p-6 relative">
          <h3 className="text-xl font-bold">🛠️ Custom Appliance Architect</h3>
          <p className="text-xs text-blue-200 mt-1">
            Define your equipment's electrical properties so our engine includes it accurately.
          </p>
          <button onClick={onClose}
            className="absolute top-4 right-5 text-white hover:text-red-300 text-3xl font-bold leading-none">&times;</button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">

          {/* Name + Phase */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Appliance / Equipment Name</label>
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g., Industrial Air Compressor"
                className="w-full border border-gray-300 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">Electrical Phase</label>
              <div className="grid grid-cols-2 gap-2">
                {['single', 'three'].map(p => (
                  <label key={p}
                    className={`flex items-center justify-center p-3 border-2 rounded-xl cursor-pointer transition text-sm font-medium
                      ${phase === p ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                    <input type="radio" className="mr-2" checked={phase === p} onChange={() => setPhase(p)} />
                    {p === 'single' ? 'Single-Phase' : 'Three-Phase'}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Smart Power Converter */}
          <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
            <span className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
              ⚡ Smart Power Converter — Input whatever you know (W, HP, or Amps)
            </span>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1 font-semibold">Watts (W)</label>
                <input type="number" value={watts} onChange={e => syncFromWatts(e.target.value)} placeholder="2200"
                  className="w-full border rounded-xl p-2.5 bg-white text-center font-mono font-bold text-blue-700 focus:ring-2 focus:ring-blue-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1 font-semibold">Horsepower (HP)</label>
                <input type="number" value={hp} onChange={e => syncFromHp(e.target.value)} placeholder="3"
                  className="w-full border rounded-xl p-2.5 bg-white text-center font-mono font-bold text-orange-600 focus:ring-2 focus:ring-orange-400 outline-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1 font-semibold">Amps @ 240V</label>
                <input type="number" value={amps} onChange={e => syncFromAmps(e.target.value)} placeholder="10"
                  className="w-full border rounded-xl p-2.5 bg-white text-center font-mono font-bold text-green-600 focus:ring-2 focus:ring-green-400 outline-none" />
              </div>
            </div>
          </div>

          {/* Motor Type + Duty */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Motor / Compressor?</label>
              <select value={type} onChange={e => setType(e.target.value)}
                className="w-full border border-gray-300 rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {SURGE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Overnight Duty Cycle</label>
              <select value={duty} onChange={e => setDuty(parseFloat(e.target.value))}
                className="w-full border border-gray-300 rounded-xl p-3 outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                {DUTY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Live Insight */}
          <div className={`border-l-4 p-4 rounded-r-xl text-xs leading-relaxed ${INSIGHT_STYLES[insight.style]}`}>
            {insight.text}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 p-4 border-t flex justify-end gap-3">
          <button onClick={onClose}
            className="px-5 py-2.5 border rounded-xl text-gray-600 hover:bg-gray-100 transition text-sm font-medium">
            Cancel
          </button>
          <button onClick={handleInject}
            className="px-6 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-xl shadow hover:opacity-95 transition text-sm font-bold">
            Inject Into Load Calculator ⚡
          </button>
        </div>
      </div>
    </div>
  )
}
