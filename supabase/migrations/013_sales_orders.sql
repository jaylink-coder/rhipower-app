-- =========================================================
-- RhiPower — Sales Orders
-- =========================================================
-- The "stock out" half of the ERP build-out, closing the gap that quotes
-- never touch inventory: a Sales Order is created manually from an accepted
-- quote (not auto-triggered by the status dropdown — see the app-layer
-- comment in salesOrders.js for why), then confirming it reserves stock and
-- fulfilling its lines (partial allowed) deducts it for real.
--
--   sales_orders       — one per converted quote. quotation_id links back to
--                         the originating lead but is nullable (ON DELETE
--                         SET NULL) since a Sales Order is its own financial
--                         record and must survive the quote being removed.
--   sales_order_lines  — role_key uses ON DELETE SET NULL (unlike Purchase
--                         Order lines' RESTRICT) plus a frozen description/
--                         sku_snapshot/unit_cost_kes captured at conversion
--                         time — a Sales Order must stay readable even if the
--                         catalog item it referenced is later deleted or
--                         renamed, same reasoning as quotation_requests'
--                         panel_role_key/etc. (migration 009).
-- =========================================================

CREATE TABLE IF NOT EXISTS sales_orders (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  so_number        INTEGER     GENERATED ALWAYS AS IDENTITY (START WITH 1),  -- display as SO-0001
  quotation_id     UUID        REFERENCES quotation_requests(id) ON DELETE SET NULL,
  customer_user_id UUID        REFERENCES customer_profiles(id) ON DELETE SET NULL,
  client_name      TEXT        NOT NULL,
  client_phone     TEXT        NOT NULL,
  client_email     TEXT,
  site_address     TEXT,
  status           TEXT        NOT NULL DEFAULT 'draft',
  -- 'draft' | 'confirmed' | 'partially_fulfilled' | 'fulfilled' | 'cancelled'
  materials_kes    NUMERIC(12,2) NOT NULL DEFAULT 0,
  labor_kes        NUMERIC(12,2) NOT NULL DEFAULT 0,
  logistics_kes    NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_kes        NUMERIC(12,2) NOT NULL DEFAULT 0,  -- VAT-inclusive, matches the quote convention
  admin_id         UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email      TEXT,
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_so_quotation ON sales_orders(quotation_id);
CREATE INDEX IF NOT EXISTS idx_so_status    ON sales_orders(status);

CREATE TABLE IF NOT EXISTS sales_order_lines (
  id                 UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  sales_order_id     UUID        NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  role_key           TEXT        REFERENCES inventory_prices(role_key) ON DELETE SET NULL,
  zone               TEXT        NOT NULL,  -- 'zoneA' | 'zoneB' | 'zoneC' | 'labor' | 'logistics'
  description        TEXT        NOT NULL,  -- frozen snapshot of the BOM line label
  sku_snapshot       TEXT,
  qty                NUMERIC(10,2) NOT NULL,  -- NUMERIC not INTEGER: cable lines are "123m", mounting is "4.2 kWp"
  unit_cost_kes      NUMERIC(12,2),           -- cost at conversion time, for future margin reporting
  qty_fulfilled      NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_stock_deducting BOOLEAN     NOT NULL DEFAULT true  -- false for labor/logistics summary lines (no role_key)
);

CREATE INDEX IF NOT EXISTS idx_sol_so   ON sales_order_lines(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_sol_role ON sales_order_lines(role_key);

ALTER TABLE sales_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_sales_orders"
  ON sales_orders FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "admin_can_manage_so_lines"
  ON sales_order_lines FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- Customers can read their own sales orders/lines — no UI uses this yet,
-- provisioned for a future "My Orders" customer-facing view.
CREATE POLICY "customer_can_read_own_sales_orders"
  ON sales_orders FOR SELECT TO authenticated
  USING (customer_user_id = auth.uid());

CREATE POLICY "customer_can_read_own_sales_order_lines"
  ON sales_order_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM sales_orders so WHERE so.id = sales_order_lines.sales_order_id AND so.customer_user_id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: a "Convert to Sales Order" button appears on accepted leads
-- in Leads & Pipeline, and a new "Sales Orders" section appears in the admin
-- sidebar — confirm an order to reserve stock, then fulfill lines (partial
-- delivery supported) to deduct it for real and track progress to completion.
