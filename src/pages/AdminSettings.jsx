// RhiPower — Settings. Everything that used to be hardcoded in src/config.js
// (business info), src/lib/invoices.js (16% VAT, 14-day terms), and six
// duplicated numbering formatters now lives in the org_settings table,
// edited here. See migration 016 for the full column list.
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { fetchOrgSettings, updateOrgSettings } from '../lib/orgSettings.js'
import { logAdminAction } from '../lib/auditLog.js'

const SECTIONS = [
  { id: 'org',      label: '🏢 Organization & Branding' },
  { id: 'vat',      label: '💰 VAT & Numbering' },
  { id: 'users',    label: '👥 Users' },
  { id: 'payments', label: '📱 Online Payments' },
  { id: 'portal',   label: '🌐 Customer Portal' },
  { id: 'data',     label: '📤 Data Management' },
]

function SaveBar({ onSave, saving, saved }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onSave} disabled={saving}
        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
      {saved && <span className="text-sm text-green-600 font-bold">✓ Saved</span>}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm'

function OrgBrandingSection({ settings, onSave }) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setForm(settings) }, [settings])

  async function save() {
    setSaving(true); setSaved(false)
    await onSave({
      businessName: form.businessName, whatsapp: form.whatsapp, email: form.email,
      city: form.city, tagline: form.tagline, kraPin: form.kraPin, invoiceNotesDefault: form.invoiceNotesDefault,
    })
    setSaving(false); setSaved(true)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Business Name"><input className={inputCls} value={form.businessName} onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))} /></Field>
        <Field label="WhatsApp Number"><input className={inputCls} value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} /></Field>
        <Field label="Email"><input className={inputCls} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></Field>
        <Field label="City"><input className={inputCls} value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></Field>
      </div>
      <Field label="Tagline"><input className={inputCls} value={form.tagline} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} /></Field>
      <Field label="KRA PIN (blank omits the line on invoice PDFs)"><input className={inputCls} value={form.kraPin} onChange={e => setForm(f => ({ ...f, kraPin: e.target.value }))} /></Field>
      <Field label="Default Invoice Footer Note (optional)">
        <textarea className={inputCls} rows={2} value={form.invoiceNotesDefault} onChange={e => setForm(f => ({ ...f, invoiceNotesDefault: e.target.value }))} />
      </Field>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  )
}

