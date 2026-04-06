-- Ajout de la colonne email_digest pour le récapitulatif quotidien par email
-- Activé/désactivé par l'utilisateur depuis son profil

ALTER TABLE profils_utilisateurs
  ADD COLUMN IF NOT EXISTS email_digest BOOLEAN NOT NULL DEFAULT false;

-- Index pour que la requête "WHERE email_digest = true" soit rapide
CREATE INDEX IF NOT EXISTS idx_profils_email_digest
  ON profils_utilisateurs (email_digest)
  WHERE email_digest = true;
