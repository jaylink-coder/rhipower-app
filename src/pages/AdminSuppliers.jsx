// RhiPower — Suppliers directory (Phase 1 of the ERP build-out).
// Replaces the old free-text `supplier` column on inventory_prices with a
// real entity that Purchase Orders reference. Existing supplier names were
// migrated into rows here automatically (see migration 010).
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { logAdminAction } from '../lib/auditLog.js'

function blankForm() {
  return { name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: '', lead_time_days: '', notes: '' }
}

function SupplierForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || blankForm())
  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  return (
    <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Supplier name" value={form.name} onChange={e => set('name', e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input placeholder="Contact person" value={form.contact_person || ''} onChange={e => set('contact_person', e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Phone" value={form.phone || ''} onChange={e => set('phone', e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input placeholder="Email" value={form.email || ''} onChange={e => set('email', e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <input placeholder="Address" value={form.address || ''} onChange={e => set('address', e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Payment terms (e.g. Net 30)" value={form.payment_terms || ''} onChange={e => set('payment_terms', e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input placeholder="Lead time (days)" type="number" value={form.lead_time_days ?? ''} onChange={e => set('lead_time_days', e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>
      <textarea placeholder="Notes (optional)" value={form.notes || ''} rows={2} onChange={e => set('notes', e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm resize-none" />
      <div className="flex gap-2">
        <button onClick={() => onSave(form)} disabled={saving || !form.name?.trim()}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Supplier'}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 font-semibold px-2">Cancel</button>
      </div>
    </div>
  )
}

export default function AdminSuppliers({ session }) {
  const [suppliers, setSuppliers] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [adding,    setAdding]    = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving,    setSaving]    = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('suppliers').select('*').order('name')
    setSuppliers(data || [])
    setLoading(false)
  }

  async function saveNew(form) {
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      contact_person: form.contact_person?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      address: form.address?.trim() || null,
      payment_terms: form.payment_terms?.trim() || null,
      lead_time_days: form.lead_time_days === '' ? null : parseInt(form.lead_time_days, 10),
      notes: form.notes?.trim() || null,
    }
    const { data, error } = await supabase.from('suppliers').insert(payload).select().single()
    setSaving(false)
    if (!error && data) {
      setSuppliers(p => [...p, data].sort((a, b) => a.name.localeCompare(b.name)))
      setAdding(false)
      logAdminAction(session, 'supplier_added', data.id, { name: data.name })
    }
  }

  async function saveEdit(id, form) {
    setSaving(true)
    const payload = {
      name: form.name.trim(),
      contact_person: form.contact_person?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      address: form.address?.trim() || null,
      payment_terms: form.payment_terms?.trim() || null,
      lead_time_days: form.lead_time_days === '' ? null : parseInt(form.lead_time_days, 10),
      notes: form.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('suppliers').update(payload).eq('id', id).select().single()
    setSaving(false)
    if (!error && data) {
      setSuppliers(p => p.map(s => s.id === id ? data : s))
      setEditingId(null)
      logAdminAction(session, 'supplier_updated', id, { name: data.name })
    }
  }

  async function toggleActive(s) {
    const next = !s.is_active
    await supabase.from('suppliers').update({ is_active: next }).eq('id', s.id)
    setSuppliers(p => p.map(x => x.id === s.id ? { ...x, is_active: next } : x))
    logAdminAction(session, 'supplier_status_change', s.id, { is_active: next })
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">Loading suppliers…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Supplier directory used by Purchase Orders — contact info, payment terms, and typical lead time.</p>
        <button onClick={() => setAdding(a => !a)} className="text-xs font-bold text-blue-600 hover:text-blue-800 shrink-0">
          {adding ? '✕ Cancel' : '+ Add Supplier'}
        </button>
      </div>

      {adding && <SupplierForm onSave={saveNew} onCancel={() => setAdding(false)} saving={saving} />}

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase">
                <th className="px-5 py-2 text-left font-bold">Supplier</th>
                <th className="px-4 py-2 text-left font-bold">Contact</th>
                <th className="px-4 py-2 text-left font-bold">Terms</th>
                <th className="px-4 py-2 text-left font-bold">Lead Time</th>
                <th className="px-4 py-2 text-center font-bold">Active</th>
                <th className="px-4 py-2 w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {suppliers.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400">No suppliers yet — add your first one above.</td></tr>
              ) : suppliers.map(s => (
                editingId === s.id ? (
                  <tr key={s.id}><td colSpan={6} className="p-3">
                    <SupplierForm initial={s} onSave={form => saveEdit(s.id, form)} onCancel={() => setEditingId(null)} saving={saving} />
                  </td></tr>
                ) : (
                  <tr key={s.id} className={`hover:bg-gray-50 transition ${!s.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="font-semibold text-gray-800">{s.name}</div>
                      {s.address && <div className="text-xs text-gray-400">{s.address}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {s.contact_person && <div>{s.contact_person}</div>}
                      {s.phone && <div className="text-gray-400">{s.phone}</div>}
                      {s.email && <div className="text-gray-400">{s.email}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{s.payment_terms || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{s.lead_time_days != null ? `${s.lead_time_days} day(s)` : '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleActive(s)}
                        className={`relative inline-flex w-10 h-6 rounded-full transition-colors ${s.is_active ? 'bg-green-500' : 'bg-gray-300'}`}>
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${s.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditingId(s.id)} className="text-xs text-blue-500 hover:text-blue-700 font-semibold">Edit</button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
