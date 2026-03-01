-- Fix: recettes_sauvegardees avait des policies basées sur auth.uid() (Supabase Auth)
-- mais l'app utilise un profil_id custom sans Supabase Auth → auth.uid() toujours null
-- → tous les INSERTs/UPDATEs/DELETEs échouaient silencieusement côté client.
--
-- Solution : supprimer les anciennes policies auth.uid() et remplacer par une policy ouverte.
-- La sécurité est gérée au niveau applicatif via profil_id (UUID en localStorage).

DROP POLICY IF EXISTS recettes_insert_own ON recettes_sauvegardees;
DROP POLICY IF EXISTS recettes_select_own ON recettes_sauvegardees;
DROP POLICY IF EXISTS recettes_update_own ON recettes_sauvegardees;
DROP POLICY IF EXISTS recettes_delete_own ON recettes_sauvegardees;
DROP POLICY IF EXISTS recettes_service_role ON recettes_sauvegardees;

-- Supprimer aussi les policies intermédiaires si elles ont été créées
DROP POLICY IF EXISTS anon_insert_recettes_sauvegardees ON recettes_sauvegardees;
DROP POLICY IF EXISTS anon_update_recettes_sauvegardees ON recettes_sauvegardees;
DROP POLICY IF EXISTS anon_delete_recettes_sauvegardees ON recettes_sauvegardees;

CREATE POLICY "public_access_recettes_sauvegardees"
  ON recettes_sauvegardees FOR ALL USING (true) WITH CHECK (true);
