// RhiPower Appliance Database
// surgeFactor: inductive motors spike 3–4.5× their running watts on startup
// category: used to group appliances visually in the load selector UI

export const DEFAULT_APPLIANCES = [

  // ── LIGHTING ──────────────────────────────────────────────────────────────
  { id: 'led_pack10',    category: '💡 Lighting',                   name: 'LED Bulbs — Indoor Pack of 10',                       watts: 90,   surgeFactor: 1.0, type: 'resistive' },
  { id: 'led_security',  category: '💡 Lighting',                   name: 'Outdoor Security Floodlight (2×50W)',                  watts: 100,  surgeFactor: 1.0, type: 'resistive' },
  { id: 'led_signage',   category: '💡 Lighting',                   name: 'Business Signage / Reception Lighting',               watts: 150,  surgeFactor: 1.0, type: 'resistive' },
  { id: 'led_street',    category: '💡 Lighting',                   name: 'Solar Street / Compound Light (100W)',                watts: 100,  surgeFactor: 1.0, type: 'resistive' },

  // ── ENTERTAINMENT & TECHNOLOGY ────────────────────────────────────────────
  { id: 'tv_32',         category: '📺 Entertainment & Technology', name: 'Smart TV — 32 inch',                                  watts: 80,   surgeFactor: 1.0, type: 'resistive' },
  { id: 'tv_55',         category: '📺 Entertainment & Technology', name: 'Smart TV — 55 inch / Home Cinema',                   watts: 150,  surgeFactor: 1.0, type: 'resistive' },
  { id: 'dstv',          category: '📺 Entertainment & Technology', name: 'DSTV / Zuku Decoder + Router',                        watts: 50,   surgeFactor: 1.0, type: 'resistive' },
  { id: 'laptop',        category: '📺 Entertainment & Technology', name: 'Laptop / Desktop Computer',                           watts: 80,   surgeFactor: 1.0, type: 'resistive' },
  { id: 'phone_points',  category: '📺 Entertainment & Technology', name: 'Phone & Tablet Charging Points (×5)',                 watts: 50,   surgeFactor: 1.0, type: 'resistive' },
  { id: 'cctv',          category: '📺 Entertainment & Technology', name: 'CCTV 4-Camera System + NVR Recorder',                watts: 60,   surgeFactor: 1.0, type: 'resistive' },
  { id: 'wifi_router',   category: '📺 Entertainment & Technology', name: 'Wi-Fi Router / LTE Modem',                            watts: 15,   surgeFactor: 1.0, type: 'resistive' },

  // ── COOLING & REFRIGERATION ───────────────────────────────────────────────
  { id: 'fan_ceiling',   category: '❄️ Cooling & Refrigeration',   name: 'Ceiling Fan',                                         watts: 75,   surgeFactor: 1.5, type: 'inductive' },
  { id: 'fan_stand',     category: '❄️ Cooling & Refrigeration',   name: 'Standing / Tower Fan',                                watts: 60,   surgeFactor: 1.5, type: 'inductive' },
  { id: 'fridge_small',  category: '❄️ Cooling & Refrigeration',   name: 'Small Domestic Fridge (200L)',                        watts: 150,  surgeFactor: 3.0, type: 'inductive' },
  { id: 'fridge_com',    category: '❄️ Cooling & Refrigeration',   name: 'Commercial Double-Door Refrigerator (500L)',          watts: 300,  surgeFactor: 3.0, type: 'inductive' },
  { id: 'freezer',       category: '❄️ Cooling & Refrigeration',   name: 'Chest / Upright Deep Freezer',                        watts: 200,  surgeFactor: 3.0, type: 'inductive' },
  { id: 'bar_fridge',    category: '❄️ Cooling & Refrigeration',   name: 'Bar / Beverage Display Cooler',                       watts: 250,  surgeFactor: 3.0, type: 'inductive' },
  { id: 'aircon_1hp',    category: '❄️ Cooling & Refrigeration',   name: 'Air Conditioner — 1 HP (9,000 BTU)',                  watts: 746,  surgeFactor: 4.0, type: 'inductive' },
  { id: 'aircon_1_5hp',  category: '❄️ Cooling & Refrigeration',   name: 'Air Conditioner — 1.5 HP (12,000 BTU)',               watts: 1119, surgeFactor: 4.0, type: 'inductive' },
  { id: 'aircon_2hp',    category: '❄️ Cooling & Refrigeration',   name: 'Air Conditioner — 2 HP (18,000 BTU)',                 watts: 1492, surgeFactor: 4.0, type: 'inductive' },

  // ── KITCHEN & COOKING ─────────────────────────────────────────────────────
  { id: 'microwave',     category: '🍳 Kitchen & Cooking',         name: 'Microwave Oven (900W)',                                watts: 900,  surgeFactor: 1.2, type: 'inductive' },
  { id: 'kettle',        category: '🍳 Kitchen & Cooking',         name: 'Electric Kettle (1.5 litre)',                          watts: 2000, surgeFactor: 1.0, type: 'resistive' },
  { id: 'toaster',       category: '🍳 Kitchen & Cooking',         name: 'Bread Toaster / Sandwich Press',                       watts: 800,  surgeFactor: 1.0, type: 'resistive' },
  { id: 'blender',       category: '🍳 Kitchen & Cooking',         name: 'Blender / Juicer',                                     watts: 500,  surgeFactor: 2.5, type: 'inductive' },
  { id: 'rice_cooker',   category: '🍳 Kitchen & Cooking',         name: 'Electric Rice Cooker / Slow Cooker',                   watts: 700,  surgeFactor: 1.0, type: 'resistive' },

  // ── WATER & HEATING ───────────────────────────────────────────────────────
  { id: 'shower_instant',category: '🚿 Water & Heating',           name: 'Instant Hot Water Shower Unit',                        watts: 7000, surgeFactor: 1.0, type: 'resistive' },
  { id: 'shower_mini',   category: '🚿 Water & Heating',           name: 'Mini Instant Water Heater (3kW)',                      watts: 3000, surgeFactor: 1.0, type: 'resistive' },
  { id: 'geyser_50l',    category: '🚿 Water & Heating',           name: 'Storage Geyser / Water Heater — 50 Litre',             watts: 3000, surgeFactor: 1.0, type: 'resistive' },
  { id: 'washing_machine',category:'🚿 Water & Heating',           name: 'Washing Machine (front / top loader)',                  watts: 500,  surgeFactor: 3.0, type: 'inductive' },
  { id: 'iron',          category: '🚿 Water & Heating',           name: 'Clothes Iron',                                         watts: 1200, surgeFactor: 1.0, type: 'resistive' },

  // ── PUMPS & MOTORS ────────────────────────────────────────────────────────
  { id: 'pump_surface',  category: '💧 Pumps & Motors',            name: 'Surface Water Pressure Pump — 1 HP',                  watts: 746,  surgeFactor: 3.0, type: 'inductive' },
  { id: 'pump_surface_2hp', category: '💧 Pumps & Motors',         name: 'Surface Water Pump — 2 HP',                           watts: 1492, surgeFactor: 3.0, type: 'inductive' },
  { id: 'borehole',      category: '💧 Pumps & Motors',            name: 'Submersible Borehole Pump — 5 HP (200m+ Lift)',        watts: 3730, surgeFactor: 4.5, type: 'inductive' },
  { id: 'borehole_3hp',  category: '💧 Pumps & Motors',            name: 'Submersible Borehole Pump — 3 HP (100m Lift)',         watts: 2238, surgeFactor: 4.5, type: 'inductive' },
  { id: 'pool',          category: '💧 Pumps & Motors',            name: 'Swimming Pool Filtration & Circulation Pump',          watts: 1500, surgeFactor: 3.0, type: 'inductive' },
  { id: 'irrigation',    category: '💧 Pumps & Motors',            name: 'Irrigation Pump — Drip / Sprinkler System (2 HP)',     watts: 1492, surgeFactor: 3.0, type: 'inductive' },

  // ── POWER TOOLS & WORKSHOP ───────────────────────────────────────────────
  { id: 'grinder',       category: '🔧 Power Tools & Workshop',    name: 'Angle Grinder (4.5 inch)',                             watts: 850,  surgeFactor: 2.5, type: 'inductive' },
  { id: 'drill',         category: '🔧 Power Tools & Workshop',    name: 'Electric Drill / Impact Driver',                       watts: 600,  surgeFactor: 2.0, type: 'inductive' },
  { id: 'welder',        category: '🔧 Power Tools & Workshop',    name: 'Arc Welder — 200A',                                    watts: 5000, surgeFactor: 1.2, type: 'resistive' },
  { id: 'air_compressor',category: '🔧 Power Tools & Workshop',    name: 'Air Compressor — 2 HP Workshop',                      watts: 1500, surgeFactor: 4.0, type: 'inductive' },

  // ── OFFICE & COMMERCIAL ──────────────────────────────────────────────────
  { id: 'pos_system',    category: '🏢 Office & Commercial',       name: 'POS Terminal + Receipt Printer',                       watts: 80,   surgeFactor: 1.0, type: 'resistive' },
  { id: 'printer',       category: '🏢 Office & Commercial',       name: 'Office Laser Printer / Photocopier',                   watts: 400,  surgeFactor: 1.2, type: 'inductive' },
  { id: 'server_rack',   category: '🏢 Office & Commercial',       name: 'Small Server Rack / NAS Storage',                     watts: 300,  surgeFactor: 1.0, type: 'resistive' },
  { id: 'cash_register', category: '🏢 Office & Commercial',       name: 'Electronic Cash Register',                             watts: 50,   surgeFactor: 1.0, type: 'resistive' },
]

// Get unique category names in order of appearance
export const CATEGORIES = [...new Set(DEFAULT_APPLIANCES.map(a => a.category))]
