-- Fix: supprimer les doublons sémantiques dans la table alimentation
-- Ces doublons (même nom, IDs différents) causaient des répétitions d'aliments
-- dans la génération de plans (ex: Maquereau au déjeuner ET au dîner).
--
-- Pour chaque doublon, on garde l'entrée avec le meilleur score dans alimentation_besoins
-- et on supprime l'autre APRÈS avoir migré ses références dans alimentation_besoins.

-- ============================================================
-- 1. MAQUEREAU : garder ALI_047 (score max 5 dans mobilite)
--    supprimer ALI_119 (même score, même catégorie, doublon pur)
-- ============================================================

-- Supprimer les entrées junction du doublon (elles existent déjà pour ALI_047)
DELETE FROM alimentation_besoins WHERE aliment_id = 'ALI_119';

-- Supprimer l'aliment doublon
DELETE FROM alimentation WHERE id = 'ALI_119';

-- ============================================================
-- 2. SAUMON SAUVAGE : garder ALI_010, supprimer ALI_045
-- ============================================================

DELETE FROM alimentation_besoins WHERE aliment_id = 'ALI_045';
DELETE FROM alimentation WHERE id = 'ALI_045';

-- ============================================================
-- 3. POULET (FILET) : garder ALI_048 (Aliment - Viande blanche),
--    migrer les besoins de ALI_094 vers ALI_048 si non couverts, puis supprimer ALI_094
-- ============================================================

-- Migrer besoin "sommeil" score 3 de ALI_094 vers ALI_048 si pas encore présent
INSERT INTO alimentation_besoins (aliment_id, besoin_id, score)
SELECT 'ALI_048', besoin_id, score
FROM alimentation_besoins
WHERE aliment_id = 'ALI_094'
  AND besoin_id NOT IN (
    SELECT besoin_id FROM alimentation_besoins WHERE aliment_id = 'ALI_048'
  )
ON CONFLICT DO NOTHING;

DELETE FROM alimentation_besoins WHERE aliment_id = 'ALI_094';
DELETE FROM alimentation WHERE id = 'ALI_094';

-- ============================================================
-- Résultat attendu : 3 doublons éliminés → plus de répétition
-- intra-plan (même protéine déjeuner+dîner) causée par les IDs dupliqués
-- ============================================================
