// Shared spec-row formatting for panel/inverter/battery products — used by
// both the Step3 comparison picker and the full product detail page, so the
// two never drift out of sync on what counts as a "spec".
export function productSpecRows(category, p) {
  const rows = []
  if (category === 'panel') {
    if (p.wattsEach)        rows.push(['Output', `${p.wattsEach}W`])
    if (p.efficiencyPct)    rows.push(['Efficiency', `${p.efficiencyPct}%`])
    if (p.warrantyYears)    rows.push(['Warranty', `${p.warrantyYears} yr`])
    if (p.degradationPctYr) rows.push(['Degradation', `${p.degradationPctYr}%/yr`])
  } else if (category === 'inverter') {
    if (p.kwEach)        rows.push(['Capacity', `${p.kwEach} kW`])
    if (p.efficiencyPct) rows.push(['Efficiency', `${p.efficiencyPct}%`])
    if (p.mpptCount)     rows.push(['MPPT', `${p.mpptCount}`])
    if (p.phase)         rows.push(['Phase', p.phase])
    if (p.warrantyYears) rows.push(['Warranty', `${p.warrantyYears} yr`])
  } else if (category === 'battery') {
    if (p.kwhEach)       rows.push(['Capacity', `${p.kwhEach} kWh`])
    if (p.cycleLife)     rows.push(['Cycle life', `${p.cycleLife.toLocaleString()}`])
    if (p.dodPct)        rows.push(['DoD', `${p.dodPct}%`])
    if (p.warrantyYears) rows.push(['Warranty', `${p.warrantyYears} yr`])
  }
  return rows
}

export const CATEGORY_ICON = { panel: '☀️', inverter: '⚡', battery: '🔋' }
export const CATEGORY_LABEL = { panel: 'Solar Panel', inverter: 'Inverter', battery: 'Battery' }
