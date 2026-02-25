// supabase/functions/generer-plan/niveau1-securite.ts
// VERSION V3 :
// - Utilise les tables junction besoins (nutraceutiques_besoins, aromatherapie_besoins, routines_besoins)
// - Filtre les produits par pertinence besoin + sécurité profil
// - Le score besoin est directement exploitable en niveau2 (plus de matching string flou)

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ProfilUtilisateur, ProduitFiltre } from './types.ts';

// ============================================================================
// FILTRAGE NUTRACEUTIQUES + AROMATHÉRAPIE via tables junction
// ============================================================================

export async function filtrerProduitsSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur,
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
    const produitsFiltres = tousLesProduits.filter(p => appliquerFiltresSecurite(p, profil));

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

// ============================================================================
// LOGIQUE DE FILTRAGE SÉCURITÉ (partagée nutraceutiques + HE)
// ============================================================================

function appliquerFiltresSecurite(p: any, profil: ProfilUtilisateur): boolean {

  // 1. Contre-indication grossesse
  if (profil.grossesse && p.populations_risque.some((r: string) =>
    ['grossesse', 'enceinte', 'femme enceinte'].includes(r.toLowerCase())
  )) {
    return false;
  }

  // 2. Contre-indication allaitement
  if (profil.allaitement && p.populations_risque.some((r: string) =>
    ['allaitement', 'allaitante'].includes(r.toLowerCase())
  )) {
    return false;
  }

  // 3. Contre-indications pathologies
  if (profil.pathologies && profil.pathologies.length > 0) {
    const pathologiesLower = profil.pathologies.map((pp: string) => pp.toLowerCase());
    const ciLower = p.contre_indications.map((ci: string) => ci.toLowerCase());
    if (pathologiesLower.some(pp => ciLower.some(ci => ci.includes(pp)))) {
      return false;
    }
  }

  // 4. Interactions médicamenteuses
  if (profil.medications && profil.medications.length > 0) {
    const medsLower = profil.medications.map((m: string) => m.toLowerCase());
    const interLower = p.interactions_medicaments.map((i: string) => i.toLowerCase());
    if (medsLower.some(med => interLower.some(inter => inter.includes(med)))) {
      return false;
    }
  }

  return true;
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
  profil: ProfilUtilisateur
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

    console.log(`[NIVEAU 1] Recettes : ${recettes?.length || 0} sûres`);
    return recettes || [];

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
  profil: ProfilUtilisateur,
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

    // Filtrer routines contre-indiquées
    const routinesFiltrees = routines.filter((r: any) => {
      const ci = normaliserArray(r.contre_indications);
      if (!ci.length || !profil.pathologies?.length) return true;

      const pathologiesLower = profil.pathologies.map((p: string) => p.toLowerCase());
      const ciLower = ci.map((c: string) => c.toLowerCase());

      return !pathologiesLower.some(pp => ciLower.some(c => c.includes(pp)));
    });

    console.log(`[NIVEAU 1] Routines : ${routinesFiltrees.length}/${routines.length} sûres`);
    return routinesFiltrees;

  } catch (error) {
    console.error('[ERROR] Exception filtrerRoutinesSecurite:', error);
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
