// MPPT string-balancing — checks whether a chosen panel and inverter can
// actually be wired together safely, given Kenya's real temperature swings.
// A panel's Voc rises in the cold (risking exceeding the inverter's
// absolute max DC input on a cold morning) and its Vmp drops in the heat
// (risking falling below the MPPT tracker's minimum operating voltage on a
// hot rooftop) — both have to be checked against record-ish local extremes,
// not the 25°C STC rating on the datasheet.
//
// RhiPower's second TypeScript file (see ItemForm.tsx for the first) — a
// pure calculation module with no UI, matching calculator.js's own
// "pure functions, no side effects" convention.

export interface PanelElectricalInput {
  vocV: number                // open-circuit voltage (V)
  vmpV: number                // max-power voltage (V) — panel.nominalVoltageV
  iscA: number                // short-circuit current (A) — panel.maxCurrentAmps
  tempCoefficientPctC: number // %/°C power/voltage loss above 25°C STC, typically negative
}

export interface InverterMpptInput {
  maxInputVoltageV: number   // absolute ceiling before damage
  mpptMinVoltageV: number    // MPPT tracking window floor
  maxCurrentAmps: number     // max current per MPPT tracker
  mpptCount: number          // number of independent MPPT trackers on one inverter unit
}

export interface StringBalancingOptions {
  recordColdestTempC?: number  // default: a cold highland Kenyan night
  recordHottestTempC?: number  // default: a hot rooftop-in-direct-sun day
}

export interface StringBalancingResult {
  isCompatible: boolean
  minPanelsPerString: number
  maxPanelsPerString: number
  maxParallelStringsPerMppt: number
  bottleneckReason?: string
}

export function calculateStringBalancing(
  panel: PanelElectricalInput,
  inverter: InverterMpptInput,
  opts?: StringBalancingOptions,
): StringBalancingResult {
  const recordColdestTempC = opts?.recordColdestTempC ?? 5
  const recordHottestTempC = opts?.recordHottestTempC ?? 45

  // Voltage rises as temperature drops below the 25°C STC reference —
  // worst case for the max-panels-per-string ceiling is the coldest morning.
  const tempDeltaCold = recordColdestTempC - 25
  const worstCaseVoc = panel.vocV * (1 + (panel.tempCoefficientPctC / 100) * tempDeltaCold)

  // Voltage drops as temperature rises above 25°C — worst case for the
  // min-panels-per-string floor is the hottest rooftop day.
  const tempDeltaHot = recordHottestTempC - 25
  const worstCaseVmp = panel.vmpV * (1 + (panel.tempCoefficientPctC / 100) * tempDeltaHot)

  // Ceiling checked against the inverter's absolute max DC input (a hard
  // damage limit), not the MPPT window's own upper bound — a string that
  // briefly tracks less efficiently near the top of the MPPT range is a
  // minor loss; exceeding maxInputVoltageV can damage the inverter.
  const maxPanelsPerString = Math.floor(inverter.maxInputVoltageV / worstCaseVoc)
  const minPanelsPerString = Math.ceil(inverter.mpptMinVoltageV / worstCaseVmp)
  const maxParallelStringsPerMppt = Math.floor(inverter.maxCurrentAmps / panel.iscA)

  let isCompatible = true
  let bottleneckReason: string | undefined

  if (minPanelsPerString > maxPanelsPerString) {
    isCompatible = false
    bottleneckReason = "This inverter's MPPT window is too narrow for this panel's electrical profile — no valid string length works."
  } else if (maxParallelStringsPerMppt < 1) {
    isCompatible = false
    bottleneckReason = "This panel's short-circuit current (Isc) exceeds the inverter's max MPPT input current."
  }

  return {
    isCompatible,
    minPanelsPerString,
    maxPanelsPerString,
    maxParallelStringsPerMppt,
    ...(bottleneckReason ? { bottleneckReason } : {}),
  }
}
