// RhiPower SKU Inventory — mapped to physical installation zones
// Tier (premium/balanced/budget) is DERIVED from price via DEFAULT_PRICE_BANDS
// (see migration 007) — it is no longer a label assigned per product, so a
// category can hold any number of products and several can share a tier.
// All costs in KES (Kenyan Shillings) at wholesale buying price.

export const TIER_META = {
  premium:  { label: '⭐ Premium Tier',  description: 'The highest-spec options available — best efficiency, longest warranties.' },
  balanced: { label: '✅ Balanced Tier', description: 'The best value-for-money band — dependable, widely-serviced brands.' },
  budget:   { label: '💡 Budget Tier',   description: 'Cost-effective options for smaller systems and tighter budgets.' },
}

// Starting ranges — must match migration 007's seed. Editable from the admin
// panel; changing these there does not require touching this file, since the
// live app always prefers whatever price_bands holds in Supabase.
export const DEFAULT_PRICE_BANDS = {
  panel:    { budget: [0, 16000],  balanced: [16000, 19000],  premium: [19000, null] },
  inverter: { budget: [0, 150000], balanced: [150000, 350000], premium: [350000, null] },
  battery:  { budget: [0, 250000], balanced: [250000, 400000], premium: [400000, null] },
}

// Flat per-category product lists — any number of entries per category.
// Comparison-spec fields (efficiencyPct, warrantyYears, degradationPctYr,
// mpptCount, phase, cycleLife, dodPct) are left undefined here by design;
// real figures live in Supabase, entered from the admin "Add/Edit Item" page.
export const DEFAULT_PRODUCTS = {
  panel: [
    { roleKey: 'budget_panel',    sku: 'GEN-MONO-550W',  description: 'Tier-1 550W Monocrystalline Solar Module',    cost: 14500, wattsEach: 550, unitWeightKg: 28   },
    { roleKey: 'balanced_panel',  sku: 'LR7-72HGD-620M', description: 'LONGi Hi-MO 7 620W Bifacial Dual-Glass Panel', cost: 18500, wattsEach: 620, unitWeightKg: 33.5 },
  ],
  inverter: [
    { roleKey: 'budget_inverter',   sku: 'GROWATT-SPF5000ES',   description: 'Growatt SPF 5000 ES 5kW Hybrid Inverter',                    cost: 83000,  kwEach: 5,  unitWeightKg: 12 },
    { roleKey: 'balanced_inverter', sku: 'DEYE-SUN12K-SG04LP3', description: 'Deye SUN-12K-SG04LP3-EU 12kW 3-Phase 2-MPPT Hybrid Inverter', cost: 270000, kwEach: 12, unitWeightKg: 36 },
    { roleKey: 'premium_inverter',  sku: 'VIC-QUAT-48-15K',     description: 'Victron Energy Quattro 15kVA Premium Inverter/Charger',      cost: 420000, kwEach: 15, unitWeightKg: 45 },
  ],
  battery: [
    { roleKey: 'budget_battery',   sku: 'GEN-WALL-10KWH',    description: 'Market Standard 10.2kWh Lithium Battery Pack',        cost: 195000, kwhEach: 10.2, unitWeightKg: 85  },
    { roleKey: 'balanced_battery', sku: 'FL-BATT-48V-15KWH', description: 'Felicity 15kWh Premium Lithium LiFePO₄ Battery Pack', cost: 315000, kwhEach: 15,   unitWeightKg: 125 },
    { roleKey: 'premium_battery',  sku: 'BYD-LV-FLEX-15',    description: 'BYD 15.4kWh Premium Lithium LiFePO₄ Battery Pack',    cost: 480000, kwhEach: 15.4, unitWeightKg: 140 },
  ],
}

// Zone components are shared across all tiers — not price-banded, since
// there's one correct spec per job (e.g. cable size is a safety requirement,
// not a brand preference).
export const ZONES = {
  // ─── ZONE A: SOLAR ARRAY COMBINER BOX ───
  zoneA: [
    { sku: 'DC-BREAKER-63A', description: 'Chint NBI-63DC 2-Pole 1000V DC Isolator Breaker',               cost: 3500 },
    { sku: 'DC-SPD-1000V',   description: 'Chint NU6 Type 2 Heavy-Duty DC Surge Protective Device',         cost: 4200 },
    { sku: 'DC-FUSE-15A',    description: 'Mersen 1000V DC Photovoltaic Fuse Holder + Link (15A)',          cost: 850  },
    { sku: 'CABLE-DC-6MM',   description: '6mm² Kinu Copper DC Solar Cable (Per Meter)',                    cost: 180  },
    { sku: 'CABLE-DC-10MM',  description: '10mm² Kinu Copper DC Solar Cable (Per Meter)',                   cost: 280  },
    { sku: 'MOUNT-ALU-KIT',  description: 'Aluminium Roof Mounting Structure (rails, clamps, L-feet) — Per kWp', cost: 14000 },
    { sku: 'EARTH-LA-KIT',   description: 'Earthing & Lightning Protection Kit (rods, arrestor, bonding cable)', cost: 22000 },
  ],

  // ─── ZONE B: BATTERY COMBINER STATION ───
  zoneB: [
    { sku: 'DC-MCCB-400A',   description: 'Chint NM8N 400A 2-Pole High-Current DC Battery MCCB',           cost: 18500 },
    { sku: 'COPPER-BUSBAR',  description: 'Solid Tinned Copper Multi-Battery Interconnection Busbar',       cost: 9000  },
    { sku: 'LUG-50-M8',      description: 'Tinned Heavy-Gauge 50mm² Copper Lug — M8 (Battery Terminals)',  cost: 65    },
    { sku: 'LUG-50-M10',     description: 'Tinned Heavy-Gauge 50mm² Copper Lug — M10 (Inverter Terminals)', cost: 75   },
    { sku: 'CABLE-BAT-50MM', description: '50mm² Flexible Rubber Heat-Resistant Battery Cable (Per Meter)', cost: 1100 },
  ],

  // ─── ZONE C: AC DISTRIBUTION BOARD ───
  zoneC: [
    { sku: 'AC-MCB-3P-63A',  description: 'Chint 3-Phase 63A Mains AC Overload Circuit Breaker',           cost: 4500 },
    { sku: 'SMART-BREAKER',  description: 'Tuya 40A Wi-Fi Smart DIN-Rail Breaker (Method C Rain Automator)', cost: 6500 },
    { sku: 'AC-CONTACTOR-40A', description: 'Chint 40A 2-Pole Heavy-Duty AC Power Contactor Relay',         cost: 3800 },
  ],
}
