// Zod validation for the panel/inverter/battery item spec form. Storage
// stays flat columns on `inventory_prices` (migrations 007 + 029) — that's
// what price-band tier derivation, Stock Valuation, and every other report
// already query directly, and a JSONB rewrite would mean touching all of
// them for no functional gain. This file's nested shape exists only at the
// application boundary: `flatRowToSpec()` reads a Supabase row into it for
// the form, `specToFlatRow()` flattens it back out for the write. Every
// field is nullable/optional by design — RhiPower's admin doesn't always
// have a full datasheet on hand, so Zod validates *shape and range* when a
// value is present, not "field must exist."

import { z } from 'zod'

export type ItemCategory = string

export const CELL_TYPES = ['mono_n_type', 'mono_p_type', 'poly'] as const
export type CellType = (typeof CELL_TYPES)[number]
export const CELL_TYPE_LABELS: Record<CellType, string> = {
  mono_n_type: 'Mono N-Type',
  mono_p_type: 'Mono P-Type',
  poly: 'Polycrystalline',
}

export const INVERTER_TYPES = ['hybrid', 'string', 'micro'] as const
export type InverterType = (typeof INVERTER_TYPES)[number]
export const INVERTER_TYPE_LABELS: Record<InverterType, string> = {
  hybrid: 'Hybrid',
  string: 'String',
  micro: 'Micro',
}

export const CHEMISTRY_TYPES = ['lifepo4', 'lead_acid', 'lto', 'sodium_ion'] as const
export type ChemistryType = (typeof CHEMISTRY_TYPES)[number]
export const CHEMISTRY_TYPE_LABELS: Record<ChemistryType, string> = {
  lifepo4: 'LiFePO4 (Lithium Iron Phosphate)',
  lead_acid: 'Lead-Acid (AGM / Gel)',
  lto: 'Lithium Titanate (LTO)',
  sodium_ion: 'Sodium-Ion',
}

export const PHASES = ['single', 'three'] as const
export type Phase = (typeof PHASES)[number]

export const VAT_STATUSES = ['standard', 'zero_rated', 'exempt'] as const
export type VatStatus = (typeof VAT_STATUSES)[number]

// Which flat column holds "capacity" per product category — mirrors
// CATEGORY_META.capacityField in Admin.jsx (kept separate deliberately;
// Admin.jsx's copy stays JS and only drives the inventory table's own
// summary string, not form validation).
const CAPACITY_COLUMN: Record<string, string> = {
  panel: 'watts_each',
  inverter: 'kw_each',
  battery: 'kwh_each',
}

const positive = () => z.coerce.number().positive().nullable().optional()
const pct = () => z.coerce.number().min(0).max(100).nullable().optional()
const anyNumber = () => z.coerce.number().nullable().optional()
const posInt = () => z.coerce.number().int().positive().nullable().optional()

export const DimensionsSchema = z.object({
  lengthMm: positive(),
  widthMm: positive(),
  thicknessMm: positive(),
})
export type Dimensions = z.infer<typeof DimensionsSchema>

export const ElectricalSchema = z.object({
  nominalVoltageV: positive(),
  maxCurrentAmps: positive(),
})
export type Electrical = z.infer<typeof ElectricalSchema>

export const EnvironmentalSchema = z.object({
  operatingTempMinC: anyNumber(),
  operatingTempMaxC: anyNumber(),
  ipRating: z.string().trim().regex(/^IP\d{2}$/i, 'Must look like IP65').nullable().optional(),
})
export type Environmental = z.infer<typeof EnvironmentalSchema>

export const PanelSpecSchema = z.object({
  efficiencyPct: pct(),
  warrantyYears: positive(),
  degradationPctYr: anyNumber(),
  cellType: z.enum(CELL_TYPES).nullable().optional(),
  tempCoefficientPctC: anyNumber(),
  // Open-circuit voltage — higher than Vmp (electrical.nominalVoltageV),
  // the value that matters for MPPT string-balancing (see stringBalancing.ts).
  vocV: positive(),
})
export type PanelSpec = z.infer<typeof PanelSpecSchema>

