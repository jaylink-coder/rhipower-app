// RhiPower Engineering Calculator
// Pure functions — no UI, no side effects. Input data in, results out.

import { DEFAULT_PRODUCTS, TIER_META, ZONES as DEFAULT_ZONES } from '../data/skuInventory.js'
import { pickDefaultProduct } from './tierProducts.js'

const PEAK_SUN_HOURS = {
  nanyuki: 5.5,
  mombasa: 6.0,
  nairobi: 5.0,
  kisumu:  5.8,
  eldoret: 5.3,
}

// Pumps are cut off after 4PM — no overnight battery draw from these
const NIGHT_SHED_IDS = ['borehole', 'pool', 'borehole_pump', 'pool_pump']

export function formatKsh(amount) {
  return 'Ksh ' + Math.round(amount).toLocaleString('en-KE')
}

// `selection` lets a caller (Step3's brand/model picker) override which
// specific product is used per category. When omitted, the cheapest product
// within the active tier is used — same effective behaviour as before
// tiers held exactly one hardcoded product each.
export function runCalculation(siteConfig, allAppliances, quantities, inventory = null, selection = null) {
  const {
    location, wireDistM, siteKm,
    tier       = 'balanced',
    backupDays = 1,
  } = siteConfig

  const products = inventory?.products || DEFAULT_PRODUCTS
  const ZONES    = inventory?.zones    || DEFAULT_ZONES
  const z = ZONES

  const panel    = selection?.panel    || pickDefaultProduct(products.panel,    tier) || products.panel[0]
  const inverter = selection?.inverter || pickDefaultProduct(products.inverter, tier) || products.inverter[0]
  const battery  = selection?.battery  || pickDefaultProduct(products.battery,  tier) || products.battery[0]
  if (!panel || !inverter || !battery) return null

  // 1. AGGREGATE LOADS
  let totalRunningWatts = 0
  let maxSurgeWatts     = 0
  let overnightEnergyWh = 0   // per single day
  let heavyMotorCount   = 0
  let hardwareCostBase  = 0
  const surgeAppliances = []  // for engineer's notes

  allAppliances.forEach(app => {
    const qty = quantities[app.id] || 0
    if (qty <= 0) return

    const runW   = app.watts * qty
    const surgeW = runW * app.surgeFactor

    totalRunningWatts += runW
    if (surgeW > maxSurgeWatts) maxSurgeWatts = surgeW

    if (app.surgeFactor >= 3 && runW >= 1500) {
      heavyMotorCount++
      surgeAppliances.push({ name: app.name, runW, surgeW, surgeF: app.surgeFactor })
    }

    if (!NIGHT_SHED_IDS.includes(app.id)) {
      overnightEnergyWh += runW * 14.5 * 0.5  // 14.5 hrs night at 50% avg duty
    }
  })

  if (totalRunningWatts === 0) return null

  // 2. PEAK SUN HOURS — use real NASA data if available, else fallback table
  const peakSunHours = siteConfig.psh || PEAK_SUN_HOURS[location] || 5.5

  // 3. INVERTER SIZING
  const neededInverterKW = Math.max((totalRunningWatts / 1000) * 1.25, maxSurgeWatts / 1000)
  const inverterQty      = Math.max(1, Math.ceil(neededInverterKW / inverter.kwEach))
  const totalInverterKW  = inverterQty * inverter.kwEach

  // 4. BATTERY SIZING — scaled by backupDays (80% DOD safety floor)
  const totalOvernightWh = overnightEnergyWh * backupDays   // multiply by chosen backup days
  const neededUsableKWh  = (totalOvernightWh / 1000) / 0.80
  const batteryQty       = Math.max(1, Math.ceil(neededUsableKWh / battery.kwhEach))
  const trueBattKWh      = Math.round(batteryQty * battery.kwhEach * 10) / 10

  // 5. SOLAR PANEL SIZING
  const daytimeKWh = (totalRunningWatts * 7) / 1000  // ~7 hours of daytime load
  const neededPVkW = (trueBattKWh + daytimeKWh) / peakSunHours
  const panelQty   = Math.max(1, Math.ceil((neededPVkW * 1000) / panel.wattsEach))
  const truePVkW   = (panelQty * panel.wattsEach) / 1000

  // 6. CABLE SIZING
  const cableIsHeavy = wireDistM > 120
  const cableSKU     = cableIsHeavy ? z.zoneA[4] : z.zoneA[3]
  const cableSpec    = cableIsHeavy
    ? `10mm² Copper DC Solar Cable (required for ${wireDistM}m run — keeps voltage drop below 2%)`
    : `6mm² Copper DC Solar Cable (suitable for ${wireDistM}m run)`
  const cableMeters  = Math.ceil(wireDistM * 2 * Math.ceil(panelQty / 16))

  // 7. ZONE A BOM (Solar Combiner Box)
  const qtyBreaker = inverterQty * 2
  const qtySPD     = inverterQty * 2
  const qtyFuses   = Math.ceil(panelQty / 16) * 2

  // Mounting scales with array size (Ksh/kWp); earthing/lightning protection is
  // one code-mandated kit per system regardless of size.
  const mountingCost = truePVkW * z.zoneA[5].cost
  const earthingCost = z.zoneA[6].cost

  hardwareCostBase += panelQty    * panel.cost
  hardwareCostBase += qtyBreaker  * z.zoneA[0].cost
  hardwareCostBase += qtySPD      * z.zoneA[1].cost
  hardwareCostBase += qtyFuses    * z.zoneA[2].cost
  hardwareCostBase += cableMeters * cableSKU.cost
  hardwareCostBase += mountingCost
  hardwareCostBase += earthingCost

  const zoneA = [
    { qty: panelQty,                     label: panel.description,      sku: panel.sku,     roleKey: panel.roleKey },
    { qty: qtyBreaker,                   label: z.zoneA[0].description, roleKey: z.zoneA[0].roleKey },
    { qty: qtySPD,                       label: z.zoneA[1].description, roleKey: z.zoneA[1].roleKey },
    { qty: qtyFuses,                     label: z.zoneA[2].description, roleKey: z.zoneA[2].roleKey },
    { qty: `${cableMeters}m`,            label: cableSpec,              roleKey: cableSKU.roleKey },
    { qty: `${truePVkW.toFixed(1)} kWp`, label: z.zoneA[5].description, sku: z.zoneA[5].sku, roleKey: z.zoneA[5].roleKey },
    { qty: 1,                            label: z.zoneA[6].description, sku: z.zoneA[6].sku, roleKey: z.zoneA[6].roleKey },
  ]

  // 8. ZONE B BOM (Battery Combiner)
  const lugM8Qty  = batteryQty * 2
  const lugM10Qty = inverterQty * 2
  const batCableM = batteryQty * 4

  hardwareCostBase += batteryQty  * battery.cost
  hardwareCostBase += inverterQty * inverter.cost
  hardwareCostBase += z.zoneB[0].cost
  hardwareCostBase += z.zoneB[1].cost
  hardwareCostBase += lugM8Qty  * z.zoneB[2].cost
  hardwareCostBase += lugM10Qty * z.zoneB[3].cost
  hardwareCostBase += batCableM * z.zoneB[4].cost

  const zoneB = [
    { qty: batteryQty,       label: battery.description,  sku: battery.sku,  roleKey: battery.roleKey  },
    { qty: inverterQty,      label: inverter.description, sku: inverter.sku, roleKey: inverter.roleKey },
    { qty: 1,                label: z.zoneB[0].description, roleKey: z.zoneB[0].roleKey },
    { qty: 1,                label: z.zoneB[1].description, roleKey: z.zoneB[1].roleKey },
    { qty: lugM8Qty,         label: z.zoneB[2].description, roleKey: z.zoneB[2].roleKey },
    { qty: lugM10Qty,        label: z.zoneB[3].description, roleKey: z.zoneB[3].roleKey },
    { qty: `${batCableM}m`,  label: z.zoneB[4].description, roleKey: z.zoneB[4].roleKey },
  ]

  // 9. ZONE C BOM (AC Distribution)
  hardwareCostBase += z.zoneC[0].cost
  hardwareCostBase += z.zoneC[1].cost
  if (heavyMotorCount > 0) hardwareCostBase += heavyMotorCount * z.zoneC[2].cost

  const zoneC = [
    { qty: 1,              label: z.zoneC[0].description, roleKey: z.zoneC[0].roleKey },
    { qty: 1,              label: z.zoneC[1].description, roleKey: z.zoneC[1].roleKey },
    ...(heavyMotorCount > 0
      ? [{ qty: heavyMotorCount, label: z.zoneC[2].description + ' — pump load-shedding circuits', roleKey: z.zoneC[2].roleKey }]
      : []),
  ]

  // 10. LABOR
  const laborBase      = 20000
  const laborPanels    = panelQty    * 1500
  const laborBatteries = batteryQty  * 5000
  const laborInverters = inverterQty * 7500
  const totalLabor     = laborBase + laborPanels + laborBatteries + laborInverters

  // 11. LOGISTICS
  const totalWeightKg = (panelQty    * panel.unitWeightKg) +
                        (batteryQty  * battery.unitWeightKg) +
                        (inverterQty * inverter.unitWeightKg)

  let ratePerKm = 40
  if (totalWeightKg > 250)  ratePerKm = 70
  if (totalWeightKg > 1000) ratePerKm = 120

  const transportCost = siteKm * 2 * ratePerKm
  let perDiemCost = 0
  if (siteKm > 80) {
    const techCount   = 4
    const installDays = Math.max(2, Math.ceil(panelQty / 20))
    perDiemCost       = techCount * installDays * 2500
  }
  const totalLogistics = transportCost + perDiemCost

  // 12. TOTALS (35% margin on materials)
  const materialsAtSellPrice = hardwareCostBase * 1.35
  const grandTotal           = materialsAtSellPrice + totalLabor + totalLogistics

  return {
    // Core sizing
    panelQty, truePVkW, inverterQty, totalInverterKW, batteryQty, trueBattKWh,
    // BOM
    zoneA, zoneB, zoneC,
    // Financials
    materialsAtSellPrice, totalLabor, totalLogistics, grandTotal,
    // Engineer's raw numbers — for transparent explanation panel
    engineering: {
      totalRunningWatts,
      maxSurgeWatts,
      overnightEnergyWhPerDay: overnightEnergyWh,
      totalOvernightWh,
      neededInverterKW:  Math.round(neededInverterKW * 10) / 10,
      neededUsableKWh:   Math.round(neededUsableKWh * 10) / 10,
      neededPVkW:        Math.round(neededPVkW * 10) / 10,
      daytimeKWh:        Math.round(daytimeKWh * 10) / 10,
      peakSunHours,
      backupDays,
      surgeAppliances,
      cableSpec,
      cableIsHeavy,
    },
    // Metadata
    heavyMotorCount, wireDistM, siteKm, totalWeightKg,
    tierLabel: TIER_META[tier]?.label,
    // Which specific products were used, and what else was available in this
    // tier — Step3's brand/model picker renders straight from these.
    selectedProducts:  { panel, inverter, battery },
    availableProducts: {
      panel:    products.panel.filter(p => p.tier === tier),
      inverter: products.inverter.filter(p => p.tier === tier),
      battery:  products.battery.filter(p => p.tier === tier),
    },
    // Pre-formatted strings
    fmt: {
      materials: formatKsh(materialsAtSellPrice),
      labor:     formatKsh(totalLabor),
      logistics: formatKsh(totalLogistics),
      total:     formatKsh(grandTotal),
    },
  }
}
