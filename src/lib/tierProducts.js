// Price-band tier derivation + default product selection.
// A product's tier is DERIVED from its price falling inside a band, never
// assigned by a human typing "premium" — see migration 007 for the ranges.

const TIER_ORDER = ['budget', 'balanced', 'premium']

export function deriveTier(category, price, priceBands) {
  const bands = priceBands?.[category]
  if (!bands) return 'balanced'
  for (const tier of TIER_ORDER) {
    const band = bands[tier]
    if (!band) continue
    const [min, max] = band
    if (price >= min && (max == null || price < max)) return tier
  }
  return 'balanced'
}

// The cheapest product within a tier is the sane default when a customer
// hasn't explicitly picked a brand yet — same behaviour as before this
// change, just derived instead of hardcoded.
export function pickDefaultProduct(products, tier) {
  const matches = (products || []).filter(p => p.tier === tier)
  if (!matches.length) return null
  return matches.reduce((cheapest, p) => (p.cost < cheapest.cost ? p : cheapest), matches[0])
}
