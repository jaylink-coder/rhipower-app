import { useState, useMemo } from 'react'
import { TIER_META }          from '../data/skuInventory.js'
import { KENYA_LOCATIONS }    from '../lib/nasaPower.js'
import { runCalculation, formatKsh } from '../lib/calculator.js'
import { BUSINESS }           from '../config.js'
import SystemDiagram          from '../components/SystemDiagram.jsx'
import { supabase, isSupabaseReady } from '../lib/supabase.js'
import MpesaDeposit from '../components/MpesaDeposit.jsx'
import { generateProposalPDF } from '../lib/pdfProposal.js'

// ── helpers ────────────────────────────────────────────────────────────────
const TIER_STYLE = {
  premium:  { ring: 'ring-amber-400',   bg: 'bg-amber-50',   badge: 'bg-amber-500 text-white',   text: 'text-amber-700'  },
  balanced: { ring: 'ring-blue-500',    bg: 'bg-blue-50',    badge: 'bg-blue-600 text-white',     text: 'text-blue-700'  },
  budget:   { ring: 'ring-emerald-400', bg: 'bg-emerald-50', badge: 'bg-emerald-600 text-white',  text: 'text-emerald-700'},
}

const BACKUP_LABELS = {
  1: 'Essential (1 day) — powers you through one overnight cycle',
  2: 'Standard (2 days) — weekend power without a generator',
  3: 'Comfortable (3 days) — ideal for rainy season resilience',
  4: 'Robust (4 days) — farming & hospitality reliability',
  5: 'Maximum (5 days) — near-total energy independence',
}

