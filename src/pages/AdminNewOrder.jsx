// RhiPower — Office Ordering. Staff-side entry point for phone-in and
// walk-in customers: reuses the EXACT same Step1/Step2 wizard screens and
// runCalculation() engine the public site uses, so pricing/BOM correctness
// is identical — no separate manual-entry logic that could drift out of
// sync with the real engineering math or produce Sales Order lines the
// invoice generator can't apportion VAT against correctly.
//
// At the results step, staff choose one of two outcomes:
//   "Save as Quote Only" — for someone who just wants an estimate, same as
//     if they'd submitted the public wizard themselves. Creates a Lead.
//   "Place Order Now"    — for someone ready to buy right now on the call.
//     Creates the same Lead, then immediately calls the same
//     convertQuoteToSalesOrder() the "Convert to Sales Order" button on an
//     existing lead uses — so there is exactly one code path that turns a
//     quote into a Sales Order, regardless of how the quote was created.
import { useState, useEffect } from 'react'
import Step1_SiteConfig from './Step1_SiteConfig.jsx'
import Step2_Loads from './Step2_Loads.jsx'
import { DEFAULT_APPLIANCES } from '../data/appliances.js'
import { DEFAULT_CONFIG } from '../data/defaultSiteConfig.js'
import { TIER_META } from '../data/skuInventory.js'
import { fetchSolarData } from '../lib/nasaPower.js'
import { runCalculation } from '../lib/calculator.js'
import { fetchInventory } from '../lib/inventory.js'
import { supabase } from '../lib/supabase.js'
import { convertQuoteToSalesOrder } from '../lib/salesOrders.js'
import { logAdminAction } from '../lib/auditLog.js'

const BACKUP_OPTIONS = [1, 2, 3, 4, 5]

function TierCard({ tier, results, active, onSelect }) {
  const meta = TIER_META[tier]
  if (!results) return null
  return (
    <button onClick={() => onSelect(tier)}
      className={`text-left border-2 rounded-2xl p-4 transition ${active ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-gray-100 bg-white hover:border-gray-200'}`}>
      <div className="font-bold text-sm text-gray-800">{meta.label}</div>
      <div className="text-2xl font-black font-mono mt-1 text-gray-900">{results.fmt.total}</div>
      <div className="grid grid-cols-3 gap-1 mt-3 text-center text-[10px]">
        <div className="bg-amber-50 rounded-lg py-1.5"><div className="font-black text-amber-700">{results.truePVkW.toFixed(1)}</div><div className="text-amber-600">kWp</div></div>
        <div className="bg-blue-50 rounded-lg py-1.5"><div className="font-black text-blue-700">{results.totalInverterKW}</div><div className="text-blue-600">kW</div></div>
        <div className="bg-purple-50 rounded-lg py-1.5"><div className="font-black text-purple-700">{results.trueBattKWh}</div><div className="text-purple-600">kWh</div></div>
      </div>
    </button>
  )
}

function blankForm() { return { name: '', phone: '', email: '', address: '' } }

