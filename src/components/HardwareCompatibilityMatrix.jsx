// Catalog-wide MPPT compatibility check — every active panel × every active
// inverter, evaluated at once. Pure aggregation over calculateStringBalancing()
// (src/lib/stringBalancing.ts, already shipped and wired into calculator.js's
// real sizing math) — no new engineering logic lives here, just a grid view
// over it so an admin can see the whole catalog's compatibility at a glance
// instead of checking one pairing at a time inside a specific quote.
import { useState, useEffect, useMemo } from 'react'
import { fetchInventory } from '../lib/inventory.js'
import { calculateStringBalancing } from '../lib/stringBalancing.ts'

const PANEL_FIELDS    = ['vocV', 'nominalVoltageV', 'maxCurrentAmps']
const INVERTER_FIELDS = ['maxInputVoltageV', 'mpptMinVoltageV', 'maxCurrentAmps']

function missingFields(product, fields, labels) {
  return fields.filter(f => product[f] == null).map(f => labels[f])
}

const PANEL_FIELD_LABELS    = { vocV: 'Voc', nominalVoltageV: 'Vmp (Nominal Voltage)', maxCurrentAmps: 'Isc (Max Current)' }
const INVERTER_FIELD_LABELS = { maxInputVoltageV: 'Max DC Input', mpptMinVoltageV: 'MPPT Min Voltage', maxCurrentAmps: 'Max Current (per MPPT)' }

function evaluatePair(panel, inverter, coldestTempC, hottestTempC) {
  const missingPanel    = missingFields(panel, PANEL_FIELDS, PANEL_FIELD_LABELS)
  const missingInverter = missingFields(inverter, INVERTER_FIELDS, INVERTER_FIELD_LABELS)
  if (missingPanel.length || missingInverter.length) {
    return { status: 'missing', missingPanel, missingInverter }
  }
  const result = calculateStringBalancing(
    { vocV: panel.vocV, vmpV: panel.nominalVoltageV, iscA: panel.maxCurrentAmps, tempCoefficientPctC: panel.tempCoefficientPctC ?? 0 },
    { maxInputVoltageV: inverter.maxInputVoltageV, mpptMinVoltageV: inverter.mpptMinVoltageV, maxCurrentAmps: inverter.maxCurrentAmps, mpptCount: inverter.mpptCount || 1 },
    { recordColdestTempC: coldestTempC, recordHottestTempC: hottestTempC },
  )
  return { status: result.isCompatible ? 'compatible' : 'incompatible', result }
}

const STATUS_STYLE = {
  missing:      { badge: '⚪', bg: 'bg-gray-100 hover:bg-gray-200',       text: 'text-gray-500' },
  compatible:   { badge: '🟢', bg: 'bg-emerald-100 hover:bg-emerald-200', text: 'text-emerald-800' },
  incompatible: { badge: '🔴', bg: 'bg-red-100 hover:bg-red-200',         text: 'text-red-800' },
}

