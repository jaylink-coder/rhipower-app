-- =========================================================
-- RhiPower — Stock Movement Ledger + Inverter Serial Tracking + Product Images
-- =========================================================
-- Three additions, scoped to what actually fits a single-location,
-- project-based installer (not a warehouse chain):
--
--   1. image_url on inventory_prices — provisioned for the new customer
--      product detail page; NULL until real product photos exist, the page
--      shows an honest placeholder rather than a broken image.
--
--   2. stock_movements — every time stock_qty is changed from the admin
--      panel, the delta (not just the final number) is now logged with an
--      optional reason, so "why did this drop from 12 to 7" has an answer.
--
--   3. product_serials — for inverters specifically (high cost, multi-year
--      warranties — the item type where a warranty claim actually needs
--      "which physical unit did this customer get"). Deliberately NOT
--      applied to panels/batteries; free-text `installed_at` rather than a
--      strict FK to quotation_requests, matching the same light-touch
--      pattern already used for site_visits.assigned_to.
-- =========================================================

-- ─── 1. Product image (provision only — stays NULL until photos exist) ─────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS image_url TEXT;

-- ─── 2. Stock movement ledger ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_movements (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  role_key         TEXT        NOT NULL REFERENCES inventory_prices(role_key) ON DELETE CASCADE,
  quantity_changed INTEGER     NOT NULL,   -- positive = received/added, negative = used/adjusted down
  reason           TEXT,                  -- e.g. "Received from Solarshop", "Used in quote #123"
  admin_id         UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email      TEXT
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_role ON stock_movements(role_key);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_stock_movements"
  ON stock_movements FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── 3. Inverter serial-number tracking ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_serials (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  role_key      TEXT        NOT NULL REFERENCES inventory_prices(role_key) ON DELETE CASCADE,
  serial_number TEXT        NOT NULL UNIQUE,
  status        TEXT        NOT NULL DEFAULT 'available',  -- 'available' | 'reserved' | 'installed' | 'defective'
  installed_at  TEXT,       -- free text: customer/job reference, e.g. "Alex Nyaga — Nanyuki, 04 Jul 2026"
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_product_serials_role ON product_serials(role_key);

ALTER TABLE product_serials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_product_serials"
  ON product_serials FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: /admin -> Inventory & Prices -> any Inverter row will show a
-- "Serials" panel to add/track individual units. Every stock_qty save now
-- also records a ledger entry, viewable via the new "History" link per item.
