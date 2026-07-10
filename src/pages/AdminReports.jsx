// RhiPower — Reports (Phase 5 / final phase of the ERP build-out).
// Everything here is read-only, computed from data the rest of the app
// already writes — no new write paths, just aggregation. Stock valuation
// uses weighted_avg_cost_kes (migration 019, maintained by PO receiving in
// AdminPurchaseOrders.jsx); gross margin and sales-by-product use
// sales_order_lines.unit_cost_kes, which is already a frozen cost snapshot
// per line; customer balances use the existing invoices table directly.
import { useState, useEffect } from 'react'
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { getAccountBalance, getProfitAndLoss, getVatReport, getMonthlyTrend } from '../lib/ledger.js'

// Investor-facing tabs (plain business language, no accounting jargon) come
// first; the detailed operational reports that already existed follow.
// See MEMORY.md project_rhipower.md — Reports is deliberately kept separate
// from Accounting because it's the view non-accountants (e.g. investors)
// actually read.
const SECTIONS = [
  { id: 'overview',  label: '📊 Overview' },
  { id: 'trend',     label: '📈 Revenue & Profit' },
  { id: 'pipeline',  label: '🎯 Sales Pipeline' },
  { id: 'cash',      label: '💵 Cash Position' },
  { id: 'valuation', label: '📦 Stock Valuation' },
  { id: 'margin',    label: '💹 Gross Margin' },
  { id: 'products',  label: '🏆 Sales by Product' },
  { id: 'balances',  label: '👤 AR Aging' },
]
const LEAD_STATUS_LABELS = { new: 'New', contacted: 'Contacted', site_surveyed: 'Site Surveyed', proposal_accepted: 'Proposal Accepted', installed: 'Installed', lost: 'Lost' }
const LEAD_STATUS_ORDER = ['new', 'contacted', 'site_surveyed', 'proposal_accepted', 'installed', 'lost']
const MONTH_LABEL = m => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-KE', { month: 'short', year: '2-digit' }) }

