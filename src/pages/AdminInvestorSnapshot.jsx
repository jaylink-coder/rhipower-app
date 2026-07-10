// RhiPower — Investor & Capabilities Snapshot. A presentation-quality page
// for two audiences at once: someone deciding whether to invest (real
// traction numbers, in plain language) and anyone getting a tour of what
// the system actually does (module-by-module). Built from the same
// ledger/report data as Accounting and Reports — no separate numbers to
// keep in sync. See MEMORY.md project_rhipower.md for why Reports/this page
// stay in plain business language rather than accounting terminology.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { getAccountBalance, getMonthlyTrend } from '../lib/ledger.js'
import { FALLBACK as BUSINESS_FALLBACK } from '../lib/orgSettings.js'

const MODULES = [
  { icon: '📋', title: 'Leads & Pipeline', desc: 'Every enquiry tracked from first contact through site survey, proposal, and install — nothing falls through the cracks.' },
  { icon: '📦', title: 'Inventory & Pricing', desc: 'Live buying prices, weighted-average costing, low-stock alerts, and automatic 3-tier (Premium/Balanced/Budget) pricing on every quote.' },
  { icon: '🏭', title: 'Suppliers & Purchasing', desc: 'Purchase orders with partial receiving — stock and cost update automatically the moment goods arrive.' },
  { icon: '📑', title: 'Sales Orders & Invoicing', desc: 'Quote-to-cash in one flow. A confirmed order generates a KRA-compliant VAT invoice automatically.' },
  { icon: '💵', title: 'Payments', desc: 'M-Pesa, bank transfer, and cash payments recorded and reconciled against every invoice.' },
  { icon: '👥', title: 'Customers', desc: 'Full account history, saved designs, and outstanding balances for every customer.' },
  { icon: '📚', title: 'Accounting', desc: 'A real double-entry ledger underneath the whole system — Chart of Accounts, Journal, Trial Balance, Profit & Loss, Balance Sheet, and VAT reporting.' },
  { icon: '🏗️', title: 'Fixed Assets', desc: 'Vehicles and equipment tracked with automatic straight-line depreciation.' },
  { icon: '📊', title: 'Reports', desc: 'Plain-language business performance — revenue trends, sales pipeline, cash position — for anyone who needs the picture without the accounting detail.' },
]

function Stat({ label, value, color }) {
  return (
    <div className={`rounded-2xl p-4 ${color}`}>
      <div className="text-xs font-bold uppercase tracking-wider opacity-60">{label}</div>
      <div className="text-2xl font-black font-mono mt-1 tabular-nums">{value}</div>
    </div>
  )
}

