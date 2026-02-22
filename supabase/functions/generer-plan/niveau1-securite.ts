// supabase/functions/generer-plan/niveau1-securite.ts

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ProfilUtilisateur, ProduitFiltre } from './types.ts';

/**
 * NIVEAU 1 : FILTRAGE SÉCURITÉ (BDD)
 * Exclusion stricte des contre-indications, allergies, interactions
 */

export async function filtrerProduitsSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur,
  typesProduits: string[] = ['nutraceutique', 'aromatherapie']
): Promise<ProduitFiltre[]> {
  
  console.log('🔒 NIVEAU 1 : Filtrage sécurité...');
  
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
    console.error('Erreur récupération produits:', error);
    throw new Error('Erreur filtrage sécurité');
  }
  
  // 2. Filtrage strict
  const produitsFiltres = produits?.filter(p => {
    
    // Vérifier grossesse
    if (profil.grossesse && p.populations_risque?.includes('grossesse')) {
      console.log(`❌ ${p.nom} exclu : grossesse`);
      return false;
    }
    
    // Vérifier allaitement
    if (profil.allaitement && p.populations_risque?.includes('allaitement')) {
      console.log(`❌ ${p.nom} exclu : allaitement`);
      return false;
    }
    
    // Vérifier pathologies
    if (profil.pathologies && profil.pathologies.length > 0) {
      const contrIndications = p.contre_indications || [];
      const hasContrIndication = profil.pathologies.some(path => 
        contrIndications.some(ci => ci.toLowerCase().includes(path.toLowerCase()))
      );
      if (hasContrIndication) {
        console.log(`❌ ${p.nom} exclu : contre-indication pathologie`);
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
        console.log(`❌ ${p.nom} exclu : interaction médicamenteuse`);
        return false;
      }
    }
    
    console.log(`✅ ${p.nom} sécurisé`);
    return true;
    
  }) || [];
  
  console.log(`🔒 Filtrage sécurité : ${produitsFiltres.length}/${produits?.length || 0} produits sûrs`);
  
  return produitsFiltres as ProduitFiltre[];
}

export async function filtrerRecettesSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur
): Promise<any[]> {
  
  console.log('🔒 NIVEAU 1 : Filtrage recettes sécurité...');
  
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
  
  const { data: recettes, error } = await query;
  
  if (error) {
    console.error('Erreur récupération recettes:', error);
    throw new Error('Erreur filtrage recettes sécurité');
  }
  
  // Filtrage allergènes dans ingrédients (nécessite requête supplémentaire)
  // TODO : améliorer avec jointure sur table ingrédients
  
  console.log(`🔒 Filtrage recettes : ${recettes?.length || 0} recettes sûres`);
  
  return recettes || [];
}

export async function filtrerRoutinesSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur
): Promise<any[]> {
  
  console.log('🔒 NIVEAU 1 : Filtrage routines sécurité...');
  
  const { data: routines, error } = await supabase
    .from('routines')
    .select('*');
  
  if (error) {
    console.error('Erreur récupération routines:', error);
    throw new Error('Erreur filtrage routines sécurité');
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
  
  console.log(`🔒 Filtrage routines : ${routinesFiltrees.length}/${routines?.length || 0} routines sûres`);
  
  return routinesFiltrees;
}