// Compact axis-tick currency, e.g. "Ksh 1.2M" / "Ksh 450K" — formatKsh's
// full "Ksh 1,234,567" is too wide for a chart axis.
function shortKsh(n) {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `Ksh ${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `Ksh ${(n / 1_000).toFixed(0)}K`
  return `Ksh ${Math.round(n)}`
}
const PIE_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#d97706', '#059669', '#dc2626']
const STAGE_COLORS = { new: '#94a3b8', contacted: '#60a5fa', site_surveyed: '#3b82f6', proposal_accepted: '#2563eb', installed: '#16a34a', lost: '#dc2626' }

const CATEGORY_LABELS = { panel: '☀️ Panels', inverter: '⚡ Inverters', battery: '🔋 Batteries', protection: '🛡️ Protection', cable: '🔌 Cable', mounting: '🔧 Mounting', safety: '⚠️ Safety' }

function StatCard({ label, value, color }) {
  return (
    <div className={`rounded-2xl p-4 ${color}`}>
      <div className="text-xs font-bold uppercase tracking-wider opacity-60">{label}</div>
      <div className="text-xl font-black font-mono mt-1 tabular-nums">{value}</div>
    </div>
  )
}

// Small "▲ 12% vs last month" delta line for a KPI card — trend visibility
// is one of the standard investor-dashboard practices, and this piggybacks
// on the trend data we already fetch rather than a separate query.
function DeltaLabel({ current, previous }) {
  if (previous == null || previous === 0) return null
  const pct = Math.round(((current - previous) / Math.abs(previous)) * 100)
  if (pct === 0) return <span className="text-[11px] text-gray-400">flat vs last month</span>
  const up = pct > 0
  return <span className={`text-[11px] font-bold ${up ? 'text-green-600' : 'text-red-600'}`}>{up ? '▲' : '▼'} {Math.abs(pct)}% vs last month</span>
}

// ── Overview ──────────────────────────────────────────────────────────────────
function OverviewTab({ trend, cash, arBalance, apBalance, items, pipelineValue, installedValue, customerCount }) {
  const thisMonth = trend[trend.length - 1]
  const lastMonth = trend[trend.length - 2]
  const stockValue = items.filter(i => i.is_active !== false && i.stock_qty != null)
    .reduce((s, i) => s + (i.stock_qty || 0) * (i.weighted_avg_cost_kes ?? i.buying_price_kes), 0)
  const cashTotal = (cash.pettyCash || 0) + (cash.bank || 0) + (cash.mpesa || 0)
  const netLiquidPosition = cashTotal + (arBalance || 0) - (apBalance || 0)

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500 max-w-2xl">
        A plain-language snapshot of how the business is doing — no accounting terms, just what's coming in, what's owed, and what's on hand.
      </p>

      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">This Month</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl p-4 bg-blue-50 text-blue-800">
            <div className="text-xs font-bold uppercase tracking-wider opacity-60">Revenue</div>
            <div className="text-xl font-black font-mono mt-1 tabular-nums">{formatKsh(thisMonth?.revenue || 0)}</div>
            {lastMonth && <div className="mt-1"><DeltaLabel current={thisMonth?.revenue || 0} previous={lastMonth.revenue} /></div>}
          </div>
          <div className={`rounded-2xl p-4 ${(thisMonth?.netProfit || 0) >= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>
            <div className="text-xs font-bold uppercase tracking-wider opacity-60">Net Profit</div>
            <div className="text-xl font-black font-mono mt-1 tabular-nums">{formatKsh(thisMonth?.netProfit || 0)}</div>
            {lastMonth && <div className="mt-1"><DeltaLabel current={thisMonth?.netProfit || 0} previous={lastMonth.netProfit} /></div>}
          </div>
          <StatCard label="Gross Margin" value={thisMonth?.revenue ? `${Math.round((thisMonth.grossProfit / thisMonth.revenue) * 100)}%` : '—'} color="bg-purple-50 text-purple-700" />
        </div>
      </div>

      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Right Now</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Cash on Hand" value={formatKsh(cashTotal)} color="bg-blue-50 text-blue-800" />
          <StatCard label="Owed to You" value={formatKsh(arBalance || 0)} color="bg-amber-50 text-amber-800" />
          <StatCard label="You Owe Suppliers" value={formatKsh(apBalance || 0)} color="bg-orange-50 text-orange-800" />
          <StatCard label="Stock on Hand" value={formatKsh(stockValue)} color="bg-gray-50 text-gray-700" />
          <StatCard label="Active Sales Pipeline" value={formatKsh(pipelineValue)} color="bg-indigo-50 text-indigo-800" />
          <StatCard label="Customers" value={customerCount} color="bg-purple-50 text-purple-700" />
        </div>
      </div>

      <div className={`rounded-2xl p-4 border ${netLiquidPosition >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        <div className="text-xs font-bold uppercase tracking-wider opacity-60">Net Liquid Position</div>
        <div className={`text-2xl font-black font-mono mt-1 ${netLiquidPosition >= 0 ? 'text-green-800' : 'text-red-800'}`}>{formatKsh(netLiquidPosition)}</div>
        <div className="text-xs text-gray-500 mt-1">Cash on hand, plus what customers owe you, minus what you owe suppliers — what would be left if every invoice and bill settled today.</div>
      </div>

      <p className="text-xs text-gray-400">Installed (won) business to date: <span className="font-semibold text-gray-600">{formatKsh(installedValue)}</span> across every lead that reached "Installed" status.</p>
    </div>
  )
}

// ── Revenue & Profit Trend ───────────────────────────────────────────────────
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-100 px-3 py-2 text-xs">
      <div className="font-bold text-gray-700 mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2" style={{ color: p.color }}>
          <span className="font-semibold">{p.name}:</span> {formatKsh(p.value)}
        </div>
      ))}
    </div>
  )
}

function RevenueProfitTrendTab({ trend, revenueMix }) {
  const chartData = trend.map(t => ({ ...t, monthLabel: MONTH_LABEL(t.month) }))
  const totalRevenue = revenueMix.reduce((s, r) => s + r.amount, 0)
  const noActivity = trend.every(t => t.revenue === 0 && t.netProfit === 0)
  const pieData = revenueMix.map(r => ({ name: r.account.name, value: r.amount }))

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-400">Last {trend.length} months, from posted revenue and expenses — the same numbers behind the ledger, shown as a trend instead of a single snapshot.</p>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        {noActivity ? (
          <div className="text-center py-16 text-gray-400 text-sm">No activity posted in this window yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="monthLabel" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
              <YAxis tickFormatter={shortKsh} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={70} />
              <Tooltip content={<TrendTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="revenue" name="Revenue" fill="#93c5fd" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey="netProfit" name="Net Profit" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Revenue Mix (same period)</div>
        {pieData.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-5 py-10 text-center text-gray-400 text-sm">No revenue posted yet.</div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 grid sm:grid-cols-2 gap-4 items-center">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => formatKsh(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {pieData.map((r, i) => (
                <div key={r.name} className="flex items-center gap-3 text-sm">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  <span className="text-gray-700 flex-1">{r.name}</span>
                  <span className="font-mono font-semibold">{formatKsh(r.value)}</span>
                  <span className="text-xs text-gray-400 w-10 text-right">{totalRevenue > 0 ? Math.round((r.value / totalRevenue) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sales Pipeline ───────────────────────────────────────────────────────────
function SalesPipelineTab({ leads }) {
  const byStatus = {}
  LEAD_STATUS_ORDER.forEach(s => { byStatus[s] = { count: 0, value: 0 } })
  leads.forEach(l => {
    const s = byStatus[l.status] ? l.status : 'new'
    byStatus[s].count += 1
    byStatus[s].value += Number(l.grand_total_kes || 0)
  })
  const installed = byStatus.installed.count
  const lost = byStatus.lost.count
  const decided = installed + lost
  const winRate = decided > 0 ? Math.round((installed / decided) * 100) : null
  const avgDealSize = installed > 0 ? byStatus.installed.value / installed : 0
  const activePipelineValue = LEAD_STATUS_ORDER.filter(s => !['installed', 'lost'].includes(s)).reduce((s, k) => s + byStatus[k].value, 0)
  const chartData = LEAD_STATUS_ORDER.map(s => ({ stage: LEAD_STATUS_LABELS[s], stageKey: s, count: byStatus[s].count, value: byStatus[s].value }))

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-400">Every lead ever submitted, by where it stands today. "Win Rate" only counts leads that have actually been decided — installed or lost — not ones still in progress.</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Leads" value={leads.length} color="bg-gray-50 text-gray-700" />
        <StatCard label="Win Rate" value={winRate == null ? '—' : `${winRate}%`} color="bg-green-50 text-green-800" />
        <StatCard label="Avg Deal Size" value={formatKsh(avgDealSize)} color="bg-blue-50 text-blue-800" />
        <StatCard label="Active Pipeline" value={formatKsh(activePipelineValue)} color="bg-indigo-50 text-indigo-800" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} tickLine={false} />
            <YAxis type="category" dataKey="stage" tick={{ fontSize: 12, fill: '#334155' }} axisLine={false} tickLine={false} width={110} />
            <Tooltip formatter={(v, name, p) => name === 'count' ? [`${v} leads · ${formatKsh(p.payload.value)}`, 'Leads'] : v} />
            <Bar dataKey="count" name="count" radius={[0, 6, 6, 0]}>
              {chartData.map(d => <Cell key={d.stageKey} fill={STAGE_COLORS[d.stageKey]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="px-5 py-2 text-left font-bold">Stage</th>
              <th className="px-4 py-2 text-right font-bold">Leads</th>
              <th className="px-4 py-2 text-right font-bold">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {LEAD_STATUS_ORDER.map(s => (
              <tr key={s} className="hover:bg-gray-50 transition">
                <td className="px-5 py-2.5 font-semibold text-gray-700">
                  <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: STAGE_COLORS[s] }} />
                  {LEAD_STATUS_LABELS[s]}
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{byStatus[s].count}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatKsh(byStatus[s].value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Cash Position ────────────────────────────────────────────────────────────
function CashPositionTab({ cash, arBalance, apBalance, vat, upcomingPayables, upcomingReceivables }) {
  const cashTotal = (cash.pettyCash || 0) + (cash.bank || 0) + (cash.mpesa || 0)

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Cash by Account</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Petty Cash" value={formatKsh(cash.pettyCash)} color="bg-gray-50 text-gray-700" />
          <StatCard label="Bank Account" value={formatKsh(cash.bank)} color="bg-blue-50 text-blue-800" />
          <StatCard label="M-Pesa Till" value={formatKsh(cash.mpesa)} color="bg-green-50 text-green-800" />
          <StatCard label="Total Cash" value={formatKsh(cashTotal)} color="bg-indigo-50 text-indigo-800" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Owed to You" value={formatKsh(arBalance || 0)} color="bg-amber-50 text-amber-800" />
        <StatCard label="You Owe Suppliers" value={formatKsh(apBalance || 0)} color="bg-orange-50 text-orange-800" />
        <StatCard label={vat.netPayable >= 0 ? 'VAT Owed to KRA (this month)' : 'VAT Receivable (this month)'} value={formatKsh(Math.abs(vat.netPayable))} color={vat.netPayable >= 0 ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Bills Coming Due</div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {upcomingPayables.length === 0 ? (
              <div className="px-5 py-6 text-center text-gray-400 text-sm">Nothing outstanding.</div>
            ) : upcomingPayables.map(b => (
              <div key={b.id} className="flex justify-between px-5 py-2.5 text-sm">
                <div>
                  <div className="font-semibold text-gray-800">{b.supplierName || 'Supplier'}</div>
                  <div className="text-xs text-gray-400">Due {b.due_date ? new Date(b.due_date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }) : '—'}</div>
                </div>
                <div className="font-mono font-bold text-orange-700">{formatKsh(b.balance_due_kes)}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Payments Coming Due</div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-50">
            {upcomingReceivables.length === 0 ? (
              <div className="px-5 py-6 text-center text-gray-400 text-sm">Nothing outstanding.</div>
            ) : upcomingReceivables.map(inv => (
              <div key={inv.id} className="flex justify-between px-5 py-2.5 text-sm">
                <div>
                  <div className="font-semibold text-gray-800">{inv.client_name}</div>
                  <div className="text-xs text-gray-400">Due {inv.due_date ? new Date(inv.due_date).toLocaleDateString('en-KE', { day: '2-digit', month: 'short' }) : '—'}</div>
                </div>
                <div className="font-mono font-bold text-amber-700">{formatKsh(inv.balance_due_kes)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StockValuationTab({ items, glInventoryBalance }) {
  const active = items.filter(i => i.is_active !== false && i.stock_qty != null)
  const rows = active.map(i => {
    const cost = i.weighted_avg_cost_kes ?? i.buying_price_kes
    return { ...i, cost, value: (i.stock_qty || 0) * cost, isEstimate: i.weighted_avg_cost_kes == null }
  })
  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const byCategory = {}
  rows.forEach(r => { byCategory[r.category] = (byCategory[r.category] || 0) + r.value })
  const mismatch = glInventoryBalance != null && Math.round(totalValue) !== Math.round(glInventoryBalance)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Total Stock Value" value={formatKsh(totalValue)} color="bg-blue-50 text-blue-800" />
        <StatCard label="Items Tracked" value={rows.length} color="bg-gray-50 text-gray-700" />
        <StatCard label="Categories" value={Object.keys(byCategory).length} color="bg-purple-50 text-purple-700" />
      </div>
      <p className="text-xs text-gray-400">
        Cost = weighted-average purchase cost from received Purchase Orders. Items marked <span className="text-amber-600 font-semibold">est.</span> have
        never been received against a PO — their current buying price is used as a placeholder instead.
      </p>
      {glInventoryBalance != null && (
        <div className={`text-xs rounded-xl p-3 border ${mismatch ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
          {mismatch
            ? `⚠️ This report's total (${formatKsh(totalValue)}) doesn't match the General Ledger's Inventory Asset balance (${formatKsh(glInventoryBalance)}) — these are computed via two independent code paths (this report from live stock levels, the GL from posted journal entries), so a mismatch is a real signal — most likely the Opening Balances wizard hasn't been run yet, or something bypassed the posting engine. Check Accounting → Journal.`
            : `✓ Matches the General Ledger's Inventory Asset balance (${formatKsh(glInventoryBalance)}).`}
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="px-5 py-2 text-left font-bold">Item</th>
              <th className="px-4 py-2 text-right font-bold">Stock</th>
              <th className="px-4 py-2 text-right font-bold">Unit Cost</th>
              <th className="px-4 py-2 text-right font-bold">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.sort((a, b) => b.value - a.value).map(r => (
              <tr key={r.role_key} className="hover:bg-gray-50 transition">
                <td className="px-5 py-2.5">
                  <div className="font-semibold text-gray-800">{r.description}</div>
                  <div className="text-xs text-gray-400">{CATEGORY_LABELS[r.category] || r.category}</div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{r.stock_qty}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatKsh(r.cost)}{r.isEstimate && <span className="text-amber-600 text-xs ml-1">est.</span>}</td>
                <td className="px-4 py-2.5 text-right font-mono font-bold">{formatKsh(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GrossMarginTab({ salesOrders }) {
  const eligible = salesOrders.filter(so => !['draft', 'cancelled'].includes(so.status))
  const rows = eligible.map(so => {
    const cost = (so.sales_order_lines || [])
      .filter(l => l.is_stock_deducting)
      .reduce((s, l) => s + Number(l.unit_cost_kes || 0) * Number(l.qty || 0), 0)
    const revenue = Number(so.materials_kes || 0)
    const margin = revenue - cost
    return { so, cost, revenue, margin, marginPct: revenue > 0 ? (margin / revenue) * 100 : 0 }
  })
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0)
  const totalCost    = rows.reduce((s, r) => s + r.cost, 0)
  const totalMargin  = totalRevenue - totalCost

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Materials Revenue" value={formatKsh(totalRevenue)} color="bg-blue-50 text-blue-800" />
        <StatCard label="Materials Cost" value={formatKsh(totalCost)} color="bg-gray-50 text-gray-700" />
        <StatCard label="Gross Margin" value={`${formatKsh(totalMargin)} (${totalRevenue > 0 ? Math.round((totalMargin/totalRevenue)*100) : 0}%)`} color={totalMargin >= 0 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'} />
      </div>
      <p className="text-xs text-gray-400">
        Materials only — labour and logistics revenue have no cost-of-goods to compare against, so they're excluded from margin (they show separately on each order).
        Covers Sales Orders from Confirmed onward (drafts and cancelled orders aren't real deals yet).
      </p>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="px-5 py-2 text-left font-bold">Order</th>
              <th className="px-4 py-2 text-right font-bold">Revenue</th>
              <th className="px-4 py-2 text-right font-bold">Cost</th>
              <th className="px-4 py-2 text-right font-bold">Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.sort((a, b) => new Date(b.so.created_at) - new Date(a.so.created_at)).map(r => (
              <tr key={r.so.id} className="hover:bg-gray-50 transition">
                <td className="px-5 py-2.5">
                  <div className="font-semibold text-gray-800">SO-{String(r.so.so_number).padStart(4, '0')} · {r.so.client_name}</div>
                  <div className="text-xs text-gray-400">{r.so.status.replace(/_/g, ' ')}</div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{formatKsh(r.revenue)}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatKsh(r.cost)}</td>
                <td className={`px-4 py-2.5 text-right font-mono font-bold ${r.margin >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatKsh(r.margin)} ({Math.round(r.marginPct)}%)</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SalesByProductTab({ salesOrders }) {
  const eligible = salesOrders.filter(so => !['draft', 'cancelled'].includes(so.status))
  const byRole = {}
  eligible.forEach(so => {
    (so.sales_order_lines || []).filter(l => l.is_stock_deducting && l.role_key).forEach(l => {
      const r = byRole[l.role_key] = byRole[l.role_key] || { description: l.description, qty: 0, cost: 0, orders: new Set() }
      r.qty += Number(l.qty || 0)
      r.cost += Number(l.unit_cost_kes || 0) * Number(l.qty || 0)
      r.orders.add(so.id)
    })
  })
  const rows = Object.entries(byRole).map(([roleKey, r]) => ({ roleKey, ...r, orderCount: r.orders.size }))
    .sort((a, b) => b.qty - a.qty)

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Units moved and their total buying cost, across every non-draft, non-cancelled Sales Order. Per-product revenue isn't shown —
        invoice pricing is apportioned per zone, not per individual BOM line, so a true per-SKU sell price doesn't cleanly exist yet.
      </p>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="px-5 py-2 text-left font-bold">Product</th>
              <th className="px-4 py-2 text-right font-bold">Qty Sold</th>
              <th className="px-4 py-2 text-right font-bold">Orders</th>
              <th className="px-4 py-2 text-right font-bold">Cost Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-10 text-gray-400">No sales recorded yet.</td></tr>
            ) : rows.map(r => (
              <tr key={r.roleKey} className="hover:bg-gray-50 transition">
                <td className="px-5 py-2.5 font-semibold text-gray-800">{r.description}</td>
                <td className="px-4 py-2.5 text-right font-mono">{r.qty}</td>
                <td className="px-4 py-2.5 text-right font-mono">{r.orderCount}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatKsh(r.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// 0-30/31-60/61-90/90+ day buckets from due_date, plus a "Current" bucket
// for balances not yet due — the standard AR aging shape, superseding the
// old flat "Customer Balances" report (same data source, strictly more
// information, so it replaces rather than duplicates).
function agingBucket(dueDate) {
  if (!dueDate) return 'current'
  const days = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000)
  if (days <= 0) return 'current'
  if (days <= 30) return 'b1'
  if (days <= 60) return 'b2'
  if (days <= 90) return 'b3'
  return 'b4'
}
const AGING_BUCKETS = ['current', 'b1', 'b2', 'b3', 'b4']
const AGING_LABELS  = { current: 'Current', b1: '1–30 days', b2: '31–60 days', b3: '61–90 days', b4: '90+ days' }

function CustomerBalancesTab({ invoices, glArBalance }) {
  const byPhone = {}
  invoices.filter(i => i.status !== 'void' && Number(i.balance_due_kes) > 0).forEach(inv => {
    const key = inv.client_phone || inv.client_name
    const r = byPhone[key] = byPhone[key] || { name: inv.client_name, phone: inv.client_phone, buckets: { current: 0, b1: 0, b2: 0, b3: 0, b4: 0 }, total: 0, count: 0 }
    r.buckets[agingBucket(inv.due_date)] += Number(inv.balance_due_kes || 0)
    r.total += Number(inv.balance_due_kes || 0)
    r.count += 1
  })
  const rows = Object.values(byPhone).sort((a, b) => b.total - a.total)
  const totalOutstanding = rows.reduce((s, r) => s + r.total, 0)
  const totals = { current: 0, b1: 0, b2: 0, b3: 0, b4: 0 }
  rows.forEach(r => AGING_BUCKETS.forEach(k => { totals[k] += r.buckets[k] }))
  const mismatch = glArBalance != null && Math.round(totalOutstanding) !== Math.round(glArBalance)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Total Outstanding" value={formatKsh(totalOutstanding)} color="bg-red-50 text-red-700" />
        <StatCard label="Customers with Balance" value={rows.length} color="bg-blue-50 text-blue-800" />
        {glArBalance != null && (
          <StatCard label="GL Accounts Receivable" value={formatKsh(glArBalance)} color={mismatch ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'} />
        )}
      </div>
      {mismatch && (
        <div className="text-xs rounded-xl p-3 border bg-amber-50 border-amber-200 text-amber-800">
          ⚠️ This report's total ({formatKsh(totalOutstanding)}) doesn't match the General Ledger's Accounts Receivable balance ({formatKsh(glArBalance)}) —
          most likely some invoices predate the accounting module (Phase 2) or the Opening Balances wizard hasn't been run yet. Both numbers come from
          independent code paths, so a mismatch is a real signal worth checking in Accounting → Journal.
        </div>
      )}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="px-5 py-2 text-left font-bold">Customer</th>
              {AGING_BUCKETS.map(b => <th key={b} className="px-4 py-2 text-right font-bold whitespace-nowrap">{AGING_LABELS[b]}</th>)}
              <th className="px-4 py-2 text-right font-bold">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 ? (
              <tr><td colSpan={AGING_BUCKETS.length + 2} className="text-center py-10 text-gray-400">No outstanding balances.</td></tr>
            ) : rows.map(r => (
              <tr key={r.phone} className="hover:bg-gray-50 transition">
                <td className="px-5 py-2.5">
                  <div className="font-semibold text-gray-800">{r.name}</div>
                  <div className="text-xs text-gray-400">{r.phone}</div>
                </td>
                {AGING_BUCKETS.map(b => (
                  <td key={b} className={`px-4 py-2.5 text-right font-mono ${b === 'b3' ? 'text-amber-700' : b === 'b4' ? 'font-bold text-red-700' : ''}`}>
                    {r.buckets[b] > 0 ? formatKsh(r.buckets[b]) : '—'}
                  </td>
                ))}
                <td className="px-4 py-2.5 text-right font-mono font-bold">{formatKsh(r.total)}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-800 font-black text-sm">
                <td className="px-5 py-2.5">Total</td>
                {AGING_BUCKETS.map(b => <td key={b} className="px-4 py-2.5 text-right font-mono">{formatKsh(totals[b])}</td>)}
                <td className="px-4 py-2.5 text-right font-mono">{formatKsh(totalOutstanding)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

export default function AdminReports() {
  const [items,       setItems]       = useState([])
  const [salesOrders,  setSalesOrders] = useState([])
  const [invoices,     setInvoices]    = useState([])
  const [leads,        setLeads]       = useState([])
  const [customerCount, setCustomerCount] = useState(0)
  const [vendorBills,  setVendorBills]  = useState([])
  const [supplierNames, setSupplierNames] = useState({})
  const [glInventoryBalance, setGlInventoryBalance] = useState(null)
  const [glArBalance,        setGlArBalance]        = useState(null)
  const [apBalance,          setApBalance]          = useState(null)
  const [cash,          setCash]          = useState({ pettyCash: 0, bank: 0, mpesa: 0 })
  const [trend,         setTrend]         = useState([])
  const [revenueMix,    setRevenueMix]    = useState([])
  const [vat,           setVat]           = useState({ outputVat: 0, inputVat: 0, netPayable: 0 })
  const [loading,       setLoading]       = useState(true)
  const [loadError,     setLoadError]     = useState('')
  const [activeSection, setActiveSection] = useState('overview')

  async function load() {
    setLoading(true); setLoadError('')
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)
    const today = now.toISOString().slice(0, 10)
    const trendStart = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString().slice(0, 10)

    try {
      const [
        itemsRes, soRes, invRes, leadsRes, customersRes, billsRes, suppliersRes,
        invBalance, arBalance, apBal, petty, bank, mpesa,
        periodPL, monthlyTrend, vatReport,
      ] = await Promise.all([
        supabase.from('inventory_prices').select('role_key, description, category, stock_qty, weighted_avg_cost_kes, buying_price_kes, is_active'),
        supabase.from('sales_orders').select('*, sales_order_lines(*)'),
        supabase.from('invoices').select('invoice_number, client_name, client_phone, due_date, total_kes, amount_paid_kes, balance_due_kes, status'),
        supabase.from('quotation_requests').select('status, grand_total_kes, created_at'),
        supabase.from('customer_profiles').select('id, status'),
        supabase.from('vendor_bills').select('id, supplier_id, due_date, status, total_kes, balance_due_kes').neq('status', 'void').gt('balance_due_kes', 0),
        supabase.from('suppliers').select('id, name'),
        // Cross-checks against the GL — computed via a completely independent
        // code path (posted journal entries) from the reports above (live
        // operational tables), so a mismatch is a real, actionable signal.
        // Caught and ignored if the accounting module's tables don't exist
        // yet or a required system account is missing, so these reports keep
        // working exactly as before migrations 021+ are run.
        getAccountBalance('inventory_asset').catch(() => null),
        getAccountBalance('accounts_receivable').catch(() => null),
        getAccountBalance('accounts_payable').catch(() => null),
        getAccountBalance('petty_cash').catch(() => 0),
        getAccountBalance('bank_operating').catch(() => 0),
        getAccountBalance('mpesa_till').catch(() => 0),
        getProfitAndLoss({ from: trendStart, to: today }).catch(() => null),
        getMonthlyTrend({ months: 12 }).catch(() => []),
        getVatReport({ from: monthStart, to: today }).catch(() => ({ outputVat: 0, inputVat: 0, netPayable: 0 })),
      ])
      if (itemsRes.error) throw itemsRes.error
      if (soRes.error) throw soRes.error
      if (invRes.error) throw invRes.error
      if (leadsRes.error) throw leadsRes.error
      if (customersRes.error) throw customersRes.error
      if (billsRes.error) throw billsRes.error
      if (suppliersRes.error) throw suppliersRes.error

      setItems(itemsRes.data || [])
      setSalesOrders(soRes.data || [])
      setInvoices(invRes.data || [])
      setLeads(leadsRes.data || [])
      setCustomerCount((customersRes.data || []).filter(c => c.status !== 'suspended').length)
      setVendorBills(billsRes.data || [])
      const nameMap = {}
      ;(suppliersRes.data || []).forEach(s => { nameMap[s.id] = s.name })
      setSupplierNames(nameMap)
      setGlInventoryBalance(invBalance)
      setGlArBalance(arBalance)
      setApBalance(apBal)
      setCash({ pettyCash: petty || 0, bank: bank || 0, mpesa: mpesa || 0 })
      setRevenueMix(periodPL?.income || [])
      setTrend(monthlyTrend)
      setVat(vatReport)
    } catch (e) {
      setLoadError(e.message || String(e))
    }
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  if (loadError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-sm text-red-800 space-y-2">
        <div className="font-bold">Couldn't load Reports.</div>
        <div className="font-mono text-xs">{loadError}</div>
        <button onClick={load} className="text-xs font-bold text-red-700 hover:text-red-900 underline">Retry</button>
      </div>
    )
  }
  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading reports…</div>

  const pipelineValue  = leads.filter(l => !['lost', 'installed'].includes(l.status)).reduce((s, l) => s + Number(l.grand_total_kes || 0), 0)
  const installedValue = leads.filter(l => l.status === 'installed').reduce((s, l) => s + Number(l.grand_total_kes || 0), 0)

  const upcomingPayables = vendorBills
    .map(b => ({ ...b, supplierName: supplierNames[b.supplier_id] }))
    .sort((a, b) => new Date(a.due_date || '9999-12-31') - new Date(b.due_date || '9999-12-31'))
    .slice(0, 5)
  const upcomingReceivables = invoices
    .filter(i => i.status !== 'void' && Number(i.balance_due_kes) > 0)
    .sort((a, b) => new Date(a.due_date || '9999-12-31') - new Date(b.due_date || '9999-12-31'))
    .slice(0, 5)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition ${activeSection === s.id ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {activeSection === 'overview'  && <OverviewTab trend={trend} cash={cash} arBalance={glArBalance} apBalance={apBalance} items={items} pipelineValue={pipelineValue} installedValue={installedValue} customerCount={customerCount} />}
      {activeSection === 'trend'     && <RevenueProfitTrendTab trend={trend} revenueMix={revenueMix} />}
      {activeSection === 'pipeline'  && <SalesPipelineTab leads={leads} />}
      {activeSection === 'cash'      && <CashPositionTab cash={cash} arBalance={glArBalance} apBalance={apBalance} vat={vat} upcomingPayables={upcomingPayables} upcomingReceivables={upcomingReceivables} />}
      {activeSection === 'valuation' && <StockValuationTab items={items} glInventoryBalance={glInventoryBalance} />}
      {activeSection === 'margin'    && <GrossMarginTab salesOrders={salesOrders} />}
      {activeSection === 'products'  && <SalesByProductTab salesOrders={salesOrders} />}
      {activeSection === 'balances'  && <CustomerBalancesTab invoices={invoices} glArBalance={glArBalance} />}
    </div>
  )
}
