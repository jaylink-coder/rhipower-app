import { CELL_TYPE_LABELS, INVERTER_TYPE_LABELS, CHEMISTRY_TYPE_LABELS } from './itemSpecSchema.ts'

// Dimensions/operating-temp are stored as separate columns (see migration
// 029) but read better to a customer as one combined row than three/two
// near-identical ones.
function dimensionsRow(p) {
  const parts = [p.lengthMm, p.widthMm, p.thicknessMm].filter(v => v != null)
  if (!parts.length) return null
  return ['Dimensions', `${parts.join(' × ')} mm`]
}
function operatingTempRow(p) {
  if (p.operatingTempMinC != null && p.operatingTempMaxC != null) return ['Operating temp', `${p.operatingTempMinC}°C to ${p.operatingTempMaxC}°C`]
  if (p.operatingTempMinC != null) return ['Operating temp', `From ${p.operatingTempMinC}°C`]
  if (p.operatingTempMaxC != null) return ['Operating temp', `Up to ${p.operatingTempMaxC}°C`]
  return null
}

// Shared spec-row formatting for panel/inverter/battery products — used by
// both the Step3 comparison picker and the full product detail page, so the
// two never drift out of sync on what counts as a "spec".
export function productSpecRows(category, p) {
  const rows = []
  if (category === 'panel') {
    if (p.wattsEach)        rows.push(['Output', `${p.wattsEach}W`])
    if (p.efficiencyPct)    rows.push(['Efficiency', `${p.efficiencyPct}%`])
    if (p.cellType)         rows.push(['Cell type', CELL_TYPE_LABELS[p.cellType] || p.cellType])
    if (p.warrantyYears)    rows.push(['Warranty', `${p.warrantyYears} yr`])
    if (p.degradationPctYr) rows.push(['Degradation', `${p.degradationPctYr}%/yr`])
    if (p.tempCoefficientPctC != null) rows.push(['Temp coefficient', `${p.tempCoefficientPctC}%/°C`])
    if (p.vocV)            rows.push(['Voc (open-circuit)', `${p.vocV}V`])
  } else if (category === 'inverter') {
    if (p.kwEach)         rows.push(['Capacity', `${p.kwEach} kW`])
    if (p.inverterType)   rows.push(['Type', INVERTER_TYPE_LABELS[p.inverterType] || p.inverterType])
    if (p.efficiencyPct)  rows.push(['Efficiency', `${p.efficiencyPct}%`])
    if (p.continuousPowerW) rows.push(['Continuous power', `${p.continuousPowerW}W`])
    if (p.surgePowerW)    rows.push(['Surge power', `${p.surgePowerW}W`])
    if (p.mpptCount)      rows.push(['MPPT', `${p.mpptCount}`])
    if (p.mpptMinVoltageV && p.mpptMaxVoltageV) rows.push(['MPPT window', `${p.mpptMinVoltageV}V–${p.mpptMaxVoltageV}V`])
    if (p.maxInputVoltageV) rows.push(['Max DC input', `${p.maxInputVoltageV}V`])
    if (p.phase)          rows.push(['Phase', p.phase])
    if (p.commProtocols)  rows.push(['Comms', p.commProtocols])
    if (p.warrantyYears)  rows.push(['Warranty', `${p.warrantyYears} yr`])
  } else if (category === 'battery') {
    if (p.kwhEach)          rows.push(['Capacity', `${p.kwhEach} kWh`])
    if (p.chemistryType)    rows.push(['Chemistry', CHEMISTRY_TYPE_LABELS[p.chemistryType] || p.chemistryType])
    if (p.cycleLife)        rows.push(['Cycle life', `${p.cycleLife.toLocaleString()}`])
    if (p.dodPct)           rows.push(['DoD', `${p.dodPct}%`])
    if (p.maxChargeRateC)   rows.push(['Max charge rate', `${p.maxChargeRateC}C`])
    if (p.warrantyYears)    rows.push(['Warranty', `${p.warrantyYears} yr`])
  }
  if (['panel', 'inverter', 'battery'].includes(category)) {
    if (p.nominalVoltageV) rows.push(['Nominal voltage', `${p.nominalVoltageV}V`])
    if (p.maxCurrentAmps)  rows.push(['Max current', `${p.maxCurrentAmps}A`])
    const dims = dimensionsRow(p); if (dims) rows.push(dims)
    const temp = operatingTempRow(p); if (temp) rows.push(temp)
    if (p.ipRating)        rows.push(['IP rating', p.ipRating])
  }
  return rows
}

export const CATEGORY_ICON = { panel: '☀️', inverter: '⚡', battery: '🔋' }
export const CATEGORY_LABEL = { panel: 'Solar Panel', inverter: 'Inverter', battery: 'Battery' }
