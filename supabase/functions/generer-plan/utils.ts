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
  typeRepas: string,
  profilId: string
): Promise<any | null> {

  console.log('[CACHE] Recherche recette en cache...');

  try {
    const { data, error } = await supabase
      .from('recettes_sauvegardees')
      .select('*')
      .eq('profil_id', profilId)
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

// ============================================================================
// CALCUL NUTRITION RÉELLE DEPUIS LA TABLE ALIMENTATION
// ============================================================================

export interface NutritionCalculee {
  calories:  number;
  proteines: number;
  glucides:  number;
  lipides:   number;
  couverture: string;   // ex: "4/7 ingrédients"
  source: 'calculé' | 'partiel' | 'estimé_llm';
}

/**
 * Convertit une quantité+unité en grammes.
 * Retourne null si l'unité est inconnue ou la quantité nulle.
 */
export function convertirEnGrammes(quantite: number, unite: string, nomIng: string): number | null {
  if (!quantite || quantite <= 0) return null;
  const u = (unite || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (['g', 'gr', 'gramme', 'grammes', 'grams'].includes(u)) return quantite;
  if (u === 'kg' || u === 'kilogramme') return quantite * 1000;
  if (u === 'ml')  return quantite;          // 1 ml ≈ 1 g (eau)
  if (u === 'cl')  return quantite * 10;
  if (u === 'l' || u === 'litre' || u === 'litres') return quantite * 1000;
  if (u.includes('soupe') || u === 'cas' || u === 'tbsp') return quantite * 15;
  if (u.includes('cafe')  || u === 'cac' || u === 'tsp')  return quantite * 5;
  if (u === 'verre')                    return quantite * 200;
  if (u === 'poignee' || u === 'poignees') return quantite * 30;

  // pièce — conversion par nom d'ingrédient
  if (['piece', 'pieces', 'pc', 'pcs', 'unite', 'unites', ''].includes(u)) {
    const n = nomIng.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const table: Record<string, number> = {
      'oeuf': 55, 'egg': 55,
      'citron': 100, 'orange': 150, 'pomme': 130, 'poire': 140,
      'banane': 120, 'tomate': 100, 'oignon': 80, 'echalote': 40,
      'gousse': 5, 'carotte': 80, 'courgette': 200, 'poivron': 150,
      'avocat': 150, 'mangue': 200, 'peche': 130, 'prune': 50,
      'figue': 50, 'kiwi': 75, 'abricot': 40,
    };
    for (const [key, g] of Object.entries(table)) {
      if (n.includes(key)) return quantite * g;
    }
    return quantite * 100; // défaut 100 g / pièce
  }
  return null; // unité non reconnue → ingrédient ignoré
}

/**
 * Extrait le mot-clé principal d'un nom d'ingrédient pour la recherche ILIKE.
 */
export function extraireMotCle(nom: string): string | null {
  const stopWords = new Set([
    'de', 'du', 'des', 'le', 'la', 'les', 'et', 'en', 'au', 'aux',
    'un', 'une', 'avec', 'sans', 'frais', 'fraiche', 'fraîche', 'bio',
    'nature', 'maison', 'sur', 'par', 'pour',
    // mots de préparation
    'filet', 'pave', 'tranche', 'steak', 'cuisse', 'aile', 'blanc',
    'rouge', 'noir', 'vert', 'dore', 'grille', 'cuit', 'cru', 'entier',
    'hache', 'emincer', 'coupe',
    // assaisonnements ignorés (très peu caloriques)
    'sel', 'poivre', 'herbe', 'epice', 'persil', 'ciboulette', 'thym',
    'romarin', 'basilic', 'laurier', 'ail', 'echalote',
  ]);

  const normalized = nom.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim();

  const words = normalized.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
  return words[0] || (normalized.length > 2 ? normalized.split(/\s+/)[0] : null);
}

/**
 * Calcule les macros réelles en croisant les ingrédients avec la table alimentation.
 * - Ingrédients matchés  → kcal réelles calculées (quantite / 100 × valeur_100g)
 * - Ingrédients manquants → ignorés (0 kcal comptés pour eux)
 * - Si < 2 ingrédients matchés → retourne null (on garde l'estimation LLM)
 */
export async function calculerNutritionReelle(
  ingredients: Array<{ nom: string; quantite: number; unite: string }>,
  supabase: SupabaseClient
): Promise<NutritionCalculee | null> {

  let totCal = 0, totProt = 0, totGluc = 0, totLip = 0;
  let matched = 0;

  for (const ing of ingredients) {
    const grammes = convertirEnGrammes(ing.quantite, ing.unite, ing.nom);
    if (!grammes) continue;

    const keyword = extraireMotCle(ing.nom);
    if (!keyword || keyword.length < 3) continue;

    const { data } = await supabase
      .from('alimentation')
      .select('calories, proteines, glucides, lipides')
      .ilike('nom', `%${keyword}%`)
      .limit(1);

    const ali = data?.[0];
    if (ali?.calories != null) {
      const r = grammes / 100;
      totCal  += (ali.calories  || 0) * r;
      totProt += (ali.proteines || 0) * r;
      totGluc += (ali.glucides  || 0) * r;
      totLip  += (ali.lipides   || 0) * r;
      matched++;
    }
  }

  if (matched < 2) return null; // pas assez fiable → fallback LLM

  const couverture = matched >= Math.ceil(ingredients.length * 0.6) ? 'calculé' : 'partiel';
  return {
    calories:  Math.round(totCal),
    proteines: Math.round(totProt * 10) / 10,
    glucides:  Math.round(totGluc * 10) / 10,
    lipides:   Math.round(totLip  * 10) / 10,
    couverture: `${matched}/${ingredients.length} ingrédients`,
    source: couverture,
  };
}
