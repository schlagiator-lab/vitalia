-- ── Bucket Supabase Storage ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'recette-photos',
  'recette-photos',
  true,
  5242880,  -- 5 Mo max
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Authentifiés peuvent uploader
CREATE POLICY "recipe_photos_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'recette-photos');

-- Tout le monde peut lire (bucket public)
CREATE POLICY "recipe_photos_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'recette-photos');

-- Propriétaire peut supprimer ses photos
CREATE POLICY "recipe_photos_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'recette-photos' AND owner = auth.uid());

-- ── Table recette_photos ──
CREATE TABLE IF NOT EXISTS recette_photos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profil_id        TEXT        NOT NULL,
  titre            TEXT        NOT NULL,
  photo_url        TEXT        NOT NULL,
  consent_partage  BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE recette_photos ENABLE ROW LEVEL SECURITY;

-- Propriétaire peut tout faire sur ses photos
CREATE POLICY "photo_owner_all"
  ON recette_photos FOR ALL
  TO authenticated
  USING  (profil_appartient_utilisateur(profil_id))
  WITH CHECK (profil_appartient_utilisateur(profil_id));

-- Tout le monde (y compris anon) peut lire les photos partagées
CREATE POLICY "photo_public_read"
  ON recette_photos FOR SELECT
  USING (consent_partage = true);

-- Index pour la recherche par titre
CREATE INDEX IF NOT EXISTS idx_recette_photos_titre
  ON recette_photos (titre);

-- ── Colonne photo_url sur les tables existantes ──
ALTER TABLE recettes_sauvegardees ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE recettes_favorites    ADD COLUMN IF NOT EXISTS photo_url TEXT;
