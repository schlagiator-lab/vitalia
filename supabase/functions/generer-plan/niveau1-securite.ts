// supabase/functions/generer-plan/niveau1-securite.ts
// VERSION V3 :
// - Utilise les tables junction besoins (nutraceutiques_besoins, aromatherapie_besoins, routines_besoins)
// - Filtre les produits par pertinence besoin + sécurité profil
// - Le score besoin est directement exploitable en niveau2 (plus de matching string flou)

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ProfilUtilisateur, ProduitFiltre } from './types.ts';
import {
  ProfilSecurite, Decision, produitEstSur, routineEstSure, recetteBddEstSure, alimentEstSur,
} from '../_shared/securite.ts';

// Filtre + log des exclusions (les décisions viennent TOUTES de _shared/securite.ts)
function filtrerAvecJournal<T extends { nom?: string; id?: string }>(
  contexte: string,
  items: T[],
  decider: (item: T) => Decision
): T[] {
  const garde: T[] = [];
  const exclus: string[] = [];
  for (const item of items) {
    const d = decider(item);
    if (d.sur) garde.push(item);
    else exclus.push(`${item.nom ?? item.id} [${d.raison}]`);
  }
  if (exclus.length > 0) {
    const apercu = exclus.slice(0, 12).join(', ') + (exclus.length > 12 ? ` … (+${exclus.length - 12})` : '');
    console.log(`[SECURITE] ${contexte} : ${exclus.length}/${items.length} exclu(s) — ${apercu}`);
  }
  return garde;
}

// ============================================================================
// FILTRAGE NUTRACEUTIQUES + AROMATHÉRAPIE via tables junction
// ============================================================================

export async function filtrerProduitsSecurite(
  supabase: SupabaseClient,
  securite: ProfilSecurite,
  besoins: string[] = []
): Promise<ProduitFiltre[]> {

  console.log('[NIVEAU 1] Filtrage sécurité produits pour besoins:', besoins);

  // Si aucun besoin fourni, prendre tous les besoins disponibles
  const besoinsActifs = besoins.length > 0
    ? besoins
    : ['vitalite', 'serenite', 'sommeil', 'digestion', 'mobilite', 'hormones'];

  try {
    // ── Récupération via tables junction (nutraceutiques et aromathérapie) ──
    const [resNutra, resAro] = await Promise.all([
      supabase
        .from('nutraceutiques_besoins')
        .select('besoin_id, score, nutraceutiques(*)')
        .in('besoin_id', besoinsActifs),
      supabase
        .from('aromatherapie_besoins')
        .select('besoin_id, score, aromatherapie(*)')
        .in('besoin_id', besoinsActifs)
    ]);

    if (resNutra.error) {
      console.error('[ERROR] Erreur récupération nutraceutiques_besoins:', resNutra.error);
    }
    if (resAro.error) {
      console.error('[ERROR] Erreur récupération aromatherapie_besoins:', resAro.error);
    }

    // ── Dédupliquer : garder le score max par produit ──
    const nutraMap = new Map<string, ProduitFiltre>();
    for (const row of (resNutra.data || []) as any[]) {
      const p = row.nutraceutiques;
      if (!p) continue;
      const existing = nutraMap.get(p.id);
      const newScore = row.score || 1;
      if (!existing || (existing.besoin_score || 0) < newScore) {
        nutraMap.set(p.id, {
          ...p,
          type: 'nutraceutique' as const,
          besoin_id: row.besoin_id,
          besoin_score: newScore,
          symptomes_cibles:         normaliserArray(p.symptomes_cibles),
          contre_indications:       normaliserArray(p.contre_indications),
          interactions_medicaments: normaliserArray(p.interactions_medicaments),
          populations_risque:       normaliserArray(p.populations_risque)
        });
      }
    }

    const aroMap = new Map<string, ProduitFiltre>();
    for (const row of (resAro.data || []) as any[]) {
      const p = row.aromatherapie;
      if (!p) continue;
      const existing = aroMap.get(p.id);
      const newScore = row.score || 1;
      if (!existing || (existing.besoin_score || 0) < newScore) {
        aroMap.set(p.id, {
          ...p,
          type: 'aromatherapie' as const,
          besoin_id: row.besoin_id,
          besoin_score: newScore,
          symptomes_cibles:         normaliserArray(p.symptomes_cibles),
          contre_indications:       normaliserArray(p.contre_indications || p.contre_indications_majeures),
          interactions_medicaments: normaliserArray(p.interactions_medicaments),
          populations_risque:       normaliserArray(p.populations_risque || extrairePopulationsRisqueHE(p))
        });
      }
    }

    const nutraceutiques = Array.from(nutraMap.values());
    const aromatherapies = Array.from(aroMap.values());

    // ── Fallback : si les tables junction sont vides, charger tous les produits ──
    let tousLesProduits: ProduitFiltre[];

    if (nutraceutiques.length === 0 && aromatherapies.length === 0) {
      console.warn('[NIVEAU 1] Tables junction vides — fallback vers tables directes');
      tousLesProduits = await fetchProduitsDirect(supabase);
    } else {
      tousLesProduits = [...nutraceutiques, ...aromatherapies];
    }

    const totalAvant = tousLesProduits.length;
    const produitsFiltres = filtrerAvecJournal('Niveau 1 produits', tousLesProduits, p => produitEstSur(p, p.type as 'nutraceutique' | 'aromatherapie', securite));

    console.log(`[NIVEAU 1] Nutraceutiques : ${nutraceutiques.length} | Aromathérapie : ${aromatherapies.length}`);
    console.log(`[NIVEAU 1] Filtrés : ${produitsFiltres.length}/${totalAvant} produits sûrs`);

    return produitsFiltres;

  } catch (error) {
    console.error('[ERROR] Exception filtrerProduitsSecurite:', error);
    return [];
  }
}