export default function HardwareCompatibilityMatrix() {
  const [panels,    setPanels]    = useState([])
  const [inverters, setInverters] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [loadError, setLoadError] = useState('')
  const [coldestTempC, setColdestTempC] = useState(5)
  const [hottestTempC, setHottestTempC] = useState(45)
  const [selected,  setSelected]  = useState(null) // { panel, inverter, cell }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setLoadError('')
    fetchInventory()
      .then(inv => {
        if (cancelled) return
        setPanels(inv.products.panel || [])
        setInverters(inv.products.inverter || [])
      })
      .catch(err => { if (!cancelled) setLoadError(err.message || 'Failed to load inventory.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const grid = useMemo(() => {
    return panels.map(panel => ({
      panel,
      cells: inverters.map(inverter => ({ inverter, ...evaluatePair(panel, inverter, coldestTempC, hottestTempC) })),
    }))
  }, [panels, inverters, coldestTempC, hottestTempC])

  const summary = useMemo(() => {
    const all = grid.flatMap(row => row.cells)
    return {
      total: all.length,
      missing: all.filter(c => c.status === 'missing').length,
      compatible: all.filter(c => c.status === 'compatible').length,
      incompatible: all.filter(c => c.status === 'incompatible').length,
    }
  }, [grid])

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Evaluating catalog…</div>

  if (loadError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
        Couldn't load inventory: {loadError}
      </div>
    )
  }

  if (panels.length === 0 || inverters.length === 0) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        Add at least one panel and one inverter under the Products tab before checking compatibility.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Regional Climate Extremes</div>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Record coldest (°C)</label>
            <input type="number" value={coldestTempC} onChange={e => setColdestTempC(Number(e.target.value))}
              className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Record hottest (°C)</label>
            <input type="number" value={hottestTempC} onChange={e => setHottestTempC(Number(e.target.value))}
              className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <p className="text-xs text-gray-400 max-w-md">
            Cold weather raises panel voltage (risk of exceeding an inverter's max DC input); hot weather lowers it
            (risk of falling below the MPPT startup floor). Adjust for the region you're installing in.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap gap-4 text-sm">
        <span className="font-bold text-gray-700">{summary.total} pairing{summary.total !== 1 ? 's' : ''} evaluated</span>
        <span className="text-gray-400">⚪ {summary.missing} missing specs</span>
        <span className="text-emerald-700">🟢 {summary.compatible} compatible</span>
        <span className="text-red-700">🔴 {summary.incompatible} incompatible</span>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-auto max-h-[70vh]">
        <table className="text-sm border-collapse">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 bg-gray-50 border-b border-r border-gray-100 px-3 py-2 text-left font-bold text-gray-600 z-30">
                Panel \ Inverter
              </th>
              {inverters.map(inv => (
                <th key={inv.roleKey} className="sticky top-0 bg-gray-50 border-b border-gray-100 px-3 py-2 text-left font-bold text-gray-600 whitespace-nowrap z-20">
                  {inv.sku}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map(row => (
              <tr key={row.panel.roleKey}>
                <td className="sticky left-0 bg-white border-r border-b border-gray-50 px-3 py-2 font-semibold text-gray-700 whitespace-nowrap z-10">
                  {row.panel.sku}
                </td>
                {row.cells.map(cell => {
                  const style = STATUS_STYLE[cell.status]
                  const isSelected = selected?.panel.roleKey === row.panel.roleKey && selected?.inverter.roleKey === cell.inverter.roleKey
                  return (
                    <td key={cell.inverter.roleKey} className="border-b border-gray-50 p-1">
                      <button
                        onClick={() => setSelected({ panel: row.panel, inverter: cell.inverter, ...cell })}
                        className={`w-full h-10 rounded-lg text-lg transition ${style.bg} ${isSelected ? 'ring-2 ring-blue-400' : ''}`}
                        title={`${row.panel.sku} × ${cell.inverter.sku}`}>
                        {style.badge}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-xs font-bold uppercase text-gray-400 tracking-wider">Pairing Detail</div>
              <h3 className="font-black text-gray-800">{selected.panel.sku} × {selected.inverter.sku}</h3>
            </div>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>

          {selected.status === 'missing' && (
            <div className="text-sm text-gray-600 space-y-1">
              <p>Can't evaluate this pairing yet — missing specs:</p>
              {selected.missingPanel.length > 0 && <p>• <strong>{selected.panel.sku}</strong>: {selected.missingPanel.join(', ')}</p>}
              {selected.missingInverter.length > 0 && <p>• <strong>{selected.inverter.sku}</strong>: {selected.missingInverter.join(', ')}</p>}
              <p className="text-xs text-gray-400 mt-2">Add these from Edit Item on the Products tab.</p>
            </div>
          )}

          {selected.status === 'compatible' && (
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-gray-400 block">Panels per string</span><span className="font-bold text-gray-900">{selected.result.minPanelsPerString}–{selected.result.maxPanelsPerString}</span></div>
              <div><span className="text-gray-400 block">Max parallel strings / MPPT</span><span className="font-bold text-gray-900">{selected.result.maxParallelStringsPerMppt}</span></div>
              <div><span className="text-gray-400 block">MPPT trackers on this inverter</span><span className="font-bold text-gray-900">{selected.inverter.mpptCount || 1}</span></div>
            </div>
          )}

          {selected.status === 'incompatible' && (
            <p className="text-sm text-red-700 font-semibold">⚠️ {selected.result.bottleneckReason}</p>
          )}
        </div>
      )}
    </div>
  )
}
