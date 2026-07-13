// The single Add/Edit entry point for panel/inverter/battery (and Zone/BOM)
// inventory items — see Admin.jsx's InventoryTable for why this is the ONLY
// edit surface in the app (no inline table editors, no modal edit mode).
// Rewritten in TypeScript + Zod (see itemSpecSchema.ts) as RhiPower's first
// TS file: Zod catches bad data (negative price, efficiency over 100%, wrong
// enum) before it reaches Supabase, which matters more here than almost
// anywhere else in the app since there's no human code reviewer checking
// each admin submission by hand.
import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { supabase } from '../lib/supabase.js'
import { formatKsh, sellPrice, DEFAULT_MARGIN_PCT } from '../lib/calculator.js'
import { logAdminAction } from '../lib/auditLog.js'
import { logStockMovement } from '../lib/inventory.js'
import {
  ItemSpecSchema, flatRowToSpec, specToFlatRow,
  CELL_TYPE_LABELS, INVERTER_TYPE_LABELS, CHEMISTRY_TYPE_LABELS,
  type ItemSpec, type VatStatus,
} from '../lib/itemSpecSchema.ts'

const VAT_STATUS_OPTIONS: { value: VatStatus; label: string }[] = [
  { value: 'standard', label: 'Standard-rated' },
  { value: 'zero_rated', label: 'Zero-rated' },
  { value: 'exempt', label: 'Exempt' },
]

// Mirrors Admin.jsx's CATEGORY_META (kept separate — that copy stays JS and
// only drives the inventory table's own summary string).
const CATEGORY_META: Record<string, { capacityLabel: string; capacityUnit: string }> = {
  panel: { capacityLabel: 'Watts', capacityUnit: 'W' },
  inverter: { capacityLabel: 'Capacity', capacityUnit: 'kW' },
  battery: { capacityLabel: 'Capacity', capacityUnit: 'kWh' },
}

const PHASE_OPTIONS: { value: string; label: string }[] = [
  { value: 'single', label: 'Single-phase' },
  { value: 'three', label: 'Three-phase' },
]
const CELL_TYPE_OPTIONS = Object.entries(CELL_TYPE_LABELS).map(([value, label]) => ({ value, label }))
const INVERTER_TYPE_OPTIONS = Object.entries(INVERTER_TYPE_LABELS).map(([value, label]) => ({ value, label }))
const CHEMISTRY_TYPE_OPTIONS = Object.entries(CHEMISTRY_TYPE_LABELS).map(([value, label]) => ({ value, label }))

interface DimensionsForm { lengthMm: string; widthMm: string; thicknessMm: string }
interface ElectricalForm { nominalVoltageV: string; maxCurrentAmps: string }
interface EnvironmentalForm { operatingTempMinC: string; operatingTempMaxC: string; ipRating: string }
interface PanelForm { efficiencyPct: string; warrantyYears: string; degradationPctYr: string; cellType: string; tempCoefficientPctC: string; vocV: string }
interface InverterForm { efficiencyPct: string; warrantyYears: string; mpptCount: string; phase: string; inverterType: string; continuousPowerW: string; surgePowerW: string; commProtocols: string; mpptMinVoltageV: string; mpptMaxVoltageV: string; maxInputVoltageV: string }
interface BatteryForm { cycleLife: string; dodPct: string; warrantyYears: string; chemistryType: string; maxChargeRateC: string }

interface FormState {
  sku: string
  description: string
  buyingPriceKes: string
  marginPct: string
  wholesalePriceKes: string
  wholesaleMinQty: string
  capacity: string
  unitWeightKg: string
  vatStatus: VatStatus
  dimensions: DimensionsForm
  electrical: ElectricalForm
  environmental: EnvironmentalForm
  panel: PanelForm
  inverter: InverterForm
  battery: BatteryForm
  // Edit-only
  stockQty: string
  reorderPoint: string
  supplier: string
  inStock: boolean
  reason: string
  imageUrl: string
  datasheetUrl: string
}

const numToStr = (n: number | null | undefined): string => (n == null ? '' : String(n))
const blankToNull = (s: string): string | null => (s.trim() === '' ? null : s)

