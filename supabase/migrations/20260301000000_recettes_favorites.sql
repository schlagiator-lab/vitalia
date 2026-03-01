CREATE TABLE IF NOT EXISTS recettes_favorites (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profil_id             TEXT NOT NULL,
  recette_sauvegardee_id UUID,
  titre                 TEXT NOT NULL,
  moment                TEXT,
  ingredients           JSONB,
  steps                 TEXT[],
  tip                   TEXT,
  note                  INTEGER NOT NULL CHECK (note IN (4, 5)),
  sauvegardee_le        TIMESTAMPTZ DEFAULT NOW(),
  mise_a_jour_le        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(profil_id, titre)
);
ALTER TABLE recettes_favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access recettes_favorites" ON recettes_favorites FOR ALL USING (true);
