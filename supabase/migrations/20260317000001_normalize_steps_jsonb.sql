-- Point 19 : aligner recettes_favorites.steps sur le type jsonb
-- (recettes_sauvegardees.steps est déjà jsonb)
-- Conversion sûre : text[] → jsonb via to_jsonb()

ALTER TABLE recettes_favorites
  ALTER COLUMN steps TYPE jsonb
  USING to_jsonb(steps);
