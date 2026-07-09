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
    imageUrl:         row.image_url || undefined,
    itemCode:         row.item_code != null ? Number(row.item_code) : undefined,
    inStock:          row.in_stock !== false,
    isActive:         row.is_active !== false,
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
      const base = { ...def, roleKey: key }
      if (!r) return base
      return { ...base, sku: r.sku, description: r.description, cost: Number(r.buying_price_kes) }
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
