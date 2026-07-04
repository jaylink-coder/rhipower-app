-- =========================================================
-- RhiPower — Suppliers
-- =========================================================
-- Phase 1 of the ERP build-out: a real supplier directory, replacing the
-- free-text `supplier` column on inventory_prices with a proper table that
-- Purchase Orders (migration 011) can reference.
--
-- The old `inventory_prices.supplier` TEXT column is deliberately kept for
-- now (not dropped) — every distinct value already on file gets migrated
-- into its own supplier row and inventory_prices.supplier_id is backfilled
-- to point at it, but the old column stays as a safety net until the admin
-- panel has fully switched over to supplier_id and the data's been checked.
-- =========================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  name            TEXT        NOT NULL,
  contact_person  TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  payment_terms   TEXT,       -- free text, e.g. "Net 30", "50% deposit / 50% on delivery"
  lead_time_days  INTEGER,
  notes           TEXT,
  is_active       BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_suppliers_active ON suppliers(is_active);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_manage_suppliers"
  ON suppliers FOR ALL TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── Migrate inventory_prices.supplier (free text) to a real FK ─────────────
ALTER TABLE inventory_prices ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

INSERT INTO suppliers (name)
SELECT DISTINCT supplier FROM inventory_prices
WHERE supplier IS NOT NULL AND btrim(supplier) <> ''
ON CONFLICT DO NOTHING;

UPDATE inventory_prices ip
SET supplier_id = s.id
FROM suppliers s
WHERE s.name = ip.supplier AND ip.supplier_id IS NULL;

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: a new "Suppliers" section appears in the admin sidebar with
-- every distinct supplier name already on file pre-populated as a real row.
-- The old free-text `supplier` column stays untouched for now.
