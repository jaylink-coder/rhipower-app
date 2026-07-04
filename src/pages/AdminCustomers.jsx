// Admin-side customer directory — lists everyone with a saved account,
// mirroring HustleSasa's admin/users pattern but scaled to what RhiPower
// actually needs (no roles/rosters/watchlists, just accounts + their quotes).
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { logAdminAction } from '../lib/auditLog.js'

export default function AdminCustomers({ session }) {
  const [customers, setCustomers] = useState([])
  const [loading,    setLoading]  = useState(true)
  const [toggling,   setToggling] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: profiles }, { data: quotes }] = await Promise.all([
      supabase.from('customer_profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('quotation_requests').select('user_id, grand_total_kes').not('user_id', 'is', null),
    ])

    const stats = {}
    ;(quotes || []).forEach(q => {
      const s = stats[q.user_id] || { count: 0, total: 0 }
      s.count += 1
      s.total += Number(q.grand_total_kes || 0)
      stats[q.user_id] = s
    })

    setCustomers((profiles || []).map(p => ({ ...p, ...(stats[p.id] || { count: 0, total: 0 }) })))
    setLoading(false)
  }

  async function toggleSuspend(customer) {
    const next = customer.status === 'suspended' ? 'active' : 'suspended'
    setToggling(p => ({ ...p, [customer.id]: true }))
    const { error } = await supabase.from('customer_profiles').update({ status: next }).eq('id', customer.id)
    setToggling(p => ({ ...p, [customer.id]: false }))
    if (!error) {
      setCustomers(p => p.map(c => c.id === customer.id ? { ...c, status: next } : c))
      logAdminAction(session, 'customer_status_change', customer.id, { email: customer.email, status: next })
    }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading customers…</div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl p-4 bg-blue-50 text-blue-800">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">Total Accounts</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{customers.length}</div>
        </div>
        <div className="rounded-2xl p-4 bg-green-50 text-green-800">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">With Saved Quotes</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{customers.filter(c => c.count > 0).length}</div>
        </div>
        <div className="rounded-2xl p-4 bg-red-50 text-red-700">
          <div className="text-xs font-bold uppercase tracking-wider opacity-60">Suspended</div>
          <div className="text-xl font-black font-mono mt-1 tabular-nums">{customers.filter(c => c.status === 'suspended').length}</div>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
          No customer accounts yet — they appear here once someone signs up to save a design.
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                  <th className="px-5 py-2 text-left font-bold">Customer</th>
                  <th className="px-4 py-2 text-left font-bold">Joined</th>
                  <th className="px-4 py-2 text-right font-bold">Quotes</th>
                  <th className="px-4 py-2 text-right font-bold">Total Value</th>
                  <th className="px-4 py-2 text-center font-bold">Status</th>
                  <th className="px-4 py-2 w-28"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customers.map(c => (
                  <tr key={c.id} className={`hover:bg-gray-50 transition ${c.status === 'suspended' ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-gray-800">{c.full_name || 'Unnamed'}</div>
                      <div className="text-xs text-gray-400">{c.email}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(c.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">{c.count}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums">{formatKsh(c.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${c.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {c.status === 'suspended' ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleSuspend(c)} disabled={toggling[c.id]}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition disabled:opacity-50">
                        {toggling[c.id] ? '…' : c.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
