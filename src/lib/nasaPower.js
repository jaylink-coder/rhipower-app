// NASA POWER Climatology API — free, no key required
// Returns real multi-year average solar radiation for any coordinate on Earth
// Data source: NASA Langley Research Center POWER Project
// https://power.larc.nasa.gov/

// Kenya city coordinates (lat, lon)
export const KENYA_LOCATIONS = {
  nanyuki: { label: 'Nanyuki / Laikipia Plateau',    lat: -0.0167, lon: 37.0667, fallbackPSH: 5.5 },
  nairobi: { label: 'Nairobi / Central Highlands',   lat: -1.2921, lon: 36.8219, fallbackPSH: 5.0 },
  mombasa: { label: 'Mombasa / Coastal Region',      lat: -4.0435, lon: 39.6682, fallbackPSH: 6.0 },
  kisumu:  { label: 'Kisumu / Lake Victoria Basin',  lat: -0.0917, lon: 34.7667, fallbackPSH: 5.8 },
  eldoret: { label: 'Eldoret / Rift Valley',         lat:  0.5143, lon: 35.2698, fallbackPSH: 5.3 },
}

const MONTH_KEYS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

/**
 * Fetches real Peak Sun Hours from NASA POWER satellite data.
 * Returns { annualPSH, monthly: [{month, psh}], source: 'nasa'|'fallback' }
 */
export async function fetchSolarData(locationKey) {
  const loc = KENYA_LOCATIONS[locationKey]
  if (!loc) return { annualPSH: 5.5, monthly: [], source: 'fallback' }

  try {
    const url = [
      'https://power.larc.nasa.gov/api/temporal/climatology/point',
      `?parameters=ALLSKY_SFC_SW_DWN`,
      `&community=RE`,
      `&longitude=${loc.lon}`,
      `&latitude=${loc.lat}`,
      `&format=JSON`,
    ].join('')

    const response = await fetch(url)
    if (!response.ok) throw new Error('NASA API error')

    const data = await response.json()
    const raw  = data?.properties?.parameter?.ALLSKY_SFC_SW_DWN

    if (!raw) throw new Error('Unexpected response shape')

    const annualPSH = parseFloat(raw.ANN || raw.ANN_AVG || 0) || loc.fallbackPSH
    const monthly   = MONTH_KEYS.map((k, i) => ({
      month: MONTH_NAMES[i],
      psh:   parseFloat(raw[k] || 0),
    }))

    return { annualPSH: parseFloat(annualPSH.toFixed(2)), monthly, source: 'nasa' }

  } catch {
    // Network error or API down — fall back to curated estimates
    return {
      annualPSH: loc.fallbackPSH,
      monthly:   [],
      source:    'fallback',
    }
  }
}
