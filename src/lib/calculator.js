// RhiPower Engineering Calculator
// Pure functions — no UI, no side effects. Input data in, results out.

import { DEFAULT_PRODUCTS, TIER_META, ZONES as DEFAULT_ZONES } from '../data/skuInventory.js'
import { pickDefaultProduct } from './tierProducts.js'
import { calculateStringBalancing } from './stringBalancing.ts'

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

// The margin every item prices at unless it carries its own override
// (inventory_prices.margin_pct, migration 033) — kept as one named
// constant since it used to be a bare `* 1.35` scattered across this file
// and Admin.jsx.
export const DEFAULT_MARGIN_PCT = 35
export function sellPrice(cost, marginPct) {
  const margin = marginPct != null ? marginPct : DEFAULT_MARGIN_PCT
  return cost * (1 + margin / 100)
}

// Per-unit selling price for a BOM line, given how many units this quote
// needs. A wholesale tier (migration 033) is a hard cutoff, not a sliding
// scale: below wholesaleMinQty the line prices at the normal margin: at or
// above it, every unit in the line switches to wholesalePriceKes. Both
// fields must be set on the item for the tier to apply at all.
export function unitSellPrice(item, qty) {
  if (item.wholesalePriceKes != null && item.wholesaleMinQty != null && qty >= item.wholesaleMinQty) {
    return item.wholesalePriceKes
  }
  return sellPrice(item.cost, item.marginPct)
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
  let hardwareSellBase  = 0  // sum of unitSellPrice(item, qty) * qty — respects per-item margin/wholesale overrides
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

  // 3. INVERTER SIZING (continuous/surge running load)
  const neededInverterKW = Math.max((totalRunningWatts / 1000) * 1.25, maxSurgeWatts / 1000)
  let inverterQty        = Math.max(1, Math.ceil(neededInverterKW / inverter.kwEach))
  let totalInverterKW    = inverterQty * inverter.kwEach

  // 4. BATTERY SIZING — scaled by backupDays. DoD uses the selected
  // battery's real datasheet figure (migration 029's dodPct) once entered;
  // falls back to the original flat 80% floor when it's still blank, which
  // is every product until real specs are added — today's numbers for
  // existing inventory are unchanged.
  const dodFraction      = battery.dodPct != null ? battery.dodPct / 100 : 0.80
  const totalOvernightWh = overnightEnergyWh * backupDays   // multiply by chosen backup days
  const neededUsableKWh  = (totalOvernightWh / 1000) / dodFraction
  let batteryQty         = Math.max(1, Math.ceil(neededUsableKWh / battery.kwhEach))
  let trueBattKWh        = Math.round(batteryQty * battery.kwhEach * 10) / 10

  // 4b. C-RATE / SURGE CROSS-CHECK — bumps quantities up (never down) when a
  // real datasheet number reveals the energy-only sizing above isn't enough
  // to actually deliver the power needed. Both only engage once the
  // relevant spec is entered; with today's inventory (no products have
  // maxChargeRateC/surgePowerW set yet) these are no-ops.
  let batteryUpsizedForCRate = false
  if (battery.maxChargeRateC != null) {
    // Battery bank's max continuous discharge power must cover the sized
    // inverter's continuous draw, not just hold enough total energy.
    const minKWhForInverterLoad = totalInverterKW / battery.maxChargeRateC
    if (minKWhForInverterLoad > trueBattKWh) {
      batteryQty  = Math.max(batteryQty, Math.ceil(minKWhForInverterLoad / battery.kwhEach))
      trueBattKWh = Math.round(batteryQty * battery.kwhEach * 10) / 10
      batteryUpsizedForCRate = true
    }
  }
  let inverterUpsizedForSurge = false
  if (inverter.surgePowerW != null) {
    // Real datasheet surge rating, replacing the flat 1.25× guess used for
    // neededInverterKW above once it's known.
    const minInvertersForSurge = Math.ceil(maxSurgeWatts / inverter.surgePowerW)
    if (minInvertersForSurge > inverterQty) {
      inverterQty     = minInvertersForSurge
      totalInverterKW = inverterQty * inverter.kwEach
      inverterUpsizedForSurge = true
    }
  }

  // 5. SOLAR PANEL SIZING — derated for real-world heat if the panel's
  // temperature coefficient is known (migration 029's tempCoefficientPctC);
  // falls back to nameplate wattage, today's exact behavior, when blank.
  const ASSUMED_CELL_OPERATING_TEMP_C = 60  // rooftop-mounted module in Kenyan sun vs. the 25°C STC rating reference
  const tempDerateFactor = panel.tempCoefficientPctC != null
    ? 1 + (panel.tempCoefficientPctC / 100) * (ASSUMED_CELL_OPERATING_TEMP_C - 25)
    : 1
  const effectiveWattsEach = panel.wattsEach * tempDerateFactor
  const daytimeKWh = (totalRunningWatts * 7) / 1000  // ~7 hours of daytime load
  const neededPVkW = (trueBattKWh + daytimeKWh) / peakSunHours
  const panelQty   = Math.max(1, Math.ceil((neededPVkW * 1000) / effectiveWattsEach))
  // Nameplate total (not derated) — the customer-facing kWp figure should
  // read as the panels' rated capacity, not the heat-adjusted effective one.
  const truePVkW   = (panelQty * panel.wattsEach) / 1000

  // 5b. MPPT STRING BALANCING — only engages once the selected panel has
  // Voc/Vmp/Isc (migration 031's vocV, plus 029's nominalVoltageV/
  // maxCurrentAmps reused as Vmp/Isc) and the selected inverter has its
  // MPPT window populated. Today's inventory has none of this, so
  // stringConfig stays null and the crude "16 panels per combiner branch"
  // guess below is used exactly as it always has been.
  let stringConfig = null
  if (panel.vocV != null && panel.nominalVoltageV != null && panel.maxCurrentAmps != null &&
      inverter.maxInputVoltageV != null && inverter.mpptMinVoltageV != null && inverter.maxCurrentAmps != null) {
    const balancing = calculateStringBalancing(
      { vocV: panel.vocV, vmpV: panel.nominalVoltageV, iscA: panel.maxCurrentAmps, tempCoefficientPctC: panel.tempCoefficientPctC ?? 0 },
      { maxInputVoltageV: inverter.maxInputVoltageV, mpptMinVoltageV: inverter.mpptMinVoltageV, maxCurrentAmps: inverter.maxCurrentAmps, mpptCount: inverter.mpptCount || 1 },
    )
    if (balancing.isCompatible) {
      // As close to maxPanelsPerString as the actual panel count allows —
      // fewer, longer strings means fewer combiner-box parts.
      const panelsPerString = Math.max(balancing.minPanelsPerString, Math.min(balancing.maxPanelsPerString, panelQty))
      const stringCount     = Math.ceil(panelQty / panelsPerString)
      const stringsPerInverterUnit = balancing.maxParallelStringsPerMppt * (inverter.mpptCount || 1)
      let inverterUpsizedForStrings = false
      if (stringCount > stringsPerInverterUnit * inverterQty) {
        // Never blocks the quote — bumps inverter quantity so there's
        // enough MPPT capacity to actually host every string, same
        // non-blocking upsize pattern as the C-rate/surge checks above.
        inverterQty     = Math.max(inverterQty, Math.ceil(stringCount / stringsPerInverterUnit))
        totalInverterKW = inverterQty * inverter.kwEach
        inverterUpsizedForStrings = true
      }
      stringConfig = {
        panelsPerString, stringCount, inverterUpsizedForStrings,
        mpptTrackersUsed: Math.min((inverter.mpptCount || 1) * inverterQty, stringCount),
      }
    } else {
      stringConfig = { bottleneckReason: balancing.bottleneckReason }
    }
  }
  const stringsForBOM = stringConfig?.stringCount ?? Math.ceil(panelQty / 16)

  // 6. CABLE SIZING
  const cableIsHeavy = wireDistM > 120
  const cableSKU     = cableIsHeavy ? z.zoneA[4] : z.zoneA[3]
  const cableSpec    = cableIsHeavy
    ? `10mm² Copper DC Solar Cable (required for ${wireDistM}m run — keeps voltage drop below 2%)`
    : `6mm² Copper DC Solar Cable (suitable for ${wireDistM}m run)`
  const cableMeters  = Math.ceil(wireDistM * 2 * stringsForBOM)

  // 7. ZONE A BOM (Solar Combiner Box)
  const qtyBreaker = inverterQty * 2
  const qtySPD     = inverterQty * 2
  const qtyFuses   = stringsForBOM * 2

  // Mounting scales with array size (Ksh/kWp); earthing/lightning protection is
  // one code-mandated kit per system regardless of size.
  hardwareSellBase += panelQty    * unitSellPrice(panel, panelQty)
  hardwareSellBase += qtyBreaker  * unitSellPrice(z.zoneA[0], qtyBreaker)
  hardwareSellBase += qtySPD      * unitSellPrice(z.zoneA[1], qtySPD)
  hardwareSellBase += qtyFuses    * unitSellPrice(z.zoneA[2], qtyFuses)
  hardwareSellBase += cableMeters * unitSellPrice(cableSKU, cableMeters)
  hardwareSellBase += truePVkW    * unitSellPrice(z.zoneA[5], truePVkW)
  hardwareSellBase += unitSellPrice(z.zoneA[6], 1)

  const zoneA = [
    { qty: panelQty,                     label: panel.description,      sku: panel.sku,     roleKey: panel.roleKey,       vatStatus: panel.vatStatus || 'standard' },
    { qty: qtyBreaker,                   label: z.zoneA[0].description, roleKey: z.zoneA[0].roleKey, vatStatus: z.zoneA[0].vatStatus || 'standard' },
    { qty: qtySPD,                       label: z.zoneA[1].description, roleKey: z.zoneA[1].roleKey, vatStatus: z.zoneA[1].vatStatus || 'standard' },
    { qty: qtyFuses,                     label: z.zoneA[2].description, roleKey: z.zoneA[2].roleKey, vatStatus: z.zoneA[2].vatStatus || 'standard' },
    { qty: `${cableMeters}m`,            label: cableSpec,              roleKey: cableSKU.roleKey,   vatStatus: cableSKU.vatStatus || 'standard' },
    { qty: `${truePVkW.toFixed(1)} kWp`, label: z.zoneA[5].description, sku: z.zoneA[5].sku, roleKey: z.zoneA[5].roleKey, vatStatus: z.zoneA[5].vatStatus || 'standard' },
    { qty: 1,                            label: z.zoneA[6].description, sku: z.zoneA[6].sku, roleKey: z.zoneA[6].roleKey, vatStatus: z.zoneA[6].vatStatus || 'standard' },
  ]

  // 8. ZONE B BOM (Battery Combiner)
  const lugM8Qty  = batteryQty * 2
  const lugM10Qty = inverterQty * 2
  const batCableM = batteryQty * 4

  hardwareSellBase += batteryQty  * unitSellPrice(battery, batteryQty)
  hardwareSellBase += inverterQty * unitSellPrice(inverter, inverterQty)
  hardwareSellBase += unitSellPrice(z.zoneB[0], 1)
  hardwareSellBase += unitSellPrice(z.zoneB[1], 1)
  hardwareSellBase += lugM8Qty  * unitSellPrice(z.zoneB[2], lugM8Qty)
  hardwareSellBase += lugM10Qty * unitSellPrice(z.zoneB[3], lugM10Qty)
  hardwareSellBase += batCableM * unitSellPrice(z.zoneB[4], batCableM)

  const zoneB = [
    { qty: batteryQty,       label: battery.description,  sku: battery.sku,  roleKey: battery.roleKey,  vatStatus: battery.vatStatus  || 'standard' },
    { qty: inverterQty,      label: inverter.description, sku: inverter.sku, roleKey: inverter.roleKey, vatStatus: inverter.vatStatus || 'standard' },
    { qty: 1,                label: z.zoneB[0].description, roleKey: z.zoneB[0].roleKey, vatStatus: z.zoneB[0].vatStatus || 'standard' },
    { qty: 1,                label: z.zoneB[1].description, roleKey: z.zoneB[1].roleKey, vatStatus: z.zoneB[1].vatStatus || 'standard' },
    { qty: lugM8Qty,         label: z.zoneB[2].description, roleKey: z.zoneB[2].roleKey, vatStatus: z.zoneB[2].vatStatus || 'standard' },
    { qty: lugM10Qty,        label: z.zoneB[3].description, roleKey: z.zoneB[3].roleKey, vatStatus: z.zoneB[3].vatStatus || 'standard' },
    { qty: `${batCableM}m`,  label: z.zoneB[4].description, roleKey: z.zoneB[4].roleKey, vatStatus: z.zoneB[4].vatStatus || 'standard' },
  ]

  // 9. ZONE C BOM (AC Distribution)
  hardwareSellBase += unitSellPrice(z.zoneC[0], 1)
  hardwareSellBase += unitSellPrice(z.zoneC[1], 1)
  if (heavyMotorCount > 0) hardwareSellBase += heavyMotorCount * unitSellPrice(z.zoneC[2], heavyMotorCount)

  const zoneC = [
    { qty: 1,              label: z.zoneC[0].description, roleKey: z.zoneC[0].roleKey, vatStatus: z.zoneC[0].vatStatus || 'standard' },
    { qty: 1,              label: z.zoneC[1].description, roleKey: z.zoneC[1].roleKey, vatStatus: z.zoneC[1].vatStatus || 'standard' },
    ...(heavyMotorCount > 0
      ? [{ qty: heavyMotorCount, label: z.zoneC[2].description + ' — pump load-shedding circuits', roleKey: z.zoneC[2].roleKey, vatStatus: z.zoneC[2].vatStatus || 'standard' }]
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

  // 12. TOTALS — materials price per line item, respecting each item's own
  // margin override and wholesale quantity break (migration 033) instead
  // of one flat 35% applied to the whole hardware total.
  const materialsAtSellPrice = hardwareSellBase
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
      // Only meaningful once real datasheet specs are entered on a product
      // (migration 029) — dodPctUsed stays 80 and tempDerateFactor stays 1
      // for every quote until then, matching today's exact behavior.
      dodPctUsed:              Math.round(dodFraction * 1000) / 10,
      tempDerateFactor:        Math.round(tempDerateFactor * 1000) / 1000,
      batteryUpsizedForCRate,
      inverterUpsizedForSurge,
      // Only populated once the selected panel + inverter both have full
      // MPPT electrical specs (migration 031) — null for every quote until
      // then, and the Zone A BOM falls back to the /16 heuristic.
      stringConfig,
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
