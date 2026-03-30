-- ============================================================
-- Migration : RLS ownership réel via Supabase Auth
-- ============================================================
-- Contexte :
--   profils_utilisateurs.id       = UUID du profil (utilisé comme profil_id partout)
--   profils_utilisateurs.user_id  = UUID Supabase Auth (= auth.uid())
--   Les deux sont DIFFÉRENTS — la jointure est obligatoire.
--
-- Toutes les anciennes policies étaient USING (true) (base ouverte).
-- Cette migration les remplace par des policies ownership strictes
-- pour le rôle `authenticated` (JWT utilisateur).
--
-- Les Edge Functions utilisent SERVICE_ROLE_KEY → bypass RLS automatique.
-- ============================================================

-- Helper : fonction stable pour éviter de répéter la sous-requête
-- Retourne le user_id auth correspondant à un profil_id (uuid ou text)
CREATE OR REPLACE FUNCTION public.profil_appartient_utilisateur(p_profil_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profils_utilisateurs
    WHERE id::text = p_profil_id
      AND user_id = auth.uid()
  )
$$;

-- ============================================================
-- 1. profils_utilisateurs
-- ============================================================
DROP POLICY IF EXISTS "users_own_profil_select"  ON profils_utilisateurs;
DROP POLICY IF EXISTS "users_own_profil_insert"  ON profils_utilisateurs;
DROP POLICY IF EXISTS "users_own_profil_update"  ON profils_utilisateurs;

CREATE POLICY "users_own_profil_select"
  ON profils_utilisateurs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "users_own_profil_insert"
  ON profils_utilisateurs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users_own_profil_update"
  ON profils_utilisateurs FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 2. plans_generes_cache
-- ============================================================
DROP POLICY IF EXISTS "anon_insert_plans_generes_cache"  ON plans_generes_cache;
DROP POLICY IF EXISTS "anon_select_plans_generes_cache"  ON plans_generes_cache;
DROP POLICY IF EXISTS "anon_update_plans_generes_cache"  ON plans_generes_cache;
DROP POLICY IF EXISTS "plans_cache_own_profil"           ON plans_generes_cache;
DROP POLICY IF EXISTS "auth_plans_cache_all"             ON plans_generes_cache;

CREATE POLICY "auth_plans_cache_all"
  ON plans_generes_cache FOR ALL
  TO authenticated
  USING  (profil_appartient_utilisateur(profil_id::text))
  WITH CHECK (profil_appartient_utilisateur(profil_id::text));

-- ============================================================
-- 3. plans_generes  (table permanente, feedback satisfaction)
-- ============================================================
DROP POLICY IF EXISTS "anon_update_plans_generes_feedback" ON plans_generes;
DROP POLICY IF EXISTS "auth_plans_generes_all"             ON plans_generes;

CREATE POLICY "auth_plans_generes_all"
  ON plans_generes FOR ALL
  TO authenticated
  USING  (profil_appartient_utilisateur(profil_id::text))
  WITH CHECK (profil_appartient_utilisateur(profil_id::text));

-- ============================================================
-- 4. recettes_sauvegardees
-- ============================================================
DROP POLICY IF EXISTS "public_access_recettes_sauvegardees" ON recettes_sauvegardees;
DROP POLICY IF EXISTS "auth_recettes_sauvegardees_all"      ON recettes_sauvegardees;

CREATE POLICY "auth_recettes_sauvegardees_all"
  ON recettes_sauvegardees FOR ALL
  TO authenticated
  USING  (profil_appartient_utilisateur(profil_id::text))
  WITH CHECK (profil_appartient_utilisateur(profil_id::text));

-- ============================================================
-- 5. recettes_favorites
-- ============================================================
DROP POLICY IF EXISTS "Public access recettes_favorites" ON recettes_favorites;
DROP POLICY IF EXISTS "auth_recettes_favorites_all"      ON recettes_favorites;

CREATE POLICY "auth_recettes_favorites_all"
  ON recettes_favorites FOR ALL
  TO authenticated
  USING  (profil_appartient_utilisateur(profil_id::text))
  WITH CHECK (profil_appartient_utilisateur(profil_id::text));

-- ============================================================
-- 6. checkin_symptomes
-- ============================================================
-- Ancienne policy incorrecte : auth.uid() = profil_id
-- comparait auth UUID au profil UUID → toujours faux → aucun check-in ne sauvegardait
DROP POLICY IF EXISTS "checkin_own"                ON checkin_symptomes;
DROP POLICY IF EXISTS "auth_checkin_symptomes_all" ON checkin_symptomes;

CREATE POLICY "auth_checkin_symptomes_all"
  ON checkin_symptomes FOR ALL
  TO authenticated
  USING  (profil_appartient_utilisateur(profil_id::text))
  WITH CHECK (profil_appartient_utilisateur(profil_id::text));

-- ============================================================
-- 7. historique_items_vus
-- ============================================================
DROP POLICY IF EXISTS "anon_insert_historique_items_vus" ON historique_items_vus;
DROP POLICY IF EXISTS "auth_historique_items_vus_all"    ON historique_items_vus;

CREATE POLICY "auth_historique_items_vus_all"
  ON historique_items_vus FOR ALL
  TO authenticated
  USING  (profil_appartient_utilisateur(profil_id::text))
  WITH CHECK (profil_appartient_utilisateur(profil_id::text));