export default function AdminNewOrder({ session, onNavigate }) {
  const [step,        setStep]        = useState(1)
  const [siteConfig,  setSiteConfig]  = useState(DEFAULT_CONFIG)
  const [appliances,  setAppliances]  = useState(DEFAULT_APPLIANCES)
  const [quantities,  setQuantities]  = useState({})
  const [allResults,  setAllResults]  = useState(null)
  const [nasaLoading, setNasaLoading] = useState(false)
  const [inventory,   setInventory]   = useState(null)
  const [activeTier,  setActiveTier]  = useState('balanced')
  const [backupDays,  setBackupDays]  = useState(1)
  const [form,        setForm]        = useState(blankForm())
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [done,        setDone]        = useState(null)  // { type: 'quote'|'order', lead, so? }

  useEffect(() => { fetchInventory().then(setInventory) }, [])

  useEffect(() => {
    if (step !== 2) return
    setNasaLoading(true)
    fetchSolarData(siteConfig.location).then(data => {
      setSiteConfig(prev => ({ ...prev, psh: data.annualPSH, pshSource: data.source, pshMonthly: data.monthly }))
      setNasaLoading(false)
    })
  }, [siteConfig.location, step])

  function addCustomAppliance(newApp) {
    setAppliances(prev => [...prev, newApp])
    setQuantities(prev => ({ ...prev, [newApp.id]: 1 }))
  }

  function handleCalculate() {
    const tiers = ['premium', 'balanced', 'budget']
    const results = {}
    let anyValid = false
    tiers.forEach(tier => {
      const r = runCalculation({ ...siteConfig, tier, backupDays }, appliances, quantities, inventory)
      results[tier] = r
      if (r) anyValid = true
    })
    if (!anyValid) { alert('Set a quantity for at least one appliance.'); return }
    setAllResults(results)
    setStep(3)
  }

  function startOver() {
    setStep(1); setSiteConfig(DEFAULT_CONFIG); setAppliances(DEFAULT_APPLIANCES)
    setQuantities({}); setAllResults(null); setActiveTier('balanced'); setBackupDays(1)
    setForm(blankForm()); setDone(null); setError('')
  }

  const results = allResults?.[activeTier]

  function buildLeadPayload() {
    const customAppliances = appliances.filter(a => a.id.startsWith('custom_'))
    return {
      client_name: form.name.trim(), client_phone: form.phone.trim(),
      client_email: form.email.trim() || null, site_address: form.address.trim() || null,
      client_profile: 'business', path_selected: 'buy',
      location: siteConfig.location, profile: siteConfig.profile,
      tier_selected: activeTier, backup_days: backupDays,
      psh: siteConfig.psh, psh_source: siteConfig.pshSource,
      wire_dist_m: siteConfig.wireDistM, site_km: siteConfig.siteKm,
      panel_qty: results.panelQty, inverter_qty: results.inverterQty, battery_qty: results.batteryQty,
      true_pv_kw: results.truePVkW, total_inv_kw: results.totalInverterKW, true_batt_kwh: results.trueBattKWh,
      materials_kes: results.materialsAtSellPrice, labor_kes: results.totalLabor,
      logistics_kes: results.totalLogistics, grand_total_kes: results.grandTotal,
      user_id: null,
      panel_role_key: results.selectedProducts?.panel?.roleKey || null,
      inverter_role_key: results.selectedProducts?.inverter?.roleKey || null,
      battery_role_key: results.selectedProducts?.battery?.roleKey || null,
      raw_state: { siteConfig, customAppliances, quantities, clientProfile: 'business', backupDays },
      admin_notes: 'Created by admin — office order (phone/walk-in)',
    }
  }

  async function createLead() {
    const { data, error: err } = await supabase.from('quotation_requests').insert(buildLeadPayload()).select().single()
    if (err) throw err
    logAdminAction(session, 'lead_created_by_admin', data.id, { client_name: data.client_name, total: results.grandTotal })
    return data
  }

  async function saveAsQuote() {
    if (!form.name.trim() || !form.phone.trim()) { setError('Name and phone are required.'); return }
    setSaving(true); setError('')
    try {
      const lead = await createLead()
      setDone({ type: 'quote', lead })
    } catch (e) { setError(e.message || String(e)) }
    setSaving(false)
  }

  async function placeOrderNow() {
    if (!form.name.trim() || !form.phone.trim()) { setError('Name and phone are required.'); return }
    setSaving(true); setError('')
    try {
      const lead = await createLead()
      const so = await convertQuoteToSalesOrder(lead, session)
      setDone({ type: 'order', lead, so })
    } catch (e) { setError(e.message || String(e)) }
    setSaving(false)
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto bg-white rounded-2xl border border-gray-100 p-8 text-center space-y-4">
        <div className="text-5xl">{done.type === 'order' ? '🛒' : '📋'}</div>
        <h2 className="text-xl font-black text-gray-800">
          {done.type === 'order' ? 'Sales Order Created' : 'Quote Saved'}
        </h2>
        <p className="text-sm text-gray-500">
          {done.lead.client_name} · {done.lead.client_phone}
          {done.type === 'order' && <> — SO-{String(done.so.so_number).padStart(4, '0')}, status <strong>draft</strong></>}
        </p>
        <div className="flex flex-col gap-2">
          {done.type === 'order' ? (
            <button onClick={() => onNavigate?.('salesorders', done.so.id)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2.5 rounded-xl transition">
              View Sales Order →
            </button>
          ) : (
            <button onClick={() => onNavigate?.('leads', done.lead.id)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2.5 rounded-xl transition">
              View Lead →
            </button>
          )}
          <button onClick={startOver} className="text-sm text-gray-400 hover:text-gray-600 font-semibold px-4 py-2">
            + Start Another Order
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-bold text-gray-400">
        <span className={step === 1 ? 'text-blue-600' : ''}>1. Site</span>
        <span>→</span>
        <span className={step === 2 ? 'text-blue-600' : ''}>2. Loads</span>
        <span>→</span>
        <span className={step === 3 ? 'text-blue-600' : ''}>3. Confirm</span>
      </div>

      {step === 1 && (
        <Step1_SiteConfig config={siteConfig} nasaLoading={nasaLoading}
          onChange={updates => setSiteConfig(prev => ({ ...prev, ...updates }))}
          onNext={() => setStep(2)} />
      )}

      {step === 2 && (
        <Step2_Loads appliances={appliances} quantities={quantities} siteConfig={siteConfig}
          onQuantitiesChange={setQuantities} onBack={() => setStep(1)}
          onResults={handleCalculate} onAddAppliance={addCustomAppliance} />
      )}

      {step === 3 && results && (
        <div className="space-y-5">
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Backup Days</div>
            <div className="flex gap-2">
              {BACKUP_OPTIONS.map(d => (
                <button key={d} onClick={() => setBackupDays(d)}
                  className={`w-10 h-10 rounded-xl font-black text-sm transition ${backupDays === d ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Pick a Tier</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {['premium', 'balanced', 'budget'].map(tier => (
                <TierCard key={tier} tier={tier} results={allResults[tier]} active={activeTier === tier} onSelect={setActiveTier} />
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Customer Details</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <input placeholder="Name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Phone *" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Email (optional)" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input placeholder="Site address (optional)" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            {error && <div className="text-xs text-red-600 font-semibold bg-red-50 p-2 rounded-lg">{error}</div>}
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button onClick={saveAsQuote} disabled={saving}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold px-4 py-3 rounded-xl transition disabled:opacity-50">
                {saving ? 'Saving…' : '📋 Save as Quote Only'}
              </button>
              <button onClick={placeOrderNow} disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-3 rounded-xl transition disabled:opacity-50">
                {saving ? 'Placing…' : '🛒 Place Order Now'}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              "Save as Quote Only" is for someone who just wants an estimate — it's added to Leads & Pipeline like any other enquiry.
              "Place Order Now" creates the same quote and immediately converts it to a Sales Order (status: draft), reserving nothing yet — confirm it from Sales Orders when ready.
            </p>
          </div>

          <button onClick={() => setStep(2)} className="text-xs text-gray-400 hover:text-gray-600 font-semibold">← Back to Loads</button>
        </div>
      )}
    </div>
  )
}
