// supabase/functions/generer-plan/niveau1-securite.ts
// VERSION CORRIGÉE : Sans emojis

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ProfilUtilisateur, ProduitFiltre } from './types.ts';

/**
 * NIVEAU 1 : FILTRAGE SECURITE (BDD)
 * Exclusion stricte des contre-indications, allergies, interactions
 */

export async function filtrerProduitsSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur,
  typesProduits: string[] = ['nutraceutique', 'aromatherapie']
): Promise<ProduitFiltre[]> {
  
  console.log('[NIVEAU 1] Filtrage securite produits...');
  
  // 1. Récupérer TOUS les produits
  const { data: produits, error } = await supabase
    .from('nutraceutiques')
    .select(`
      id,
      nom,
      nom_scientifique,
      categorie,
      symptomes_cibles,
      niveau_preuve,
      efficacite_estimee,
      contre_indications,
      interactions_medicaments,
      populations_risque
    `);
  
  if (error) {
    console.error('[ERROR] Erreur recuperation produits:', error);
    throw new Error('Erreur filtrage securite');
  }
  
  // 2. Filtrage strict
  const produitsFiltres = produits?.filter(p => {
    
    // Vérifier grossesse
    if (profil.grossesse && p.populations_risque?.includes('grossesse')) {
      console.log(`[EXCLU] ${p.nom} : grossesse`);
      return false;
    }
    
    // Vérifier allaitement
    if (profil.allaitement && p.populations_risque?.includes('allaitement')) {
      console.log(`[EXCLU] ${p.nom} : allaitement`);
      return false;
    }
    
    // Vérifier pathologies
    if (profil.pathologies && profil.pathologies.length > 0) {
      const contrIndications = p.contre_indications || [];
      const hasContrIndication = profil.pathologies.some(path => 
        contrIndications.some(ci => ci.toLowerCase().includes(path.toLowerCase()))
      );
      if (hasContrIndication) {
        console.log(`[EXCLU] ${p.nom} : contre-indication pathologie`);
        return false;
      }
    }
    
    // Vérifier interactions médicamenteuses
    if (profil.medications && profil.medications.length > 0) {
      const interactions = p.interactions_medicaments || [];
      const hasInteraction = profil.medications.some(med =>
        interactions.some(int => int.toLowerCase().includes(med.toLowerCase()))
      );
      if (hasInteraction) {
        console.log(`[EXCLU] ${p.nom} : interaction medicamenteuse`);
        return false;
      }
    }
    
    console.log(`[OK] ${p.nom} securise`);
    return true;
    
  }) || [];
  
  console.log(`[NIVEAU 1] Filtrage securite : ${produitsFiltres.length}/${produits?.length || 0} produits surs`);
  
  return produitsFiltres as ProduitFiltre[];
}

export async function filtrerRecettesSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur
): Promise<any[]> {
  
  console.log('[NIVEAU 1] Filtrage recettes securite...');
  
  // Construction des filtres SQL
  let query = supabase
    .from('recettes')
    .select('*');
  
  // Régime végan
  if (profil.regime_alimentaire?.includes('vegan')) {
    query = query.eq('regime_vegan', true);
  }
  
  // Régime végétarien
  if (profil.regime_alimentaire?.includes('vegetarien')) {
    query = query.eq('regime_vegetarien', true);
  }
  
  // Sans gluten
  if (profil.allergenes?.includes('gluten') || profil.regime_alimentaire?.includes('sans-gluten')) {
    query = query.eq('sans_gluten', true);
  }
  
  // Régime paléo
  if (profil.regime_alimentaire?.includes('paleo')) {
    query = query.eq('regime_paleo', true);
  }
  
  // Régime keto
  if (profil.regime_alimentaire?.includes('keto')) {
    query = query.eq('regime_keto', true);
  }

   // Régime halal
  if (profil.regime_alimentaire?.includes('halal')) {
    query = query.eq('regime_halal', true);
  }
  
  // Régime casher
  if (profil.regime_alimentaire?.includes('casher') || profil.regime_alimentaire?.includes('cachère')) {
    query = query.eq('regime_casher', true);
  }
  
  const { data: recettes, error } = await query;
  
  if (error) {
    console.error('[ERROR] Erreur recuperation recettes:', error);
    throw new Error('Erreur filtrage recettes securite');
  }
  
  console.log(`[NIVEAU 1] Filtrage recettes : ${recettes?.length || 0} recettes sures`);
  
  return recettes || [];
}

export async function filtrerRoutinesSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur
): Promise<any[]> {
  
  console.log('[NIVEAU 1] Filtrage routines securite...');
  
  const { data: routines, error } = await supabase
    .from('routines')
    .select('*');
  
  if (error) {
    console.error('[ERROR] Erreur recuperation routines:', error);
    throw new Error('Erreur filtrage routines securite');
  }
  
  // Filtrage contre-indications
  const routinesFiltrees = routines?.filter(r => {
    const contrIndications = r.contre_indications || [];
    
    // Grossesse
    if (profil.grossesse && contrIndications.some(ci => ci.toLowerCase().includes('grossesse'))) {
      return false;
    }
    
    // Pathologies
    if (profil.pathologies && profil.pathologies.length > 0) {
      const hasContrIndication = profil.pathologies.some(path =>
        contrIndications.some(ci => ci.toLowerCase().includes(path.toLowerCase()))
      );
      if (hasContrIndication) return false;
    }
    
    return true;
  }) || [];
  
  console.log(`[NIVEAU 1] Filtrage routines : ${routinesFiltrees.length}/${routines?.length || 0} routines sures`);
  
  return routinesFiltrees;
}
