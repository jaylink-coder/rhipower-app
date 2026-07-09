// Admin Command Centre — the actual landing page when an admin logs in,
// rather than dropping straight into Leads & Pipeline with no overview.
// Pulls together stats already computed elsewhere in the app (leads,
// pipeline value, low stock, customers) plus the audit log as a live
// activity feed, so "what's going on right now" is answerable in one glance.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'

const ACTION_LABELS = {
  price_update:          p => `Updated price on ${p.target}`,
  stock_toggle:          p => `Toggled stock status on ${p.target}`,
  stock_level_update:    p => `Updated stock/specs on ${p.target}`,
  product_added:         p => `Added new product "${p.details?.sku || p.target}"`,
  item_reactivated:      p => `Marked ${p.target} active`,
  item_marked_inactive:  p => `Marked ${p.target} inactive`,
  item_deleted:          p => `Deleted product ${p.target}`,
  price_band_update:     p => `Edited a price band (${p.target})`,
  serial_added:          p => `Added serial number to ${p.target}`,
  serial_status_update:  p => `Updated a serial's status on ${p.target}`,
  lead_status_change:    p => `Changed lead status (${p.target})`,
  site_visit_scheduled:  p => `Scheduled a site visit (${p.target})`,
  site_visit_completed:  p => `Completed a site visit (${p.target})`,
  customer_suspended:    p => `Suspended customer ${p.target}`,
  customer_reactivated:  p => `Reactivated customer ${p.target}`,
  supplier_added:        p => `Added supplier "${p.details?.name || p.target}"`,
  supplier_updated:      p => `Updated supplier ${p.target}`,
  supplier_status_change:p => `Changed supplier status (${p.target})`,
  po_created:            p => `Created a purchase order (${p.target})`,
  po_status_change:      p => `Updated a purchase order's status (${p.target})`,
  po_line_received:      p => `Received stock against a purchase order (${p.target})`,
  sales_order_created:   p => `Converted a quote to a sales order (${p.target})`,
  sales_order_confirmed: p => `Confirmed a sales order — stock reserved (${p.target})`,
  sales_order_cancelled: p => `Cancelled a sales order (${p.target})`,
  sales_order_line_fulfilled: p => `Fulfilled a sales order line (${p.target})`,
  invoice_generated:     p => `Generated an invoice (${p.target})`,
  invoice_sent:          p => `Marked an invoice as sent (${p.target})`,
  invoice_voided:        p => `Voided an invoice (${p.target})`,
  payment_recorded:      p => `Recorded a payment (${p.target})`,
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function AdminHome({ session, onNavigate }) {
  const [stats,    setStats]    = useState(null)
  const [activity, setActivity] = useState(null)
  const [lowStock, setLowStock] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('quotation_requests').select('status, grand_total_kes'),
      supabase.from('customer_profiles').select('id', { count: 'exact', head: true }),
      supabase.from('inventory_prices').select('role_key, description, stock_qty, reorder_point, is_active'),
      supabase.from('admin_audit_log').select('*').order('created_at', { ascending: false }).limit(15),
      supabase.from('purchase_orders').select('status'),
      supabase.from('sales_orders').select('status'),
      supabase.from('invoices').select('status, balance_due_kes'),
    ]).then(([leadsRes, custRes, invRes, logRes, poRes, soRes, invoicesRes]) => {
      const leads = leadsRes.data || []
      const totalLeads   = leads.length
      const newLeads     = leads.filter(l => (l.status || 'new') === 'new').length
      const pipelineVal  = leads.filter(l => !['installed', 'lost'].includes(l.status)).reduce((s, l) => s + Number(l.grand_total_kes || 0), 0)
      const installedRev = leads.filter(l => l.status === 'installed').reduce((s, l) => s + Number(l.grand_total_kes || 0), 0)

      const products = (invRes.data || []).filter(r => r.is_active !== false)
      const low = products.filter(r => r.stock_qty != null && r.reorder_point != null && r.stock_qty <= r.reorder_point)

      const openPOs = (poRes.data || []).filter(p => ['draft', 'ordered', 'partially_received'].includes(p.status)).length
      const openSOs = (soRes.data || []).filter(s => ['draft', 'confirmed', 'partially_fulfilled'].includes(s.status)).length
      const unpaidInvoices = (invoicesRes.data || []).filter(i => ['sent', 'partially_paid', 'overdue'].includes(i.status))
      const unpaidTotal = unpaidInvoices.reduce((s, i) => s + Number(i.balance_due_kes || 0), 0)

      setStats({
        totalLeads, newLeads, pipelineVal, installedRev,
        totalCustomers: custRes.count || 0,
        totalProducts: products.length,
        openPOs, openSOs,
        unpaidInvoiceCount: unpaidInvoices.length, unpaidTotal,
      })
      setLowStock(low)
      setActivity(logRes.data || [])
      setLoading(false)
    })
  }, [])

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading command centre…</div>

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  const CARDS = [
    { label: 'New Leads',        val: stats.newLeads,               sub: `${stats.totalLeads} total`,          color: 'bg-red-50 text-red-700 border-red-200',       nav: 'leads' },
    { label: 'Active Pipeline',  val: formatKsh(stats.pipelineVal),  sub: 'not yet installed/lost',             color: 'bg-amber-50 text-amber-700 border-amber-200', nav: 'leads' },
    { label: 'Installed Revenue',val: formatKsh(stats.installedRev), sub: 'completed jobs',                     color: 'bg-emerald-50 text-emerald-700 border-emerald-200', nav: 'leads' },
    { label: 'Customers',       val: stats.totalCustomers,          sub: 'registered accounts',                color: 'bg-blue-50 text-blue-700 border-blue-200',    nav: 'customers' },
    { label: 'Active Products', val: stats.totalProducts,           sub: 'panels/inverters/batteries',         color: 'bg-purple-50 text-purple-700 border-purple-200', nav: 'inventory' },
    { label: 'Low Stock Alerts',val: lowStock.length,                sub: lowStock.length ? 'needs reordering' : 'all good', color: lowStock.length ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-500 border-gray-200', nav: 'inventory' },
    { label: 'Open POs',        val: stats.openPOs,                  sub: 'purchase orders in progress',        color: 'bg-cyan-50 text-cyan-700 border-cyan-200',      nav: 'purchasing' },
    { label: 'Open Sales Orders', val: stats.openSOs,                sub: 'awaiting fulfillment',                color: 'bg-indigo-50 text-indigo-700 border-indigo-200', nav: 'salesorders' },
    { label: 'Unpaid Invoices', val: stats.unpaidInvoiceCount,        sub: formatKsh(stats.unpaidTotal || 0),     color: 'bg-pink-50 text-pink-700 border-pink-200',      nav: 'invoices' },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black text-gray-800">{greeting}, {session?.user?.email?.split('@')[0]}</h2>
        <p className="text-sm text-gray-400">{new Date().toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {CARDS.map(c => (
          <button key={c.label} onClick={() => onNavigate(c.nav)}
            className={`text-left border-2 rounded-2xl p-4 hover:shadow-md transition ${c.color}`}>
            <div className="text-xs font-bold uppercase tracking-wider opacity-70">{c.label}</div>
            <div className="text-2xl font-black mt-1 tabular-nums">{c.val}</div>
            <div className="text-xs opacity-60 mt-0.5">{c.sub}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Alerts + quick actions */}
        <div className="space-y-4">
          {lowStock.length > 0 && (
            <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
              <h3 className="font-black text-red-800 text-sm mb-2">⚠️ Reorder Soon</h3>
              <ul className="space-y-1 text-sm text-red-700">
                {lowStock.map(p => (
                  <li key={p.role_key} className="flex justify-between">
                    <span>{p.description}</span>
                    <span className="font-bold">{p.stock_qty} left</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-white border-2 border-gray-100 rounded-2xl p-4">
            <h3 className="font-black text-gray-700 text-sm mb-3">Quick Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onNavigate('leads')} className="text-left bg-gray-50 hover:bg-gray-100 rounded-xl p-3 text-sm font-bold text-gray-700 transition">📋 View Leads</button>
              <button onClick={() => onNavigate('inventory')} className="text-left bg-gray-50 hover:bg-gray-100 rounded-xl p-3 text-sm font-bold text-gray-700 transition">📦 Manage Inventory</button>
              <button onClick={() => onNavigate('purchasing')} className="text-left bg-gray-50 hover:bg-gray-100 rounded-xl p-3 text-sm font-bold text-gray-700 transition">🧾 Purchase Orders</button>
              <button onClick={() => onNavigate('salesorders')} className="text-left bg-gray-50 hover:bg-gray-100 rounded-xl p-3 text-sm font-bold text-gray-700 transition">📑 Sales Orders</button>
              <button onClick={() => onNavigate('invoices')} className="text-left bg-gray-50 hover:bg-gray-100 rounded-xl p-3 text-sm font-bold text-gray-700 transition">💵 Invoices</button>
              <button onClick={() => onNavigate('reports')} className="text-left bg-gray-50 hover:bg-gray-100 rounded-xl p-3 text-sm font-bold text-gray-700 transition">📊 Reports</button>
              <button onClick={() => onNavigate('customers')} className="text-left bg-gray-50 hover:bg-gray-100 rounded-xl p-3 text-sm font-bold text-gray-700 transition">👥 View Customers</button>
              <a href="https://supabase.com/dashboard/project/qsuisdtnzrxrdqcqbvem" target="_blank" rel="noreferrer"
                className="text-left bg-gray-50 hover:bg-gray-100 rounded-xl p-3 text-sm font-bold text-gray-700 transition">🗄️ Open Supabase</a>
            </div>
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-white border-2 border-gray-100 rounded-2xl p-4">
          <h3 className="font-black text-gray-700 text-sm mb-3">Recent Activity</h3>
          {!activity?.length ? (
            <div className="text-xs text-gray-400 italic">No admin actions logged yet.</div>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto">
              {activity.map(a => (
                <div key={a.id} className="text-xs border-b border-gray-50 pb-2 last:border-0">
                  <div className="text-gray-700">{(ACTION_LABELS[a.action] || (p => `${p.action} — ${p.target || ''}`))(a)}</div>
                  <div className="text-gray-400 mt-0.5">{a.admin_email || 'system'} · {timeAgo(a.created_at)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
