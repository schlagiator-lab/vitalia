// supabase/functions/generer-plan/niveau1-securite.ts
// VERSION CORRIGÉE V2 :
// - FIX P3 : Ajout filtrage aromathérapie (manquait entièrement dans v1)
//            → aromatherapieSelectionnee était toujours vide
// - FIX P3 BIS : Type unifié 'nutraceutique' | 'aromatherapie' | 'aliment'
//               pour que scorerProduits() puisse filtrer correctement par type

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ProfilUtilisateur, ProduitFiltre } from './types.ts';

// ============================================================================
// FILTRAGE NUTRACEUTIQUES
// ============================================================================

export async function filtrerProduitsSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur
): Promise<ProduitFiltre[]> {
  
  console.log('[NIVEAU 1] Filtrage sécurité produits...');
  
  try {
    // Récupérer nutraceutiques ET aromathérapie en parallèle
    const [resNutra, resAro] = await Promise.all([
      supabase.from('nutraceutiques').select('*'),
      supabase.from('aromatherapie').select('*')
    ]);

    if (resNutra.error) {
      console.error('[ERROR] Erreur récupération nutraceutiques:', resNutra.error);
    }
    if (resAro.error) {
      console.error('[ERROR] Erreur récupération aromathérapie:', resAro.error);
    }

    // Normaliser les nutraceutiques
    const nutraceutiques: ProduitFiltre[] = ((resNutra.data || []) as any[]).map(p => ({
      ...p,
      type: 'nutraceutique' as const,
      symptomes_cibles:         normaliserArray(p.symptomes_cibles),
      contre_indications:       normaliserArray(p.contre_indications),
      interactions_medicaments: normaliserArray(p.interactions_medicaments),
      populations_risque:       normaliserArray(p.populations_risque)
    }));

    // FIX P3 : Normaliser les aromathérapies
    const aromatherapies: ProduitFiltre[] = ((resAro.data || []) as any[]).map(p => ({
      ...p,
      type: 'aromatherapie' as const,
      symptomes_cibles:         normaliserArray(p.symptomes_cibles),
      contre_indications:       normaliserArray(p.contre_indications || p.contre_indications_majeures),
      interactions_medicaments: normaliserArray(p.interactions_medicaments || p.interactions_medicaments),
      populations_risque:       normaliserArray(p.populations_risque || extrairePopulationsRisqueHE(p))
    }));

    // Combiner et filtrer
    const tousLesProduits = [...nutraceutiques, ...aromatherapies];
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

/**
 * Extrait les populations à risque depuis les champs texte HE
 * (les HE ont "contre_indications_majeures" en texte libre)
 */
function extrairePopulationsRisqueHE(he: any): string[] {
  const texte = (he.contre_indications_majeures || '').toLowerCase();
  const populations: string[] = [];
  
  if (texte.includes('grossesse') || texte.includes('enceinte')) {
    populations.push('grossesse');
  }
  if (texte.includes('allaitement') || texte.includes('allaitante')) {
    populations.push('allaitement');
  }
  if (texte.includes('enfant') || texte.includes('nourrisson')) {
    populations.push('enfant');
  }
  if (texte.includes('épilepsie') || texte.includes('epilepsie')) {
    populations.push('epilepsie');
  }
  
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
    
    // Filtres régimes alimentaires stricts
    if (profil.regime_alimentaire?.includes('vegan')) {
      query = query.eq('regime_vegan', true);
    }
    if (profil.regime_alimentaire?.includes('vegetarien')) {
      query = query.eq('regime_vegetarien', true);
    }
    if (profil.allergenes?.includes('gluten') || profil.regime_alimentaire?.includes('sans-gluten')) {
      query = query.eq('sans_gluten', true);
    }
    if (profil.regime_alimentaire?.includes('halal')) {
      query = query.eq('regime_halal', true);
    }
    if (profil.regime_alimentaire?.includes('casher')) {
      query = query.eq('regime_casher', true);
    }
    if (profil.regime_alimentaire?.includes('paleo')) {
      query = query.eq('regime_paleo', true);
    }
    if (profil.regime_alimentaire?.includes('keto')) {
      query = query.eq('regime_keto', true);
    }
    
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
// FILTRAGE ROUTINES
// ============================================================================

export async function filtrerRoutinesSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur
): Promise<any[]> {
  
  console.log('[NIVEAU 1] Filtrage routines sécurité...');
  
  try {
    const { data: routines, error } = await supabase
      .from('routines')
      .select('*');
    
    if (error) {
      console.error('[ERROR] Erreur récupération routines:', error);
      return [];
    }
    
    // Filtrer routines contre-indiquées (ex: sport intensif si pathologie cardiaque)
    const routinesFiltrees = (routines || []).filter((r: any) => {
      const ci = normaliserArray(r.contre_indications);
      if (!ci.length || !profil.pathologies?.length) return true;
      
      const pathologiesLower = profil.pathologies.map((p: string) => p.toLowerCase());
      const ciLower = ci.map((c: string) => c.toLowerCase());
      
      return !pathologiesLower.some(pp => ciLower.some(c => c.includes(pp)));
    });
    
    console.log(`[NIVEAU 1] Routines : ${routinesFiltrees.length}/${routines?.length || 0} sûres`);
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
    // Peut être une string CSV "val1,val2" ou une string PostgreSQL "{val1,val2}"
    return valeur
      .replace(/^\{|\}$/g, '') // enlever les accolades PostgreSQL
      .split(/,(?![^{]*})/)    // split sur virgule (sauf dans des sous-objets)
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
  return [];
}