function specToFormState(spec: ItemSpec, editRow?: Record<string, any> | null): FormState {
  return {
    sku: spec.sku,
    description: spec.description,
    buyingPriceKes: spec.buyingPriceKes ? String(spec.buyingPriceKes) : '',
    // Overridden right after this call using `source` (editRow or cloneFrom) —
    // margin/wholesale aren't part of ItemSpec/Zod, so they're not derived here.
    marginPct: '',
    wholesalePriceKes: '',
    wholesaleMinQty: '',
    capacity: numToStr(spec.capacity),
    unitWeightKg: numToStr(spec.unitWeightKg),
    vatStatus: spec.vatStatus,
    dimensions: {
      lengthMm: numToStr(spec.dimensions.lengthMm),
      widthMm: numToStr(spec.dimensions.widthMm),
      thicknessMm: numToStr(spec.dimensions.thicknessMm),
    },
    electrical: {
      nominalVoltageV: numToStr(spec.electrical.nominalVoltageV),
      maxCurrentAmps: numToStr(spec.electrical.maxCurrentAmps),
    },
    environmental: {
      operatingTempMinC: numToStr(spec.environmental.operatingTempMinC),
      operatingTempMaxC: numToStr(spec.environmental.operatingTempMaxC),
      ipRating: spec.environmental.ipRating ?? '',
    },
    panel: {
      efficiencyPct: numToStr(spec.panel?.efficiencyPct),
      warrantyYears: numToStr(spec.panel?.warrantyYears),
      degradationPctYr: numToStr(spec.panel?.degradationPctYr),
      cellType: spec.panel?.cellType ?? '',
      tempCoefficientPctC: numToStr(spec.panel?.tempCoefficientPctC),
      vocV: numToStr(spec.panel?.vocV),
    },
    inverter: {
      efficiencyPct: numToStr(spec.inverter?.efficiencyPct),
      warrantyYears: numToStr(spec.inverter?.warrantyYears),
      mpptCount: numToStr(spec.inverter?.mpptCount),
      phase: spec.inverter?.phase ?? '',
      inverterType: spec.inverter?.inverterType ?? '',
      continuousPowerW: numToStr(spec.inverter?.continuousPowerW),
      surgePowerW: numToStr(spec.inverter?.surgePowerW),
      commProtocols: spec.inverter?.commProtocols ?? '',
      mpptMinVoltageV: numToStr(spec.inverter?.mpptMinVoltageV),
      mpptMaxVoltageV: numToStr(spec.inverter?.mpptMaxVoltageV),
      maxInputVoltageV: numToStr(spec.inverter?.maxInputVoltageV),
    },
    battery: {
      cycleLife: numToStr(spec.battery?.cycleLife),
      dodPct: numToStr(spec.battery?.dodPct),
      warrantyYears: numToStr(spec.battery?.warrantyYears),
      chemistryType: spec.battery?.chemistryType ?? '',
      maxChargeRateC: numToStr(spec.battery?.maxChargeRateC),
    },
    stockQty: editRow?.stock_qty != null ? String(editRow.stock_qty) : '',
    reorderPoint: editRow?.reorder_point != null ? String(editRow.reorder_point) : '',
    supplier: editRow?.supplier || '',
    inStock: editRow?.in_stock !== false,
    reason: '',
    imageUrl: editRow?.image_url || '',
    datasheetUrl: editRow?.datasheet_url || '',
  }
}

interface ItemFormProps {
  category: string
  mode: 'add' | 'edit'
  editRow?: Record<string, any> | null
  cloneFrom?: Record<string, any> | null
  onSaved: (row: Record<string, any>) => void
  onCancel?: () => void
  session: any
}

