-- =========================================================
-- RhiPower — Admin User Management + a Customer Portal RLS Bug Fix
-- =========================================================
-- 1. admin_profiles currently has no `email` column (admin emails only
--    live in auth.users, which client code can't query) and exactly one
--    RLS policy: self-read-only. That makes a "Users" settings list
--    impossible today. This adds `email` (denormalised, matching the
--    admin_email-alongside-admin_id pattern used everywhere else in this
--    schema — audit log, stock_movements, purchase_orders, etc.),
--    backfills it for the existing admin, and widens read access so any
--    admin can see the full admin roster. Still no client-side INSERT
--    policy — creating a new admin means creating a real auth.users row
--    first, which only the new invite-admin edge function (service role)
--    can do. DELETE is allowed for admins EXCEPT their own row, so nobody
--    can accidentally lock themselves out via the Settings UI.
--
-- 2. Bug fix found while building this: customer_profiles has zero
--    UPDATE policy for admins, meaning AdminCustomers.jsx's existing
--    suspend/reactivate toggle has been silently failing — the UI updates
--    optimistically but the write itself is blocked by RLS. Adding the
--    missing policy here since it's directly adjacent to this migration's
--    Customer Portal settings work.
-- =========================================================

-- ─── 1. admin_profiles: email column + backfill ─────────────────────────────
ALTER TABLE admin_profiles ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE admin_profiles ap
SET email = u.email
FROM auth.users u
WHERE u.id = ap.id AND ap.email IS NULL;

-- ─── admin_profiles: replace self-read-only with admin-can-read-all ────────
DROP POLICY IF EXISTS "auth_can_read_own_profile" ON admin_profiles;

CREATE POLICY "admin_can_read_all_admin_profiles"
  ON admin_profiles FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM admin_profiles me WHERE me.id = auth.uid()));

CREATE POLICY "admin_can_delete_other_admin_profiles"
  ON admin_profiles FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM admin_profiles me WHERE me.id = auth.uid())
    AND id != auth.uid()
  );

-- ─── 2. Bug fix: admins can update customer_profiles (suspend/reactivate) ──
CREATE POLICY "admin_can_update_customer_profiles"
  ON customer_profiles FOR UPDATE TO authenticated
  USING     (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()));

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: the Settings -> Users tab can list every admin (with
-- email) and remove one (never yourself). The existing Suspend/Reactivate
-- button in Customers now actually persists instead of silently no-oping.
-- Creating a NEW admin still requires deploying the invite-admin edge
-- function (supabase functions deploy invite-admin) — this migration only
-- prepares the table/policies it writes to.
