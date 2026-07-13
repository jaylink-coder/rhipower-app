// Fetches live inventory prices from Supabase.
// Falls back to hardcoded skuInventory.js values if DB is unreachable.

import { supabase, isSupabaseReady } from './supabase.js'
import { DEFAULT_PRODUCTS, DEFAULT_PRICE_BANDS, ZONES as DEFAULT_ZONES } from '../data/skuInventory.js'
import { deriveTier } from './tierProducts.js'

export const FALLBACK = { products: DEFAULT_PRODUCTS, priceBands: DEFAULT_PRICE_BANDS, zones: DEFAULT_ZONES }

export function toProduct(row) {
  return {
    roleKey:          row.role_key,
    sku:              row.sku,
    description:      row.description,
    cost:             Number(row.buying_price_kes),
    marginPct:        row.margin_pct != null ? Number(row.margin_pct) : undefined,
    wholesalePriceKes: row.wholesale_price_kes != null ? Number(row.wholesale_price_kes) : undefined,
    wholesaleMinQty:  row.wholesale_min_qty != null ? Number(row.wholesale_min_qty) : undefined,
    wattsEach:        row.watts_each     != null ? Number(row.watts_each)     : undefined,
    kwhEach:          row.kwh_each       != null ? Number(row.kwh_each)       : undefined,
    kwEach:           row.kw_each        != null ? Number(row.kw_each)        : undefined,
    unitWeightKg:     row.unit_weight_kg != null ? Number(row.unit_weight_kg) : undefined,
    efficiencyPct:    row.efficiency_pct     != null ? Number(row.efficiency_pct)     : undefined,
    warrantyYears:    row.warranty_years     != null ? Number(row.warranty_years)     : undefined,
    degradationPctYr: row.degradation_pct_yr != null ? Number(row.degradation_pct_yr) : undefined,
    mpptCount:        row.mppt_count         != null ? Number(row.mppt_count)         : undefined,
    phase:            row.phase        || undefined,
    cycleLife:        row.cycle_life   != null ? Number(row.cycle_life) : undefined,
    dodPct:           row.dod_pct      != null ? Number(row.dod_pct)    : undefined,
    // Full component spec schema (migration 029) — dimensions/electrical/
    // environmental are shared across categories; the rest are category-
    // specific, but reading them all here is harmless since a panel row
    // simply never has inverter_type/chemistry_type etc. set.
    lengthMm:            row.length_mm            != null ? Number(row.length_mm)            : undefined,
    widthMm:             row.width_mm             != null ? Number(row.width_mm)             : undefined,
    thicknessMm:         row.thickness_mm         != null ? Number(row.thickness_mm)         : undefined,
    nominalVoltageV:     row.nominal_voltage_v    != null ? Number(row.nominal_voltage_v)    : undefined,
    maxCurrentAmps:      row.max_current_amps     != null ? Number(row.max_current_amps)     : undefined,
    operatingTempMinC:   row.operating_temp_min_c != null ? Number(row.operating_temp_min_c) : undefined,
    operatingTempMaxC:   row.operating_temp_max_c != null ? Number(row.operating_temp_max_c) : undefined,
    ipRating:            row.ip_rating || undefined,
    cellType:            row.cell_type || undefined,
    tempCoefficientPctC: row.temp_coefficient_pct_c != null ? Number(row.temp_coefficient_pct_c) : undefined,
    inverterType:        row.inverter_type || undefined,
    continuousPowerW:    row.continuous_power_w != null ? Number(row.continuous_power_w) : undefined,
    surgePowerW:         row.surge_power_w      != null ? Number(row.surge_power_w)      : undefined,
    commProtocols:       row.comm_protocols || undefined,
    chemistryType:       row.chemistry_type || undefined,
    maxChargeRateC:      row.max_charge_rate_c != null ? Number(row.max_charge_rate_c) : undefined,
    // MPPT string-balancing fields (migration 031)
    vocV:                row.voc_v != null ? Number(row.voc_v) : undefined,
    mpptMinVoltageV:     row.mppt_min_voltage_v  != null ? Number(row.mppt_min_voltage_v)  : undefined,
    mpptMaxVoltageV:     row.mppt_max_voltage_v  != null ? Number(row.mppt_max_voltage_v)  : undefined,
    maxInputVoltageV:    row.max_input_voltage_v != null ? Number(row.max_input_voltage_v) : undefined,
    imageUrl:         row.image_url || undefined,
    datasheetUrl:     row.datasheet_url || undefined,
    itemCode:         row.item_code != null ? Number(row.item_code) : undefined,
    inStock:          row.in_stock !== false,
    isActive:         row.is_active !== false,
    vatStatus:        row.vat_status || 'standard',
  }
}