function BomZone({ title, color, intro, items }) {
  const styles = {
    orange: { border: 'border-orange-200 hover:border-orange-300', title: 'text-orange-700' },
    purple: { border: 'border-purple-200 hover:border-purple-300', title: 'text-purple-700' },
    blue:   { border: 'border-blue-200 hover:border-blue-300',     title: 'text-blue-700'  },
  }[color]
  return (
    <div className={`border-2 rounded-2xl p-5 bg-white transition shadow-sm ${styles.border}`}>
      <h4 className={`font-bold border-b pb-2 mb-3 ${styles.title}`}>{title}</h4>
      <p className="text-xs text-gray-500 mb-3 italic">{intro}</p>
      <ul className="list-disc pl-5 space-y-1.5 text-sm text-gray-700">
        {items.map((item, i) => (
          <li key={i}>
            <strong>{item.qty}×</strong> {item.label}
            {item.sku && <span className="ml-1 text-xs text-gray-400 font-mono">(SKU: {item.sku})</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

// Phone-comparison-style spec rows — only shows what's actually filled in
// for a given product, since the admin may not have every spec on hand yet.
function productSpecRows(category, p) {
  const rows = []
  if (category === 'panel') {
    if (p.wattsEach)         rows.push(['Output', `${p.wattsEach}W`])
    if (p.efficiencyPct)     rows.push(['Efficiency', `${p.efficiencyPct}%`])
    if (p.warrantyYears)     rows.push(['Warranty', `${p.warrantyYears} yr`])
    if (p.degradationPctYr)  rows.push(['Degradation', `${p.degradationPctYr}%/yr`])
  } else if (category === 'inverter') {
    if (p.kwEach)          rows.push(['Capacity', `${p.kwEach} kW`])
    if (p.efficiencyPct)   rows.push(['Efficiency', `${p.efficiencyPct}%`])
    if (p.mpptCount)       rows.push(['MPPT', `${p.mpptCount}`])
    if (p.phase)           rows.push(['Phase', p.phase])
    if (p.warrantyYears)   rows.push(['Warranty', `${p.warrantyYears} yr`])
  } else if (category === 'battery') {
    if (p.kwhEach)       rows.push(['Capacity', `${p.kwhEach} kWh`])
    if (p.cycleLife)     rows.push(['Cycle life', `${p.cycleLife.toLocaleString()}`])
    if (p.dodPct)        rows.push(['DoD', `${p.dodPct}%`])
    if (p.warrantyYears) rows.push(['Warranty', `${p.warrantyYears} yr`])
  }
  return rows
}

function BrandPicker({ category, label, results, onPick }) {
  const options  = results.availableProducts[category]
  const selected = results.selectedProducts[category]
  if (!options || options.length <= 1) return null

  return (
    <div className="bg-white border-2 border-gray-100 rounded-2xl p-4">
      <div className="text-xs font-bold uppercase text-gray-400 tracking-wider mb-2">{label} — {options.length} options in this tier</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {options.map(opt => {
          const isSel = opt.roleKey === selected.roleKey
          const specs = productSpecRows(category, opt)
          return (
            <button key={opt.roleKey} onClick={() => onPick(category, opt)}
              className={`text-left p-3 rounded-xl border-2 transition ${isSel ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-bold text-gray-800">{opt.description}</div>
                {isSel && <span className="text-blue-600 text-xs font-bold shrink-0">✓ Selected</span>}
              </div>
              <div className="text-sm font-mono font-black text-gray-900 mt-1">{formatKsh(opt.cost)}</div>
              {specs.length > 0 && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-xs text-gray-500">
                  {specs.map(([k, v]) => (
                    <div key={k}><span className="text-gray-400">{k}:</span> <span className="font-semibold text-gray-700">{v}</span></div>
                  ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function EngineerMath({ eng, results, autoOpen = false }) {
  const [open, setOpen] = useState(autoOpen)

  return (
    <div className="border-2 border-indigo-100 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 bg-indigo-50 hover:bg-indigo-100 transition text-left">
        <div>
          <span className="font-black text-indigo-800">🔢 Show Me the Engineering Math</span>
          <span className="ml-2 text-xs text-indigo-500">{open ? 'hide' : 'tap to see every calculation step'}</span>
        </div>
        <span className="text-indigo-400 text-xl">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="bg-white px-5 py-5 space-y-5 text-sm">

          <div className="border-l-4 border-blue-400 pl-4 space-y-1 font-mono">
            <div className="font-black text-blue-700 not-italic font-sans text-base">STEP 1 — Your Electrical Load</div>
            <div className="text-gray-600">Total running load: <span className="font-bold text-gray-900">{(eng.totalRunningWatts/1000).toFixed(2)} kW</span></div>
            <div className="text-gray-600">Peak surge demand:  <span className="font-bold text-gray-900">{(eng.maxSurgeWatts/1000).toFixed(2)} kW</span></div>
            {eng.surgeAppliances.length > 0 && (
              <div className="mt-1 not-italic font-sans text-xs text-orange-600 font-semibold">
                ⚠️ High-surge motors detected:
                {eng.surgeAppliances.map((a, i) => (
                  <div key={i} className="pl-3 font-mono">
                    → {a.name}: {(a.runW/1000).toFixed(1)} kW × {a.surgeF}× surge = <strong>{(a.surgeW/1000).toFixed(1)} kW peak</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-l-4 border-purple-400 pl-4 space-y-1 font-mono">
            <div className="font-black text-purple-700 not-italic font-sans text-base">STEP 2 — Inverter Sizing</div>
            <div className="text-xs text-gray-400 not-italic font-sans mb-1">Rule: must handle both running load ×1.25 AND the peak surge — whichever is larger</div>
            <div className="text-gray-600">Running load × 1.25 = <span className="font-bold text-gray-900">{(eng.totalRunningWatts * 1.25 / 1000).toFixed(2)} kW</span></div>
            <div className="text-gray-600">Peak surge demand  = <span className="font-bold text-gray-900">{(eng.maxSurgeWatts/1000).toFixed(2)} kW</span></div>
            <div className="text-gray-600">→ We need: <span className="font-bold text-gray-900">{eng.neededInverterKW} kW inverter capacity</span></div>
            <div className="text-gray-600">→ Selected: <span className="font-bold text-gray-900">{results.inverterQty} × {results.totalInverterKW / results.inverterQty} kW = {results.totalInverterKW} kW total</span></div>
          </div>

          <div className="border-l-4 border-green-400 pl-4 space-y-1 font-mono">
            <div className="font-black text-green-700 not-italic font-sans text-base">STEP 3 — Battery Storage Sizing</div>
            <div className="text-xs text-gray-400 not-italic font-sans mb-1">Rule: store enough for {eng.backupDays} night{eng.backupDays > 1 ? 's' : ''}, using only 80% capacity (protects battery lifespan)</div>
            <div className="text-gray-600">Overnight energy / night = <span className="font-bold text-gray-900">{(eng.overnightEnergyWhPerDay/1000).toFixed(2)} kWh</span></div>
            <div className="text-gray-600">× {eng.backupDays} backup day{eng.backupDays > 1 ? 's' : ''} = <span className="font-bold text-gray-900">{(eng.totalOvernightWh/1000).toFixed(2)} kWh</span></div>
            <div className="text-gray-600">÷ 0.80 DoD safety floor = <span className="font-bold text-gray-900">{eng.neededUsableKWh} kWh needed</span></div>
            <div className="text-gray-600">→ Selected: <span className="font-bold text-gray-900">{results.batteryQty} × {results.trueBattKWh / results.batteryQty} kWh = {results.trueBattKWh} kWh total</span></div>
          </div>

          <div className="border-l-4 border-amber-400 pl-4 space-y-1 font-mono">
            <div className="font-black text-amber-700 not-italic font-sans text-base">STEP 4 — Solar Panel Array Sizing</div>
            <div className="text-xs text-gray-400 not-italic font-sans mb-1">Rule: panels must recharge batteries AND power daytime loads every single day</div>
            <div className="text-gray-600">Daytime load (7 hrs)    = <span className="font-bold text-gray-900">{eng.daytimeKWh} kWh</span></div>
            <div className="text-gray-600">Battery to recharge     = <span className="font-bold text-gray-900">{results.trueBattKWh} kWh</span></div>
            <div className="text-gray-600">Total daily requirement = <span className="font-bold text-gray-900">{(eng.daytimeKWh + results.trueBattKWh).toFixed(1)} kWh</span></div>
            <div className="text-gray-600">÷ {eng.peakSunHours} peak sun hours (NASA data) = <span className="font-bold text-gray-900">{eng.neededPVkW} kWp needed</span></div>
            <div className="text-gray-600">→ Selected: <span className="font-bold text-gray-900">{results.panelQty} panels × {(results.truePVkW * 1000 / results.panelQty).toFixed(0)}W = {results.truePVkW.toFixed(2)} kWp total</span></div>
          </div>

          <div className="border-l-4 border-red-300 pl-4 space-y-1">
            <div className="font-black text-red-600 font-sans text-base">STEP 5 — Cable Sizing</div>
            <div className="text-sm text-gray-700">{eng.cableSpec}</div>
            {eng.cableIsHeavy && (
              <div className="text-orange-600 text-xs font-semibold">
                ⚡ Your {results.wireDistM}m panel-to-inverter run requires 10mm² copper. Thinner cable causes voltage drop and overheating.
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}

function buildWhatsAppMessage(clientName, clientPhone, siteConfig, results, tier, backupDays) {
  const loc     = KENYA_LOCATIONS[siteConfig.location]?.label || siteConfig.location
  const tierLbl = TIER_META[tier]?.label || tier
  const r       = results
  return encodeURIComponent(
    `🌟 *RhiPower — My Solar System Design*\n\n` +
    `👤 ${clientName || 'N/A'}  |  📞 ${clientPhone || 'N/A'}\n` +
    `📍 ${loc}  |  ☀️ ${siteConfig.psh} PSH/day (NASA)\n\n` +
    `⚡ *System Design — ${tierLbl} · ${backupDays}-Day Backup*\n` +
    `• Solar Array: ${r.truePVkW.toFixed(2)} kWp (${r.panelQty} panels)\n` +
    `• Inverter: ${r.totalInverterKW} kW (${r.inverterQty} unit${r.inverterQty !== 1 ? 's' : ''})\n` +
    `• Battery: ${r.trueBattKWh} kWh (${r.batteryQty} pack${r.batteryQty !== 1 ? 's' : ''})\n\n` +
    `💰 *Cost Estimate:*\n` +
    `• Hardware: ${r.fmt.materials}\n` +
    `• Labour:   ${r.fmt.labor}\n` +
    `• Logistics: ${r.fmt.logistics}\n` +
    `• *TOTAL: ${r.fmt.total}*\n\n` +
    `I designed this system on RhiPower and would like to proceed. Please contact me.`
  )
}

// ── Shared contact form ────────────────────────────────────────────────────
function ContactForm({ name, phone, email, address, setName, setPhone, setEmail, setAddress,
                       submitted, onWhatsApp, onDownloadPdf, ctaLabel }) {
  if (submitted) {
    return (
      <div className="bg-green-100 border border-green-300 text-green-800 p-4 rounded-xl text-sm font-semibold text-center">
        ✅ Sent! A RhiPower engineer will contact you within 24 hours.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { label: 'Full Name *',             val: name,    set: setName,    ph: 'Your name',           type: 'text'  },
          { label: 'Phone / WhatsApp *',      val: phone,   set: setPhone,   ph: '+254 7XX XXX XXX',    type: 'tel'   },
          { label: 'Email',                   val: email,   set: setEmail,   ph: 'you@email.com',       type: 'email' },
          { label: 'Site Location / Address', val: address, set: setAddress, ph: 'Town, county or GPS', type: 'text'  },
        ].map(f => (
          <div key={f.label}>
            <label className="block text-xs font-bold text-gray-600 mb-1">{f.label}</label>
            <input type={f.type} value={f.val} onChange={e => f.set(e.target.value)}
              placeholder={f.ph}
              className="w-full border border-gray-200 p-3 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button onClick={onWhatsApp}
          className="flex-1 bg-green-500 hover:bg-green-600 text-white font-black p-4 rounded-xl shadow-lg transition flex items-center justify-center gap-2">
          <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white shrink-0">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          {ctaLabel}
        </button>
        <button onClick={onDownloadPdf}
          className="px-4 border-2 border-gray-200 rounded-xl text-gray-500 hover:bg-gray-50 font-bold transition text-sm">
          ⬇️ PDF
        </button>
      </div>
    </div>
  )
}

// Profile-aware helpers
const PROFILE_LABELS = {
  homeowner:    { icon: '🏠', label: 'Homeowner Mode',     color: 'bg-blue-100 text-blue-700'    },
  diy:          { icon: '🔌', label: 'Hands-On Mode',      color: 'bg-emerald-100 text-emerald-700'},
  professional: { icon: '⚡', label: 'Professional Mode',  color: 'bg-amber-100 text-amber-800'  },
  business:     { icon: '🏢', label: 'Business Mode',      color: 'bg-purple-100 text-purple-700' },
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function Step3_Results({
  allResults, defaultTier, defaultBackupDays, siteConfig, appliances, quantities, clientProfile, inventory, customerUser, onBack
}) {
  const isPro      = clientProfile === 'professional'
  const isDIY      = clientProfile === 'diy'
  const isHome     = clientProfile === 'homeowner'
  const isBusiness = clientProfile === 'business'

  const [activeTier, setActiveTier] = useState(defaultTier || 'balanced')
  const [backupDays, setBackupDays] = useState(defaultBackupDays || 1)
  // Professionals land on BOM tab; business lands on quote; everyone else on design
  const [activeTab,  setActiveTab]  = useState(isPro ? 'bom' : isBusiness ? 'quote' : 'design')
  // Pre-select the recommended path based on experience level
  const [showPath,   setShowPath]   = useState(isPro ? 'buy' : isHome ? 'book' : null)
  const [name,       setName]       = useState('')
  const [phone,      setPhone]      = useState('')
  const [email,      setEmail]      = useState('')
  const [address,    setAddress]    = useState('')
  const [submitted,  setSubmitted]  = useState(false)
  const [quotationId, setQuotationId] = useState(null)
  // Customer's explicit brand/model picks, kept per-tier so switching tiers
  // to compare and coming back doesn't lose what they chose.
  const [productOverrides, setProductOverrides] = useState({ premium: {}, balanced: {}, budget: {} })

  // Re-run ALL THREE tiers live whenever backup days or a brand pick changes
  const liveAllResults = useMemo(() => {
    const out = {}
    ;['premium', 'balanced', 'budget'].forEach(tier => {
      out[tier] = runCalculation({ ...siteConfig, tier, backupDays }, appliances, quantities, inventory, productOverrides[tier])
    })
    return out
  }, [backupDays, siteConfig, appliances, quantities, inventory, productOverrides])

  function handlePickProduct(category, product) {
    setProductOverrides(p => ({ ...p, [activeTier]: { ...p[activeTier], [category]: product } }))
  }

  // Active tier result (already inside liveAllResults, just aliased for readability)
  const results = liveAllResults[activeTier]

  if (!results) return null

  const { panelQty, truePVkW, inverterQty, totalInverterKW,
          batteryQty, trueBattKWh, zoneA, zoneB, zoneC,
          fmt, heavyMotorCount, engineering: eng } = results

  async function saveQuotation() {
    if (!isSupabaseReady) return
    try {
      // Only the client's own additions need saving — DEFAULT_APPLIANCES is
      // reconstructed from code on resume, keeping this snapshot small.
      const customAppliances = appliances.filter(a => a.id.startsWith('custom_'))
      const { data } = await supabase.from('quotation_requests').insert({
        client_name:     name.trim(),
        client_phone:    phone.trim(),
        client_email:    email.trim()   || null,
        site_address:    address.trim() || null,
        client_profile:  clientProfile,
        path_selected:   showPath,
        location:        siteConfig.location,
        profile:         siteConfig.profile,
        tier_selected:   activeTier,
        backup_days:     backupDays,
        psh:             siteConfig.psh,
        psh_source:      siteConfig.pshSource,
        wire_dist_m:     siteConfig.wireDistM,
        site_km:         siteConfig.siteKm,
        panel_qty:       results.panelQty,
        inverter_qty:    results.inverterQty,
        battery_qty:     results.batteryQty,
        true_pv_kw:      results.truePVkW,
        total_inv_kw:    results.totalInverterKW,
        true_batt_kwh:   results.trueBattKWh,
        materials_kes:   results.materialsAtSellPrice,
        labor_kes:       results.totalLabor,
        logistics_kes:   results.totalLogistics,
        grand_total_kes: results.grandTotal,
        user_id:         customerUser?.id || null,
        raw_state:       { siteConfig, customAppliances, quantities, clientProfile, backupDays },
      }).select('id').single()
      if (data?.id) setQuotationId(data.id)
    } catch (err) {
      console.error('Supabase save failed (non-blocking):', err)
    }
  }

  function handleWhatsApp() {
    if (!name.trim() || !phone.trim()) {
      alert('Please enter your name and phone number so our engineer can contact you.')
      return
    }
    const msg = buildWhatsAppMessage(name, phone, siteConfig, results, activeTier, backupDays)
    window.open(`https://wa.me/${BUSINESS.whatsapp.replace(/\D/g, '')}?text=${msg}`, '_blank')
    saveQuotation()   // fire-and-forget: saves to database without blocking the WhatsApp send
    setSubmitted(true)
  }

  function handleDownloadPdf() {
    generateProposalPDF({
      client: { name, phone, email, address },
      siteConfig, results, tier: activeTier, backupDays,
    })
  }

  const contactProps = { name, phone, email, address, setName, setPhone, setEmail, setAddress,
                         submitted, onWhatsApp: handleWhatsApp, onDownloadPdf: handleDownloadPdf }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">

      {/* HEADER */}
      <div className="mb-6 text-center">
        <h2 className="text-2xl font-black text-gray-800">⚡ Your Solar System Design</h2>
        <p className="text-sm text-gray-500 mt-1">
          You designed this. Every number is calculated from the appliances you selected.
        </p>
        {clientProfile && PROFILE_LABELS[clientProfile] && (
          <div className="flex items-center justify-center gap-2 mt-3">
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${PROFILE_LABELS[clientProfile].color}`}>
              {PROFILE_LABELS[clientProfile].icon} {PROFILE_LABELS[clientProfile].label}
            </span>
            {isPro && (
              <span className="text-xs text-amber-600 font-semibold">
                — Full technical data shown. Engineer's Math panel is pre-opened below.
              </span>
            )}
            {isHome && (
              <span className="text-xs text-blue-600 font-semibold">
                — We've highlighted the safest path for you below.
              </span>
            )}
            {isDIY && (
              <span className="text-xs text-emerald-600 font-semibold">
                — Your DIY spec sheet and safety checklist are ready.
              </span>
            )}
          </div>
        )}
      </div>

      {/* STEP 1 — TIER PICKER */}
      <div className="mb-5">
        <p className="text-xs font-bold uppercase text-gray-400 tracking-widest mb-3 text-center">
          Step 1 of 2 — Choose your hardware quality
        </p>
        <div className="grid grid-cols-3 gap-3">
          {['premium', 'balanced', 'budget'].map(tier => {
            const r   = liveAllResults[tier]
            const t   = TIER_META[tier]
            const s   = TIER_STYLE[tier]
            const sel = activeTier === tier
            if (!r) return null
            return (
              <button key={tier} onClick={() => setActiveTier(tier)}
                className={`p-4 rounded-2xl border-2 text-left transition w-full
                  ${sel ? `${s.ring} ring-2 ${s.bg} shadow-md` : 'border-gray-200 bg-white hover:shadow'}`}>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.badge}`}>{t.label}</span>
                <div className="text-xs text-gray-500 mt-2">
                  {r.truePVkW.toFixed(1)} kWp · {r.inverterQty}× inv · {r.batteryQty}× bat
                </div>
                <div className={`text-base font-black font-mono mt-1 ${s.text}`}>{r.fmt.total}</div>
                {sel && <div className="text-xs text-green-700 font-bold mt-0.5">✓ Selected</div>}
              </button>
            )
          })}
        </div>
      </div>

      {/* BRAND / MODEL PICKER — only shows a category when this tier has more than one option */}
      {(results.availableProducts.panel.length > 1 || results.availableProducts.inverter.length > 1 || results.availableProducts.battery.length > 1) && (
        <div className="space-y-3 mb-5">
          <p className="text-xs font-bold uppercase text-gray-400 tracking-widest text-center">
            {TIER_META[activeTier]?.label} has more than one option — pick what fits you
          </p>
          <BrandPicker category="panel"    label="☀️ Solar Panel"     results={results} onPick={handlePickProduct} />
          <BrandPicker category="inverter" label="⚡ Inverter"        results={results} onPick={handlePickProduct} />
          <BrandPicker category="battery"  label="🔋 Battery"         results={results} onPick={handlePickProduct} />
        </div>
      )}

      {/* STEP 2 — BACKUP DAYS SLIDER */}
      <div className="bg-white border-2 border-indigo-100 rounded-2xl p-5 mb-5 shadow-sm">
        <p className="text-xs font-bold uppercase text-gray-400 tracking-widest mb-3">
          Step 2 of 2 — How many days of backup power do you want?
        </p>
        <div className="flex items-center gap-4 mb-2">
          <span className="text-4xl font-black text-indigo-700 w-8 text-center tabular-nums">{backupDays}</span>
          <input type="range" min={1} max={5} value={backupDays}
            onChange={e => setBackupDays(Number(e.target.value))}
            className="flex-1 h-3 rounded-full accent-indigo-600 cursor-pointer" />
        </div>
        <p className="text-sm font-semibold text-indigo-700">{BACKUP_LABELS[backupDays]}</p>
        <p className="text-xs text-gray-400 mt-1.5">
          Storage: <strong className="text-gray-700">{batteryQty} × {trueBattKWh / batteryQty} kWh packs = {trueBattKWh} kWh</strong>
          <span className="ml-2 text-indigo-400">← this updates live as you move the slider</span>
        </p>
      </div>

      {/* LIVE SYSTEM SUMMARY CARDS */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Solar Array',     val: `${truePVkW.toFixed(2)} kWp`, sub: `${panelQty} panels`,                              c: 'bg-amber-50  border-amber-200  text-amber-800'  },
          { label: 'Inverter',        val: `${totalInverterKW} kW`,       sub: `${inverterQty} unit${inverterQty !== 1 ? 's':''}`, c: 'bg-blue-50   border-blue-200   text-blue-800'  },
          { label: 'Battery Storage', val: `${trueBattKWh} kWh`,          sub: `${batteryQty} pack${batteryQty !== 1 ? 's':''}`,  c: 'bg-purple-50 border-purple-200 text-purple-800'},
        ].map(s => (
          <div key={s.label} className={`border-2 rounded-2xl p-4 text-center transition-all ${s.c}`}>
            <div className="text-xs font-bold uppercase tracking-wider opacity-60 mb-1">{s.label}</div>
            <div className="text-xl font-black font-mono tabular-nums">{s.val}</div>
            <div className="text-xs font-semibold opacity-70 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* TAB BAR */}
      <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 mb-6 print:hidden">
        {[
          { id: 'design', label: '🔬 System Design'   },
          { id: 'bom',    label: '📦 Component List'  },
          { id: 'quote',  label: '💰 Pricing & Quote' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition
              ${activeTab === tab.id ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── TAB: DESIGN ──────────────────────────────────────────────────── */}
      {activeTab === 'design' && (
        <div className="space-y-5">
          <SystemDiagram panelQty={panelQty} inverterQty={inverterQty}
            batteryQty={batteryQty} results={results} tier={activeTier} />

          <EngineerMath eng={eng} results={results} autoOpen={isPro} />

          {/* Load stats */}
          <div className="bg-white border-2 border-gray-100 rounded-2xl p-5 shadow-sm">
            <h4 className="font-bold text-gray-700 mb-3">⚡ Your Load Profile</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { label: 'Total Running Load', val: `${(eng.totalRunningWatts/1000).toFixed(2)} kW`, sub: 'all appliances on',          c: 'bg-gray-50    text-gray-800'   },
                { label: 'Peak Surge',          val: `${(eng.maxSurgeWatts/1000).toFixed(2)} kW`,    sub: 'at motor start-up',           c: 'bg-orange-50  text-orange-800' },
                { label: 'Nightly Energy',      val: `${(eng.overnightEnergyWhPerDay/1000).toFixed(2)} kWh`, sub: 'per night',           c: 'bg-blue-50    text-blue-800'   },
                { label: 'Daily Solar Yield',   val: `${(truePVkW * eng.peakSunHours * 0.8).toFixed(2)} kWh`, sub: 'at 80% array yield', c: 'bg-green-50   text-green-800'  },
              ].map(s => (
                <div key={s.label} className={`rounded-xl p-3 ${s.c}`}>
                  <div className="text-xs font-bold uppercase tracking-wider opacity-60">{s.label}</div>
                  <div className="text-xl font-black font-mono mt-0.5">{s.val}</div>
                  <div className="text-xs opacity-70">{s.sub}</div>
                </div>
              ))}
            </div>
            {heavyMotorCount > 0 && (
              <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800 font-semibold">
                💡 <strong>Smart Load Control:</strong> {heavyMotorCount} heavy motor circuit{heavyMotorCount !== 1 ? 's' : ''} (pump/AC)
                will auto-isolate after 4:00 PM daily — protecting your battery bank overnight.
              </div>
            )}
          </div>

          <button onClick={() => setActiveTab('bom')}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition print:hidden">
            View Full Component List →
          </button>
        </div>
      )}

      {/* ── TAB: BOM ──────────────────────────────────────────────────────── */}
      {activeTab === 'bom' && (
        <div className="space-y-4">
          <p className="text-xs text-gray-400 text-center italic">
            Every item is required for a safe, IEC-compliant installation.
            SKU codes allow you or your electrician to source and verify independently.
          </p>

          <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0">🛡️</span>
              <div className="text-sm text-emerald-900">
                <p className="font-black mb-1">Why source this list from RhiPower instead of piecing it together yourself?</p>
                <ul className="text-xs space-y-1 text-emerald-800">
                  <li>✅ <strong>Genuine stock, not relabeled or grey-market</strong> — every panel/inverter/battery SKU above is traceable to its manufacturer, unlike unverifiable marketplace listings.</li>
                  <li>✅ <strong>Full manufacturer warranty</strong> — 25-year panels, 10-year inverter, 10-year battery — void or unenforceable on gear bought piecemeal with no invoice trail.</li>
                  <li>✅ <strong>Engineering liability</strong> — this BOM is sized as one matched system. Mixing brands/specs sourced separately risks inverter-battery incompatibility with no one accountable if it fails.</li>
                </ul>
              </div>
            </div>
          </div>

          <BomZone
            title="📦 Zone A — Solar Array & Combiner Box (rooftop)"
            color="orange"
            intro="High-voltage DC protection. Safely isolates your panels from the plant room and stops lightning surges reaching the inverter."
            items={zoneA} />
          <BomZone
            title="🔋 Zone B — Battery Bank & Power Plant (inverter room)"
            color="purple"
            intro="Heavy-duty DC busbars and connections linking battery strings to inverters. Oversized conductors prevent heat build-up during high charge/discharge currents."
            items={zoneB} />
          <BomZone
            title="⚡ Zone C — AC Distribution & Smart Load Control"
            color="blue"
            intro="Your home or business distribution board. Smart timers shed heavy motor loads after 4PM and during low-sun days to protect your battery autonomy."
            items={zoneC} />
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-xs text-indigo-800">
            <strong>Compliance:</strong> All core components meet IEC 61215 (panels), IEC 62109 (inverter),
            IEC 62619 (LiFePO₄ batteries), IEC 60947 (switchgear).
            Installation wiring per Kenya National Electrical Code KS 638 / IEC 60364.
            16% VAT applicable. Installer should be KEBS-registered.
          </div>
          <button onClick={() => setActiveTab('quote')}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition print:hidden">
            See Pricing & Choose Your Path →
          </button>
        </div>
      )}

      {/* ── TAB: QUOTE ────────────────────────────────────────────────────── */}
      {activeTab === 'quote' && (
        <div className="space-y-5">

          {/* Financial summary */}
          <div className="bg-gray-900 text-white rounded-2xl p-6 shadow-lg">
            <h4 className="font-bold text-lg text-emerald-400 mb-4 border-b border-gray-700 pb-3">
              💰 Full Project Cost Estimate
            </h4>
            <div className="space-y-3 text-sm font-mono">
              {[
                { label: 'Hardware (materials + 35% margin):',           val: fmt.materials },
                { label: `Engineering & installation labor:`,             val: fmt.labor     },
                { label: `Logistics & per-diem (${siteConfig.siteKm} km):`, val: fmt.logistics },
              ].map(r => (
                <div key={r.label} className="flex justify-between gap-4">
                  <span className="text-gray-400">{r.label}</span>
                  <span className="font-bold text-gray-100 shrink-0">{r.val}</span>
                </div>
              ))}
              <div className="border-t border-gray-700 pt-3 flex justify-between items-baseline">
                <span className="text-white font-black">TOTAL PROJECT:</span>
                <span className="font-black text-emerald-400 text-2xl">{fmt.total}</span>
              </div>
            </div>
            <div className="mt-4 text-xs text-gray-500 space-y-0.5">
              <div>Prices inclusive of 16% VAT · Subject to site survey · {backupDays}-day backup · {TIER_META[activeTier]?.label}</div>
              <div>
                Warranty:{' '}
                {results.selectedProducts?.panel?.warrantyYears    ? `${results.selectedProducts.panel.warrantyYears}-year panels` : '25-year panels'} ·{' '}
                {results.selectedProducts?.inverter?.warrantyYears ? `${results.selectedProducts.inverter.warrantyYears}-year inverter` : '10-year inverter'} ·{' '}
                {results.selectedProducts?.battery?.warrantyYears  ? `${results.selectedProducts.battery.warrantyYears}-year battery` : '10-year battery'} ·{' '}
                2-year installation workmanship
              </div>
            </div>
          </div>

          {/* Three paths */}
          <div>
            <p className="text-xs font-bold uppercase text-gray-400 tracking-widest mb-3 text-center">
              How do you want to proceed?
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  id: 'buy', icon: '🛒', title: 'Supply Only',
                  desc: 'We supply all components. You or your own electrician handles installation.',
                  color: 'border-blue-400 bg-blue-50', activeColor: 'ring-2 ring-blue-500',
                  textColor: 'text-blue-700',
                  recommended: isPro || isBusiness,
                  recommendedLabel: 'Recommended for you',
                },
                {
                  id: 'diy', icon: '🔧', title: 'DIY / Own Installer',
                  desc: 'Download your complete spec sheet and hand it to any qualified electrician.',
                  color: 'border-emerald-400 bg-emerald-50', activeColor: 'ring-2 ring-emerald-500',
                  textColor: 'text-emerald-700',
                  recommended: isDIY,
                  recommendedLabel: 'Recommended for you',
                  warning: isHome ? '⚠️ Not recommended without electrical training' : null,
                },
                {
                  id: 'book', icon: '👷', title: 'Full Turnkey',
                  desc: 'We supply, deliver, install, and commission. One team, one invoice.',
                  color: 'border-amber-400 bg-amber-50', activeColor: 'ring-2 ring-amber-500',
                  textColor: 'text-amber-700',
                  recommended: isHome,
                  recommendedLabel: '⭐ Recommended for your profile',
                },
              ].map(p => (
                <button key={p.id}
                  onClick={() => setShowPath(showPath === p.id ? null : p.id)}
                  className={`p-5 rounded-2xl border-2 text-left transition hover:shadow-lg relative
                    ${showPath === p.id ? `${p.color} ${p.activeColor} shadow-md` : 'border-gray-200 bg-white'}`}>
                  {p.recommended && (
                    <div className="absolute -top-2.5 left-4 bg-green-500 text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
                      {p.recommendedLabel}
                    </div>
                  )}
                  <div className="text-3xl mb-2 mt-1">{p.icon}</div>
                  <div className="font-black text-gray-800">{p.title}</div>
                  <div className="text-xs text-gray-500 mt-1">{p.desc}</div>
                  {p.warning && (
                    <div className="mt-2 text-xs font-bold text-orange-600">{p.warning}</div>
                  )}
                  <div className={`mt-3 text-xs font-bold ${showPath === p.id ? p.textColor : 'text-gray-400'}`}>
                    {showPath === p.id ? '▲ Close' : '▼ Select this option'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Path detail: Supply */}
          {showPath === 'buy' && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-5 animate-slide-up">
              <h4 className="font-black text-blue-800 mb-3">🛒 Supply-Only Package — What's Included</h4>
              <ul className="text-sm text-blue-700 space-y-1.5 mb-4">
                <li>✅ All {panelQty} panels + {inverterQty} inverter + {batteryQty} battery packs delivered to site</li>
                <li>✅ All Zone A / B / C protection components, pre-kitted and labelled</li>
                <li>✅ Wiring diagram specific to your layout</li>
                <li>✅ IEC datasheets and KEBS compliance documents</li>
                <li>✅ 12-month manufacturer warranty on all supplied components</li>
                <li>⚠️ Installation by a qualified electrician is your responsibility</li>
              </ul>
              <p className="text-sm text-blue-800 mb-4">
                Hardware-only cost: <strong className="text-lg font-black">{fmt.materials}</strong>
                <span className="text-xs text-blue-500 ml-2">incl. VAT, excl. installation</span>
              </p>
              <ContactForm {...contactProps} ctaLabel="Request Supply Quote via WhatsApp" />
              {submitted && (
                <div className="mt-4">
                  <MpesaDeposit
                    quotationId={quotationId}
                    defaultPhone={phone}
                    suggestedAmount={Math.max(5000, Math.round(results.grandTotal * 0.05 / 100) * 100)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Path detail: DIY */}
          {showPath === 'diy' && (
            <div className="bg-emerald-50 border-2 border-emerald-200 rounded-2xl p-5 animate-slide-up">
              {isHome && (
                <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-4 mb-4">
                  <p className="text-sm font-black text-orange-800">⚠️ Safety Notice for Homeowners</p>
                  <p className="text-xs text-orange-700 mt-1">
                    Solar PV systems above 1kW involve high-voltage DC electricity (up to 400V) that is
                    dangerous and potentially fatal if handled incorrectly. In Kenya, systems above 5kW
                    require installation by a KEBS-registered electrician (IEC 60364 / KS 638).
                    We strongly recommend choosing <strong>Full Turnkey</strong> or hiring a qualified
                    electrician with your spec sheet. This document is provided for your reference only.
                  </p>
                </div>
              )}
              <h4 className="font-black text-emerald-800 mb-3">🔧 Your DIY Specification Pack</h4>
              <ul className="text-sm text-emerald-700 space-y-1.5 mb-4">
                <li>✅ Complete BOM with SKU codes (all zones)</li>
                <li>✅ Engineering calculation sheet showing every formula</li>
                <li>✅ Cable sizing for your exact {siteConfig.wireDistM}m run</li>
                <li>✅ Zone A / B / C installation sequence</li>
                <li>✅ IEC compliance checklist before commissioning</li>
                <li>💡 <strong>Hand this printout to any qualified electrician</strong> — they have everything</li>
              </ul>
              <div className="flex flex-col sm:flex-row gap-3">
                <button onClick={handleDownloadPdf}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-black p-4 rounded-xl transition">
                  ⬇️ Download PDF Spec Sheet
                </button>
                <button onClick={() => {
                  const msg = buildWhatsAppMessage('DIY Order', '', siteConfig, results, activeTier, backupDays)
                  window.open(`https://wa.me/${BUSINESS.whatsapp.replace(/\D/g, '')}?text=${msg}`, '_blank')
                }}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold p-4 rounded-xl transition">
                  📤 Send Spec to My Electrician via WhatsApp
                </button>
              </div>
            </div>
          )}

          {/* Path detail: Book */}
          {showPath === 'book' && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 animate-slide-up">
              <h4 className="font-black text-amber-800 mb-3">👷 Full Turnkey — What You Get</h4>
              <ul className="text-sm text-amber-700 space-y-1.5 mb-4">
                <li>✅ Site survey within 3–5 business days of enquiry</li>
                <li>✅ All components supplied, delivered, and installed by our team</li>
                <li>✅ Electrical safety inspection & EPRA compliance documentation</li>
                <li>✅ System commissioning with full handover training</li>
                <li>✅ 2-year installation workmanship warranty</li>
                <li>✅ Post-installation WhatsApp support</li>
              </ul>
              <div className="bg-amber-100 rounded-xl p-3 text-sm text-amber-800 mb-4">
                Full turnkey estimate: <strong className="text-xl font-black">{fmt.total}</strong>
              </div>
              <ContactForm {...contactProps} ctaLabel="Book Site Survey via WhatsApp" />
              {submitted && (
                <div className="mt-4">
                  <MpesaDeposit
                    quotationId={quotationId}
                    defaultPhone={phone}
                    suggestedAmount={Math.max(5000, Math.round(results.grandTotal * 0.05 / 100) * 100)}
                  />
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* BACK */}
      <div className="mt-8 print:hidden">
        <button onClick={onBack}
          className="px-6 py-4 border-2 border-gray-200 rounded-2xl text-gray-600 hover:bg-gray-50 font-bold transition">
          ← Back to Loads
        </button>
      </div>

    </div>
  )
}