export default function ItemForm({ category, mode, editRow, cloneFrom, onSaved, onCancel, session }: ItemFormProps) {
  const meta = CATEGORY_META[category] || null
  const isEdit = mode === 'edit'
  const isProductCategory = category === 'panel' || category === 'inverter' || category === 'battery'

  const [form, setForm] = useState<FormState>(() => {
    const source = isEdit ? editRow : cloneFrom
    const spec = flatRowToSpec(source, category)
    if (!isEdit && source) spec.sku = `${spec.sku} (copy)`
    return {
      ...specToFormState(spec, isEdit ? editRow : null),
      marginPct: numToStr(source?.margin_pct),
      wholesalePriceKes: numToStr(source?.wholesale_price_kes),
      wholesaleMinQty: numToStr(source?.wholesale_min_qty),
    }
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState('')
  const [saving, setSaving] = useState(false)

  // Specs sourced from a real manufacturer datasheet (see migration 032)
  // are locked against casual retyping — an admin has to deliberately hit
  // "Unlock to correct" first. Saving after unlocking demotes the row back
  // to unverified, since we can no longer promise the values still match
  // the datasheet once they're editable again.
  const specsVerified = isEdit && editRow?.specs_verified === true
  const [specsUnlocked, setSpecsUnlocked] = useState(false)
  const specsLocked = specsVerified && !specsUnlocked

  function validateRequired(key: 'sku' | 'description' | 'buyingPriceKes', value: string): string | null {
    if (key === 'sku' && !value.trim()) return 'Brand/model is required.'
    if (key === 'description' && !value.trim()) return 'Description is required.'
    if (key === 'buyingPriceKes') {
      if (!value) return 'Buying price is required.'
      if (parseFloat(value) <= 0) return 'Buying price must be greater than zero.'
    }
    return null
  }
  function handleBlur(key: 'sku' | 'description' | 'buyingPriceKes') {
    const msg = validateRequired(key, form[key] as string)
    setErrors(e => ({ ...e, [key]: msg || '' }))
  }
  function updateTop<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(f => ({ ...f, [key]: value }))
    if (errors[key as string]) setErrors(e => ({ ...e, [key as string]: '' }))
  }
  function updateGroup<G extends 'dimensions' | 'electrical' | 'environmental' | 'panel' | 'inverter' | 'battery'>(
    group: G, key: string, value: string,
  ) {
    setForm(f => ({ ...f, [group]: { ...(f[group] as unknown as Record<string, string>), [key]: value } }))
    const path = `${group}.${key}`
    if (errors[path]) setErrors(e => ({ ...e, [path]: '' }))
  }

  async function save() {
    const nextErrors: Record<string, string> = {}
    ;(['sku', 'description', 'buyingPriceKes'] as const).forEach(key => {
      const msg = validateRequired(key, form[key] as string)
      if (msg) nextErrors[key] = msg
    })
    if (Object.keys(nextErrors).length > 0) { setErrors(nextErrors); return }

    const raw = {
      sku: form.sku,
      description: form.description,
      buyingPriceKes: form.buyingPriceKes,
      capacity: blankToNull(form.capacity),
      unitWeightKg: blankToNull(form.unitWeightKg),
      vatStatus: form.vatStatus,
      dimensions: {
        lengthMm: blankToNull(form.dimensions.lengthMm),
        widthMm: blankToNull(form.dimensions.widthMm),
        thicknessMm: blankToNull(form.dimensions.thicknessMm),
      },
      electrical: {
        nominalVoltageV: blankToNull(form.electrical.nominalVoltageV),
        maxCurrentAmps: blankToNull(form.electrical.maxCurrentAmps),
      },
      environmental: {
        operatingTempMinC: blankToNull(form.environmental.operatingTempMinC),
        operatingTempMaxC: blankToNull(form.environmental.operatingTempMaxC),
        ipRating: blankToNull(form.environmental.ipRating),
      },
      panel: category === 'panel' ? {
        efficiencyPct: blankToNull(form.panel.efficiencyPct),
        warrantyYears: blankToNull(form.panel.warrantyYears),
        degradationPctYr: blankToNull(form.panel.degradationPctYr),
        cellType: blankToNull(form.panel.cellType),
        tempCoefficientPctC: blankToNull(form.panel.tempCoefficientPctC),
        vocV: blankToNull(form.panel.vocV),
      } : null,
      inverter: category === 'inverter' ? {
        efficiencyPct: blankToNull(form.inverter.efficiencyPct),
        warrantyYears: blankToNull(form.inverter.warrantyYears),
        mpptCount: blankToNull(form.inverter.mpptCount),
        phase: blankToNull(form.inverter.phase),
        inverterType: blankToNull(form.inverter.inverterType),
        continuousPowerW: blankToNull(form.inverter.continuousPowerW),
        surgePowerW: blankToNull(form.inverter.surgePowerW),
        commProtocols: blankToNull(form.inverter.commProtocols),
        mpptMinVoltageV: blankToNull(form.inverter.mpptMinVoltageV),
        mpptMaxVoltageV: blankToNull(form.inverter.mpptMaxVoltageV),
        maxInputVoltageV: blankToNull(form.inverter.maxInputVoltageV),
      } : null,
      battery: category === 'battery' ? {
        cycleLife: blankToNull(form.battery.cycleLife),
        dodPct: blankToNull(form.battery.dodPct),
        warrantyYears: blankToNull(form.battery.warrantyYears),
        chemistryType: blankToNull(form.battery.chemistryType),
        maxChargeRateC: blankToNull(form.battery.maxChargeRateC),
      } : null,
    }

    const result = ItemSpecSchema.safeParse(raw)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.issues.forEach(issue => {
        fieldErrors[issue.path.join('.')] = issue.message
      })
      setErrors(fieldErrors)
      setSubmitError('Some fields need fixing before this can be saved — see below.')
      return
    }

    setSaving(true); setSubmitError('')
    const payload = specToFlatRow(result.data, category)
    payload.margin_pct = form.marginPct === '' ? null : parseFloat(form.marginPct)
    payload.wholesale_price_kes = form.wholesalePriceKes === '' ? null : parseFloat(form.wholesalePriceKes)
    payload.wholesale_min_qty = form.wholesaleMinQty === '' ? null : parseInt(form.wholesaleMinQty, 10)

    if (isEdit && editRow) {
      payload.stock_qty = form.stockQty === '' ? null : parseInt(form.stockQty, 10)
      payload.reorder_point = form.reorderPoint === '' ? null : parseInt(form.reorderPoint, 10)
      payload.supplier = form.supplier.trim() || null
      payload.in_stock = form.inStock
      payload.image_url = form.imageUrl || null
      payload.datasheet_url = form.datasheetUrl || null
      payload.specs_verified = specsUnlocked ? false : editRow.specs_verified === true
      payload.updated_at = new Date().toISOString()

      // Non-null: this form only renders post-admin-login, which itself
      // requires `supabase` to be configured (LoginScreen calls
      // supabase.auth.signInWithPassword) — it can't be null here.
      const { data, error } = await supabase!.from('inventory_prices').update(payload).eq('role_key', editRow.role_key).select().single()
      setSaving(false)
      if (error) { setSubmitError(error.message); return }

      const priceChanged = result.data.buyingPriceKes !== Number(editRow.buying_price_kes || 0)
      const qtyDelta = payload.stock_qty != null ? payload.stock_qty - (editRow.stock_qty || 0) : 0
      logAdminAction(session, 'item_updated', editRow.role_key, { sku: data.sku })
      if (priceChanged) logAdminAction(session, 'price_update', editRow.role_key, { from: editRow.buying_price_kes, to: payload.buying_price_kes })
      if (qtyDelta !== 0) await logStockMovement({ roleKey: editRow.role_key, quantityChanged: qtyDelta, reason: form.reason?.trim(), session })
      onSaved(data)
    } else {
      const roleKey = `${category}_${form.sku.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`
      payload.role_key = roleKey
      payload.category = category
      payload.tier = 'balanced'
      payload.unit = 'each'

      const { data, error } = await supabase!.from('inventory_prices').insert(payload).select().single()
      setSaving(false)
      if (error) { setSubmitError(error.message); return }
      logAdminAction(session, 'product_added', roleKey, { category, sku: data.sku })
      onSaved(data)
    }
  }

  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [uploadingDatasheet, setUploadingDatasheet] = useState(false)
  const [assetError, setAssetError] = useState('')

  // Uploads straight to Storage on file select (same pattern as
  // SiteVisitsPanel.jsx's VisitPhotos) — but only writes the resulting
  // public URL into inventory_prices once the main Save button is clicked,
  // so a photo pick doesn't silently commit ahead of the rest of the form.
  // `upsert: true` lets "Replace" overwrite the same path instead of
  // erroring on an existing file.
  async function uploadAsset(file: File, kind: 'photo' | 'datasheet') {
    if (!editRow) return
    const setUploading = kind === 'photo' ? setUploadingPhoto : setUploadingDatasheet
    setUploading(true); setAssetError('')
    const ext = kind === 'photo' ? (file.name.split('.').pop() || 'jpg') : 'pdf'
    const path = `${editRow.role_key}/${kind}.${ext}`
    const { error: upErr } = await supabase!.storage.from('product-assets').upload(path, file, { upsert: true })
    setUploading(false)
    if (upErr) { setAssetError(upErr.message); return }
    const { data } = supabase!.storage.from('product-assets').getPublicUrl(path)
    if (kind === 'photo') updateTop('imageUrl', data.publicUrl)
    else updateTop('datasheetUrl', data.publicUrl)
  }

  const fieldClass = (key: string, disabled?: boolean) =>
    `border rounded-lg px-2 py-1.5 text-sm outline-none ${
      disabled ? 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed'
        : errors[key] ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-blue-400'
    }`

  // Labels are permanent, unlike placeholder text — a placeholder disappears
  // the moment a value is typed, so a saved numeric field (e.g. "590") would
  // otherwise give no clue what it means once the form is reopened for editing.
  function TextField({ path, label, value, onChange, wide, required, disabled }: {
    path: string; label: string; value: string
    onChange: (e: ChangeEvent<HTMLInputElement>) => void; wide?: boolean; required?: boolean; disabled?: boolean
  }) {
    return (
      <div className={wide ? 'col-span-2' : ''}>
        <label className="block text-xs text-gray-500 mb-1">
          {label}{!required && <span className="text-gray-300"> — optional</span>}
        </label>
        <input type="number" value={value} onChange={onChange} disabled={disabled}
          className={`w-full ${fieldClass(path, disabled)}`} />
        {errors[path] && <p className="text-xs text-red-600 mt-0.5">{errors[path]}</p>}
      </div>
    )
  }

  function SelectField({ path, label, value, onChange, options, disabled }: {
    path: string; label: string; value: string; onChange: (e: ChangeEvent<HTMLSelectElement>) => void
    options: { value: string; label: string }[]; disabled?: boolean
  }) {
    return (
      <div>
        <label className="block text-xs text-gray-500 mb-1">{label} <span className="text-gray-300">— optional</span></label>
        <select value={value} onChange={onChange} disabled={disabled} className={`w-full bg-white ${fieldClass(path, disabled)}`}>
          <option value="">— choose —</option>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Brand / model *</label>
          <input placeholder="e.g. JA Solar 700W N-Type" value={form.sku}
            onChange={e => updateTop('sku', e.target.value)} onBlur={() => handleBlur('sku')}
            className={`w-full ${fieldClass('sku')}`} />
          {errors.sku && <p className="text-xs text-red-600 mt-0.5">{errors.sku}</p>}
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Buying price (Ksh) *</label>
          <input type="number" value={form.buyingPriceKes}
            onChange={e => updateTop('buyingPriceKes', e.target.value)} onBlur={() => handleBlur('buyingPriceKes')}
            className={`w-full ${fieldClass('buyingPriceKes')}`} />
          {errors.buyingPriceKes && <p className="text-xs text-red-600 mt-0.5">{errors.buyingPriceKes}</p>}
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Description *</label>
        <input placeholder="Full description, shown to customers" value={form.description}
          onChange={e => updateTop('description', e.target.value)} onBlur={() => handleBlur('description')}
          className={`w-full ${fieldClass('description')}`} />
        {errors.description && <p className="text-xs text-red-600 mt-0.5">{errors.description}</p>}
      </div>

      <div className="pt-2 border-t border-gray-100">
        <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Pricing</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Margin (%) <span className="text-gray-300">— optional, {DEFAULT_MARGIN_PCT}% default</span></label>
            <input type="number" placeholder={String(DEFAULT_MARGIN_PCT)} value={form.marginPct}
              onChange={e => updateTop('marginPct', e.target.value)}
              className={`w-full ${fieldClass('marginPct')}`} />
          </div>
          <div className="flex flex-col justify-end pb-1.5">
            <span className="text-xs text-gray-400">
              Sells at{' '}
              <span className="font-bold text-emerald-700">
                {form.buyingPriceKes
                  ? formatKsh(sellPrice(parseFloat(form.buyingPriceKes) || 0, form.marginPct === '' ? null : parseFloat(form.marginPct)))
                  : '—'}
              </span>
              {form.marginPct === '' ? ` (${DEFAULT_MARGIN_PCT}% default)` : ` (${form.marginPct}% margin)`}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <TextField path="wholesalePriceKes" label="Wholesale price (Ksh)" value={form.wholesalePriceKes}
            onChange={e => updateTop('wholesalePriceKes', e.target.value)} />
          <TextField path="wholesaleMinQty" label="Min qty to unlock wholesale" value={form.wholesaleMinQty}
            onChange={e => updateTop('wholesaleMinQty', e.target.value)} />
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Set both wholesale fields together to give this item a bulk-quantity floor — a customer buying at least that many pieces pays the wholesale price instead of the margin price, in both quotes and this inventory list. Leave both blank for normal margin-only pricing.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {meta && (
          <TextField path="capacity" label={`${meta.capacityLabel} (${meta.capacityUnit})`} disabled={specsLocked}
            value={form.capacity} onChange={e => updateTop('capacity', e.target.value)} />
        )}
        <TextField path="unitWeightKg" label="Weight (kg)" disabled={specsLocked}
          value={form.unitWeightKg} onChange={e => updateTop('unitWeightKg', e.target.value)} />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">VAT status</label>
        <select value={form.vatStatus} onChange={e => updateTop('vatStatus', e.target.value as VatStatus)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-blue-400">
          {VAT_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {isProductCategory && (
        <>
          {specsVerified && (
            <div className={`rounded-xl p-3 text-xs flex items-center justify-between gap-3 ${
              specsUnlocked ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}`}>
              <span>
                {specsUnlocked
                  ? '🔓 Unlocked — saving now will mark these specs as no longer verified.'
                  : '🔒 Verified from an official manufacturer datasheet. Specs below are locked to prevent accidental changes.'}
              </span>
              {!specsUnlocked && (
                <button type="button" onClick={() => setSpecsUnlocked(true)}
                  className="font-bold text-blue-600 hover:text-blue-800 whitespace-nowrap">
                  Unlock to correct
                </button>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-gray-100">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Dimensions (mm)</div>
            <div className="grid grid-cols-3 gap-2">
              <TextField path="dimensions.lengthMm" label="Length (mm)" value={form.dimensions.lengthMm} disabled={specsLocked}
                onChange={e => updateGroup('dimensions', 'lengthMm', e.target.value)} />
              <TextField path="dimensions.widthMm" label="Width (mm)" value={form.dimensions.widthMm} disabled={specsLocked}
                onChange={e => updateGroup('dimensions', 'widthMm', e.target.value)} />
              <TextField path="dimensions.thicknessMm" label="Thickness (mm)" value={form.dimensions.thicknessMm} disabled={specsLocked}
                onChange={e => updateGroup('dimensions', 'thicknessMm', e.target.value)} />
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Electrical</div>
            <div className="grid grid-cols-2 gap-2">
              <TextField path="electrical.nominalVoltageV" label="Nominal voltage — Vmp (V)" value={form.electrical.nominalVoltageV} disabled={specsLocked}
                onChange={e => updateGroup('electrical', 'nominalVoltageV', e.target.value)} />
              <TextField path="electrical.maxCurrentAmps" label="Max current — Isc (A)" value={form.electrical.maxCurrentAmps} disabled={specsLocked}
                onChange={e => updateGroup('electrical', 'maxCurrentAmps', e.target.value)} />
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Environmental</div>
            <div className="grid grid-cols-3 gap-2">
              <TextField path="environmental.operatingTempMinC" label="Min operating temp (°C)" value={form.environmental.operatingTempMinC} disabled={specsLocked}
                onChange={e => updateGroup('environmental', 'operatingTempMinC', e.target.value)} />
              <TextField path="environmental.operatingTempMaxC" label="Max operating temp (°C)" value={form.environmental.operatingTempMaxC} disabled={specsLocked}
                onChange={e => updateGroup('environmental', 'operatingTempMaxC', e.target.value)} />
              <div>
                <label className="block text-xs text-gray-500 mb-1">IP rating <span className="text-gray-300">— optional</span></label>
                <input placeholder="e.g. IP65" value={form.environmental.ipRating} disabled={specsLocked}
                  onChange={e => updateGroup('environmental', 'ipRating', e.target.value)}
                  className={`w-full ${fieldClass('environmental.ipRating', specsLocked)}`} />
                {errors['environmental.ipRating'] && <p className="text-xs text-red-600 mt-0.5">{errors['environmental.ipRating']}</p>}
              </div>
            </div>
          </div>

          {category === 'panel' && (
            <div>
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Panel Specs</div>
              <div className="grid grid-cols-3 gap-2">
                <TextField path="panel.efficiencyPct" label="Efficiency (%)" value={form.panel.efficiencyPct} disabled={specsLocked}
                  onChange={e => updateGroup('panel', 'efficiencyPct', e.target.value)} />
                <TextField path="panel.warrantyYears" label="Warranty (yr)" value={form.panel.warrantyYears} disabled={specsLocked}
                  onChange={e => updateGroup('panel', 'warrantyYears', e.target.value)} />
                <TextField path="panel.degradationPctYr" label="Degradation (%/yr)" value={form.panel.degradationPctYr} disabled={specsLocked}
                  onChange={e => updateGroup('panel', 'degradationPctYr', e.target.value)} />
                <SelectField path="panel.cellType" label="Cell type" value={form.panel.cellType} disabled={specsLocked}
                  onChange={e => updateGroup('panel', 'cellType', e.target.value)} options={CELL_TYPE_OPTIONS} />
                <TextField path="panel.tempCoefficientPctC" label="Temp coefficient (%/°C)" value={form.panel.tempCoefficientPctC} disabled={specsLocked}
                  onChange={e => updateGroup('panel', 'tempCoefficientPctC', e.target.value)} />
                <TextField path="panel.vocV" label="Voc — open-circuit voltage (V)" value={form.panel.vocV} disabled={specsLocked}
                  onChange={e => updateGroup('panel', 'vocV', e.target.value)} />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Voc (above) plus the Electrical section's Nominal Voltage (Vmp) and Max Current (Isc) are what let RhiPower check this panel is compatible with a chosen inverter's MPPT input.</p>
            </div>
          )}

          {category === 'inverter' && (
            <div>
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Inverter Specs</div>
              <div className="grid grid-cols-3 gap-2">
                <TextField path="inverter.efficiencyPct" label="Efficiency (%)" value={form.inverter.efficiencyPct} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'efficiencyPct', e.target.value)} />
                <TextField path="inverter.warrantyYears" label="Warranty (yr)" value={form.inverter.warrantyYears} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'warrantyYears', e.target.value)} />
                <TextField path="inverter.mpptCount" label="MPPT tracker count" value={form.inverter.mpptCount} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'mpptCount', e.target.value)} />
                <SelectField path="inverter.phase" label="Phase" value={form.inverter.phase} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'phase', e.target.value)} options={PHASE_OPTIONS} />
                <SelectField path="inverter.inverterType" label="Inverter type" value={form.inverter.inverterType} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'inverterType', e.target.value)} options={INVERTER_TYPE_OPTIONS} />
                <TextField path="inverter.continuousPowerW" label="Continuous power (W)" value={form.inverter.continuousPowerW} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'continuousPowerW', e.target.value)} />
                <TextField path="inverter.surgePowerW" label="Surge power (W)" value={form.inverter.surgePowerW} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'surgePowerW', e.target.value)} />
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Comm protocols <span className="text-gray-300">— optional</span></label>
                  <input placeholder="e.g. CAN, RS485" value={form.inverter.commProtocols} disabled={specsLocked}
                    onChange={e => updateGroup('inverter', 'commProtocols', e.target.value)}
                    className={`w-full ${fieldClass('inverter.commProtocols', specsLocked)}`} />
                </div>
                <TextField path="inverter.mpptMinVoltageV" label="MPPT min voltage (V)" value={form.inverter.mpptMinVoltageV} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'mpptMinVoltageV', e.target.value)} />
                <TextField path="inverter.mpptMaxVoltageV" label="MPPT max voltage (V)" value={form.inverter.mpptMaxVoltageV} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'mpptMaxVoltageV', e.target.value)} />
                <TextField path="inverter.maxInputVoltageV" label="Absolute max DC input (V)" value={form.inverter.maxInputVoltageV} disabled={specsLocked}
                  onChange={e => updateGroup('inverter', 'maxInputVoltageV', e.target.value)} />
              </div>
              <p className="text-[11px] text-gray-400 mt-1">MPPT window + max input voltage (above) plus the Electrical section's Max Current are what let RhiPower check a chosen panel is compatible with this inverter's MPPT input.</p>
            </div>
          )}

          {category === 'battery' && (
            <div>
              <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Battery Specs</div>
              <div className="grid grid-cols-3 gap-2">
                <TextField path="battery.cycleLife" label="Cycle life" value={form.battery.cycleLife} disabled={specsLocked}
                  onChange={e => updateGroup('battery', 'cycleLife', e.target.value)} />
                <TextField path="battery.dodPct" label="Depth of discharge (%)" value={form.battery.dodPct} disabled={specsLocked}
                  onChange={e => updateGroup('battery', 'dodPct', e.target.value)} />
                <TextField path="battery.warrantyYears" label="Warranty (yr)" value={form.battery.warrantyYears} disabled={specsLocked}
                  onChange={e => updateGroup('battery', 'warrantyYears', e.target.value)} />
                <SelectField path="battery.chemistryType" label="Chemistry" value={form.battery.chemistryType} disabled={specsLocked}
                  onChange={e => updateGroup('battery', 'chemistryType', e.target.value)} options={CHEMISTRY_TYPE_OPTIONS} />
                <TextField path="battery.maxChargeRateC" label="Max charge rate (C)" value={form.battery.maxChargeRateC} disabled={specsLocked}
                  onChange={e => updateGroup('battery', 'maxChargeRateC', e.target.value)} />
              </div>
            </div>
          )}
        </>
      )}

      {isEdit && isProductCategory && (
        <div className="pt-2 border-t border-gray-100">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Assets</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">Product photo</div>
              {form.imageUrl && (
                <img src={form.imageUrl} alt="Product" className="w-20 h-20 object-cover rounded-lg border border-gray-200 mb-1.5" />
              )}
              <label className="inline-block text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer">
                {uploadingPhoto ? 'Uploading…' : form.imageUrl ? 'Replace photo' : '+ Upload photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" disabled={uploadingPhoto}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadAsset(f, 'photo') }} />
              </label>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Datasheet (PDF)</div>
              {form.datasheetUrl && (
                <a href={form.datasheetUrl} target="_blank" rel="noreferrer" className="block text-xs text-blue-600 underline mb-1.5">View current datasheet</a>
              )}
              <label className="inline-block text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer">
                {uploadingDatasheet ? 'Uploading…' : form.datasheetUrl ? 'Replace datasheet' : '+ Upload datasheet'}
                <input type="file" accept="application/pdf" className="hidden" disabled={uploadingDatasheet}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadAsset(f, 'datasheet') }} />
              </label>
            </div>
          </div>
          {assetError && <p className="text-xs text-red-600 mt-1.5">{assetError}</p>}
        </div>
      )}

      {isEdit && (
        <div className="pt-2 border-t border-gray-100 space-y-2">
          <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">Stock & Supply</div>
          <div className="flex gap-2 items-end flex-wrap">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Stock qty</label>
              <input type="number" value={form.stockQty}
                onChange={e => updateTop('stockQty', e.target.value)}
                className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Reorder at</label>
              <input placeholder="—" type="number" value={form.reorderPoint}
                onChange={e => updateTop('reorderPoint', e.target.value)}
                className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
            </div>
            <label className="flex items-center gap-1.5 text-sm text-gray-600 ml-auto pb-1.5">
              <input type="checkbox" checked={form.inStock} onChange={e => updateTop('inStock', e.target.checked)} className="w-4 h-4" />
              In stock (orderable)
            </label>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Supplier name</label>
            <input value={form.supplier}
              onChange={e => updateTop('supplier', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Reason for quantity change <span className="text-gray-300">— optional</span></label>
            <input value={form.reason}
              onChange={e => updateTop('reason', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
          </div>
        </div>
      )}

      <p className="text-xs text-blue-600">Fields marked * are required. Leave any spec blank if you don't know it yet — it just won't show in the customer comparison.</p>
      {submitError && <p className="text-xs text-red-600 font-semibold bg-red-50 p-2 rounded-lg">{submitError}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition disabled:opacity-50">
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Product'}
        </button>
        {onCancel && <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 px-2">Cancel</button>}
      </div>
    </div>
  )
}
