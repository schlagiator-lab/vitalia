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

// ─── Minuit Europe/Zurich (en UTC) — le quota se réinitialise à minuit heure suisse ──
function decalageZurichMs(instant: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Zurich', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).map(x => [x.type, x.value])
  );
  const commeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((commeUtc - instant.getTime()) / 60000) * 60000;
}

function debutJourZurich(): Date {
  const maintenant = new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Zurich', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(maintenant).map(x => [x.type, x.value])
  );
  const minuitCommeUtc = Date.UTC(+p.year, +p.month - 1, +p.day);
  // 2 passes : le décalage est recalculé à minuit même (correct les jours de changement d'heure)
  let debut = new Date(minuitCommeUtc - decalageZurichMs(maintenant));
  debut = new Date(minuitCommeUtc - decalageZurichMs(debut));
  return debut;
}

// ─── Vérification rate limit plan journalier ─────────────────────────────────
// Compte les PLANS générés (lignes plans_generes), pas les appels LLM :
// un plan = ~6 appels LLM, compter llm_usage bloquait dès le 1er plan.
export async function verifierRateLimitJournalier(
  supabase: SupabaseClient,
  profilId: string
): Promise<RateLimitResult> {
  try {
    const debutJour = debutJourZurich();

    const { count, error } = await supabase
      .from('plans_generes')
      .select('id', { count: 'exact', head: true })
      .eq('profil_id', profilId)
      .gte('genere_le', debutJour.toISOString());

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
// Compte les SEMAINES générées : uniquement l'appel batch réussi (appel='batch-7-jours',
// succes=true). La motivation et les batchs tombés en fallback ne sont pas comptés.
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
      .eq('appel', 'batch-7-jours')
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
