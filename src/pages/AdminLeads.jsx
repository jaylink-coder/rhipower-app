import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh } from '../lib/calculator.js'
import { logAdminAction } from '../lib/auditLog.js'
import SiteVisitsPanel from '../components/SiteVisitsPanel.jsx'

const STATUS_OPTIONS = [
  { value: 'new',               label: 'New',               color: 'bg-blue-100   text-blue-800'   },
  { value: 'contacted',         label: 'Contacted',         color: 'bg-yellow-100 text-yellow-800' },
  { value: 'site_surveyed',     label: 'Site Surveyed',     color: 'bg-purple-100 text-purple-800' },
  { value: 'proposal_accepted', label: 'Proposal Accepted', color: 'bg-orange-100 text-orange-800' },
  { value: 'installed',         label: 'Installed',         color: 'bg-green-100  text-green-800'  },
  { value: 'lost',              label: 'Lost',              color: 'bg-gray-100   text-gray-500'   },
]
const STATUS_MAP  = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s]))
const TIER_LABELS = { premium: '⭐ Premium', balanced: '✅ Balanced', budget: '💡 Budget' }
const PATH_LABELS = { buy: '🛒 Supply Only', diy: '🔧 DIY', book: '👷 Full Turnkey' }
const PROF_LABELS = { homeowner: '🏠 Homeowner', diy: '🔌 DIY', professional: '⚡ Engineer', business: '🏢 Business' }

