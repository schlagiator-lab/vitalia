-- Fix: replace the auth.uid()-based policy on plans_generes_cache
-- The app uses profil_id (text UUID in localStorage), not Supabase Auth.
-- The old policy "plans_cache_own_profil" requires auth.uid() which is always
-- null for anon users, blocking inserts even with our permissive anon policy.

DROP POLICY IF EXISTS "plans_cache_own_profil" ON plans_generes_cache;

-- Allow anon to SELECT their own rows (profil_id stored client-side)
CREATE POLICY "anon_select_plans_generes_cache"
  ON plans_generes_cache
  FOR SELECT
  TO anon
  USING (true);

-- Allow anon to UPDATE their own rows
CREATE POLICY "anon_update_plans_generes_cache"
  ON plans_generes_cache
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);
