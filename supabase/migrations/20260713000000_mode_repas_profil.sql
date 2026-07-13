-- Mode repas chaud/froid : préférence persistée au profil, choisie au moment
-- de générer un plan (Aujourd'hui / Semaine / Recette) pour adapter la
-- génération IA aux jours de canicule (recettes sans cuisson).

ALTER TABLE profils_utilisateurs
  ADD COLUMN IF NOT EXISTS mode_repas text DEFAULT 'chaud'
  CHECK (mode_repas IN ('chaud','froid'));
