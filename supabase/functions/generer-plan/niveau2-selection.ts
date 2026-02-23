// supabase/functions/generer-plan/niveau2-selection.ts
// VERSION CORRIGÉE V2 :
// - FIX P5 : Fallback robuste quand vue_items_frequents / vue_styles_recents
//            n'existent pas en BDD (requêtes échouent silencieusement)
// - Algorithme Fisher-Yates pour mélange aléatoire garanti (variété sans vues)

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { 
  ProfilUtilisateur, 
  ContexteUtilisateur,
  ProduitFiltre,
  RoutineCandidate,
  HistoriqueRotation 
} from './types.ts';

// ============================================================================
// RÉCUPÉRATION HISTORIQUE DE ROTATION
// FIX P5 : Fallback gracieux si les vues SQL n'existent pas encore
// ============================================================================

export async function recupererHistoriqueRotation(
  supabase: SupabaseClient,
  profilId: string
): Promise<HistoriqueRotation> {
  
  console.log('[NIVEAU 2] Récupération historique rotation...');
  
  const historiqueVide: HistoriqueRotation = {
    items_frequents: [],
    styles_recents: [],
    ingredients_recents: []
  };
  
  try {
    // Tentative 1 : vue vue_items_frequents (peut ne pas exister)
    const { data: itemsFrequents, error: errItemsFreq } = await supabase
      .from('vue_items_frequents')
      .select('*')
      .eq('profil_id', profilId)
      .limit(50);

    // FIX P5 : Si la vue n'existe pas, on log mais on ne plante pas
    if (errItemsFreq) {
      console.log('[NIVEAU 2] vue_items_frequents indisponible (vue SQL à créer), utilisation de historique_items_vus directement...');
      
      // Fallback : requêter directement la table sous-jacente
      const { data: itemsDirect, error: errDirect } = await supabase
        .from('historique_items_vus')
        .select('item_id, type_item, item_nom, vu_le')
        .eq('profil_id', profilId)
        .gte('vu_le', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('vu_le', { ascending: false })
        .limit(50);
      
      if (errDirect) {
        console.log('[NIVEAU 2] historique_items_vus aussi indisponible — historique vide, variété maximale');
        return historiqueVide;
      }
      
      // Construire un pseudo-historique depuis la table brute
      const itemsMap = new Map<string, any>();
      (itemsDirect || []).forEach(item => {
        if (!itemsMap.has(item.item_id)) {
          const joursDepuis = (Date.now() - new Date(item.vu_le).getTime()) / (1000 * 60 * 60 * 24);
          let scoreRotation = 1.0;
          if (joursDepuis < 7)  scoreRotation = 0.50;
          else if (joursDepuis < 14) scoreRotation = 0.70;
          else if (joursDepuis < 30) scoreRotation = 0.85;
          
          itemsMap.set(item.item_id, {
            item_id: item.item_id,
            type_item: item.type_item,
            nb_vues: 1,
            derniere_vue: item.vu_le,
            score_rotation_simple: scoreRotation
          });
        }
      });
      
      return {
        items_frequents: Array.from(itemsMap.values()),
        styles_recents: [],
        ingredients_recents: []
      };
    }

    // Tentative 2 : vue vue_styles_recents
    const { data: stylesRecents, error: errStyles } = await supabase
      .from('vue_styles_recents')
      .select('*')
      .eq('profil_id', profilId)
      .limit(10);
    
    if (errStyles) {
      console.log('[NIVEAU 2] vue_styles_recents indisponible — styles vides');
    }

    // Ingrédients récents (7 derniers jours) depuis la table brute
    const { data: ingredientsRecents } = await supabase
      .from('historique_items_vus')
      .select('ingredients_principaux')
      .eq('profil_id', profilId)
      .gte('vu_le', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .not('ingredients_principaux', 'is', null);
    
    const ingredientsFlat = (ingredientsRecents || [])
      .flatMap(r => r.ingredients_principaux || []);
    
    console.log(`[NIVEAU 2] Historique : ${(itemsFrequents || []).length} items, ${(stylesRecents || []).length} styles`);
    
    return {
      items_frequents:    itemsFrequents  || [],
      styles_recents:     stylesRecents   || [],
      ingredients_recents: ingredientsFlat
    };
    
  } catch (error) {
    console.error('[ERROR] Exception récupération historique (non bloquant):', error);
    return historiqueVide;
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
  
  console.log(`[NIVEAU 2] Scoring de ${produits.length} produits...`);
  
  if (produits.length === 0) return [];
  
  return produits.map(p => {
    // 1. Score pertinence symptômes (40%)
    const symptomesCibles = Array.isArray(p.symptomes_cibles)
      ? p.symptomes_cibles
      : [];
    
    const symptomesUtilisateur = contexte.symptomes_declares || [];
    const symptomsMatch = symptomesUtilisateur.filter(s =>
      symptomesCibles.some(sc => sc.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(sc.toLowerCase()))
    ).length;
    
    const scorePertinence = symptomsMatch > 0
      ? (symptomsMatch / Math.max(symptomesUtilisateur.length, 1)) * 40
      : 10; // Score de base même sans correspondance exacte
    
    // 2. Score niveau de preuve (20%)
    const scorePreuve = ((p.niveau_preuve || 1) / 5) * 20;
    
    // 3. Score efficacité estimée (20%)
    const scoreEfficacite = ((p.efficacite_estimee || 5) / 10) * 20;
    
    // 4. Score rotation anti-répétition (20%)
    const itemHistorique = historique.items_frequents.find(
      item => item.item_id === p.id
    );
    const scoreRotation = itemHistorique
      ? (itemHistorique.score_rotation_simple || 0.5) * 20
      : 20; // Jamais vu = score max
    
    const scoreTotal = scorePertinence + scorePreuve + scoreEfficacite + scoreRotation;
    
    return {
      ...p,
      score_pertinence: scorePertinence,
      score_rotation:   scoreRotation,
      score_total:      scoreTotal
    } as any;
  }).sort((a: any, b: any) => (b.score_total || 0) - (a.score_total || 0));
}

// ============================================================================
// SÉLECTION STYLE CULINAIRE
// FIX P5 : Utilise Fisher-Yates si pas d'historique styles
// ============================================================================

export function selectionnerStyleCulinaire(
  profil: ProfilUtilisateur,
  historique: HistoriqueRotation
): string {
  
  const stylesFavoris = profil.styles_cuisines_favoris?.length
    ? profil.styles_cuisines_favoris
    : ['mediterraneen', 'asiatique', 'francais', 'italien', 'mexicain', 'nordique'];
  
  const stylesExclus = profil.styles_cuisines_exclus || [];
  const stylesDisponibles = stylesFavoris.filter(s => !stylesExclus.includes(s));
  
  if (stylesDisponibles.length === 0) return 'mediterraneen';
  
  // Si on a un historique de styles, on score et on sélectionne
  if (historique.styles_recents.length > 0) {
    const stylesScores = stylesDisponibles.map(style => {
      const styleRecent = historique.styles_recents.find((sr: any) => sr.style_culinaire === style);
      return { style, score: styleRecent ? (styleRecent.score_rotation_style || 0.5) : 1.0 };
    }).sort((a, b) => b.score - a.score);
    
    const rand = Math.random();
    if (rand < 0.7 && stylesScores.length >= 3) {
      return stylesScores[Math.floor(Math.random() * 3)].style;
    }
    return stylesScores[Math.floor(Math.random() * stylesScores.length)].style;
  }
  
  // FIX P5 : Pas d'historique → Fisher-Yates pour sélection vraiment aléatoire
  // Évite que le même style soit toujours sélectionné (ex: toujours index 0)
  const pool = [...stylesDisponibles];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  
  console.log(`[NIVEAU 2] Style culinaire sélectionné : ${pool[0]}`);
  return pool[0];
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
  
  console.log(`[NIVEAU 2] Sélection recettes (style: ${styleCulinaire})...`);
  
  const vide = { petitDej: null, dejeuner: null, diner: null };
  
  try {
    const { data: recettes, error } = await supabase
      .from('recettes')
      .select('*')
      .eq('categorie', styleCulinaire);
    
    if (error || !recettes?.length) {
      // Si pas de recettes pour ce style, on prend toutes les recettes disponibles
      const { data: toutesRecettes } = await supabase
        .from('recettes')
        .select('*')
        .limit(50);
      
      if (!toutesRecettes?.length) return vide;
      
      return {
        petitDej: toutesRecettes.find(r => r.type_repas === 'petit-dejeuner') || null,
        dejeuner: toutesRecettes.find(r => r.type_repas === 'dejeuner') || null,
        diner:    toutesRecettes.find(r => r.type_repas === 'diner') || null
      };
    }
    
    // FIX P5 : Sélection aléatoire avec Fisher-Yates par type de repas
    const shuffle = (arr: any[]) => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

    const petitsDej  = shuffle(recettes.filter(r => r.type_repas === 'petit-dejeuner'));
    const dejeuners  = shuffle(recettes.filter(r => r.type_repas === 'dejeuner'));
    const diners     = shuffle(recettes.filter(r => r.type_repas === 'diner'));
    
    return {
      petitDej: petitsDej[0]  || null,
      dejeuner: dejeuners[0]  || null,
      diner:    diners[0]     || null
    };
    
  } catch (error) {
    console.error('[ERROR] Exception sélection recettes:', error);
    return vide;
  }
}

// ============================================================================
// SÉLECTION ROUTINES
// ============================================================================

export function selectionnerRoutines(
  routines: RoutineCandidate[],
  contexte: ContexteUtilisateur,
  historique: HistoriqueRotation,
  nbRoutines: number = 3
): RoutineCandidate[] {
  
  console.log(`[NIVEAU 2] Sélection ${nbRoutines} routines sur ${routines.length} disponibles...`);
  
  if (routines.length === 0) return [];
  
  const routinesScores = routines.map(r => {
    const symptomesCibles = Array.isArray(r.symptomes_cibles) ? r.symptomes_cibles : [];
    const symptomesUtil = contexte.symptomes_declares || [];
    
    const symptomsMatch = symptomesUtil.filter(s =>
      symptomesCibles.some(sc => sc.toLowerCase().includes(s.toLowerCase()))
    ).length;
    
    const scorePertinence = symptomsMatch > 0
      ? (symptomsMatch / Math.max(symptomesUtil.length, 1)) * 50
      : 10;
    
    const itemHistorique = historique.items_frequents.find(item => item.item_id === r.id);
    const scoreRotation = itemHistorique
      ? (itemHistorique.score_rotation_simple || 0.5) * 50
      : 50;
    
    return {
      ...r,
      score_pertinence: scorePertinence,
      score_rotation:   scoreRotation,
      score_total:      scorePertinence + scoreRotation
    };
  }).sort((a: any, b: any) => (b.score_total || 0) - (a.score_total || 0));
  
  // Sélection pondérée : 70% top 3, 20% top 4-6, 10% aléatoire
  const selection: RoutineCandidate[] = [];
  const pool = [...routinesScores];
  
  while (selection.length < nbRoutines && pool.length > 0) {
    const rand = Math.random();
    let chosenIndex: number;
    
    if (rand < 0.7 && pool.length >= 1) {
      chosenIndex = 0;
    } else if (rand < 0.9 && pool.length >= 2) {
      chosenIndex = Math.min(1, pool.length - 1);
    } else {
      chosenIndex = Math.floor(Math.random() * pool.length);
    }
    
    selection.push(pool[chosenIndex]);
    pool.splice(chosenIndex, 1);
  }
  
  return selection;
}
