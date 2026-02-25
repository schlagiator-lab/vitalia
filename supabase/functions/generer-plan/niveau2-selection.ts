// supabase/functions/generer-plan/niveau2-selection.ts
// VERSION V3 :
// - Scoring via besoin_score (tables junction) — plus fiable que matching string
// - Fallback Fisher-Yates si pas d'historique styles

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  ProfilUtilisateur,
  ContexteUtilisateur,
  ProduitFiltre,
  RoutineCandidate,
  HistoriqueRotation
} from './types.ts';

// ============================================================================
// WEIGHTED RANDOM SAMPLING SANS REMISE
// Chaque item a un poids = son score_total. On tire proportionnellement.
// ============================================================================

function selectionnerPondere<T extends { score_total?: number }>(
  items: T[],
  n: number
): T[] {
  if (items.length === 0) return [];
  if (items.length <= n)  return [...items];

  const selection: T[] = [];
  const pool = items.map(item => ({
    item,
    poids: Math.max(item.score_total ?? 1, 1)
  }));

  while (selection.length < n && pool.length > 0) {
    const sommePoids = pool.reduce((acc, p) => acc + p.poids, 0);
    let seuil = Math.random() * sommePoids;
    let indexChoisi = 0;

    for (let i = 0; i < pool.length; i++) {
      seuil -= pool[i].poids;
      if (seuil <= 0) {
        indexChoisi = i;
        break;
      }
    }

    selection.push(pool[indexChoisi].item);
    pool.splice(indexChoisi, 1);
  }

  return selection;
}

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
          if (joursDepuis < 7)  scoreRotation = 0.30;
          else if (joursDepuis < 14) scoreRotation = 0.60;
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
// Utilise le besoin_score des tables junction (plus fiable que le matching string)
// ============================================================================