function VatNumberingSection({ settings, onSave }) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setForm(settings) }, [settings])

  async function save() {
    setSaving(true); setSaved(false)
    await onSave({
      vatRatePct: parseFloat(form.vatRatePct) || 0,
      vatPricingMode: form.vatPricingMode,
      invoiceDueDays: parseInt(form.invoiceDueDays, 10) || 0,
      invoicePrefix: form.invoicePrefix, poPrefix: form.poPrefix, soPrefix: form.soPrefix,
    })
    setSaving(false); setSaved(true)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-800">
        Per-item VAT status (Standard-rated / Zero-rated / Exempt) is set on each product in Inventory &amp; Prices,
        not here — these settings control the org-wide rate and whether your prices already include tax.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Standard VAT Rate (%)"><input type="number" className={inputCls} value={form.vatRatePct} onChange={e => setForm(f => ({ ...f, vatRatePct: e.target.value }))} /></Field>
        <Field label="Invoice Due Term (days)"><input type="number" className={inputCls} value={form.invoiceDueDays} onChange={e => setForm(f => ({ ...f, invoiceDueDays: e.target.value }))} /></Field>
      </div>
      <Field label="Pricing Mode">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {[['inclusive', 'VAT Inclusive'], ['exclusive', 'VAT Exclusive']].map(([v, label]) => (
            <button key={v} onClick={() => setForm(f => ({ ...f, vatPricingMode: v }))}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition ${form.vatPricingMode === v ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {form.vatPricingMode === 'exclusive'
            ? 'Prices entered are treated as pre-tax — VAT is added on top at invoicing.'
            : 'Prices entered already include VAT (today\'s behaviour) — VAT is broken out of the total at invoicing, the total itself doesn\'t change.'}
        </p>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Invoice Prefix"><input className={inputCls} value={form.invoicePrefix} onChange={e => setForm(f => ({ ...f, invoicePrefix: e.target.value }))} /></Field>
        <Field label="Purchase Order Prefix"><input className={inputCls} value={form.poPrefix} onChange={e => setForm(f => ({ ...f, poPrefix: e.target.value }))} /></Field>
        <Field label="Sales Order Prefix"><input className={inputCls} value={form.soPrefix} onChange={e => setForm(f => ({ ...f, soPrefix: e.target.value }))} /></Field>
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  )
}

function UsersSection({ session }) {
  const [admins,  setAdmins]  = useState([])
  const [loading, setLoading] = useState(true)
  const [email,    setEmail]    = useState('')
  const [fullName, setFullName] = useState('')
  const [role,     setRole]     = useState('admin')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState(null)
  const [removing, setRemoving] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('admin_profiles').select('*').order('created_at')
    setAdmins(data || [])
    setLoading(false)
  }

  async function invite() {
    if (!email.trim()) return
    setInviting(true); setInviteMsg(null)
    const { data, error } = await supabase.functions.invoke('invite-admin', {
      body: { email: email.trim(), fullName: fullName.trim(), role },
    })
    setInviting(false)
    if (error || data?.error) {
      setInviteMsg({ ok: false, text: data?.error || error.message || 'Invite failed.' })
    } else {
      setInviteMsg({ ok: true, text: data.message })
      setEmail(''); setFullName(''); setRole('admin')
      load()
    }
  }

  async function remove(admin) {
    setRemoving(p => ({ ...p, [admin.id]: true }))
    const { error } = await supabase.from('admin_profiles').delete().eq('id', admin.id)
    setRemoving(p => ({ ...p, [admin.id]: false }))
    if (!error) {
      setAdmins(p => p.filter(a => a.id !== admin.id))
      logAdminAction(session, 'admin_removed', admin.id, { email: admin.email })
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
        <div className="text-xs font-black text-blue-900">Invite a New Admin</div>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} />
          <input placeholder="Full name (optional)" className={inputCls} value={fullName} onChange={e => setFullName(e.target.value)} />
        </div>
        <select value={role} onChange={e => setRole(e.target.value)} className={`${inputCls} bg-white w-40`}>
          <option value="admin">Admin</option>
          <option value="technician">Technician</option>
        </select>
        {inviteMsg && <div className={`text-xs font-semibold ${inviteMsg.ok ? 'text-green-700' : 'text-red-700'}`}>{inviteMsg.text}</div>}
        <button onClick={invite} disabled={inviting || !email.trim()}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
          {inviting ? 'Sending…' : 'Send Invite'}
        </button>
        <p className="text-xs text-blue-600">Sends a Supabase Auth invite email — the new admin sets their own password from that email.</p>
      </div>

      {loading ? <div className="text-gray-400 text-sm">Loading admins…</div> : (
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {admins.map(a => (
            <div key={a.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-semibold text-gray-800 text-sm">{a.full_name || a.email || 'Unnamed'}</div>
                <div className="text-xs text-gray-400">{a.email} · {a.role || 'admin'}</div>
              </div>
              {a.id !== session?.user?.id ? (
                <button onClick={() => remove(a)} disabled={removing[a.id]}
                  className="text-xs font-bold text-red-600 hover:text-red-800 px-2 py-1">
                  {removing[a.id] ? '…' : 'Remove'}
                </button>
              ) : (
                <span className="text-xs text-gray-300 italic">You</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OnlinePaymentsSection({ settings, onSave }) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setForm(settings) }, [settings])

  async function save() {
    setSaving(true); setSaved(false)
    await onSave({ mpesaTillDisplay: form.mpesaTillDisplay })
    setSaving(false); setSaved(true)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <Field label="M-Pesa Till / Paybill (shown to customers)">
        <input className={inputCls} value={form.mpesaTillDisplay} onChange={e => setForm(f => ({ ...f, mpesaTillDisplay: e.target.value }))} placeholder="e.g. Till 123456" />
      </Field>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
        This is display-only — it doesn't affect payment collection. The actual M-Pesa STK push credentials
        (Daraja shortcode, passkey, consumer key/secret) are Supabase Edge Function secrets, set via
        <code className="mx-1 bg-white px-1 rounded">supabase secrets set</code>
        by whoever has CLI access — keeping real payment credentials out of a client-editable database row.
        See <code className="bg-white px-1 rounded">supabase/functions/README.md</code>.
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  )
}

function CustomerPortalSection({ settings, onSave }) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setForm(settings) }, [settings])

  async function save() {
    setSaving(true); setSaved(false)
    await onSave({ allowCustomerSignup: form.allowCustomerSignup })
    setSaving(false); setSaved(true)
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center justify-between bg-white border border-gray-100 rounded-xl p-4">
        <div>
          <div className="font-semibold text-gray-800 text-sm">Allow new customer sign-ups</div>
          <div className="text-xs text-gray-400">Turning this off hides self-registration — existing accounts still work.</div>
        </div>
        <button onClick={() => setForm(f => ({ ...f, allowCustomerSignup: !f.allowCustomerSignup }))}
          className={`relative inline-flex w-12 h-7 rounded-full transition-colors shrink-0 ${form.allowCustomerSignup ? 'bg-green-500' : 'bg-gray-300'}`}>
          <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${form.allowCustomerSignup ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>
      <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-xs text-green-800">
        Also fixed while building this: the Suspend/Reactivate toggle in Customers previously had no database
        permission to actually take effect — it now works.
      </div>
      <SaveBar onSave={save} saving={saving} saved={saved} />
    </div>
  )
}

const EXPORT_TABLES = [
  { table: 'quotation_requests', label: 'Leads & Quotes' },
  { table: 'inventory_prices',   label: 'Inventory' },
  { table: 'suppliers',          label: 'Suppliers' },
  { table: 'purchase_orders',    label: 'Purchase Orders' },
  { table: 'sales_orders',       label: 'Sales Orders' },
  { table: 'invoices',           label: 'Invoices' },
  { table: 'customer_profiles',  label: 'Customers' },
]

function toCSV(rows) {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const escape = v => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n')
}

function DataManagementSection() {
  const [exporting, setExporting] = useState({})

  async function exportTable(table, label) {
    setExporting(p => ({ ...p, [table]: true }))
    const { data } = await supabase.from(table).select('*')
    setExporting(p => ({ ...p, [table]: false }))
    if (!data?.length) { alert(`No rows in ${label} to export.`); return }
    const blob = new Blob([toCSV(data)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `rhipower-${table}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3 max-w-xl">
      <p className="text-sm text-gray-500">Export any table as CSV — a full snapshot for backup or spreadsheet analysis.</p>
      <div className="grid grid-cols-2 gap-2">
        {EXPORT_TABLES.map(t => (
          <button key={t.table} onClick={() => exportTable(t.table, t.label)} disabled={exporting[t.table]}
            className="text-left bg-white border border-gray-100 hover:bg-gray-50 rounded-xl p-3 text-sm font-bold text-gray-700 transition disabled:opacity-50">
            {exporting[t.table] ? 'Exporting…' : `⬇ ${t.label}`}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function AdminSettings({ session, onSettingsChanged }) {
  const [settings, setSettings] = useState(null)
  const [activeSection, setActiveSection] = useState('org')

  useEffect(() => { fetchOrgSettings().then(setSettings) }, [])

  async function handleSave(patch) {
    const updated = await updateOrgSettings(patch, session)
    setSettings(updated)
    onSettingsChanged?.(updated)
  }

  if (!settings) return <div className="flex items-center justify-center py-20 text-gray-400">Loading settings…</div>

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

      {activeSection === 'org'      && <OrgBrandingSection settings={settings} onSave={handleSave} />}
      {activeSection === 'vat'      && <VatNumberingSection settings={settings} onSave={handleSave} />}
      {activeSection === 'users'    && <UsersSection session={session} />}
      {activeSection === 'payments' && <OnlinePaymentsSection settings={settings} onSave={handleSave} />}
      {activeSection === 'portal'   && <CustomerPortalSection settings={settings} onSave={handleSave} />}
      {activeSection === 'data'     && <DataManagementSection />}
    </div>
  )
}