export const InverterSpecSchema = z.object({
  efficiencyPct: pct(),
  warrantyYears: positive(),
  mpptCount: posInt(),
  phase: z.enum(PHASES).nullable().optional(),
  inverterType: z.enum(INVERTER_TYPES).nullable().optional(),
  continuousPowerW: positive(),
  surgePowerW: positive(),
  commProtocols: z.string().trim().nullable().optional(),
  // MPPT tracking window + absolute max DC input — used by
  // stringBalancing.ts to check a chosen panel actually fits this inverter.
  mpptMinVoltageV: positive(),
  mpptMaxVoltageV: positive(),
  maxInputVoltageV: positive(),
})
export type InverterSpec = z.infer<typeof InverterSpecSchema>

export const BatterySpecSchema = z.object({
  cycleLife: posInt(),
  dodPct: pct(),
  warrantyYears: positive(),
  chemistryType: z.enum(CHEMISTRY_TYPES).nullable().optional(),
  maxChargeRateC: positive(),
})
export type BatterySpec = z.infer<typeof BatterySpecSchema>

export const ItemSpecSchema = z.object({
  sku: z.string().trim().min(1, 'Brand/model is required.'),
  description: z.string().trim().min(1, 'Description is required.'),
  buyingPriceKes: z.coerce.number().positive('Buying price must be greater than zero.'),
  capacity: positive(),
  unitWeightKg: positive(),
  vatStatus: z.enum(VAT_STATUSES),
  dimensions: DimensionsSchema,
  electrical: ElectricalSchema,
  environmental: EnvironmentalSchema,
  panel: PanelSpecSchema.nullable().optional(),
  inverter: InverterSpecSchema.nullable().optional(),
  battery: BatterySpecSchema.nullable().optional(),
})
export type ItemSpec = z.infer<typeof ItemSpecSchema>

// ── Flat Supabase row ⇄ nested ItemSpec ──────────────────────────────────

export function flatRowToSpec(row: Record<string, any> | null | undefined, category: ItemCategory): ItemSpec {
  const capacityCol = CAPACITY_COLUMN[category]
  return {
    sku: row?.sku ?? '',
    description: row?.description ?? '',
    buyingPriceKes: row?.buying_price_kes != null ? Number(row.buying_price_kes) : 0,
    capacity: capacityCol && row?.[capacityCol] != null ? Number(row[capacityCol]) : null,
    unitWeightKg: row?.unit_weight_kg != null ? Number(row.unit_weight_kg) : null,
    vatStatus: (row?.vat_status ?? 'standard') as VatStatus,
    dimensions: {
      lengthMm: row?.length_mm != null ? Number(row.length_mm) : null,
      widthMm: row?.width_mm != null ? Number(row.width_mm) : null,
      thicknessMm: row?.thickness_mm != null ? Number(row.thickness_mm) : null,
    },
    electrical: {
      nominalVoltageV: row?.nominal_voltage_v != null ? Number(row.nominal_voltage_v) : null,
      maxCurrentAmps: row?.max_current_amps != null ? Number(row.max_current_amps) : null,
    },
    environmental: {
      operatingTempMinC: row?.operating_temp_min_c != null ? Number(row.operating_temp_min_c) : null,
      operatingTempMaxC: row?.operating_temp_max_c != null ? Number(row.operating_temp_max_c) : null,
      ipRating: row?.ip_rating ?? null,
    },
    panel: category === 'panel' ? {
      efficiencyPct: row?.efficiency_pct != null ? Number(row.efficiency_pct) : null,
      warrantyYears: row?.warranty_years != null ? Number(row.warranty_years) : null,
      degradationPctYr: row?.degradation_pct_yr != null ? Number(row.degradation_pct_yr) : null,
      cellType: (row?.cell_type ?? null) as CellType | null,
      tempCoefficientPctC: row?.temp_coefficient_pct_c != null ? Number(row.temp_coefficient_pct_c) : null,
      vocV: row?.voc_v != null ? Number(row.voc_v) : null,
    } : null,
    inverter: category === 'inverter' ? {
      efficiencyPct: row?.efficiency_pct != null ? Number(row.efficiency_pct) : null,
      warrantyYears: row?.warranty_years != null ? Number(row.warranty_years) : null,
      mpptCount: row?.mppt_count != null ? Number(row.mppt_count) : null,
      phase: (row?.phase ?? null) as Phase | null,
      inverterType: (row?.inverter_type ?? null) as InverterType | null,
      continuousPowerW: row?.continuous_power_w != null ? Number(row.continuous_power_w) : null,
      surgePowerW: row?.surge_power_w != null ? Number(row.surge_power_w) : null,
      commProtocols: row?.comm_protocols ?? null,
      mpptMinVoltageV: row?.mppt_min_voltage_v != null ? Number(row.mppt_min_voltage_v) : null,
      mpptMaxVoltageV: row?.mppt_max_voltage_v != null ? Number(row.mppt_max_voltage_v) : null,
      maxInputVoltageV: row?.max_input_voltage_v != null ? Number(row.max_input_voltage_v) : null,
    } : null,
    battery: category === 'battery' ? {
      cycleLife: row?.cycle_life != null ? Number(row.cycle_life) : null,
      dodPct: row?.dod_pct != null ? Number(row.dod_pct) : null,
      warrantyYears: row?.warranty_years != null ? Number(row.warranty_years) : null,
      chemistryType: (row?.chemistry_type ?? null) as ChemistryType | null,
      maxChargeRateC: row?.max_charge_rate_c != null ? Number(row.max_charge_rate_c) : null,
    } : null,
  }
}