export function scorerProduits(
  produits: ProduitFiltre[],
  contexte: ContexteUtilisateur,
  historique: HistoriqueRotation
): ProduitFiltre[] {

  console.log(`[NIVEAU 2] Scoring de ${produits.length} produits...`);

  if (produits.length === 0) return [];

  return produits.map(p => {
    // 1. Score besoin (junction table) — 40% du score total
    // besoin_score est sur 5 → normalisé sur 40
    const besoinScore = p.besoin_score || 3;
    const scorePertinence = (besoinScore / 5) * 40;

    // 2. Score niveau de preuve (20%)
    const scorePreuve = ((p.niveau_preuve || 1) / 5) * 20;

    // 3. Score efficacité estimée (10%)
    const scoreEfficacite = ((p.efficacite_estimee || 5) / 10) * 10;

    // 4. Score rotation anti-répétition (30%) — renforcé pour plus de variété
    const itemHistorique = historique.items_frequents.find(
      item => item.item_id === p.id
    );
    const scoreRotation = itemHistorique
      ? (itemHistorique.score_rotation_simple || 0.5) * 30
      : 30; // Jamais vu = score max

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
// SÉLECTION NUTRACEUTIQUES & AROMATHÉRAPIE (pondérée)
// ============================================================================

export function selectionnerNutraceutiques(
  produitsScores: ProduitFiltre[],
  n: number = 3
): ProduitFiltre[] {
  const candidats = produitsScores.filter(p => p.type === 'nutraceutique');
  const selection = selectionnerPondere(candidats as any, n);
  console.log(`[NIVEAU 2] Nutraceutiques sélectionnés (${selection.length}/${candidats.length}) :`);
  selection.forEach((p: any) => {
    console.log(`  → ${p.nom} | score_total=${p.score_total?.toFixed(1)} | rotation=${p.score_rotation?.toFixed(1)}`);
  });
  return selection as ProduitFiltre[];
}

export function selectionnerAromatherapie(
  produitsScores: ProduitFiltre[],
  n: number = 2
): ProduitFiltre[] {
  const candidats = produitsScores.filter(p => p.type === 'aromatherapie');
  const selection = selectionnerPondere(candidats as any, n);
  console.log(`[NIVEAU 2] Aromathérapie sélectionnée (${selection.length}/${candidats.length}) :`);
  selection.forEach((p: any) => {
    console.log(`  → ${p.nom} | score_total=${p.score_total?.toFixed(1)}`);
  });
  return selection as ProduitFiltre[];
}

// ============================================================================
// INGRÉDIENTS BANNIS (vus < 7j)
// ============================================================================

export function getIngredientsBanis(historique: HistoriqueRotation): Set<string> {
  const banis = new Set<string>();
  (historique.ingredients_recents || []).forEach(ing => {
    if (ing) banis.add(ing.toLowerCase().trim());
  });
  console.log(`[NIVEAU 2] Ingrédients bannis du pool (vus < 7j) : ${banis.size}`);
  if (banis.size > 0) console.log(`  → ${Array.from(banis).join(', ')}`);
  return banis;
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

  // Styles utilisés < 3 jours → exclus du pool pour forcer la rotation
  const stylesRecentsIds = new Set(
    (historique.styles_recents as any[])
      .filter((sr: any) => {
        if (!sr.derniere_utilisation) return false;
        const joursDepuis = (Date.now() - new Date(sr.derniere_utilisation).getTime()) / (1000 * 60 * 60 * 24);
        return joursDepuis < 3;
      })
      .map((sr: any) => sr.style_culinaire)
  );

  let stylesDisponibles = stylesFavoris.filter(s => !stylesExclus.includes(s) && !stylesRecentsIds.has(s));

  // Fallback si tous les styles sont récents
  if (stylesDisponibles.length === 0) {
    stylesDisponibles = stylesFavoris.filter(s => !stylesExclus.includes(s));
  }
  if (stylesDisponibles.length === 0) return 'mediterraneen';

  // Scoring pondéré basé sur le score de rotation (le plus "frais" gagne)
  const stylesScores = stylesDisponibles.map(style => {
    const styleRecent = (historique.styles_recents as any[]).find((sr: any) => sr.style_culinaire === style);
    const score = styleRecent
      ? Math.max((styleRecent.score_rotation_style ?? styleRecent.score ?? 0.5) * 100, 1)
      : 100; // Jamais utilisé = poids max
    return { style, score_total: score };
  });

  const [styleChoisi] = selectionnerPondere(stylesScores, 1);
  const resultat = styleChoisi?.style || 'mediterraneen';
  console.log(`[NIVEAU 2] Style culinaire sélectionné : ${resultat}`);
  return resultat;
}

// ============================================================================
// SÉLECTION RECETTES
// ============================================================================

export async function selectionnerRecettes(
  supabase: SupabaseClient,
  _profil: ProfilUtilisateur,
  styleCulinaire: string,
  historique: HistoriqueRotation
): Promise<{ petitDej: any; dejeuner: any; diner: any }> {

  console.log(`[NIVEAU 2] Sélection recettes (style: ${styleCulinaire})...`);

  const vide = { petitDej: null, dejeuner: null, diner: null };

  // IDs des recettes vues récemment — à exclure en priorité
  const recettesVuesIds = new Set(
    historique.items_frequents
      .filter(item => item.type_item === 'recette')
      .map(item => item.item_id)
  );
  console.log(`[NIVEAU 2] Recettes exclues (vues récemment) : ${recettesVuesIds.size}`);

  // FIX P5 : Sélection aléatoire avec Fisher-Yates
  const shuffle = (arr: any[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Filtre anti-répétition + shuffle par type de repas
  const filtrerEtShuffler = (source: any[], type: string) => {
    const toutes  = source.filter((r: any) => r.type_repas === type);
    const nonVues = toutes.filter((r: any) => !recettesVuesIds.has(r.id));
    return shuffle(nonVues.length > 0 ? nonVues : toutes); // fallback si tout vu
  };

  try {
    const { data: recettes, error } = await supabase
      .from('recettes')
      .select('*')
      .eq('categorie', styleCulinaire);

    if (error || !recettes?.length) {
      // Fallback : toutes les recettes disponibles tous styles confondus
      const { data: toutesRecettes } = await supabase
        .from('recettes')
        .select('*')
        .limit(50);

      if (!toutesRecettes?.length) return vide;

      return {
        petitDej: filtrerEtShuffler(toutesRecettes, 'petit-dejeuner')[0] || null,
        dejeuner: filtrerEtShuffler(toutesRecettes, 'dejeuner')[0]       || null,
        diner:    filtrerEtShuffler(toutesRecettes, 'diner')[0]          || null
      };
    }

    return {
      petitDej: filtrerEtShuffler(recettes, 'petit-dejeuner')[0] || null,
      dejeuner: filtrerEtShuffler(recettes, 'dejeuner')[0]       || null,
      diner:    filtrerEtShuffler(recettes, 'diner')[0]          || null
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
  _contexte: ContexteUtilisateur,
  historique: HistoriqueRotation,
  nbRoutines: number = 3
): RoutineCandidate[] {

  console.log(`[NIVEAU 2] Sélection ${nbRoutines} routines sur ${routines.length} disponibles...`);

  if (routines.length === 0) return [];

  // Barème 40/60 : les routines ont moins de critères médicaux → rotation pèse plus
  const routinesScores = routines.map(r => {
    const besoinScore = (r as any).besoin_score || 3;
    const scorePertinence = (besoinScore / 5) * 40;

    const itemHistorique = historique.items_frequents.find(item => item.item_id === r.id);
    const scoreRotation = itemHistorique
      ? ((itemHistorique as any).score_rotation_simple ?? itemHistorique.score_rotation ?? 0.5) * 60
      : 60; // Jamais vu = score max

    return {
      ...r,
      score_pertinence: scorePertinence,
      score_rotation:   scoreRotation,
      score_total:      scorePertinence + scoreRotation
    };
  }).sort((a: any, b: any) => (b.score_total || 0) - (a.score_total || 0));

  // Remplacement de la boucle biaisée par le Weighted Random Sampling
  const selection = selectionnerPondere(routinesScores as any, nbRoutines);
  console.log(`[NIVEAU 2] Routines sélectionnées (${selection.length}/${routines.length}) :`);
  (selection as any[]).forEach((r: any) => {
    console.log(`  → ${r.nom} | score_total=${r.score_total?.toFixed(1)}`);
  });
  return selection as unknown as RoutineCandidate[];
}
