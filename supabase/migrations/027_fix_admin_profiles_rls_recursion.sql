-- =========================================================
-- RhiPower — Fix infinite RLS recursion on admin_profiles (introduced in 017)
-- =========================================================
-- 017_admin_management_and_fixes.sql replaced admin_profiles' simple
-- self-read policy (id = auth.uid(), no subquery) with one that queries
-- admin_profiles from inside its own policy:
--   USING (EXISTS (SELECT 1 FROM admin_profiles me WHERE me.id = auth.uid()))
-- To evaluate that inner subquery, Postgres re-applies admin_profiles'
-- own SELECT policy — which runs the same subquery again — infinite
-- recursion. Every other table's "admin can manage X" policy does
-- EXISTS (SELECT 1 FROM admin_profiles WHERE id = auth.uid()), which
-- transitively hits this same recursive policy. This has been a landmine
-- on every admin-only table since 017 shipped — the Accounting module is
-- just the first place that exercised it hard enough to surface as
-- "infinite recursion detected in policy for relation admin_profiles".
--
-- Fix: a SECURITY DEFINER helper function that checks admin_profiles as
-- the function owner (bypassing RLS internally — safe here, it only ever
-- returns a boolean, never rows), used to replace admin_profiles' own
-- SELECT/DELETE policies so the self-reference is broken at its source.
-- No other table's policy needs to change — they all subquery
-- admin_profiles, which now resolves without recursing.
-- =========================================================

CREATE OR REPLACE FUNCTION is_admin(uid UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_profiles WHERE id = uid);
$$;

DROP POLICY IF EXISTS "admin_can_read_all_admin_profiles" ON admin_profiles;
CREATE POLICY "admin_can_read_all_admin_profiles"
  ON admin_profiles FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS "admin_can_delete_other_admin_profiles" ON admin_profiles;
CREATE POLICY "admin_can_delete_other_admin_profiles"
  ON admin_profiles FOR DELETE TO authenticated
  USING (is_admin() AND id != auth.uid());

-- ─── DONE ────────────────────────────────────────────────────────────────────
-- After running: reload the Accounting tab (and any other admin page) —
-- the "infinite recursion detected in policy for relation admin_profiles"
-- error is gone. Every table's admin-only RLS policy still works exactly
-- as before; only how admin_profiles checks itself changed.
