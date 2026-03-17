-- Point 5 : nettoyage automatique du cache expiré
-- pg_cron n'étant pas activé, on utilise un trigger AFTER INSERT :
-- à chaque nouveau plan mis en cache, les entrées expirées sont supprimées.

CREATE OR REPLACE FUNCTION clean_expired_plans_cache()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM plans_generes_cache WHERE expires_at < NOW();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_clean_expired_cache ON plans_generes_cache;

CREATE TRIGGER trigger_clean_expired_cache
  AFTER INSERT ON plans_generes_cache
  FOR EACH STATEMENT
  EXECUTE FUNCTION clean_expired_plans_cache();
