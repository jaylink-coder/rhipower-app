// Site survey / installation visit tracking for one lead — lives inside the
// expanded lead card in AdminLeads.jsx. Deliberately simple: free-text
// "assigned to" rather than real technician accounts, since RhiPower doesn't
// have field staff logins yet (see 004_site_visits.sql for the growth path).
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { logAdminAction } from '../lib/auditLog.js'

const TYPE_LABELS   = { survey: '📐 Site Survey', installation: '👷 Installation' }
const STATUS_STYLES = {
  scheduled: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-gray-100 text-gray-500',
}

function todayISO() { return new Date().toISOString().slice(0, 10) }

const PHOTO_BUCKET = 'site-visit-photos'

function VisitPhotos({ visitId, session }) {
  const [photos,    setPhotos]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase.from('site_visit_photos')
        .select('*').eq('visit_id', visitId).order('created_at', { ascending: true })
      const withUrls = await Promise.all((data || []).map(async p => {
        const { data: signed } = await supabase.storage.from(PHOTO_BUCKET)
          .createSignedUrl(p.storage_path, 3600)
        return { ...p, url: signed?.signedUrl }
      }))
      if (!cancelled) { setPhotos(withUrls); setLoading(false) }
    }
    load()
    return () => { cancelled = true }
  }, [visitId])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    const ext  = file.name.split('.').pop() || 'jpg'
    const path = `${visitId}/${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file)
    if (upErr) { console.error('[RhiPower] photo upload failed:', upErr.message); setUploading(false); return }

    const { data } = await supabase.from('site_visit_photos').insert({
      visit_id: visitId, storage_path: path, uploaded_by: session?.user?.id || null,
    }).select().single()
    if (data) {
      const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, 3600)
      setPhotos(p => [...p, { ...data, url: signed?.signedUrl }])
      logAdminAction(session, 'site_visit_photo_uploaded', visitId, null)
    }
    setUploading(false)
  }

  async function handleDelete(photo) {
    setPhotos(p => p.filter(x => x.id !== photo.id))
    await supabase.storage.from(PHOTO_BUCKET).remove([photo.storage_path])
    await supabase.from('site_visit_photos').delete().eq('id', photo.id)
  }

  if (loading) return <div className="text-[10px] text-gray-300 mt-1">Loading photos…</div>

  return (
    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
      {photos.map(p => (
        <div key={p.id} className="relative group shrink-0">
          <a href={p.url} target="_blank" rel="noreferrer">
            <img src={p.url} alt="Site visit" className="w-12 h-12 object-cover rounded-lg border border-gray-200" />
          </a>
          <button onClick={() => handleDelete(p)}
            className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-4 h-4 text-[9px] leading-4 opacity-0 group-hover:opacity-100 transition">
            ✕
          </button>
        </div>
      ))}
      <label className="w-12 h-12 shrink-0 flex items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 cursor-pointer hover:border-blue-400 hover:text-blue-500 text-[10px] font-bold transition">
        {uploading ? '…' : '📷+'}
        <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
      </label>
    </div>
  )
}

export default function SiteVisitsPanel({ quotationId, session, leadStatus, onLeadStatusChange }) {
  const [visits,   setVisits]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [adding,   setAdding]   = useState(false)
  const [form,     setForm]     = useState({ visit_type: 'survey', scheduled_date: todayISO(), assigned_to: '', notes: '' })
  const [busy,     setBusy]     = useState({})

  useEffect(() => {
    setLoading(true)
    supabase.from('site_visits')
      .select('*').eq('quotation_id', quotationId).order('scheduled_date', { ascending: true })
      .then(({ data }) => { setVisits(data || []); setLoading(false) })
  }, [quotationId])

  async function handleAdd(e) {
    e.preventDefault()
    setBusy(p => ({ ...p, adding: true }))
    const { data, error } = await supabase.from('site_visits').insert({
      quotation_id:   quotationId,
      visit_type:     form.visit_type,
      scheduled_date: form.scheduled_date || null,
      assigned_to:    form.assigned_to.trim() || null,
      notes:          form.notes.trim() || null,
    }).select().single()
    setBusy(p => ({ ...p, adding: false }))
    if (!error && data) {
      setVisits(p => [...p, data])
      setAdding(false)
      setForm({ visit_type: 'survey', scheduled_date: todayISO(), assigned_to: '', notes: '' })
      logAdminAction(session, 'site_visit_scheduled', quotationId, { visit_type: data.visit_type })
    }
  }

  async function markComplete(visit) {
    setBusy(p => ({ ...p, [visit.id]: true }))
    const { error } = await supabase.from('site_visits')
      .update({ status: 'completed', completed_date: todayISO(), updated_at: new Date().toISOString() })
      .eq('id', visit.id)
    setBusy(p => ({ ...p, [visit.id]: false }))
    if (error) return

    setVisits(p => p.map(v => v.id === visit.id ? { ...v, status: 'completed', completed_date: todayISO() } : v))
    logAdminAction(session, 'site_visit_completed', quotationId, { visit_type: visit.visit_type })

    // Completing a visit naturally advances the lead's pipeline stage, unless
    // it's already further along (e.g. don't un-do "installed" back to "site_surveyed")
    const PIPELINE = ['new', 'contacted', 'site_surveyed', 'proposal_accepted', 'installed']
    const target = visit.visit_type === 'survey' ? 'site_surveyed' : 'installed'
    const currentIdx = PIPELINE.indexOf(leadStatus)
    const targetIdx  = PIPELINE.indexOf(target)
    if (targetIdx > currentIdx) {
      await supabase.from('quotation_requests').update({ status: target }).eq('id', quotationId)
      onLeadStatusChange?.(target)
    }
  }

  async function cancelVisit(visit) {
    setBusy(p => ({ ...p, [visit.id]: true }))
    await supabase.from('site_visits').update({ status: 'cancelled' }).eq('id', visit.id)
    setBusy(p => ({ ...p, [visit.id]: false }))
    setVisits(p => p.map(v => v.id === visit.id ? { ...v, status: 'cancelled' } : v))
  }

  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-black text-gray-700 text-sm">📋 Site Visits</h4>
        <button onClick={() => setAdding(a => !a)}
          className="text-xs font-bold text-blue-600 hover:text-blue-800">
          {adding ? '✕ Cancel' : '+ Schedule Visit'}
        </button>
      </div>

      {adding && (
        <form onSubmit={handleAdd} className="bg-gray-50 rounded-lg p-3 mb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select value={form.visit_type} onChange={e => setForm(f => ({ ...f, visit_type: e.target.value }))}
              className="border border-gray-200 rounded-lg p-2 text-xs bg-white">
              <option value="survey">📐 Site Survey</option>
              <option value="installation">👷 Installation</option>
            </select>
            <input type="date" value={form.scheduled_date}
              onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))}
              className="border border-gray-200 rounded-lg p-2 text-xs" />
          </div>
          <input type="text" placeholder="Assigned to (name + phone)" value={form.assigned_to}
            onChange={e => setForm(f => ({ ...f, assigned_to: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg p-2 text-xs" />
          <textarea placeholder="Notes" rows={2} value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg p-2 text-xs resize-none" />
          <button type="submit" disabled={busy.adding}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-lg transition disabled:opacity-50">
            {busy.adding ? 'Saving…' : 'Schedule'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="text-xs text-gray-400 py-2">Loading visits…</div>
      ) : visits.length === 0 ? (
        <div className="text-xs text-gray-400 py-2">No site visits scheduled yet.</div>
      ) : (
        <div className="space-y-2">
          {visits.map(v => (
            <div key={v.id} className="flex items-start justify-between gap-2 text-xs border-b border-gray-50 pb-2 last:border-0">
              <div>
                <div className="font-bold text-gray-700">
                  {TYPE_LABELS[v.visit_type] || v.visit_type}
                  <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${STATUS_STYLES[v.status]}`}>
                    {v.status}
                  </span>
                </div>
                <div className="text-gray-400 mt-0.5">
                  {v.status === 'completed'
                    ? `Completed ${v.completed_date}`
                    : `Scheduled ${v.scheduled_date || '—'}`}
                  {v.assigned_to && ` · ${v.assigned_to}`}
                </div>
                {v.notes && <div className="text-gray-500 mt-0.5 italic">{v.notes}</div>}
                <VisitPhotos visitId={v.id} session={session} />
              </div>
              {v.status === 'scheduled' && (
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => markComplete(v)} disabled={busy[v.id]}
                    className="text-green-700 bg-green-50 hover:bg-green-100 font-bold px-2 py-1 rounded-lg transition disabled:opacity-50">
                    ✓ Done
                  </button>
                  <button onClick={() => cancelVisit(v)} disabled={busy[v.id]}
                    className="text-gray-400 hover:text-gray-600 font-bold px-2 py-1 rounded-lg transition disabled:opacity-50">
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
