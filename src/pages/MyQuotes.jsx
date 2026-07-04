// A signed-in customer's saved designs — RLS (customer_can_read_own_quotes)
// ensures this query only ever returns rows belonging to auth.uid().
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'

const TIER_LABELS = { premium: '⭐ Premium', balanced: '✅ Balanced', budget: '💡 Budget' }

export default function MyQuotes({ user, onBack, onResume }) {
  const [quotes,  setQuotes]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('quotation_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setQuotes(data || []); setLoading(false) })
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
    onBack()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-blue-800 to-indigo-900 text-white px-6 py-4">
        <div className="max-w-3xl mx-auto flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black">👤 My Quotes</h1>
            <p className="text-xs text-blue-200 mt-0.5">{user?.email}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onBack} className="text-xs bg-blue-700/50 hover:bg-blue-700 px-3 py-2 rounded-lg font-semibold transition">← App</button>
            <button onClick={handleSignOut} className="text-xs bg-red-800 hover:bg-red-700 px-3 py-2 rounded-lg font-semibold transition">Sign Out</button>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {loading && <div className="text-center py-16 text-gray-400">Loading your quotes…</div>}

        {!loading && quotes.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-gray-100">
            <div className="text-4xl mb-2">📄</div>
            <p className="text-gray-500 font-semibold">No saved designs yet.</p>
            <p className="text-xs text-gray-400 mt-1">Design a system and it'll show up here once you submit it.</p>
            <button onClick={onBack} className="mt-4 bg-blue-700 hover:bg-blue-800 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition">
              Start Designing
            </button>
          </div>
        )}

        {quotes.map(q => (
          <div key={q.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">
                  {new Date(q.created_at).toLocaleDateString('en-KE', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
                <div className="font-black text-gray-800 mt-0.5">
                  {q.location || 'Site'} — {TIER_LABELS[q.tier_selected] || q.tier_selected}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {q.panel_qty} panels · {q.inverter_qty} inverter(s) · {q.battery_qty} battery pack(s)
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-black font-mono text-gray-800">{formatKsh(q.grand_total_kes || 0)}</div>
                <div className="text-xs text-gray-400 capitalize">{(q.status || 'new').replace(/_/g, ' ')}</div>
              </div>
            </div>
            {q.raw_state && (
              <button onClick={() => onResume(q.raw_state)}
                className="mt-4 w-full bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-bold py-2.5 rounded-xl transition">
                Reopen This Design →
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
