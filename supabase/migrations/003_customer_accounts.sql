-- =========================================================
-- RhiPower — Customer Accounts & Saved Designs
-- =========================================================
-- Lets a client create a free account, save their design, and come back
-- later to reopen it (fully re-editable, not just a read-only receipt).
-- Also adds an admin-side "Customers" view.
--
-- IMPORTANT — READ BEFORE RUNNING:
-- Until now, "authenticated" meant "you, the admin" — the only person who
-- ever logged in — so the existing policies granted any authenticated user
-- full read/write on quotation_requests and deposit_transactions. This
-- migration adds real customer logins, so that assumption is no longer
-- safe: it replaces those blanket policies with ones that check the
-- (previously unused) admin_profiles table instead.
--
-- The INSERT at step 6 promotes your admin account into admin_profiles
-- automatically, matched against jaylinkpowersystems@gmail.com — confirmed
-- as the real Supabase Auth login email for this project.
-- =========================================================

-- ─── 1. Customer profiles — mirrors auth.users so the admin panel can list customers ──
-- auth.users itself isn't queryable through the normal client API, so this table
-- is kept in sync automatically by a trigger every time someone signs up.
CREATE TABLE IF NOT EXISTS customer_profiles (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  email      TEXT,
  full_name  TEXT,
  status     TEXT        DEFAULT 'active'  -- 'active' | 'suspended' — for abusive/spam accounts
);

ALTER TABLE customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_read_customer_profiles"
  ON customer_profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "customer_can_read_own_profile"
  ON customer_profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

-- SET search_path = '' + fully-qualified public.customer_profiles is required here —
-- Supabase's own documented pattern for auth.users triggers pins this explicitly,
-- because the role that fires the trigger during signup can't reliably resolve an
-- unqualified table name. Omitting this causes signup to fail with a generic
-- "Database error saving new user" (500) from the Auth server.
CREATE OR REPLACE FUNCTION handle_new_customer()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.customer_profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_customer_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_customer_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_customer();

-- Backfill: anyone who already signed up (e.g. you, via the admin login) before this ran
INSERT INTO customer_profiles (id, email, full_name)
SELECT id, email, raw_user_meta_data->>'full_name' FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Let a quote be linked to the account that submitted it ─────────────
-- References customer_profiles (not auth.users directly) so the admin panel
-- can embed-join quotes -> customer in a single PostgREST query.
ALTER TABLE quotation_requests ADD COLUMN IF NOT EXISTS user_id    UUID REFERENCES customer_profiles(id) ON DELETE SET NULL;
ALTER TABLE quotation_requests ADD COLUMN IF NOT EXISTS raw_state  JSONB;  -- {siteConfig, customAppliances, quantities, clientProfile, backupDays} snapshot, for full resume

CREATE INDEX IF NOT EXISTS idx_quotations_user ON quotation_requests(user_id);

-- ─── 3. Replace the "any authenticated user = admin" policies ──────────────
DROP POLICY IF EXISTS "auth_can_read_quotes"   ON quotation_requests;
DROP POLICY IF EXISTS "auth_can_update_quotes" ON quotation_requests;

-- Admins (present in admin_profiles) can still see and manage every quote
CREATE POLICY "admin_can_read_all_quotes"
  ON quotation_requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "admin_can_update_quotes"
  ON quotation_requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- A signed-in customer can see ONLY their own quotes
CREATE POLICY "customer_can_read_own_quotes"
  ON quotation_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- A signed-in customer can submit a quote and tag it as their own
-- (the existing anon_can_insert_quote policy still covers guests who don't sign in)
CREATE POLICY "authenticated_can_insert_quote"
  ON quotation_requests FOR INSERT TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- ─── 4. Same fix for deposit_transactions (it had the identical over-broad policy) ──
DROP POLICY IF EXISTS "auth_can_read_deposits" ON deposit_transactions;

CREATE POLICY "admin_can_read_all_deposits"
  ON deposit_transactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "customer_can_read_own_deposits"
  ON deposit_transactions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM quotation_requests q
    WHERE q.id = deposit_transactions.quotation_id AND q.user_id = auth.uid()
  ));

-- ─── 5. Admin audit log ─────────────────────────────────────────────────────
-- Adapted from HustleSasa's security-logging pattern: a record of who changed
-- what, useful the moment there's more than one admin/technician account.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  admin_id   UUID        REFERENCES admin_profiles(id) ON DELETE SET NULL,
  admin_email TEXT,       -- denormalised so the log stays readable if the account is later removed
  action     TEXT        NOT NULL,   -- e.g. 'price_update', 'lead_status_change', 'stock_toggle'
  target     TEXT,                   -- e.g. the role_key or lead id affected
  details    JSONB
);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_can_read_audit_log"
  ON admin_audit_log FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

CREATE POLICY "admin_can_write_audit_log"
  ON admin_audit_log FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── 6. Promote your existing admin login into admin_profiles ─────────────
-- This table was defined in schema.sql but never actually populated, which is
-- exactly what made step 3 above necessary. Confirmed admin login email:
-- jaylinkpowersystems@gmail.com — matched explicitly rather than promoting
-- every existing auth.users row, so this stays correct even if a second
-- (e.g. test) account already exists in Supabase Auth.
INSERT INTO admin_profiles (id, full_name, role)
SELECT id, 'RhiPower Admin', 'admin'
FROM auth.users
WHERE email = 'jaylinkpowersystems@gmail.com'
ON CONFLICT (id) DO NOTHING;

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- Verify immediately after running: log into /admin and confirm you can still
-- see all leads. If the list is empty, admin_profiles wasn't populated — open
-- Supabase Table Editor and check whether a row now exists in admin_profiles
-- matching your auth.users id.
