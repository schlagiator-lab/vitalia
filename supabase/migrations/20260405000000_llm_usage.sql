-- Protection des coûts LLM : table de traçabilité et rate limiting
-- Chaque appel à l'API Anthropic est logué avec tokens in/out et coût estimé.
-- Les rate limits sont vérifiés côté Edge Function via cette table.

CREATE TABLE IF NOT EXISTS llm_usage (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  profil_id   TEXT,                                   -- NULL si non identifiable
  fonction    TEXT        NOT NULL,                   -- 'generer-plan' | 'generer-plan-semaine' | ...
  appel       TEXT        NOT NULL,                   -- 'recette-petit-dejeuner' | 'pause' | 'motivation' | 'batch-semaine' | ...
  model       TEXT        NOT NULL DEFAULT 'claude-haiku-4-5-20251001',
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  cout_usd    NUMERIC(10,6),                          -- coût estimé en USD
  succes      BOOLEAN     NOT NULL DEFAULT true,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour les requêtes de rate limiting (très fréquentes)
CREATE INDEX IF NOT EXISTS llm_usage_profil_jour
  ON llm_usage (profil_id, fonction, cree_le DESC);

CREATE INDEX IF NOT EXISTS llm_usage_jour
  ON llm_usage (cree_le DESC);

-- RLS : lecture uniquement via service role (Edge Functions)
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_llm_usage"
  ON llm_usage FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Vue pratique pour le monitoring des coûts
CREATE OR REPLACE VIEW llm_couts_par_jour AS
SELECT
  cree_le::date                        AS jour,
  fonction,
  COUNT(*)                             AS nb_appels,
  SUM(tokens_in)                       AS total_tokens_in,
  SUM(tokens_out)                      AS total_tokens_out,
  ROUND(SUM(cout_usd)::numeric, 4)     AS cout_total_usd,
  COUNT(DISTINCT profil_id)            AS nb_profils_distincts
FROM llm_usage
GROUP BY 1, 2
ORDER BY 1 DESC, 3 DESC;
