import { useState, useEffect } from 'react'
import Navbar           from './components/Navbar.jsx'
import Step0_Welcome    from './pages/Step0_Welcome.jsx'
import Step1_SiteConfig from './pages/Step1_SiteConfig.jsx'
import Step2_Loads      from './pages/Step2_Loads.jsx'
import Step3_Results    from './pages/Step3_Results.jsx'
import AdminInventory   from './pages/AdminInventory.jsx'
import CustomerAuth     from './components/CustomerAuth.jsx'
import MyQuotes         from './pages/MyQuotes.jsx'
import { DEFAULT_APPLIANCES } from './data/appliances.js'
import { fetchSolarData }     from './lib/nasaPower.js'
import { runCalculation }     from './lib/calculator.js'
import { fetchInventory }     from './lib/inventory.js'
import { supabase, isSupabaseReady } from './lib/supabase.js'
import './App.css'

const STEP_LABELS = ['Site & Intent', 'Electrical Loads', 'Results & Quote']

const DEFAULT_CONFIG = {
  location:   'nanyuki',
  profile:    'airbnb',
  wireDistM:  150,
  siteKm:     200,
  tier:       'balanced',
  psh:        5.5,
  pshSource:  'fallback',
  pshMonthly: [],
}

export default function App() {
  const [step,          setStep]          = useState(0)
  const [clientProfile, setClientProfile] = useState(null)
  const [siteConfig,    setSiteConfig]    = useState(DEFAULT_CONFIG)
  const [appliances,    setAppliances]    = useState(DEFAULT_APPLIANCES)
  const [quantities,    setQuantities]    = useState({})
  const [allResults,    setAllResults]    = useState(null)
  const [nasaLoading,   setNasaLoading]   = useState(false)
  const [inventory,     setInventory]     = useState(null)   // null = use hardcoded fallback
  const [showAdmin,     setShowAdmin]     = useState(false)
  const [showAccount,   setShowAccount]   = useState(false)
  const [customerUser,  setCustomerUser]  = useState(null)   // null = signed out

  // Fetch live inventory prices from Supabase on first load
  useEffect(() => {
    fetchInventory().then(inv => setInventory(inv))
  }, [])

  // Track the signed-in customer session (shared Supabase Auth client — if the
  // logged-in user is you, the admin, this just reflects that same session here too)
  useEffect(() => {
    if (!isSupabaseReady) return
    supabase.auth.getSession().then(({ data: { session } }) => setCustomerUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, s) => setCustomerUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  // Fetch NASA satellite solar data whenever the location changes
  useEffect(() => {
    if (step === 0) return    // don't fetch before welcome screen is passed
    setNasaLoading(true)
    fetchSolarData(siteConfig.location).then(data => {
      setSiteConfig(prev => ({
        ...prev,
        psh:        data.annualPSH,
        pshSource:  data.source,
        pshMonthly: data.monthly,
      }))
      setNasaLoading(false)
    })
  }, [siteConfig.location, step])

  function handleProfileSelect(profile) {
    setClientProfile(profile)
    setStep(1)
  }

  function handleConfigChange(updates) {
    setSiteConfig(prev => ({ ...prev, ...updates }))
  }

  function handleCalculate() {
    const tiers = ['premium', 'balanced', 'budget']
    const results = {}
    let anyValid = false
    tiers.forEach(tier => {
      const r = runCalculation({ ...siteConfig, tier }, appliances, quantities, inventory)
      results[tier] = r
      if (r) anyValid = true
    })
    if (!anyValid) {
      alert('Please set a quantity for at least one appliance.')
      return
    }
    setAllResults(results)
    setStep(3)
  }

  function addCustomAppliance(newApp) {
    setAppliances(prev => [...prev, newApp])
    setQuantities(prev => ({ ...prev, [newApp.id]: 1 }))
  }

  // Reopen a saved design from "My Quotes" — rebuild state directly from the
  // snapshot rather than relying on setState timing, then jump straight to results.
  function handleResumeQuote(raw) {
    const restoredAppliances = [...DEFAULT_APPLIANCES, ...(raw.customAppliances || [])]
    const results = {}
    let anyValid = false
    ;['premium', 'balanced', 'budget'].forEach(tier => {
      const r = runCalculation({ ...raw.siteConfig, tier }, restoredAppliances, raw.quantities, inventory)
      results[tier] = r
      if (r) anyValid = true
    })
    if (!anyValid) return

    setClientProfile(raw.clientProfile || null)
    setSiteConfig(raw.siteConfig)
    setAppliances(restoredAppliances)
    setQuantities(raw.quantities)
    setAllResults(results)
    setShowAccount(false)
    setStep(3)
  }

  if (showAdmin) return <AdminInventory onBack={() => setShowAdmin(false)} />

  if (showAccount) {
    return customerUser
      ? <MyQuotes user={customerUser} onBack={() => setShowAccount(false)} onResume={handleResumeQuote} />
      : <CustomerAuth onBack={() => setShowAccount(false)} onSignedIn={() => {}} />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar onAdmin={() => setShowAdmin(true)} onAccount={() => setShowAccount(true)} customerUser={customerUser} />

      {/* Progress bar — hidden on welcome screen */}
      {step > 0 && (
        <div className="bg-white border-b border-gray-100 shadow-sm sticky top-0 z-10 print:hidden">
          <div className="max-w-5xl mx-auto px-4 py-3">
            <div className="flex items-center gap-1">

              {/* Profile badge */}
              {clientProfile && (
                <button
                  onClick={() => setStep(0)}
                  title="Change experience level"
                  className="shrink-0 text-xs font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 hover:bg-gray-200 transition mr-2">
                  {clientProfile === 'homeowner'    ? '🏠'
                   : clientProfile === 'diy'        ? '🔌'
                   : clientProfile === 'professional'? '⚡'
                   : '🏢'}
                </button>
              )}

              {STEP_LABELS.map((label, i) => {
                const num    = i + 1
                const active = step === num
                const done   = step > num
                return (
                  <div key={num} className="flex items-center gap-1.5 flex-1 min-w-0">
                    <button
                      onClick={() => done && setStep(num)}
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0 transition
                        ${active ? 'bg-blue-700 text-white shadow'
                                 : done  ? 'bg-green-600 text-white cursor-pointer hover:bg-green-700'
                                 : 'bg-gray-100 text-gray-400'}`}>
                      {done ? '✓' : num}
                    </button>
                    <span className={`text-xs font-semibold truncate hidden sm:block
                      ${active ? 'text-blue-700' : done ? 'text-green-700' : 'text-gray-400'}`}>
                      {label}
                    </span>
                    {i < STEP_LABELS.length - 1 && (
                      <div className={`h-0.5 flex-1 rounded transition ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Pages */}
      {step === 0 && (
        <Step0_Welcome onSelect={handleProfileSelect} />
      )}

      {step === 1 && (
        <Step1_SiteConfig
          config={siteConfig}
          nasaLoading={nasaLoading}
          clientProfile={clientProfile}
          onChange={handleConfigChange}
          onNext={() => setStep(2)} />
      )}

      {step === 2 && (
        <Step2_Loads
          appliances={appliances}
          quantities={quantities}
          siteConfig={siteConfig}
          clientProfile={clientProfile}
          onQuantitiesChange={setQuantities}
          onBack={() => setStep(1)}
          onResults={handleCalculate}
          onAddAppliance={addCustomAppliance} />
      )}

      {step === 3 && allResults && (
        <Step3_Results
          allResults={allResults}
          defaultTier={siteConfig.tier}
          siteConfig={siteConfig}
          appliances={appliances}
          quantities={quantities}
          clientProfile={clientProfile}
          inventory={inventory}
          customerUser={customerUser}
          onBack={() => setStep(2)} />
      )}
    </div>
  )
}