// Fallback : charger directement sans junction
async function fetchProduitsDirect(supabase: SupabaseClient): Promise<ProduitFiltre[]> {
  const [resNutra, resAro] = await Promise.all([
    supabase.from('nutraceutiques').select('*'),
    supabase.from('aromatherapie').select('*')
  ]);

  const nutraceutiques: ProduitFiltre[] = ((resNutra.data || []) as any[]).map(p => ({
    ...p,
    type: 'nutraceutique' as const,
    besoin_score: 3,
    symptomes_cibles:         normaliserArray(p.symptomes_cibles),
    contre_indications:       normaliserArray(p.contre_indications),
    interactions_medicaments: normaliserArray(p.interactions_medicaments),
    populations_risque:       normaliserArray(p.populations_risque)
  }));

  const aromatherapies: ProduitFiltre[] = ((resAro.data || []) as any[]).map(p => ({
    ...p,
    type: 'aromatherapie' as const,
    besoin_score: 3,
    symptomes_cibles:         normaliserArray(p.symptomes_cibles),
    contre_indications:       normaliserArray(p.contre_indications || p.contre_indications_majeures),
    interactions_medicaments: normaliserArray(p.interactions_medicaments),
    populations_risque:       normaliserArray(p.populations_risque || extrairePopulationsRisqueHE(p))
  }));

  return [...nutraceutiques, ...aromatherapies];
}


function extrairePopulationsRisqueHE(he: any): string[] {
  const texte = (he.contre_indications_majeures || '').toLowerCase();
  const populations: string[] = [];

  if (texte.includes('grossesse') || texte.includes('enceinte')) populations.push('grossesse');
  if (texte.includes('allaitement') || texte.includes('allaitante')) populations.push('allaitement');
  if (texte.includes('enfant') || texte.includes('nourrisson')) populations.push('enfant');
  if (texte.includes('épilepsie') || texte.includes('epilepsie')) populations.push('epilepsie');

  return populations;
}

// ============================================================================
// FILTRAGE RECETTES
// ============================================================================

export async function filtrerRecettesSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur,
  securite: ProfilSecurite
): Promise<any[]> {

  console.log('[NIVEAU 1] Filtrage recettes sécurité...');

  try {
    let query = supabase.from('recettes').select('*');

    if (profil.regime_alimentaire?.includes('vegan'))        query = query.eq('regime_vegan', true);
    if (profil.regime_alimentaire?.includes('vegetarien'))   query = query.eq('regime_vegetarien', true);
    if (profil.allergenes?.includes('gluten') || profil.regime_alimentaire?.includes('sans-gluten'))
                                                              query = query.eq('sans_gluten', true);
    if (profil.regime_alimentaire?.includes('halal'))        query = query.eq('regime_halal', true);
    if (profil.regime_alimentaire?.includes('casher'))       query = query.eq('regime_casher', true);
    if (profil.regime_alimentaire?.includes('paleo'))        query = query.eq('regime_paleo', true);
    if (profil.regime_alimentaire?.includes('keto'))         query = query.eq('regime_keto', true);

    const { data: recettes, error } = await query;

    if (error) {
      console.error('[ERROR] Erreur récupération recettes:', error);
      return [];
    }

    // Pré-filtre SQL ci-dessus (préférences) + décision sécurité unique (_shared/securite.ts)
    const recettesSures = filtrerAvecJournal('Niveau 1 recettes BDD', recettes || [], r => recetteBddEstSure(r, securite));
    console.log(`[NIVEAU 1] Recettes : ${recettesSures.length}/${recettes?.length || 0} sûres`);
    return recettesSures;

  } catch (error) {
    console.error('[ERROR] Exception filtrerRecettesSecurite:', error);
    return [];
  }
}

// ============================================================================
// FILTRAGE ROUTINES via table junction routines_besoins
// ============================================================================

