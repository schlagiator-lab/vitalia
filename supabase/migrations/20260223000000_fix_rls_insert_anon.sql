-- Fix: allow anon role to INSERT on plans_generes_cache and historique_items_vus
-- These tables have RLS enabled but were missing INSERT policies for the anon role.
-- The app uses profil_id (UUID in localStorage) instead of Supabase Auth.

-- ============================================================
-- plans_generes_cache
-- ============================================================
CREATE POLICY "anon_insert_plans_generes_cache"
  ON plans_generes_cache
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- ============================================================
-- historique_items_vus
-- ============================================================
CREATE POLICY "anon_insert_historique_items_vus"
  ON historique_items_vus
  FOR INSERT
  TO anon
  WITH CHECK (true);
