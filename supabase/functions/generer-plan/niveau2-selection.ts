// supabase/functions/generer-plan/niveau2-selection.ts

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { 
  ProfilUtilisateur, 
  ContexteUtilisateur, 
  ProduitFiltre,
  RecetteCandidate,
  RoutineCandidate,
  HistoriqueRotation,
  ItemVu
} from './types.ts';

/**
 * NIVEAU 2 : SÉLECTION INTELLIGENTE (Algorithme)
 * Scoring contextuel + Rotation anti-répétition
 */

// ============================================================================
// RÉCUPÉRATION HISTORIQUE
// ============================================================================

export async function recupererHistoriqueRotation(
  supabase: SupabaseClient,
  profilId: string
): Promise<HistoriqueRotation> {
  
  console.log('📊 Récupération historique rotation...');
  
  // 1. Items fréquents (30 derniers jours)
  const { data: itemsFrequents } = await supabase
    .from('vue_items_frequents')
    .select('*')
    .eq('profil_id', profilId)
    .gte('score_rotation_simple', 0.0)
    .order('nb_vues', { ascending: false });
  
  // 2. Styles culinaires récents
  const { data: stylesRecents } = await supabase
    .from('vue_styles_recents')
    .select('*')
    .eq('profil_id', profilId)
    .order('derniere_vue', { ascending: false });
  
  // 3. Ingrédients récents (7 derniers jours)
  const { data: ingredientsRecents } = await supabase
    .from('historique_items_vus')
    .select('ingredients_principaux')
    .eq('profil_id', profilId)
    .gte('vu_le', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .not('ingredients_principaux', 'is', null);
  
  // Flatten ingrédients
  const ingredientsFlat = ingredientsRecents
    ?.flatMap(r => r.ingredients_principaux || [])
    .filter((v, i, a) => a.indexOf(v) === i) || []; // Unique
  
  const historique: HistoriqueRotation = {
    items_frequents: (itemsFrequents || []).map(i => ({
      item_id: i.item_id,
      type_item: i.type_item,
      nb_vues: i.nb_vues,
      derniere_vue: i.derniere_vue,
      score_rotation: i.score_rotation_simple || 0.5
    })),
    styles_recents: (stylesRecents || []).map(s => ({
      style: s.style_culinaire,
      score: s.score_rotation_style || 0.5
    })),
    ingredients_recents: ingredientsFlat
  };
  
  console.log(`📊 Historique : ${historique.items_frequents.length} items, ${historique.styles_recents.length} styles, ${historique.ingredients_recents.length} ingrédients`);
  
  return historique;
}

// ============================================================================
// SCORING PRODUITS
// ============================================================================

export function scorerProduits(
  produits: ProduitFiltre[],
  contexte: ContexteUtilisateur,
  historique: HistoriqueRotation
): ProduitFiltre[] {
  
  console.log('🧮 Scoring produits...');
  
  return produits.map(p => {
    let score = 0;
    
    // 1. Pertinence symptômes (40% du score)
    const symptomesMatch = contexte.symptomes_declares?.filter(s =>
      p.symptomes_cibles?.some(sc => sc.toLowerCase().includes(s.toLowerCase()))
    ).length || 0;
    
    const scorePertinence = symptomesMatch > 0 
      ? Math.min(1.0, symptomesMatch / (contexte.symptomes_declares?.length || 1))
      : 0.3; // Score minimum si pas de match direct
    
    score += scorePertinence * 0.4;
    
    // 2. Niveau de preuve (20% du score)
    const scorePreuve = p.niveau_preuve / 5;
    score += scorePreuve * 0.2;
    
    // 3. Efficacité estimée (20% du score)
    const scoreEfficacite = p.efficacite_estimee / 10;
    score += scoreEfficacite * 0.2;
    
    // 4. Rotation anti-répétition (20% du score)
    const itemVu = historique.items_frequents.find(i => i.item_id === p.id);
    const scoreRotation = itemVu?.score_rotation || 1.0; // 1.0 = jamais vu
    score += scoreRotation * 0.2;
    
    return {
      ...p,
      score_pertinence: scorePertinence,
      score_rotation: scoreRotation,
      score_total: score
    };
  }).sort((a, b) => (b.score_total || 0) - (a.score_total || 0));
}

// ============================================================================
// SÉLECTION STYLE CULINAIRE
// ============================================================================

export function selectionnerStyleCulinaire(
  profil: ProfilUtilisateur,
  historique: HistoriqueRotation
): string {
  
  console.log('🍽️ Sélection style culinaire...');
  
  // Styles disponibles
  const stylesDisponibles = profil.styles_cuisines_favoris && profil.styles_cuisines_favoris.length > 0
    ? profil.styles_cuisines_favoris
    : ['méditerranéen', 'asiatique', 'français', 'italien', 'mexicain', 'indien', 'libanais'];
  
  // Exclure styles non désirés
  const stylesFiltres = stylesDisponibles.filter(s =>
    !profil.styles_cuisines_exclus?.includes(s)
  );
  
  // Calculer scores de rotation pour chaque style
  const stylesAvecScores = stylesFiltres.map(style => {
    const styleHistorique = historique.styles_recents.find(s => s.style === style);
    const score = styleHistorique?.score || 1.0; // 1.0 = jamais vu récemment
    return { style, score };
  });
  
  // Tri par score décroissant
  stylesAvecScores.sort((a, b) => b.score - a.score);
  
  // Sélection pondérée
  const rand = Math.random();
  
  if (rand < 0.7 && stylesAvecScores.length >= 3) {
    // 70% : Choisir parmi top 3
    const top3 = stylesAvecScores.slice(0, 3);
    const selected = selectionPonderee(top3);
    console.log(`🍽️ Style sélectionné (top 3) : ${selected}`);
    return selected;
  } else if (stylesAvecScores.length > 0) {
    // 30% : Découverte aléatoire
    const selected = stylesFiltres[Math.floor(Math.random() * stylesFiltres.length)];
    console.log(`🍽️ Style sélectionné (aléatoire) : ${selected}`);
    return selected;
  } else {
    // Fallback
    console.log('🍽️ Style par défaut : méditerranéen');
    return 'méditerranéen';
  }
}

// Fonction helper : sélection pondérée
function selectionPonderee(options: { style: string; score: number }[]): string {
  const totalScore = options.reduce((sum, opt) => sum + opt.score, 0);
  
  if (totalScore === 0) {
    return options[0].style; // Fallback
  }
  
  let rand = Math.random() * totalScore;
  
  for (const opt of options) {
    rand -= opt.score;
    if (rand <= 0) return opt.style;
  }
  
  return options[0].style;
}

// ============================================================================
// SÉLECTION RECETTES
// ============================================================================

export async function selectionnerRecettes(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur,
  styleCulinaire: string,
  historique: HistoriqueRotation
): Promise<{ petitDej: any; dejeuner: any; diner: any }> {
  
  console.log('🍳 Sélection recettes...');
  
  // Récupérer recettes par type de repas
  const petitDej = await selectionnerRecetteParType(
    supabase, 'petit-dejeuner', styleCulinaire, historique, profil
  );
  
  const dejeuner = await selectionnerRecetteParType(
    supabase, 'dejeuner', styleCulinaire, historique, profil
  );
  
  const diner = await selectionnerRecetteParType(
    supabase, 'diner', styleCulinaire, historique, profil
  );
  
  return { petitDej, dejeuner, diner };
}

async function selectionnerRecetteParType(
  supabase: SupabaseClient,
  typeRepas: string,
  styleCulinaire: string,
  historique: HistoriqueRotation,
  profil: ProfilUtilisateur
): Promise<any> {
  
  // Requête recettes
  let query = supabase
    .from('recettes')
    .select('*')
    .eq('type_repas', typeRepas);
  
  // Filtrer par style si disponible
  // Note : si pas assez de recettes avec ce style, on élargit
  const { data: recettesStyle } = await query.eq('categorie', styleCulinaire);
  
  const { data: recettesToutes } = await query;
  
  const recettes = (recettesStyle && recettesStyle.length > 0) 
    ? recettesStyle 
    : recettesToutes || [];
  
  if (recettes.length === 0) {
    console.warn(`⚠️ Aucune recette trouvée pour ${typeRepas}`);
    return null;
  }
  
  // Scoring avec rotation
  const recettesAvecScores = recettes.map(r => {
    const itemVu = historique.items_frequents.find(i => i.item_id === r.id);
    const scoreRotation = itemVu?.score_rotation || 1.0;
    
    // Pénaliser si ingrédients similaires récemment
    const ingredientsCommuns = (r.ingredients_ids || []).filter(ing =>
      historique.ingredients_recents.includes(ing)
    ).length;
    const penaliteIngredients = Math.max(0, 1 - ingredientsCommuns * 0.1);
    
    const scoreTotal = scoreRotation * penaliteIngredients;
    
    return { ...r, score_rotation: scoreRotation, score_total: scoreTotal };
  });
  
  // Trier par score
  recettesAvecScores.sort((a, b) => b.score_total - a.score_total);
  
  // Sélection pondérée (top 5)
  const top5 = recettesAvecScores.slice(0, Math.min(5, recettesAvecScores.length));
  const selected = selectionPonderee(
    top5.map(r => ({ style: r.id, score: r.score_total }))
  );
  
  const recetteSelectionnee = recettesAvecScores.find(r => r.id === selected);
  
  console.log(`🍳 Recette ${typeRepas} : ${recetteSelectionnee?.nom || 'N/A'}`);
  
  return recetteSelectionnee;
}

// ============================================================================
// SÉLECTION ROUTINES
// ============================================================================

export function selectionnerRoutines(
  routines: RoutineCandidate[],
  contexte: ContexteUtilisateur,
  historique: HistoriqueRotation,
  nbMax: number = 3
): RoutineCandidate[] {
  
  console.log('🧘 Sélection routines...');
  
  // Scoring
  const routinesAvecScores = routines.map(r => {
    let score = 0;
    
    // Pertinence symptômes
    const symptomesMatch = contexte.symptomes_declares?.filter(s =>
      r.symptomes_cibles?.some(sc => sc.toLowerCase().includes(s.toLowerCase()))
    ).length || 0;
    score += symptomesMatch * 0.5;
    
    // Rotation
    const itemVu = historique.items_frequents.find(i => i.item_id === r.id);
    const scoreRotation = itemVu?.score_rotation || 1.0;
    score += scoreRotation * 0.5;
    
    return { ...r, score_total: score };
  });
  
  // Trier et limiter
  routinesAvecScores.sort((a, b) => (b.score_total || 0) - (a.score_total || 0));
  
  const selected = routinesAvecScores.slice(0, nbMax);
  
  console.log(`🧘 ${selected.length} routines sélectionnées`);
  
  return selected;
}
