// RhiPower — Reports (Phase 5 / final phase of the ERP build-out).
// Everything here is read-only, computed from data the rest of the app
// already writes — no new write paths, just aggregation. Stock valuation
// uses weighted_avg_cost_kes (migration 019, maintained by PO receiving in
// AdminPurchaseOrders.jsx); gross margin and sales-by-product use
// sales_order_lines.unit_cost_kes, which is already a frozen cost snapshot
// per line; customer balances use the existing invoices table directly.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'

const SECTIONS = [
  { id: 'valuation', label: '📦 Stock Valuation' },
  { id: 'margin',    label: '💹 Gross Margin' },
  { id: 'products',  label: '🏆 Sales by Product' },
  { id: 'balances',  label: '👤 Customer Balances' },
]
const CATEGORY_LABELS = { panel: '☀️ Panels', inverter: '⚡ Inverters', battery: '🔋 Batteries', protection: '🛡️ Protection', cable: '🔌 Cable', mounting: '🔧 Mounting', safety: '⚠️ Safety' }

function StatCard({ label, value, color }) {
  return (
    <div className={`rounded-2xl p-4 ${color}`}>
      <div className="text-xs font-bold uppercase tracking-wider opacity-60">{label}</div>
      <div className="text-xl font-black font-mono mt-1 tabular-nums">{value}</div>
    </div>
  )
}

function StockValuationTab({ items }) {
  const active = items.filter(i => i.is_active !== false && i.stock_qty != null)
  const rows = active.map(i => {
    const cost = i.weighted_avg_cost_kes ?? i.buying_price_kes
    return { ...i, cost, value: (i.stock_qty || 0) * cost, isEstimate: i.weighted_avg_cost_kes == null }
  })
  const totalValue = rows.reduce((s, r) => s + r.value, 0)
  const byCategory = {}
  rows.forEach(r => { byCategory[r.category] = (byCategory[r.category] || 0) + r.value })

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

function CustomerBalancesTab({ invoices }) {
  const byPhone = {}
  invoices.filter(i => i.status !== 'void').forEach(inv => {
    const key = inv.client_phone || inv.client_name
    const r = byPhone[key] = byPhone[key] || { name: inv.client_name, phone: inv.client_phone, total: 0, paid: 0, balance: 0, count: 0 }
    r.total   += Number(inv.total_kes || 0)
    r.paid    += Number(inv.amount_paid_kes || 0)
    r.balance += Number(inv.balance_due_kes || 0)
    r.count   += 1
  })
  const rows = Object.values(byPhone).sort((a, b) => b.balance - a.balance)
  const totalOutstanding = rows.reduce((s, r) => s + r.balance, 0)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard label="Total Outstanding" value={formatKsh(totalOutstanding)} color="bg-red-50 text-red-700" />
        <StatCard label="Customers Invoiced" value={rows.length} color="bg-blue-50 text-blue-800" />
      </div>
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
              <th className="px-5 py-2 text-left font-bold">Customer</th>
              <th className="px-4 py-2 text-right font-bold">Invoices</th>
              <th className="px-4 py-2 text-right font-bold">Total Invoiced</th>
              <th className="px-4 py-2 text-right font-bold">Paid</th>
              <th className="px-4 py-2 text-right font-bold">Balance Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">No invoices yet.</td></tr>
            ) : rows.map(r => (
              <tr key={r.phone} className="hover:bg-gray-50 transition">
                <td className="px-5 py-2.5">
                  <div className="font-semibold text-gray-800">{r.name}</div>
                  <div className="text-xs text-gray-400">{r.phone}</div>
                </td>
                <td className="px-4 py-2.5 text-right font-mono">{r.count}</td>
                <td className="px-4 py-2.5 text-right font-mono">{formatKsh(r.total)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-green-700">{formatKsh(r.paid)}</td>
                <td className={`px-4 py-2.5 text-right font-mono font-bold ${r.balance > 0 ? 'text-red-700' : 'text-gray-400'}`}>{formatKsh(r.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdminReports() {
  const [items,       setItems]       = useState([])
  const [salesOrders,  setSalesOrders] = useState([])
  const [invoices,     setInvoices]    = useState([])
  const [loading,      setLoading]     = useState(true)
  const [activeSection, setActiveSection] = useState('valuation')

  useEffect(() => {
    Promise.all([
      supabase.from('inventory_prices').select('role_key, description, category, stock_qty, weighted_avg_cost_kes, buying_price_kes, is_active'),
      supabase.from('sales_orders').select('*, sales_order_lines(*)'),
      supabase.from('invoices').select('client_name, client_phone, total_kes, amount_paid_kes, balance_due_kes, status'),
    ]).then(([itemsRes, soRes, invRes]) => {
      setItems(itemsRes.data || [])
      setSalesOrders(soRes.data || [])
      setInvoices(invRes.data || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading reports…</div>

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

      {activeSection === 'valuation' && <StockValuationTab items={items} />}
      {activeSection === 'margin'    && <GrossMarginTab salesOrders={salesOrders} />}
      {activeSection === 'products'  && <SalesByProductTab salesOrders={salesOrders} />}
      {activeSection === 'balances'  && <CustomerBalancesTab invoices={invoices} />}
    </div>
  )
}
