// RhiPower — Fixed Assets & Depreciation (Accounting Module, Phase 5).
// Register vehicles/tools/equipment, run straight-line monthly
// depreciation, and dispose of an asset with an automatic gain/loss
// calculation. All financial logic lives in src/lib/fixedAssets.js.
import { useState, useEffect } from 'react'
import { formatKsh } from '../lib/calculator.js'
import { fetchChartOfAccounts } from '../lib/ledger.js'
import {
  fetchFixedAssets, createFixedAsset, runDepreciationForAllActive,
  disposeAsset, accumulatedDepreciation, bookValue,
} from '../lib/fixedAssets.js'

const CATEGORY_OPTIONS = [
  { value: 'vehicle',        label: 'Vehicle' },
  { value: 'tool_equipment', label: 'Tool / Equipment' },
  { value: 'other',          label: 'Other' },
]
const CATEGORY_DEFAULT_KEYS = {
  vehicle:        { asset: 'fixed_assets_vehicles', accumDepr: 'accum_depr_vehicles' },
  tool_equipment: { asset: 'fixed_assets_tools',     accumDepr: 'accum_depr_tools' },
}
const PAYMENT_OPTIONS = [
  { value: 'bank_operating',   label: 'Bank Account' },
  { value: 'mpesa_till',       label: 'M-Pesa Till' },
  { value: 'petty_cash',       label: 'Petty Cash' },
  { value: 'accounts_payable', label: 'On Credit (Accounts Payable)' },
]

