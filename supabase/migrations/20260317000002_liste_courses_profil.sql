-- Point 21 : persistance de la liste de courses sur tous les appareils
-- Stockée dans profils_utilisateurs pour éviter une table supplémentaire

ALTER TABLE profils_utilisateurs
  ADD COLUMN IF NOT EXISTS liste_courses jsonb DEFAULT NULL;
