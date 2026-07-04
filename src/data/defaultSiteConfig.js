// Shared starting siteConfig — used by App.jsx as the wizard's initial state
// and by Homepage.jsx to compute representative example-package pricing with
// the same assumptions a fresh visitor would start from.
export const DEFAULT_CONFIG = {
  location:   'nanyuki',
  profile:    'airbnb',
  wireDistM:  150,
  siteKm:     200,
  tier:       'balanced',
  psh:        5.5,
  pshSource:  'fallback',
  pshMonthly: [],
}