function AddAssetForm({ accounts, onSave, onCancel, saving }) {
  const assetAccounts = accounts.filter(a => a.account_subtype === 'fixed_asset')
  const accumAccounts = accounts.filter(a => a.account_subtype === 'contra_asset')
  const [form, setForm] = useState({
    name: '', category: 'tool_equipment', assetAccountId: '', accumDeprAccountId: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    purchaseCostKes: '', salvageValueKes: '0', usefulLifeMonths: '60',
    paymentMethod: 'bank_operating', notes: '',
  })

  function setCategory(cat) {
    const defaults = CATEGORY_DEFAULT_KEYS[cat]
    const assetAcc = defaults && accounts.find(a => a.system_key === defaults.asset)
    const accumAcc = defaults && accounts.find(a => a.system_key === defaults.accumDepr)
    setForm(f => ({ ...f, category: cat, assetAccountId: assetAcc?.id || '', accumDeprAccountId: accumAcc?.id || '' }))
  }

  const valid = form.name.trim() && form.assetAccountId && form.accumDeprAccountId
    && Number(form.purchaseCostKes) > 0 && Number(form.usefulLifeMonths) > 0

  return (
    <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Asset name (e.g. Toyota Hilux KDA 123X)" value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <select value={form.category} onChange={e => setCategory(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select value={form.assetAccountId} onChange={e => setForm(f => ({ ...f, assetAccountId: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">Asset account…</option>
          {assetAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
        <select value={form.accumDeprAccountId} onChange={e => setForm(f => ({ ...f, accumDeprAccountId: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
          <option value="">Accumulated depreciation account…</option>
          {accumAccounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <input type="date" value={form.purchaseDate} onChange={e => setForm(f => ({ ...f, purchaseDate: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input type="number" placeholder="Cost (Ksh)" value={form.purchaseCostKes} onChange={e => setForm(f => ({ ...f, purchaseCostKes: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input type="number" placeholder="Salvage value" value={form.salvageValueKes} onChange={e => setForm(f => ({ ...f, salvageValueKes: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input type="number" placeholder="Useful life (months)" value={form.usefulLifeMonths} onChange={e => setForm(f => ({ ...f, usefulLifeMonths: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <select value={form.paymentMethod} onChange={e => setForm(f => ({ ...f, paymentMethod: e.target.value }))} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white">
        {PAYMENT_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      <textarea placeholder="Notes (optional)" value={form.notes} rows={2} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none" />
      <div className="flex gap-2">
        <button
          onClick={() => onSave({ ...form, purchaseCostKes: Number(form.purchaseCostKes), salvageValueKes: Number(form.salvageValueKes), usefulLifeMonths: parseInt(form.usefulLifeMonths, 10) })}
          disabled={saving || !valid} className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
          {saving ? 'Adding…' : 'Add Asset'}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 font-semibold px-2">Cancel</button>
      </div>
    </div>
  )
}

function DisposeForm({ asset, session, onDisposed }) {
  const [disposalDate, setDisposalDate] = useState(new Date().toISOString().slice(0, 10))
  const [proceeds, setProceeds] = useState('0')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true); setError('')
    try {
      const updated = await disposeAsset(asset, { disposalDate, proceedsKes: parseFloat(proceeds) || 0 }, session)
      onDisposed(updated)
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  return (
    <div className="bg-white rounded-xl p-3 space-y-2">
      <div className="text-xs font-black text-gray-700">Dispose Asset</div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={disposalDate} onChange={e => setDisposalDate(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input type="number" placeholder="Sale proceeds (0 if scrapped)" value={proceeds} onChange={e => setProceeds(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      {error && <div className="text-xs text-red-600 font-semibold">{error}</div>}
      <button onClick={submit} disabled={busy} className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
        {busy ? 'Disposing…' : 'Confirm Disposal'}
      </button>
    </div>
  )
}

export default function AdminFixedAssets({ session }) {
  const [assets, setAssets] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(null)
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [createError, setCreateError] = useState('')
  const [disposing, setDisposing] = useState(null)
  const [periodDate, setPeriodDate] = useState(new Date().toISOString().slice(0, 10))
  const [runningAll, setRunningAll] = useState(false)
  const [runError, setRunError] = useState('')
  const [runResult, setRunResult] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [assetRows, accountRows] = await Promise.all([fetchFixedAssets(), fetchChartOfAccounts({ forceRefresh: true })])
    setAssets(assetRows)
    setAccounts(accountRows)
    setLoading(false)
  }

  async function handleCreate(form) {
    setSaving(true); setCreateError('')
    try {
      await createFixedAsset(form, session)
      setCreating(false)
      await load()
    } catch (e) {
      setCreateError(e.message || 'Failed to add asset.')
    }
    setSaving(false)
  }

  async function handleRunAll() {
    setRunningAll(true); setRunError(''); setRunResult('')
    try {
      const results = await runDepreciationForAllActive(periodDate, session)
      setRunResult(results.length > 0 ? `Posted depreciation for ${results.length} asset(s).` : 'Nothing to post — every active asset is already depreciated through this period, or fully depreciated.')
      await load()
    } catch (e) {
      setRunError(e.message || 'Failed to run depreciation.')
    }
    setRunningAll(false)
  }

  function handleDisposed(updated) {
    setAssets(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))
    setDisposing(null)
  }

  const active = assets.filter(a => a.status === 'active')
  const totalCost = active.reduce((s, a) => s + Number(a.purchase_cost_kes), 0)
  const totalBookValue = active.reduce((s, a) => s + bookValue(a), 0)

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading fixed assets…</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Active Assets',  value: active.length,           c: 'bg-blue-50 text-blue-800'  },
          { label: 'Original Cost',  value: formatKsh(totalCost),      c: 'bg-gray-50 text-gray-700'  },
          { label: 'Net Book Value', value: formatKsh(totalBookValue), c: 'bg-green-50 text-green-800' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.c}`}>
            <div className="text-xs font-bold uppercase tracking-wider opacity-60">{s.label}</div>
            <div className="text-xl font-black font-mono mt-1 tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-gray-500">Run monthly depreciation through</span>
        <input type="date" value={periodDate} onChange={e => setPeriodDate(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <button onClick={handleRunAll} disabled={runningAll} className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition disabled:opacity-50">
          {runningAll ? 'Running…' : 'Run for All Active Assets'}
        </button>
        {runResult && <span className="text-xs text-green-700 font-semibold">{runResult}</span>}
        {runError && <span className="text-xs text-red-600 font-semibold">{runError}</span>}
      </div>

      <div className="flex justify-end">
        <button onClick={() => setCreating(c => !c)} className="text-xs font-bold text-blue-600 hover:text-blue-800">
          {creating ? '✕ Cancel' : '+ Add Asset'}
        </button>
      </div>

      {creating && (
        <>
          <AddAssetForm accounts={accounts} onSave={handleCreate} onCancel={() => setCreating(false)} saving={saving} />
          {createError && <div className="text-xs text-red-600 font-semibold">{createError}</div>}
        </>
      )}

      {assets.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">No fixed assets registered yet.</div>
      ) : assets.map(asset => {
        const isOpen = expanded === asset.id
        const accumulated = accumulatedDepreciation(asset)
        const bv = bookValue(asset)
        const entries = (asset.depreciation_entries || []).slice().sort((a, b) => a.period_date.localeCompare(b.period_date))

        return (
          <div key={asset.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <button onClick={() => setExpanded(isOpen ? null : asset.id)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${asset.status === 'disposed' ? 'bg-gray-200 text-gray-500' : 'bg-blue-100 text-blue-800'}`}>
                {asset.status === 'disposed' ? 'Disposed' : 'Active'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-black text-gray-800 truncate">FA-{String(asset.asset_number).padStart(4, '0')} · {asset.name}</div>
                <div className="text-xs text-gray-400 truncate">Cost {formatKsh(asset.purchase_cost_kes)} · Book value {formatKsh(bv)}</div>
              </div>
              <span className="text-gray-300 text-sm ml-1">{isOpen ? '▲' : '▼'}</span>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 px-5 py-4 space-y-3 bg-gray-50">
                <div className="bg-white rounded-xl p-3 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-400">Purchase date</span><span className="font-semibold">{new Date(asset.purchase_date).toLocaleDateString('en-KE')}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Purchase cost</span><span className="font-mono font-semibold">{formatKsh(asset.purchase_cost_kes)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Salvage value</span><span className="font-mono font-semibold">{formatKsh(asset.salvage_value_kes)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Useful life</span><span className="font-semibold">{asset.useful_life_months} months</span></div>
                  <div className="flex justify-between"><span className="text-gray-400">Accumulated depreciation</span><span className="font-mono font-semibold">{formatKsh(accumulated)}</span></div>
                  <div className="flex justify-between font-black"><span>Net book value</span><span className="font-mono">{formatKsh(bv)}</span></div>
                  {asset.status === 'disposed' && (
                    <div className="flex justify-between text-red-600"><span>Disposed</span><span className="font-semibold">{new Date(asset.disposed_at).toLocaleDateString('en-KE')} · proceeds {formatKsh(asset.disposal_proceeds_kes || 0)}</span></div>
                  )}
                </div>

                {entries.length > 0 && (
                  <div className="bg-white rounded-xl p-3 space-y-1">
                    <div className="text-xs font-black text-gray-700 mb-1">Depreciation History</div>
                    {entries.map(e => (
                      <div key={e.id} className="flex justify-between text-xs text-gray-600">
                        <span>{e.period_date}</span>
                        <span className="font-mono font-semibold">{formatKsh(e.amount_kes)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {asset.status === 'active' && (
                  disposing === asset.id ? (
                    <DisposeForm asset={asset} session={session} onDisposed={handleDisposed} />
                  ) : (
                    <button onClick={() => setDisposing(asset.id)} className="text-xs font-bold bg-red-100 hover:bg-red-200 text-red-700 px-3 py-2 rounded-lg transition">
                      Dispose Asset
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
