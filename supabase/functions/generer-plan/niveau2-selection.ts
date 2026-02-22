// supabase/functions/generer-plan/niveau2-selection.ts
// VERSION CORRIGÉE : Gère symptomes_cibles comme array PostgreSQL

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { 
  ProfilUtilisateur, 
  ContexteUtilisateur,
  ProduitFiltre,
  RoutineCandidate,
  HistoriqueRotation 
} from './types.ts';

/**
 * NIVEAU 2 : SELECTION INTELLIGENTE (Algorithme)
 * Scoring contextuel + Rotation anti-répétition
 */

// ============================================================================
// RECUPERATION HISTORIQUE ROTATION
// ============================================================================

export async function recupererHistoriqueRotation(
  supabase: SupabaseClient,
  profilId: string
): Promise<HistoriqueRotation> {
  
  console.log('[NIVEAU 2] Recuperation historique rotation...');
  
  try {
    // Items fréquents
    const { data: itemsFrequents } = await supabase
      .from('vue_items_frequents')
      .select('*')
      .eq('profil_id', profilId)
      .limit(50);
    
    // Styles récents
    const { data: stylesRecents } = await supabase
      .from('vue_styles_recents')
      .select('*')
      .eq('profil_id', profilId)
      .limit(10);
    
    // Ingrédients récents (7 derniers jours)
    const { data: ingredientsRecents } = await supabase
      .from('historique_items_vus')
      .select('ingredients_principaux')
      .eq('profil_id', profilId)
      .gte('vu_le', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .not('ingredients_principaux', 'is', null);
    
    const ingredientsFlat = (ingredientsRecents || [])
      .flatMap(r => r.ingredients_principaux || []);
    
    return {
      items_frequents: itemsFrequents || [],
      styles_recents: stylesRecents || [],
      ingredients_recents: ingredientsFlat
    };
    
  } catch (error) {
    console.error('[ERROR] Erreur recuperation historique:', error);
    return {
      items_frequents: [],
      styles_recents: [],
      ingredients_recents: []
    };
  }
}

// ============================================================================
// SCORING PRODUITS
// ============================================================================

export function scorerProduits(
  produits: ProduitFiltre[],
  contexte: ContexteUtilisateur,
  historique: HistoriqueRotation
): ProduitFiltre[] {
  
  console.log('[NIVEAU 2] Scoring produits...');
  
  return produits.map(p => {
    let score = 0;
    
    // 1. Score pertinence symptômes (40%)
    const symptomesCibles = Array.isArray(p.symptomes_cibles) 
      ? p.symptomes_cibles 
      : [];
    
    const symptomsMatch = (contexte.symptomes_declares || []).filter(s =>
      symptomesCibles.includes(s)
    ).length;
    
    const scorePertinence = symptomsMatch > 0 
      ? (symptomsMatch / (contexte.symptomes_declares?.length || 1)) * 40
      : 10;
    
    // 2. Score niveau de preuve (20%)
    const scorePreuve = ((p.niveau_preuve || 1) / 5) * 20;
    
    // 3. Score efficacité estimée (20%)
    const scoreEfficacite = ((p.efficacite_estimee || 5) / 10) * 20;
    
    // 4. Score rotation anti-répétition (20%)
    const itemHistorique = historique.items_frequents.find(
      item => item.item_id === p.id
    );
    
    const scoreRotation = itemHistorique 
      ? itemHistorique.score_rotation_simple * 20
      : 20;
    
    score = scorePertinence + scorePreuve + scoreEfficacite + scoreRotation;
    
    return {
      ...p,
      score_pertinence: scorePertinence,
      score_rotation: scoreRotation,
      score_total: score
    };
  }).sort((a, b) => (b.score_total || 0) - (a.score_total || 0));
}

// ============================================================================
// SELECTION STYLE CULINAIRE
// ============================================================================

export function selectionnerStyleCulinaire(
  profil: ProfilUtilisateur,
  historique: HistoriqueRotation
): string {
  
  console.log('[NIVEAU 2] Selection style culinaire...');
  
  const stylesFavoris = profil.styles_cuisines_favoris || [
    'mediterraneen',
    'asiatique',
    'français',
    'italien',
    'mexicain'
  ];
  
  const stylesExclus = profil.styles_cuisines_exclus || [];
  
  const stylesDisponibles = stylesFavoris.filter(s => !stylesExclus.includes(s));
  
  // Scoring des styles
  const stylesScores = stylesDisponibles.map(style => {
    const styleRecent = historique.styles_recents.find(sr => sr.style_culinaire === style);
    const scoreRotation = styleRecent ? styleRecent.score_rotation_style : 1.0;
    
    return { style, score: scoreRotation };
  }).sort((a, b) => b.score - a.score);
  
  // Sélection pondérée
  const random = Math.random();
  
  if (random < 0.7 && stylesScores.length >= 3) {
    const topIndex = Math.floor(Math.random() * 3);
    return stylesScores[topIndex].style;
  } else {
    const randomIndex = Math.floor(Math.random() * stylesScores.length);
    return stylesScores[randomIndex].style;
  }
}

// ============================================================================
// SELECTION RECETTES
// ============================================================================

export async function selectionnerRecettes(
  supabase: SupabaseClient,
  profil: ProfilUtilisateur,
  styleCulinaire: string,
  historique: HistoriqueRotation
): Promise<{ petitDej: any; dejeuner: any; diner: any }> {
  
  console.log('[NIVEAU 2] Selection recettes...');
  
  try {
    // Recettes du style sélectionné
    const { data: recettes } = await supabase
      .from('recettes')
      .select('*')
      .eq('categorie', styleCulinaire);
    
    const recettesPetitDej = (recettes || []).filter(r => r.type_repas === 'petit-dejeuner');
    const recettesDejeuner = (recettes || []).filter(r => r.type_repas === 'dejeuner');
    const recettesDiner = (recettes || []).filter(r => r.type_repas === 'diner');
    
    const petitDej = recettesPetitDej[Math.floor(Math.random() * recettesPetitDej.length)];
    const dejeuner = recettesDejeuner[Math.floor(Math.random() * recettesDejeuner.length)];
    const diner = recettesDiner[Math.floor(Math.random() * recettesDiner.length)];
    
    return { petitDej, dejeuner, diner };
    
  } catch (error) {
    console.error('[ERROR] Erreur selection recettes:', error);
    return { petitDej: null, dejeuner: null, diner: null };
  }
}

// ============================================================================
// SELECTION ROUTINES
// ============================================================================

export function selectionnerRoutines(
  routines: RoutineCandidate[],
  contexte: ContexteUtilisateur,
  historique: HistoriqueRotation,
  nbRoutines: number = 3
): RoutineCandidate[] {
  
  console.log('[NIVEAU 2] Selection routines...');
  
  const routinesScores = routines.map(r => {
    // Score pertinence symptômes (50%)
    const symptomesCibles = Array.isArray(r.symptomes_cibles) 
      ? r.symptomes_cibles 
      : [];
    
    const symptomsMatch = (contexte.symptomes_declares || []).filter(s =>
      symptomesCibles.includes(s)
    ).length;
    
    const scorePertinence = symptomsMatch > 0 
      ? (symptomsMatch / (contexte.symptomes_declares?.length || 1)) * 50
      : 10;
    
    // Score rotation (50%)
    const itemHistorique = historique.items_frequents.find(
      item => item.item_id === r.id
    );
    
    const scoreRotation = itemHistorique 
      ? itemHistorique.score_rotation_simple * 50
      : 50;
    
    return {
      ...r,
      score_pertinence: scorePertinence,
      score_rotation: scoreRotation,
      score_total: scorePertinence + scoreRotation
    };
  }).sort((a, b) => (b.score_total || 0) - (a.score_total || 0));
  
  return routinesScores.slice(0, nbRoutines);
}
