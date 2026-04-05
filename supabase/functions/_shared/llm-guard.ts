// supabase/functions/_shared/llm-guard.ts
// Protection centralisée des coûts LLM :
//   - Rate limiting par profil_id et par fonction
//   - Logging de chaque appel avec tokens + coût estimé
//   - Vérification du budget journalier global

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Tarification Haiku (USD / token) ────────────────────────────────────────
const PRIX_INPUT_USD  = 0.0000008;   // $0.80 / 1M tokens
const PRIX_OUTPUT_USD = 0.000004;    // $4.00 / 1M tokens

// ─── Limites par défaut ───────────────────────────────────────────────────────
export const LIMITS = {
  PLANS_JOUR_PAR_PROFIL:    5,     // plans journaliers / profil / jour
  PLANS_SEMAINE_PAR_PROFIL: 2,     // plans semaine / profil / 7 jours
  BUDGET_ALERTE_USD:        8.0,   // alerte dans les logs au-delà
  BUDGET_CAP_USD:           15.0,  // coupe court les nouvelles générations
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface UsageParams {
  profilId?:  string;
  fonction:   string;
  appel:      string;
  model?:     string;
  tokensIn?:  number;
  tokensOut?: number;
  succes?:    boolean;
}

export interface RateLimitResult {
  autorise:   boolean;
  raison?:    string;
  nbDuJour?:  number;
}

// ─── Estimation du coût ───────────────────────────────────────────────────────
export function estimerCout(tokensIn: number, tokensOut: number): number {
  return tokensIn * PRIX_INPUT_USD + tokensOut * PRIX_OUTPUT_USD;
}

// ─── Log d'un appel LLM (fire-and-forget, ne bloque pas la génération) ───────
export function loggerAppelLLM(supabase: SupabaseClient, params: UsageParams): void {
  const coutUsd = (params.tokensIn && params.tokensOut)
    ? estimerCout(params.tokensIn, params.tokensOut)
    : null;

  supabase.from('llm_usage').insert({
    profil_id:  params.profilId  || null,
    fonction:   params.fonction,
    appel:      params.appel,
    model:      params.model    || 'claude-haiku-4-5-20251001',
    tokens_in:  params.tokensIn  || null,
    tokens_out: params.tokensOut || null,
    cout_usd:   coutUsd,
    succes:     params.succes   ?? true,
  }).then(({ error }) => {
    if (error) console.warn('[LLM-GUARD] Erreur log usage (non bloquant):', error.message);
    else if (coutUsd) console.log(`[LLM-GUARD] ${params.appel} — in:${params.tokensIn} out:${params.tokensOut} → $${coutUsd.toFixed(6)}`);
  });
}

// ─── Vérification rate limit plan journalier ─────────────────────────────────
export async function verifierRateLimitJournalier(
  supabase: SupabaseClient,
  profilId: string
): Promise<RateLimitResult> {
  try {
    const debutJour = new Date();
    debutJour.setHours(0, 0, 0, 0);

    const { count, error } = await supabase
      .from('llm_usage')
      .select('id', { count: 'exact', head: true })
      .eq('profil_id', profilId)
      .eq('fonction', 'generer-plan')
      .eq('succes', true)
      .gte('cree_le', debutJour.toISOString());

    if (error) {
      console.warn('[LLM-GUARD] Erreur vérif rate limit (permissif):', error.message);
      return { autorise: true };
    }

    const nb = count ?? 0;
    if (nb >= LIMITS.PLANS_JOUR_PAR_PROFIL) {
      return {
        autorise: false,
        raison:   `Limite atteinte : ${nb} plans générés aujourd'hui (max ${LIMITS.PLANS_JOUR_PAR_PROFIL})`,
        nbDuJour: nb,
      };
    }
    return { autorise: true, nbDuJour: nb };
  } catch (e) {
    console.warn('[LLM-GUARD] Exception rate limit (permissif):', e);
    return { autorise: true };
  }
}

// ─── Vérification rate limit plan semaine ────────────────────────────────────
export async function verifierRateLimitSemaine(
  supabase: SupabaseClient,
  profilId: string
): Promise<RateLimitResult> {
  try {
    const il7Jours = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { count, error } = await supabase
      .from('llm_usage')
      .select('id', { count: 'exact', head: true })
      .eq('profil_id', profilId)
      .eq('fonction', 'generer-plan-semaine')
      .eq('succes', true)
      .gte('cree_le', il7Jours);

    if (error) {
      console.warn('[LLM-GUARD] Erreur vérif rate limit semaine (permissif):', error.message);
      return { autorise: true };
    }

    const nb = count ?? 0;
    if (nb >= LIMITS.PLANS_SEMAINE_PAR_PROFIL) {
      return {
        autorise: false,
        raison:   `Limite atteinte : ${nb} plans semaine ces 7 derniers jours (max ${LIMITS.PLANS_SEMAINE_PAR_PROFIL})`,
        nbDuJour: nb,
      };
    }
    return { autorise: true, nbDuJour: nb };
  } catch (e) {
    console.warn('[LLM-GUARD] Exception rate limit semaine (permissif):', e);
    return { autorise: true };
  }
}

// ─── Vérification budget journalier global ───────────────────────────────────
export async function verifierBudgetJournalier(
  supabase: SupabaseClient
): Promise<{ sousLimite: boolean; coutJour: number }> {
  try {
    const debutJour = new Date();
    debutJour.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('llm_usage')
      .select('cout_usd')
      .gte('cree_le', debutJour.toISOString());

    if (error || !data) return { sousLimite: true, coutJour: 0 };

    const coutJour = data.reduce((acc, r) => acc + (Number(r.cout_usd) || 0), 0);

    if (coutJour >= LIMITS.BUDGET_CAP_USD) {
      console.error(`[LLM-GUARD] BUDGET CAP ATTEINT : $${coutJour.toFixed(4)} >= $${LIMITS.BUDGET_CAP_USD}`);
      return { sousLimite: false, coutJour };
    }
    if (coutJour >= LIMITS.BUDGET_ALERTE_USD) {
      console.warn(`[LLM-GUARD] Budget alerte : $${coutJour.toFixed(4)} / $${LIMITS.BUDGET_CAP_USD}`);
    }
    return { sousLimite: true, coutJour };
  } catch (e) {
    console.warn('[LLM-GUARD] Exception budget (permissif):', e);
    return { sousLimite: true, coutJour: 0 };
  }
}