// Shared "stock_qty changed" logger — routes every write path (manual admin
// adjustment, PO receiving, future Sales Order fulfillment) through one
// place so stock_movements stays a trustworthy, consistently-tagged ledger
// instead of three call sites each doing their own insert().
export async function logStockMovement({ roleKey, quantityChanged, reason, session, movementType = 'adjustment', sourceType = null, sourceId = null }) {
  if (!quantityChanged) return
  const { error } = await supabase.from('stock_movements').insert({
    role_key:         roleKey,
    quantity_changed: quantityChanged,
    reason:           reason || null,
    movement_type:    movementType,
    source_type:      sourceType,
    source_id:        sourceId,
    admin_id:         session?.user?.id || null,
    admin_email:      session?.user?.email || null,
  })
  if (error) console.warn('[RhiPower] stock movement log failed:', error.message)
}

export async function fetchInventory() {
  if (!isSupabaseReady) return FALLBACK

  try {
    const [{ data: rows, error: rowsErr }, { data: bandRows, error: bandsErr }] = await Promise.all([
      supabase.from('inventory_prices').select('*'),
      supabase.from('price_bands').select('*'),
    ])

    if (rowsErr || !rows?.length) return FALLBACK

    // price_bands may not exist yet (migration 007 not yet run) — fall back
    // to the same default ranges rather than breaking tier derivation.
    let priceBands = DEFAULT_PRICE_BANDS
    if (!bandsErr && bandRows?.length) {
      priceBands = {}
      bandRows.forEach(b => {
        priceBands[b.category] = priceBands[b.category] || {}
        priceBands[b.category][b.tier] = [Number(b.min_price), b.max_price != null ? Number(b.max_price) : null]
      })
    }

    const byKey = {}
    rows.forEach(r => { byKey[r.role_key] = r })

    function zoneItem(key, def) {
      const r = byKey[key]
      const base = { ...def, roleKey: key, vatStatus: def.vatStatus || 'standard' }
      if (!r) return base
      return {
        ...base, sku: r.sku, description: r.description, cost: Number(r.buying_price_kes), vatStatus: r.vat_status || 'standard',
        marginPct:        r.margin_pct != null ? Number(r.margin_pct) : undefined,
        wholesalePriceKes: r.wholesale_price_kes != null ? Number(r.wholesale_price_kes) : undefined,
        wholesaleMinQty:  r.wholesale_min_qty != null ? Number(r.wholesale_min_qty) : undefined,
      }
    }

    // Any number of products per category — tier is derived from price, not
    // stored, so this reflects live price_bands even if they've been edited.
    // Inactive items ("Mark as Inactive", not just out-of-stock) are excluded
    // from customer-facing quoting entirely, same as Zoho's item architecture.
    const products = { panel: [], inverter: [], battery: [] }
    rows.forEach(row => {
      if (!(row.category in products)) return
      if (row.is_active === false) return
      const product = toProduct(row)
      product.tier = deriveTier(row.category, product.cost, priceBands)
      products[row.category].push(product)
    })
    ;['panel', 'inverter', 'battery'].forEach(cat => {
      if (!products[cat].length) products[cat] = DEFAULT_PRODUCTS[cat]
    })

    return {
      products,
      priceBands,
      zones: {
        zoneA: [
          zoneItem('zoneA_breaker',  DEFAULT_ZONES.zoneA[0]),
          zoneItem('zoneA_spd',      DEFAULT_ZONES.zoneA[1]),
          zoneItem('zoneA_fuse',     DEFAULT_ZONES.zoneA[2]),
          zoneItem('zoneA_cable6',   DEFAULT_ZONES.zoneA[3]),
          zoneItem('zoneA_cable10',  DEFAULT_ZONES.zoneA[4]),
          zoneItem('zoneA_mounting', DEFAULT_ZONES.zoneA[5]),
          zoneItem('zoneA_earthing', DEFAULT_ZONES.zoneA[6]),
        ],
        zoneB: [
          zoneItem('zoneB_mccb',     DEFAULT_ZONES.zoneB[0]),
          zoneItem('zoneB_busbar',   DEFAULT_ZONES.zoneB[1]),
          zoneItem('zoneB_lug_m8',   DEFAULT_ZONES.zoneB[2]),
          zoneItem('zoneB_lug_m10',  DEFAULT_ZONES.zoneB[3]),
          zoneItem('zoneB_batcable', DEFAULT_ZONES.zoneB[4]),
        ],
        zoneC: [
          zoneItem('zoneC_mcb',       DEFAULT_ZONES.zoneC[0]),
          zoneItem('zoneC_smart',     DEFAULT_ZONES.zoneC[1]),
          zoneItem('zoneC_contactor', DEFAULT_ZONES.zoneC[2]),
        ],
      },
    }
  } catch {
    return FALLBACK
  }
}