export async function filtrerRoutinesSecurite(
  supabase: SupabaseClient,
  securite: ProfilSecurite,
  besoins: string[] = []
): Promise<any[]> {

  console.log('[NIVEAU 1] Filtrage routines sécurité pour besoins:', besoins);

  const besoinsActifs = besoins.length > 0
    ? besoins
    : ['vitalite', 'serenite', 'sommeil', 'digestion', 'mobilite', 'hormones'];

  try {
    // Tentative via table junction
    const { data: joinData, error: joinError } = await supabase
      .from('routines_besoins')
      .select('besoin_id, score, routines(*)')
      .in('besoin_id', besoinsActifs);

    let routines: any[];

    if (joinError || !joinData || joinData.length === 0) {
      console.warn('[NIVEAU 1] routines_besoins indisponible — fallback table directe');
      const { data: directData, error: directError } = await supabase
        .from('routines')
        .select('*');
      if (directError) {
        console.error('[ERROR] Erreur récupération routines:', directError);
        return [];
      }
      routines = (directData || []).map((r: any) => ({ ...r, besoin_score: 3 }));
    } else {
      // Dédupliquer par routine_id en gardant score max
      const routineMap = new Map<string, any>();
      for (const row of joinData as any[]) {
        const r = row.routines;
        if (!r) continue;
        const existing = routineMap.get(r.id);
        const newScore = row.score || 1;
        if (!existing || (existing.besoin_score || 0) < newScore) {
          routineMap.set(r.id, {
            ...r,
            besoin_id: row.besoin_id,
            besoin_score: newScore,
            contre_indications: normaliserArray(r.contre_indications)
          });
        }
      }
      routines = Array.from(routineMap.values());
    }

    // Filtrer routines contre-indiquées (grossesse, allaitement, pathologies — _shared/securite.ts)
    const routinesFiltrees = filtrerAvecJournal('Niveau 1 routines', routines, (r: any) => routineEstSure(r, securite));

    console.log(`[NIVEAU 1] Routines : ${routinesFiltrees.length}/${routines.length} sûres`);
    return routinesFiltrees;

  } catch (error) {
    console.error('[ERROR] Exception filtrerRoutinesSecurite:', error);
    return [];
  }
}

// ============================================================================
// FILTRAGE ALIMENTS via alimentation_besoins
// ============================================================================

export async function filtrerAlimentsBesoins(
  supabase: SupabaseClient,
  securite: ProfilSecurite,
  besoins: string[]
): Promise<any[]> {

  const besoinsActifs = besoins.length > 0
    ? besoins
    : ['vitalite', 'serenite', 'sommeil', 'digestion', 'mobilite', 'hormones'];

  console.log('[NIVEAU 1] Chargement aliments depuis alimentation_besoins pour besoins:', besoinsActifs);

  try {
    const { data, error } = await supabase
      .from('alimentation_besoins')
      .select('besoin_id, score, alimentation(*)')
      .in('besoin_id', besoinsActifs);

    if (error || !data?.length) {
      console.warn('[NIVEAU 1] alimentation_besoins vide ou erreur:', error?.message);
      return [];
    }

    // Dédupliquer : garder score max par NOM normalisé (pas par ID)
    // FIX anti-répétition : certains aliments ont deux IDs différents mais le même nom
    // (ex: "Maquereau" ALI_047 + ALI_119, "Saumon sauvage" ALI_010 + ALI_045)
    // Sans cette déduplication par nom, proteinesSorted[0] et [1] peuvent être le même aliment
    // → même protéine au déjeuner ET au dîner dans un même plan.
    const alimentMap = new Map<string, any>();
    for (const row of data as any[]) {
      const a = row.alimentation;
      if (!a) continue;
      const nomKey = (a.nom || '').toLowerCase().trim();
      const existing = alimentMap.get(nomKey);
      if (!existing || (existing.besoin_score || 0) < (row.score || 0)) {
        alimentMap.set(nomKey, { ...a, besoin_score: row.score || 1, besoin_id: row.besoin_id });
      }
    }

    let aliments = Array.from(alimentMap.values());

    // Décision sécurité unique (régimes, allergies, grossesse, médicaments) — _shared/securite.ts
    aliments = filtrerAvecJournal('Niveau 1 aliments', aliments, a => alimentEstSur(a, securite));

    console.log(`[NIVEAU 1] Aliments chargés : ${aliments.length}`);
    return aliments;

  } catch (err) {
    console.error('[ERROR] Exception filtrerAlimentsBesoins:', err);
    return [];
  }
}

// ============================================================================
// UTILITAIRE : Normaliser arrays (gère null, string CSV, array PostgreSQL)
// ============================================================================

function normaliserArray(valeur: any): string[] {
  if (!valeur) return [];
  if (Array.isArray(valeur)) return valeur.filter(Boolean);
  if (typeof valeur === 'string') {
    return valeur
      .replace(/^\{|\}$/g, '')
      .split(/,(?![^{]*})/)
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
  return [];
}
