// Fetches live inventory prices from Supabase.
// Falls back to hardcoded skuInventory.js values if DB is unreachable.

import { supabase, isSupabaseReady } from './supabase.js'
import { TIERS as DEFAULT_TIERS, ZONES as DEFAULT_ZONES } from '../data/skuInventory.js'

export const FALLBACK = { tiers: DEFAULT_TIERS, zones: DEFAULT_ZONES }

export async function fetchInventory() {
  if (!isSupabaseReady) return FALLBACK

  try {
    const { data, error } = await supabase
      .from('inventory_prices')
      .select('*')

    if (error || !data?.length) return FALLBACK

    const byKey = {}
    data.forEach(row => { byKey[row.role_key] = row })

    function tierItem(key, def) {
      const r = byKey[key]
      if (!r) return def
      return {
        ...def,
        sku:         r.sku,
        description: r.description,
        cost:        Number(r.buying_price_kes),
        ...(r.watts_each     != null && { wattsEach:    Number(r.watts_each)     }),
        ...(r.kwh_each       != null && { kwhEach:      Number(r.kwh_each)       }),
        ...(r.kw_each        != null && { kwEach:       Number(r.kw_each)        }),
        ...(r.unit_weight_kg != null && { unitWeightKg: Number(r.unit_weight_kg) }),
      }
    }

    function zoneItem(key, def) {
      const r = byKey[key]
      if (!r) return def
      return { ...def, sku: r.sku, description: r.description, cost: Number(r.buying_price_kes) }
    }

    return {
      tiers: {
        premium: {
          ...DEFAULT_TIERS.premium,
          panel:    tierItem('premium_panel',    DEFAULT_TIERS.premium.panel),
          inverter: tierItem('premium_inverter', DEFAULT_TIERS.premium.inverter),
          battery:  tierItem('premium_battery',  DEFAULT_TIERS.premium.battery),
        },
        balanced: {
          ...DEFAULT_TIERS.balanced,
          panel:    tierItem('balanced_panel',    DEFAULT_TIERS.balanced.panel),
          inverter: tierItem('balanced_inverter', DEFAULT_TIERS.balanced.inverter),
          battery:  tierItem('balanced_battery',  DEFAULT_TIERS.balanced.battery),
        },
        budget: {
          ...DEFAULT_TIERS.budget,
          panel:    tierItem('budget_panel',    DEFAULT_TIERS.budget.panel),
          inverter: tierItem('budget_inverter', DEFAULT_TIERS.budget.inverter),
          battery:  tierItem('budget_battery',  DEFAULT_TIERS.budget.battery),
        },
      },
      zones: {
        zoneA: [
          zoneItem('zoneA_breaker', DEFAULT_ZONES.zoneA[0]),
          zoneItem('zoneA_spd',     DEFAULT_ZONES.zoneA[1]),
          zoneItem('zoneA_fuse',    DEFAULT_ZONES.zoneA[2]),
          zoneItem('zoneA_cable6',  DEFAULT_ZONES.zoneA[3]),
          zoneItem('zoneA_cable10', DEFAULT_ZONES.zoneA[4]),
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