export function specToFlatRow(spec: ItemSpec, category: ItemCategory): Record<string, any> {
  const capacityCol = CAPACITY_COLUMN[category]
  const row: Record<string, any> = {
    sku: spec.sku,
    description: spec.description,
    buying_price_kes: spec.buyingPriceKes,
    unit_weight_kg: spec.unitWeightKg ?? null,
    vat_status: spec.vatStatus,
    length_mm: spec.dimensions.lengthMm ?? null,
    width_mm: spec.dimensions.widthMm ?? null,
    thickness_mm: spec.dimensions.thicknessMm ?? null,
    nominal_voltage_v: spec.electrical.nominalVoltageV ?? null,
    max_current_amps: spec.electrical.maxCurrentAmps ?? null,
    operating_temp_min_c: spec.environmental.operatingTempMinC ?? null,
    operating_temp_max_c: spec.environmental.operatingTempMaxC ?? null,
    ip_rating: spec.environmental.ipRating ?? null,
  }
  if (capacityCol) row[capacityCol] = spec.capacity ?? null

  if (category === 'panel' && spec.panel) {
    row.efficiency_pct = spec.panel.efficiencyPct ?? null
    row.warranty_years = spec.panel.warrantyYears ?? null
    row.degradation_pct_yr = spec.panel.degradationPctYr ?? null
    row.cell_type = spec.panel.cellType ?? null
    row.temp_coefficient_pct_c = spec.panel.tempCoefficientPctC ?? null
    row.voc_v = spec.panel.vocV ?? null
  }
  if (category === 'inverter' && spec.inverter) {
    row.efficiency_pct = spec.inverter.efficiencyPct ?? null
    row.warranty_years = spec.inverter.warrantyYears ?? null
    row.mppt_count = spec.inverter.mpptCount ?? null
    row.phase = spec.inverter.phase ?? null
    row.inverter_type = spec.inverter.inverterType ?? null
    row.continuous_power_w = spec.inverter.continuousPowerW ?? null
    row.surge_power_w = spec.inverter.surgePowerW ?? null
    row.comm_protocols = spec.inverter.commProtocols ?? null
    row.mppt_min_voltage_v = spec.inverter.mpptMinVoltageV ?? null
    row.mppt_max_voltage_v = spec.inverter.mpptMaxVoltageV ?? null
    row.max_input_voltage_v = spec.inverter.maxInputVoltageV ?? null
  }
  if (category === 'battery' && spec.battery) {
    row.cycle_life = spec.battery.cycleLife ?? null
    row.dod_pct = spec.battery.dodPct ?? null
    row.warranty_years = spec.battery.warrantyYears ?? null
    row.chemistry_type = spec.battery.chemistryType ?? null
    row.max_charge_rate_c = spec.battery.maxChargeRateC ?? null
  }
  return row
}