export default function AdminLeads({ session }) {
  const [leads,         setLeads]         = useState([])
  const [deposits,      setDeposits]      = useState({})   // quotation_id -> deposit_transactions row
  const [loading,       setLoading]       = useState(true)
  const [filter,        setFilter]        = useState('all')
  const [expanded,      setExpanded]      = useState(null)
  const [notes,         setNotes]         = useState({})
  const [savingNote,    setSavingNote]    = useState({})
  const [savingStatus,  setSavingStatus]  = useState({})

  useEffect(() => { loadLeads() }, [])

  async function loadLeads() {
    setLoading(true)
    const [{ data }, { data: depositRows }] = await Promise.all([
      supabase.from('quotation_requests').select('*').order('created_at', { ascending: false }),
      supabase.from('deposit_transactions').select('quotation_id, amount_kes, status, mpesa_receipt')
        .not('quotation_id', 'is', null),
    ])
    if (data) {
      setLeads(data)
      const n = {}
      data.forEach(l => { n[l.id] = l.admin_notes || '' })
      setNotes(n)
    }
    if (depositRows) {
      const d = {}
      // Last write wins per quotation — fine since retries just overwrite with the latest status
      depositRows.forEach(r => { d[r.quotation_id] = r })
      setDeposits(d)
    }
    setLoading(false)
  }

  async function updateStatus(id, status) {
    setSavingStatus(p => ({ ...p, [id]: true }))
    await supabase.from('quotation_requests').update({ status }).eq('id', id)
    setLeads(p => p.map(l => l.id === id ? { ...l, status } : l))
    setSavingStatus(p => ({ ...p, [id]: false }))
    logAdminAction(session, 'lead_status_change', id, { status })
  }

  async function saveNote(id) {
    setSavingNote(p => ({ ...p, [id]: true }))
    await supabase.from('quotation_requests').update({ admin_notes: notes[id] }).eq('id', id)
    setSavingNote(p => ({ ...p, [id]: false }))
  }

  const filtered      = filter === 'all' ? leads : leads.filter(l => l.status === filter)
  const pipelineValue = leads.filter(l => !['lost','installed'].includes(l.status))
                             .reduce((s, l) => s + Number(l.grand_total_kes || 0), 0)
  const installedVal  = leads.filter(l => l.status === 'installed')
                             .reduce((s, l) => s + Number(l.grand_total_kes || 0), 0)

  if (loading) return (
    <div className="flex items-center justify-center py-20 text-gray-400">Loading leads…</div>
  )

  return (
    <div className="space-y-5">

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Leads',       value: leads.length,                         c: 'bg-blue-50  text-blue-800'   },
          { label: 'New (Uncontacted)', value: leads.filter(l=>l.status==='new').length, c: 'bg-red-50 text-red-700' },
          { label: 'Active Pipeline',   value: formatKsh(pipelineValue),              c: 'bg-amber-50 text-amber-800'  },
          { label: 'Installed Revenue', value: formatKsh(installedVal),               c: 'bg-green-50 text-green-800'  },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.c}`}>
            <div className="text-xs font-bold uppercase tracking-wider opacity-60">{s.label}</div>
            <div className="text-xl font-black font-mono mt-1 tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter chips + refresh */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { value: 'all', label: `All (${leads.length})` },
          ...STATUS_OPTIONS.map(s => ({ value: s.value, label: `${s.label} (${leads.filter(l=>l.status===s.value).length})` })),
        ].map(f => (
          <button key={f.value} onClick={() => setFilter(f.value)}
            className={`text-xs font-bold px-3 py-1.5 rounded-full transition
              ${filter===f.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.label}
          </button>
        ))}
        <button onClick={loadLeads} className="ml-auto text-xs text-gray-400 hover:text-gray-600 font-semibold">
          ↻ Refresh
        </button>
      </div>

      {/* Leads list */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 bg-white rounded-2xl border border-gray-100">
          No leads in this category yet.
        </div>
      ) : filtered.map(lead => {
        const st     = STATUS_MAP[lead.status] || STATUS_MAP['new']
        const isOpen = expanded === lead.id
        const date   = new Date(lead.created_at).toLocaleDateString('en-KE', { day:'2-digit', month:'short', year:'2-digit' })
        const wa     = (lead.client_phone || '').replace(/\D/g, '')

        return (
          <div key={lead.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

            {/* Summary row — tap to expand */}
            <button onClick={() => setExpanded(isOpen ? null : lead.id)}
              className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
              <div className="flex-1 min-w-0">
                <div className="font-black text-gray-800 truncate">{lead.client_name}</div>
                <div className="text-xs text-gray-400 truncate">
                  {lead.client_phone} · {lead.location || '—'} · {TIER_LABELS[lead.tier_selected] || lead.tier_selected}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-black text-gray-800 font-mono text-sm tabular-nums">{formatKsh(lead.grand_total_kes||0)}</div>
                <div className="text-xs text-gray-400">{date}</div>
              </div>
              <span className="text-gray-300 text-sm ml-1">{isOpen ? '▲' : '▼'}</span>
            </button>

            {/* Expanded detail */}
            {isOpen && (
              <div className="border-t border-gray-100 px-5 py-5 space-y-4 bg-gray-50">

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Client info */}
                  <div className="bg-white rounded-xl p-4 text-sm space-y-1.5">
                    <h4 className="font-black text-gray-700 mb-2">👤 Client Details</h4>
                    {[
                      ['Name',    lead.client_name],
                      ['Phone',   lead.client_phone],
                      ['Email',   lead.client_email  || '—'],
                      ['Address', lead.site_address  || '—'],
                      ['Profile', PROF_LABELS[lead.client_profile] || '—'],
                      ['Path',    PATH_LABELS[lead.path_selected]  || '—'],
                    ].map(([k,v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <span className="text-gray-400 font-semibold shrink-0 text-xs">{k}</span>
                        <span className="text-gray-800 text-right text-xs">{v}</span>
                      </div>
                    ))}
                  </div>

                  {/* System specs */}
                  <div className="bg-white rounded-xl p-4 text-sm space-y-1.5">
                    <h4 className="font-black text-gray-700 mb-2">⚡ System Design</h4>
                    {[
                      ['Location', lead.location || '—'],
                      ['Tier',     TIER_LABELS[lead.tier_selected] || '—'],
                      ['Backup',   `${lead.backup_days || 1} day(s)`],
                      ['Solar',    `${lead.panel_qty} panels · ${lead.true_pv_kw} kWp`],
                      ['Inverter', `${lead.inverter_qty} unit(s) · ${lead.total_inv_kw} kW`],
                      ['Battery',  `${lead.battery_qty} pack(s) · ${lead.true_batt_kwh} kWh`],
                    ].map(([k,v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <span className="text-gray-400 font-semibold shrink-0 text-xs">{k}</span>
                        <span className="text-gray-800 text-right text-xs">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pricing */}
                <div className="bg-gray-900 text-white rounded-xl p-4 font-mono text-sm">
                  <div className="grid grid-cols-3 gap-3 text-center text-xs">
                    {[['Hardware', lead.materials_kes], ['Labour', lead.labor_kes], ['Logistics', lead.logistics_kes]].map(([k,v]) => (
                      <div key={k}>
                        <div className="text-gray-400">{k}</div>
                        <div className="font-bold">{formatKsh(v||0)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-gray-700 mt-3 pt-2 text-center">
                    <span className="text-gray-400 text-xs">TOTAL  </span>
                    <span className="text-emerald-400 font-black text-lg">{formatKsh(lead.grand_total_kes||0)}</span>
                  </div>
                </div>

                {/* Deposit status */}
                {deposits[lead.id] && (
                  <div className={`rounded-xl p-3 text-xs font-semibold flex items-center justify-between
                    ${deposits[lead.id].status === 'completed' ? 'bg-green-50 text-green-800 border border-green-200'
                      : deposits[lead.id].status === 'failed'   ? 'bg-red-50 text-red-800 border border-red-200'
                      : 'bg-amber-50 text-amber-800 border border-amber-200'}`}>
                    <span>
                      {deposits[lead.id].status === 'completed' ? '💰 Deposit paid'
                        : deposits[lead.id].status === 'failed'   ? '⚠️ Deposit attempt failed'
                        : deposits[lead.id].status === 'needs_review' ? '🔎 Deposit needs manual review'
                        : '⏳ Deposit pending'}
                      {' — '}{formatKsh(deposits[lead.id].amount_kes)}
                    </span>
                    {deposits[lead.id].mpesa_receipt && <span className="font-mono">{deposits[lead.id].mpesa_receipt}</span>}
                  </div>
                )}

                <SiteVisitsPanel
                  quotationId={lead.id}
                  session={session}
                  leadStatus={lead.status || 'new'}
                  onLeadStatusChange={newStatus => setLeads(p => p.map(l => l.id === lead.id ? { ...l, status: newStatus } : l))}
                />

                {/* Status + notes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1.5">Update Status</label>
                    <select value={lead.status || 'new'} disabled={savingStatus[lead.id]}
                      onChange={e => updateStatus(lead.id, e.target.value)}
                      className="w-full border border-gray-200 rounded-xl p-2.5 text-sm font-semibold bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                      {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 mb-1.5">Internal Notes</label>
                    <div className="flex gap-2">
                      <textarea value={notes[lead.id]||''} rows={2} placeholder="Notes visible only to you…"
                        onChange={e => setNotes(p => ({ ...p, [lead.id]: e.target.value }))}
                        className="flex-1 border border-gray-200 rounded-xl p-2.5 text-sm resize-none focus:ring-2 focus:ring-blue-500 outline-none" />
                      <button onClick={() => saveNote(lead.id)} disabled={savingNote[lead.id]}
                        className="px-3 bg-gray-800 hover:bg-gray-700 text-white text-xs font-bold rounded-xl transition disabled:opacity-50">
                        {savingNote[lead.id] ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex gap-3 flex-wrap pt-1">
                  <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white shrink-0"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    WhatsApp {lead.client_name?.split(' ')[0]}
                  </a>
                  {lead.client_email && (
                    <a href={`mailto:${lead.client_email}`}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition">
                      ✉️ Email
                    </a>
                  )}
                </div>

              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
