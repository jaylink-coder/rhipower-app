-- =========================================================
-- RhiPower — Purchase Orders
-- =========================================================
-- The "stock in" half of the ERP build-out: a real procurement workflow
-- against a supplier, replacing manual stock_qty typing as the primary way
-- stock enters the system (manual adjustment stays available for
-- corrections/shrinkage — see migration 012).
--
--   purchase_orders       — one per order placed with a supplier.
--   purchase_order_lines  — line items, each against a real inventory_prices
--                            role_key. Uses ON DELETE RESTRICT (not CASCADE
--                            like stock_movements) — a PO line is a financial
--                            record, so a product with PO history can never be
--                            hard-deleted, only marked inactive (already
--                            supported by the existing Zoho-style item flow).
-- =========================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  po_number        INTEGER     GENERATED ALWAYS AS IDENTITY (START WITH 1),  -- display as PO-0001
  supplier_id      UUID        NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status           TEXT        NOT NULL DEFAULT 'draft',
  -- 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled'
  order_date       DATE,
  expected_date    DATE,
  notes            TEXT,
  admin_id         UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email      TEXT,
  subtotal_kes     NUMERIC(12,2) NOT NULL DEFAULT 0,  -- denormalised sum of line totals, kept in sync by the app layer
  total_kes        NUMERIC(12,2) NOT NULL DEFAULT 0   -- POs are internal cost documents — no VAT line
);

CREATE INDEX IF NOT EXISTS idx_po_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status   ON purchase_orders(status);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID        NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  role_key          TEXT        NOT NULL REFERENCES inventory_prices(role_key) ON DELETE RESTRICT,
  qty_ordered       INTEGER     NOT NULL CHECK (qty_ordered > 0),
  qty_received      INTEGER     NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost_kes     NUMERIC(12,2) NOT NULL,  -- cost AT TIME OF PO — independent of inventory_prices.buying_price_kes today
  line_total_kes    NUMERIC(12,2) GENERATED ALWAYS AS (qty_ordered * unit_cost_kes) STORED
);

CREATE INDEX IF NOT EXISTS idx_pol_po   ON purchase_order_lines(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_pol_role ON purchase_order_lines(role_key);

ALTER TABLE purchase_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_pos"
  ON purchase_orders FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "admin_can_manage_po_lines"
  ON purchase_order_lines FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: a new "Purchase Orders" section appears in the admin
-- sidebar — create a PO against a supplier with line items, then receive
-- stock against it (partial receiving supported) to bump inventory_prices
-- stock_qty and log a properly-tagged stock_movements entry.
