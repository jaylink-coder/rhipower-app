// RhiPower Engineering Calculator
// Pure functions — no UI, no side effects. Input data in, results out.

import { TIERS as DEFAULT_TIERS, ZONES as DEFAULT_ZONES } from '../data/skuInventory.js'

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

export function runCalculation(siteConfig, allAppliances, quantities, inventory = null) {
  const {
    location, wireDistM, siteKm,
    tier       = 'balanced',
    backupDays = 1,
  } = siteConfig

  const TIERS = inventory?.tiers || DEFAULT_TIERS
  const ZONES = inventory?.zones || DEFAULT_ZONES
  const t = TIERS[tier]
  const z = ZONES

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
  const inverterQty      = Math.max(1, Math.ceil(neededInverterKW / t.inverter.kwEach))
  const totalInverterKW  = inverterQty * t.inverter.kwEach

  // 4. BATTERY SIZING — scaled by backupDays (80% DOD safety floor)
  const totalOvernightWh = overnightEnergyWh * backupDays   // multiply by chosen backup days
  const neededUsableKWh  = (totalOvernightWh / 1000) / 0.80
  const batteryQty       = Math.max(1, Math.ceil(neededUsableKWh / t.battery.kwhEach))
  const trueBattKWh      = Math.round(batteryQty * t.battery.kwhEach * 10) / 10

  // 5. SOLAR PANEL SIZING
  const daytimeKWh = (totalRunningWatts * 7) / 1000  // ~7 hours of daytime load
  const neededPVkW = (trueBattKWh + daytimeKWh) / peakSunHours
  const panelQty   = Math.max(1, Math.ceil((neededPVkW * 1000) / t.panel.wattsEach))
  const truePVkW   = (panelQty * t.panel.wattsEach) / 1000

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

  hardwareCostBase += panelQty    * t.panel.cost
  hardwareCostBase += qtyBreaker  * z.zoneA[0].cost
  hardwareCostBase += qtySPD      * z.zoneA[1].cost
  hardwareCostBase += qtyFuses    * z.zoneA[2].cost
  hardwareCostBase += cableMeters * cableSKU.cost
  hardwareCostBase += mountingCost
  hardwareCostBase += earthingCost

  const zoneA = [
    { qty: panelQty,                     label: t.panel.description,    sku: t.panel.sku },
    { qty: qtyBreaker,                   label: z.zoneA[0].description },
    { qty: qtySPD,                       label: z.zoneA[1].description },
    { qty: qtyFuses,                     label: z.zoneA[2].description },
    { qty: `${cableMeters}m`,            label: cableSpec },
    { qty: `${truePVkW.toFixed(1)} kWp`, label: z.zoneA[5].description, sku: z.zoneA[5].sku },
    { qty: 1,                            label: z.zoneA[6].description, sku: z.zoneA[6].sku },
  ]

  // 8. ZONE B BOM (Battery Combiner)
  const lugM8Qty  = batteryQty * 2
  const lugM10Qty = inverterQty * 2
  const batCableM = batteryQty * 4

  hardwareCostBase += batteryQty  * t.battery.cost
  hardwareCostBase += inverterQty * t.inverter.cost
  hardwareCostBase += z.zoneB[0].cost
  hardwareCostBase += z.zoneB[1].cost
  hardwareCostBase += lugM8Qty  * z.zoneB[2].cost
  hardwareCostBase += lugM10Qty * z.zoneB[3].cost
  hardwareCostBase += batCableM * z.zoneB[4].cost

  const zoneB = [
    { qty: batteryQty,       label: t.battery.description,  sku: t.battery.sku  },
    { qty: inverterQty,      label: t.inverter.description, sku: t.inverter.sku },
    { qty: 1,                label: z.zoneB[0].description },
    { qty: 1,                label: z.zoneB[1].description },
    { qty: lugM8Qty,         label: z.zoneB[2].description },
    { qty: lugM10Qty,        label: z.zoneB[3].description },
    { qty: `${batCableM}m`,  label: z.zoneB[4].description },
  ]

  // 9. ZONE C BOM (AC Distribution)
  hardwareCostBase += z.zoneC[0].cost
  hardwareCostBase += z.zoneC[1].cost
  if (heavyMotorCount > 0) hardwareCostBase += heavyMotorCount * z.zoneC[2].cost

  const zoneC = [
    { qty: 1,              label: z.zoneC[0].description },
    { qty: 1,              label: z.zoneC[1].description },
    ...(heavyMotorCount > 0
      ? [{ qty: heavyMotorCount, label: z.zoneC[2].description + ' — pump load-shedding circuits' }]
      : []),
  ]

  // 10. LABOR
  const laborBase      = 20000
  const laborPanels    = panelQty    * 1500
  const laborBatteries = batteryQty  * 5000
  const laborInverters = inverterQty * 7500
  const totalLabor     = laborBase + laborPanels + laborBatteries + laborInverters

  // 11. LOGISTICS
  const totalWeightKg = (panelQty    * t.panel.unitWeightKg) +
                        (batteryQty  * t.battery.unitWeightKg) +
                        (inverterQty * t.inverter.unitWeightKg)

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
    tierLabel: TIERS[tier].label,
    // Pre-formatted strings
    fmt: {
      materials: formatKsh(materialsAtSellPrice),
      labor:     formatKsh(totalLabor),
      logistics: formatKsh(totalLogistics),
      total:     formatKsh(grandTotal),
    },
  }
}
