// supabase/functions/generer-plan/utils.ts
// VERSION CORRIGÉE : Sans emojis

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * FONCTIONS UTILITAIRES
 */

// ============================================================================
// ENREGISTREMENT HISTORIQUE
// ============================================================================

export async function enregistrerPlanGenere(
  supabase: SupabaseClient,
  profilId: string,
  plan: any
): Promise<string | null> {
  
  console.log('[SAUVEGARDE] Enregistrement plan genere...');
  
  try {
    const { data, error } = await supabase
      .from('plans_generes')
      .insert({
        profil_id: profilId,
        symptomes_declares: plan.symptomes,
        objectif_principal: plan.objectif,
        plan_json: plan,
        genere_le: new Date().toISOString(),
        expire_le: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select('id')
      .single();
    
    if (error) {
      console.error('[ERROR] Erreur enregistrement plan:', error);
      return null;
    }
    
    console.log(`[SAUVEGARDE] Plan enregistre : ${data.id}`);
    
    return data.id;
    
  } catch (error) {
    console.error('[ERROR] Erreur enregistrement plan:', error);
    return null;
  }
}

export async function enregistrerItemsVus(
  supabase: SupabaseClient,
  profilId: string,
  planId: string,
  items: Array<{
    type: string;
    id: string;
    nom: string;
    style_culinaire?: string;
    type_repas?: string;
    ingredients?: string[];
    categorie?: string;
    moment?: string;
  }>
): Promise<void> {
  
  console.log(`[SAUVEGARDE] Enregistrement ${items.length} items vus...`);
  
  try {
    const itemsAInserer = items.map(item => ({
      profil_id: profilId,
      plan_id: planId,
      type_item: item.type,
      item_id: item.id,
      item_nom: item.nom,
      style_culinaire: item.style_culinaire || null,
      type_repas: item.type_repas || null,
      ingredients_principaux: item.ingredients || null,
      categorie_produit: item.categorie || null,
      moment_journee: item.moment || null,
      vu_le: new Date().toISOString(),
      nb_fois_vu: 1,
      derniere_vue: new Date().toISOString()
    }));
    
    const { error } = await supabase
      .from('historique_items_vus')
      .insert(itemsAInserer);
    
    if (error) {
      console.error('[ERROR] Erreur enregistrement items:', error);
    } else {
      console.log(`[SAUVEGARDE] ${items.length} items enregistres`);
    }
    
  } catch (error) {
    console.error('[ERROR] Erreur enregistrement items:', error);
  }
}

// ============================================================================
// CACHE RECETTES
// ============================================================================

export async function chercherRecetteCache(
  supabase: SupabaseClient,
  ingredientsIds: string[],
  styleCulinaire: string,
  typeRepas: string
): Promise<any | null> {
  
  console.log('[CACHE] Recherche recette en cache...');
  
  try {
    const { data, error } = await supabase
      .from('recettes_sauvegardees')
      .select('*')
      .eq('type_repas', typeRepas)
      .eq('style_culinaire', styleCulinaire)
      .gte('note_moyenne', 3)
      .limit(10);
    
    if (error || !data || data.length === 0) {
      console.log('[CACHE] Aucune recette en cache');
      return null;
    }
    
    const recetteSimilaire = data.find(r => {
      const ingredientsCommuns = r.ingredients_ids?.filter((id: string) =>
        ingredientsIds.includes(id)
      ).length || 0;
      
      return ingredientsCommuns >= Math.min(3, ingredientsIds.length * 0.6);
    });
    
    if (recetteSimilaire) {
      console.log(`[CACHE] Recette trouvee en cache : ${recetteSimilaire.nom}`);
      return recetteSimilaire;
    }
    
    console.log('[CACHE] Aucune recette similaire en cache');
    return null;
    
  } catch (error) {
    console.error('[ERROR] Erreur recherche cache:', error);
    return null;
  }
}

export async function sauvegarderRecetteGeneree(
  supabase: SupabaseClient,
  recette: any,
  profilId: string
): Promise<void> {
  
  if (!recette.genere_par_llm) return;
  
  console.log('[SAUVEGARDE] Sauvegarde recette generee...');
  
  try {
    const { error } = await supabase
      .from('recettes_sauvegardees')
      .insert({
        profil_id: profilId,
        nom: recette.nom,
        type_repas: recette.type_repas,
        style_culinaire: recette.style_culinaire,
        ingredients_ids: recette.ingredients.map((i: any) => i.id || i.nom),
        recette_json: recette,
        genere_le: new Date().toISOString(),
        note_moyenne: null,
        nb_utilisations: 0
      });
    
    if (error) {
      console.error('[ERROR] Erreur sauvegarde recette:', error);
    } else {
      console.log('[SAUVEGARDE] Recette sauvegardee');
    }
    
  } catch (error) {
    console.error('[ERROR] Erreur sauvegarde recette:', error);
  }
}

// ============================================================================
// VALIDATION
// ============================================================================

export function validerProfil(profil: any): boolean {
  if (!profil || !profil.id) {
    console.error('[ERROR] Profil invalide : ID manquant');
    return false;
  }
  
  return true;
}

export function validerContexte(contexte: any): boolean {
  return true;
}

// ============================================================================
// FORMATAGE REPONSE
// ============================================================================

export function formaterReponseAPI(plan: any, planId: string | null) {
  return {
    success: true,
    plan_id: planId,
    plan: plan,
    metadata: {
      genere_le: new Date().toISOString(),
      expire_le: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      version: '1.0'
    }
  };
}

export function formaterErreurAPI(message: string, code: string = 'INTERNAL_ERROR') {
  return {
    success: false,
    error: {
      code,
      message
    }
  };
}

// ============================================================================
// HELPERS
// ============================================================================

export function genererIdUnique(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
