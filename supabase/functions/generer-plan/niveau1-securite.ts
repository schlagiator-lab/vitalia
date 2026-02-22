// supabase/functions/generer-plan/niveau1-securite.ts
// VERSION FINALE CORRIGÉE

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ProfilUtilisateur, ProduitFiltre } from './types.ts';

export async function filtrerProduitsSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur
): Promise<ProduitFiltre[]> {
  
  console.log('[NIVEAU 1] Filtrage securite produits...');
  
  try {
    const { data: nutraceutiques, error } = await supabase
      .from('nutraceutiques')
      .select('*');
    
    if (error) {
      console.error('[ERROR] Erreur recuperation nutraceutiques:', error);
      return [];
    }
    
    const produits = (nutraceutiques || []).map(p => ({ 
      ...p, 
      type: 'nutraceutique' as const,
      symptomes_cibles: p.symptomes_cibles || [],
      contre_indications: p.contre_indications || [],
      interactions_medicaments: p.interactions_medicaments || [],
      populations_risque: p.populations_risque || []
    }));
    
    const produitsFiltres = produits.filter(p => {
      if (profil.grossesse && p.populations_risque.includes('grossesse')) return false;
      if (profil.allaitement && p.populations_risque.includes('allaitement')) return false;
      return true;
    });
    
    console.log(`[NIVEAU 1] Produits : ${produitsFiltres.length}/${produits.length} surs`);
    return produitsFiltres as ProduitFiltre[];
    
  } catch (error) {
    console.error('[ERROR] Exception filtrerProduitsSecurite:', error);
    return [];
  }
}

export async function filtrerRecettesSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur
): Promise<any[]> {
  
  console.log('[NIVEAU 1] Filtrage recettes securite...');
  
  try {
    let query = supabase.from('recettes').select('*');
    
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
    
    const { data: recettes, error } = await query;
    
    if (error) {
      console.error('[ERROR] Erreur recuperation recettes:', error);
      return [];
    }
    
    console.log(`[NIVEAU 1] Recettes : ${recettes?.length || 0} sures`);
    return recettes || [];
    
  } catch (error) {
    console.error('[ERROR] Exception filtrerRecettesSecurite:', error);
    return [];
  }
}

export async function filtrerRoutinesSecurite(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur
): Promise<any[]> {
  
  console.log('[NIVEAU 1] Filtrage routines securite...');
  
  try {
    const { data: routines, error } = await supabase
      .from('routines')
      .select('*');
    
    if (error) {
      console.error('[ERROR] Erreur recuperation routines:', error);
      return [];
    }
    
    console.log(`[NIVEAU 1] Routines : ${routines?.length || 0} sures`);
    return routines || [];
    
  } catch (error) {
    console.error('[ERROR] Exception filtrerRoutinesSecurite:', error);
    return [];
  }
}
