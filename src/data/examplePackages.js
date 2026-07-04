// Representative example systems shown on the homepage catalog, before a
// visitor commits to the full wizard — mirrors how solar-kit sites (SunWatts)
// and marketplaces (Alibaba) let people see real specs/pricing up front.
// Quantities reference ids in appliances.js; picking a package pre-fills the
// load builder with these, then still routes through Site Config so the
// final price reflects the visitor's real location/distance.

export const EXAMPLE_PACKAGES = [
  {
    id:            'essential_home',
    icon:          '🏠',
    title:         'Essential Home Backup',
    tagline:       'Lights, Wi-Fi, TV and the fridge stay on through a blackout.',
    clientProfile: 'homeowner',
    tier:          'budget',
    backupDays:    1,
    quantities: {
      led_pack10:   2,
      wifi_router:  1,
      tv_32:        1,
      fridge_small: 1,
      phone_points: 1,
    },
  },
  {
    id:            'family_home',
    icon:          '🏡',
    title:         'Family Home Comfort',
    tagline:       'Full house — fridge, laundry, entertainment and fans, day and night.',
    clientProfile: 'homeowner',
    tier:          'balanced',
    backupDays:    2,
    quantities: {
      led_pack10:      3,
      wifi_router:     1,
      tv_55:           1,
      fridge_com:      1,
      washing_machine: 1,
      fan_ceiling:     2,
      phone_points:    2,
      laptop:          1,
    },
  },
  {
    id:            'shop_business',
    icon:          '🏪',
    title:         'Shop / Small Business',
    tagline:       'POS, display cooler and security camera never go down mid-sale.',
    clientProfile: 'business',
    tier:          'budget',
    backupDays:    1,
    quantities: {
      led_pack10: 2,
      pos_system: 1,
      fridge_com: 1,
      cctv:       1,
      wifi_router:1,
      fan_stand:  2,
    },
  },
  {
    id:            'farm_pumping',
    icon:          '🚜',
    title:         'Farm / Borehole Pumping',
    tagline:       'Run a heavy submersible pump plus compound lighting off-grid.',
    clientProfile: 'business',
    tier:          'balanced',
    backupDays:    1,
    quantities: {
      borehole_3hp: 1,
      led_security: 2,
      wifi_router:  1,
    },
  },
]