export default function AdminInvestorSnapshot({ business = BUSINESS_FALLBACK }) {
  const [stats, setStats] = useState(null)
  const [loadError, setLoadError] = useState('')

  async function load() {
    setLoadError('')
    try {
      const [
        { data: leadsData, error: leadsErr },
        { data: customersData, error: customersErr },
        petty, bank, mpesa, ar, ap, trend,
      ] = await Promise.all([
        supabase.from('quotation_requests').select('status, grand_total_kes'),
        supabase.from('customer_profiles').select('id, status'),
        getAccountBalance('petty_cash').catch(() => 0),
        getAccountBalance('bank_operating').catch(() => 0),
        getAccountBalance('mpesa_till').catch(() => 0),
        getAccountBalance('accounts_receivable').catch(() => 0),
        getAccountBalance('accounts_payable').catch(() => 0),
        getMonthlyTrend({ months: 12 }).catch(() => []),
      ])
      if (leadsErr) throw leadsErr
      if (customersErr) throw customersErr

      const leads = leadsData || []
      const installed = leads.filter(l => l.status === 'installed')
      const lost = leads.filter(l => l.status === 'lost')
      const decided = installed.length + lost.length

      setStats({
        totalLeads: leads.length,
        installedCount: installed.length,
        installedValue: installed.reduce((s, l) => s + Number(l.grand_total_kes || 0), 0),
        winRate: decided > 0 ? Math.round((installed.length / decided) * 100) : null,
        activeCustomers: (customersData || []).filter(c => c.status !== 'suspended').length,
        cashTotal: (petty || 0) + (bank || 0) + (mpesa || 0),
        arBalance: ar || 0,
        apBalance: ap || 0,
        trailing12moRevenue: trend.reduce((s, t) => s + t.revenue, 0),
        trailing12moProfit: trend.reduce((s, t) => s + t.netProfit, 0),
      })
    } catch (e) {
      setLoadError(e.message || String(e))
    }
  }
  useEffect(() => { load() }, [])

  if (loadError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-sm text-red-800 space-y-2">
        <div className="font-bold">Couldn't load the snapshot.</div>
        <div className="font-mono text-xs">{loadError}</div>
        <button onClick={load} className="text-xs font-bold text-red-700 hover:text-red-900 underline">Retry</button>
      </div>
    )
  }
  if (!stats) return <div className="flex items-center justify-center py-20 text-gray-400">Building snapshot…</div>

  const asOfLabel = new Date().toLocaleDateString('en-KE', { day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex justify-end print:hidden">
        <button onClick={() => window.print()} className="text-xs font-bold bg-gray-800 hover:bg-black text-white px-4 py-2 rounded-lg transition">
          🖨️ Print / Save as PDF
        </button>
      </div>

      {/* HERO */}
      <div className="bg-gradient-to-b from-blue-900 to-blue-950 text-white rounded-3xl px-6 py-12 text-center print:rounded-none">
        <div className="text-5xl mb-3">⚡</div>
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight max-w-2xl mx-auto">{business.businessName}</h1>
        <p className="text-blue-200 mt-3 max-w-xl mx-auto">{business.tagline}</p>
        <p className="text-blue-300 text-xs mt-4">Snapshot as of {asOfLabel}</p>
      </div>

      {/* PROBLEM / SOLUTION */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">The Problem</div>
          <p className="text-sm text-gray-700">Solar quoting in Kenya is slow and manual — engineers size systems on spreadsheets, quotes take days, and there's no system tying the quote through to installed revenue, inventory, or the books.</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">The Solution</div>
          <p className="text-sm text-gray-700">{business.businessName} sizes and prices a system in minutes with real engineering math and live NASA solar data, then carries that same deal all the way through inventory, invoicing, and a real double-entry ledger — one system, not five spreadsheets.</p>
        </div>
      </div>

      {/* TRACTION */}
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Traction</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Leads Captured" value={stats.totalLeads} color="bg-gray-50 text-gray-700" />
          <Stat label="Systems Installed" value={stats.installedCount} color="bg-green-50 text-green-800" />
          <Stat label="Win Rate" value={stats.winRate == null ? '—' : `${stats.winRate}%`} color="bg-blue-50 text-blue-800" />
          <Stat label="Active Customers" value={stats.activeCustomers} color="bg-purple-50 text-purple-700" />
          <Stat label="Installed Business (lifetime)" value={formatKsh(stats.installedValue)} color="bg-indigo-50 text-indigo-800" />
          <Stat label="Revenue (trailing 12mo)" value={formatKsh(stats.trailing12moRevenue)} color="bg-blue-50 text-blue-800" />
          <Stat label="Net Profit (trailing 12mo)" value={formatKsh(stats.trailing12moProfit)} color={stats.trailing12moProfit >= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'} />
          <Stat label="Cash on Hand" value={formatKsh(stats.cashTotal)} color="bg-amber-50 text-amber-800" />
        </div>
        <p className="text-xs text-gray-400 mt-2">Owed to the business: {formatKsh(stats.arBalance)} · Owed by the business: {formatKsh(stats.apBalance)}. Figures are live, pulled straight from the same ledger used to run the business day to day — not a separate deck.</p>
      </div>

      {/* CAPABILITY TOUR */}
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">What The System Does</div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {MODULES.map(m => (
            <div key={m.title} className="bg-white rounded-2xl border border-gray-100 p-5">
              <div className="text-2xl mb-2">{m.icon}</div>
              <div className="font-black text-gray-800 text-sm">{m.title}</div>
              <div className="text-xs text-gray-500 mt-1">{m.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* TECH FOOTER */}
      <div className="bg-gray-900 text-white rounded-2xl px-6 py-6 text-center print:rounded-none">
        <p className="font-black text-sm mb-1">Built on real engineering, real accounting</p>
        <p className="text-gray-400 text-xs max-w-xl mx-auto">
          React · Supabase (PostgreSQL) · NASA POWER satellite solar data · KRA-compliant VAT handling ·
          a genuine double-entry ledger under every transaction — designed and built by an electrical engineer, not assembled from a generic template.
        </p>
      </div>
    </div>
  )
}
