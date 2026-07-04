// RhiPower homepage — catalog-first landing page shown before the wizard.
// Structure follows the pattern researched from SunWatts/Alibaba: hero →
// trust bar → browsable example packages with real computed pricing → how
// it works → custom-build fallback. Replaces a cold "pick your profile"
// question as the very first thing a visitor sees.
import { useMemo } from 'react'
import { EXAMPLE_PACKAGES } from '../data/examplePackages.js'
import { DEFAULT_APPLIANCES } from '../data/appliances.js'
import { runCalculation } from '../lib/calculator.js'
import { BUSINESS } from '../config.js'
import { DEFAULT_CONFIG } from '../data/defaultSiteConfig.js'

const TRUST_BADGES = [
  { icon: '📐', label: 'IEC & KEBS-Aligned Engineering' },
  { icon: '🥇', label: '3 Hardware Tiers — Premium / Balanced / Budget' },
  { icon: '🛡️', label: '25-Yr Panel · 10-Yr Inverter & Battery Warranty' },
  { icon: '🚚', label: 'Kenya-Wide Site Survey & Installation' },
]

const HOW_IT_WORKS = [
  { icon: '📍', label: 'Tell us your site',      desc: 'Location, distance, roof/plant room details' },
  { icon: '🔌', label: 'Pick your appliances',   desc: 'Or start from a package and adjust it' },
  { icon: '📊', label: 'Get instant 3-tier pricing', desc: 'Premium, Balanced, Budget — live, no waiting' },
  { icon: '✅', label: 'Choose how to proceed',  desc: 'Supply Only, DIY spec sheet, or Full Turnkey' },
]

export default function Homepage({ inventory, onSelectPackage, onCustomize }) {
  const packagesWithPricing = useMemo(() => {
    return EXAMPLE_PACKAGES.map(pkg => {
      const siteConfig = { ...DEFAULT_CONFIG, tier: pkg.tier, backupDays: pkg.backupDays }
      const results = runCalculation(siteConfig, DEFAULT_APPLIANCES, pkg.quantities, inventory)
      return { ...pkg, results }
    })
  }, [inventory])

  return (
    <div>
      {/* HERO */}
      <div className="bg-gradient-to-b from-blue-900 to-blue-950 text-white px-4 py-14 text-center">
        <div className="text-5xl mb-3">⚡</div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight max-w-2xl mx-auto">
          Size, price, and order your solar system in minutes — not weeks.
        </h1>
        <p className="text-blue-200 mt-3 max-w-xl mx-auto">
          Real engineering math, live 3-tier pricing, and a full component list —
          built by an electrical engineer, not a lead-generation form.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-7">
          <a href="#packages"
            className="bg-white text-blue-900 font-black px-6 py-3.5 rounded-xl shadow-lg hover:bg-blue-50 transition">
            Browse Example Systems ↓
          </a>
          <button onClick={onCustomize}
            className="border-2 border-blue-300 text-white font-bold px-6 py-3.5 rounded-xl hover:bg-blue-800 transition">
            Build My Own Custom System →
          </button>
        </div>
      </div>

      {/* TRUST BAR */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 py-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {TRUST_BADGES.map(b => (
            <div key={b.label} className="text-center">
              <div className="text-2xl mb-1">{b.icon}</div>
              <div className="text-xs font-bold text-gray-600 leading-tight">{b.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* EXAMPLE PACKAGES */}
      <div id="packages" className="max-w-5xl mx-auto px-4 py-12">
        <p className="text-xs font-bold uppercase text-gray-400 tracking-widest mb-2 text-center">
          Browse Example Systems
        </p>
        <h2 className="text-2xl font-black text-gray-800 text-center mb-2">
          Find the closest match to your needs
        </h2>
        <p className="text-sm text-gray-500 text-center max-w-lg mx-auto mb-8">
          Every price below is a real calculation, not a placeholder — pick one to prefill the
          load builder, then confirm your exact site details for a final quote.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {packagesWithPricing.map(pkg => pkg.results && (
            <button key={pkg.id} onClick={() => onSelectPackage(pkg)}
              className="text-left bg-white border-2 border-gray-100 rounded-2xl p-5 hover:border-blue-300 hover:shadow-lg transition">
              <div className="flex items-start gap-3">
                <span className="text-4xl shrink-0">{pkg.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-gray-800">{pkg.title}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{pkg.tagline}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                <div className="bg-amber-50 rounded-lg py-2">
                  <div className="text-xs font-black text-amber-700">{pkg.results.truePVkW.toFixed(1)} kWp</div>
                  <div className="text-[10px] text-amber-600">Solar</div>
                </div>
                <div className="bg-blue-50 rounded-lg py-2">
                  <div className="text-xs font-black text-blue-700">{pkg.results.totalInverterKW} kW</div>
                  <div className="text-[10px] text-blue-600">Inverter</div>
                </div>
                <div className="bg-purple-50 rounded-lg py-2">
                  <div className="text-xs font-black text-purple-700">{pkg.results.trueBattKWh} kWh</div>
                  <div className="text-[10px] text-purple-600">Battery</div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4">
                <div>
                  <div className="text-[10px] text-gray-400 capitalize">{pkg.tier} tier, from</div>
                  <div className="text-lg font-black text-gray-900">{pkg.results.fmt.total}</div>
                </div>
                <span className="text-sm font-bold text-blue-600">Get This Quote →</span>
              </div>
            </button>
          ))}
        </div>

        <p className="text-xs text-gray-400 text-center mt-6">
          None of these quite fit?{' '}
          <button onClick={onCustomize} className="text-blue-600 font-semibold hover:text-blue-800">
            Build a fully custom system from scratch →
          </button>
        </p>
      </div>

      {/* HOW IT WORKS */}
      <div className="bg-white border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 py-12">
          <h2 className="text-xl font-black text-gray-800 text-center mb-8">How It Works</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={s.label} className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 flex items-center justify-center text-xl mb-2">
                  {s.icon}
                </div>
                <div className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Step {i + 1}</div>
                <div className="text-sm font-black text-gray-800 mt-0.5">{s.label}</div>
                <div className="text-xs text-gray-500 mt-1">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* CLOSING CTA */}
      <div className="bg-gray-900 text-white text-center px-4 py-10">
        <p className="font-black text-lg mb-1">Have questions before you start?</p>
        <p className="text-gray-400 text-sm mb-4">Talk to a RhiPower engineer directly on WhatsApp.</p>
        <a href={`https://wa.me/${BUSINESS.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
          className="inline-block bg-green-500 hover:bg-green-600 text-white font-bold px-6 py-3 rounded-xl transition">
          💬 Chat on WhatsApp — {BUSINESS.whatsapp}
        </a>
      </div>
    </div>
  )
}
