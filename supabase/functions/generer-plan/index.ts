// supabase/functions/generer-plan/index.ts
// VERSION V3 :
// - Utilise les tables junction besoins pour filtrage et scoring produits
// - Passe les besoins de l'utilisateur aux fonctions de niveau1
// - Ingrédients dynamiques selon objectif / alimentation_besoins

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { ProfilUtilisateur, ContexteUtilisateur, PlanGenere } from './types.ts';
import { 
  filtrerProduitsSecurite, 
  filtrerRecettesSecurite,
  filtrerRoutinesSecurite 
} from './niveau1-securite.ts';
import {
  recupererHistoriqueRotation,
  scorerProduits,
  selectionnerStyleCulinaire,
  selectionnerRecettes,
  selectionnerRoutines
} from './niveau2-selection.ts';
import {
  genererRecetteLLM,
  genererMessageMotivation,
  transformerRecetteBDD
} from './niveau3-llm.ts';
import {
  enregistrerPlanGenere,
  enregistrerItemsVus,
  chercherRecetteCache,
  validerProfil,
  formaterReponseAPI,
  formaterErreurAPI
} from './utils.ts';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// ============================================================================
// HELPERS STATIQUES
// ============================================================================

// FIX P1 BIS : Remplace les ingrédients codés en dur
function selectionnerIngredientsParObjectif(objectif: string): string[] {
  // Mappé sur les besoins_utilisateurs : vitalite, serenite, sommeil, digestion, mobilite, hormones
  const pool: Record<string, string[]> = {
    'vitalite':          ['lentilles corail', 'quinoa', 'épinards', 'patate douce', 'pois chiches', 'riz brun', 'œufs', 'banane', 'flocons d\'avoine', 'noix de cajou'],
    'serenite':          ['cacao', 'noix de cajou', 'sarrasin', 'épinards', 'avocat', 'graines de lin', 'banane', 'légumes verts', 'saumon', 'amandes'],
    'digestion':         ['gingembre', 'fenouil', 'courgette', 'riz complet', 'yaourt', 'artichaut', 'papaye', 'carotte', 'céleri', 'pomme'],
    'sommeil':           ['patate douce', 'banane', 'amandes', 'avoine', 'cerises', 'noix', 'graines de courge', 'kiwi', 'riz complet', 'lentilles'],
    'mobilite':          ['curcuma', 'gingembre', 'saumon', 'myrtilles', 'noix', 'huile d\'olive', 'brocoli', 'cerises', 'graines de lin', 'épinards'],
    'hormones':          ['avocat', 'graines de lin', 'saumon', 'noix', 'brocoli', 'patate douce', 'quinoa', 'légumineuses', 'graines de courge', 'huile d\'olive'],
    // Rétrocompatibilité
    'energie':           ['lentilles corail', 'quinoa', 'épinards', 'patate douce', 'pois chiches', 'riz brun', 'œufs', 'banane', 'flocons d\'avoine', 'noix de cajou'],
    'stress':            ['cacao', 'noix de cajou', 'sarrasin', 'épinards', 'avocat', 'graines de lin', 'banane', 'légumes verts', 'saumon', 'amandes'],
    'bien-etre-general': ['lentilles corail', 'épinards', 'quinoa', 'avocat', 'patate douce', 'brocoli', 'pois chiches', 'myrtilles', 'noix', 'tomate']
  };
  const ingredients = pool[objectif] || pool['vitalite'];
  // Mélange Fisher-Yates puis sélection des 4 premiers pour varier à chaque appel
  const shuffled = [...ingredients];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, 4);
}

// Recette de dernier recours si LLM + BDD échouent tous les deux
function genererRecetteParDefaut(typeRepas: string, ingredients: string[]): any {
  const nomsRepas: Record<string, string> = {
    'petit-dejeuner': 'Bol Énergie du Matin',
    'dejeuner':       'Assiette Équilibrée du Midi',
    'diner':          'Dîner Léger & Nutritif'
  };
  return {
    nom: nomsRepas[typeRepas] || `Recette ${typeRepas} équilibrée`,
    type_repas: typeRepas,
    style_culinaire: 'simple',
    ingredients: ingredients.slice(0, 4).map((nom, i) => ({
      nom,
      quantite: [100, 150, 80, 50][i] || 100,
      unite: 'g'
    })),
    instructions: [
      'Préparer et laver soigneusement tous les ingrédients.',
      'Cuisiner selon la méthode adaptée à chaque ingrédient.',
      'Assembler, assaisonner et déguster.'
    ],
    temps_preparation: 15,
    temps_cuisson: 20,
    portions: 2,
    genere_par_llm: false
  };
}

// Génération recette avec cascade : (cache) → LLM → BDD → défaut
// force_regeneration=true : ignore le cache, toujours appeler le LLM
async function genererRecetteAvecFallback(
  supabase: any,
  typeRepas: string,
  styleCulinaire: string,
  ingredientsObligatoires: string[],
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur,
  historique: any,
  forceRegeneration: boolean = false
): Promise<any> {

  // 1. Cache — skippé si force_regeneration
  if (!forceRegeneration) {
    const recetteCache = await chercherRecetteCache(
      supabase, ingredientsObligatoires, styleCulinaire, typeRepas, profil.id
    );
    if (recetteCache) {
      console.log(`[CACHE] Recette ${typeRepas} depuis cache profil`);
      return transformerRecetteBDD(recetteCache);
    }
  } else {
    console.log(`[FORCE] Régénération forcée — cache ignoré pour ${typeRepas}`);
  }

  // 2. LLM
  const recetteLLM = await genererRecetteLLM(
    typeRepas, styleCulinaire, ingredientsObligatoires, profil, contexte
  );
  if (recetteLLM) {
    console.log(`[LLM] Recette ${typeRepas} générée`);
    return recetteLLM;
  }

  // 3. BDD
  console.log(`[FALLBACK-BDD] Recette ${typeRepas}...`);
  const { petitDej, dejeuner, diner } = await selectionnerRecettes(
    supabase, profil, styleCulinaire, historique
  );
  const recetteBDD = typeRepas === 'petit-dejeuner' ? petitDej
                   : typeRepas === 'dejeuner'       ? dejeuner
                   : diner;
  if (recetteBDD) return transformerRecetteBDD(recetteBDD);

  // 4. Défaut absolu
  console.log(`[DEFAULT] Recette ${typeRepas} par défaut`);
  return genererRecetteParDefaut(typeRepas, ingredientsObligatoires);
}

// ============================================================================
// FONCTION PRINCIPALE
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    console.log('[START] === GENERATION PLAN HYBRIDE (3 NIVEAUX) ===');

    // =========================================================================
    // FIX PRIORITÉ 1 : L'ancienne version attendait { profil, contexte }
    // Le frontend envoie { profil_id, symptomes, preferences_moment }
    // → On charge le profil complet depuis Supabase via profil_id
    // =========================================================================
    const body = await req.json();
    const { profil_id, symptomes, preferences_moment, force_regeneration } = body;

    if (!profil_id) {
      return new Response(
        JSON.stringify(formaterErreurAPI('profil_id manquant dans la requête', 'MISSING_PROFIL_ID')),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Charger le profil complet depuis la BDD ─────────────────────────────
    console.log(`[P1] Chargement profil ${profil_id}...`);

    const { data: profilBDD, error: profilError } = await supabase
      .from('profils_utilisateurs')
      .select('*')
      .eq('id', profil_id)
      .single();

    if (profilError || !profilBDD) {
      console.error('[ERROR] Profil non trouvé:', profilError?.message);
      return new Response(
        JSON.stringify(formaterErreurAPI('Profil utilisateur non trouvé', 'PROFIL_NOT_FOUND')),
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // ── Mapper colonnes Supabase → interface ProfilUtilisateur ──────────────
    const profil: ProfilUtilisateur = {
      id:                      profilBDD.id,
      age:                     profilBDD.age                    || undefined,
      sexe:                    profilBDD.sexe                   || undefined,
      poids:                   profilBDD.poids                  || undefined,
      taille:                  profilBDD.taille                 || undefined,
      grossesse:               profilBDD.enceinte               || false,
      allaitement:             profilBDD.allaitement            || false,
      pathologies:             profilBDD.pathologies_chroniques || [],
      medications:             profilBDD.medications_actuelles  || [],
      regime_alimentaire:      profilBDD.regimes_alimentaires   || [],
      allergenes:              profilBDD.allergies              || [],
      groupe_sanguin:          profilBDD.groupe_sanguin         || undefined,
      budget:                  profilBDD.budget_complements     || 'moyen',
      temps_preparation:       profilBDD.temps_cuisine_max      || 45,
      styles_cuisines_favoris: profilBDD.styles_cuisines_favoris|| [],
      styles_cuisines_exclus:  profilBDD.styles_cuisines_exclus || [],
      niveau_variete:          profilBDD.niveau_variete         || 'moyenne'
    };

    // ── Construire le contexte ───────────────────────────────────────────────
    // Les besoins du frontend priment sur les objectifs BDD
    // Les valeurs sont des besoin_id : vitalite, serenite, sommeil, digestion, mobilite, hormones
    const besoinsActifs: string[] = (symptomes && symptomes.length > 0)
      ? symptomes
      : (profilBDD.objectifs_generaux || []);

    // Fallback si aucun besoin défini
    const besoinsUtilises = besoinsActifs.length > 0
      ? besoinsActifs
      : ['vitalite', 'serenite'];

    const contexte: ContexteUtilisateur = {
      symptomes_declares: besoinsUtilises,
      objectif_principal: besoinsUtilises[0] || 'vitalite',
      duree_symptomes:    'quelques-jours'
    };

    console.log(`[P1] Profil OK : ${profilBDD.prenom || 'Utilisateur'}`);
    console.log(`[P1] Régimes   : ${profil.regime_alimentaire?.join(', ') || 'aucun'}`);
    console.log(`[P1] Allergènes: ${profil.allergenes?.join(', ')        || 'aucun'}`);
    console.log(`[P1] Besoins   : ${besoinsUtilises.join(', ')}`);

    if (!validerProfil(profil)) {
      return new Response(
        JSON.stringify(formaterErreurAPI('Profil invalide après mapping', 'INVALID_PROFILE')),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // ========================================================================
    // NIVEAU 1 : FILTRAGE SECURITE
    // ========================================================================

    console.log('\n[NIVEAU 1] === FILTRAGE SECURITE ===');

    const [produitsSurs, recettesSures, routinesSures] = await Promise.all([
      filtrerProduitsSecurite(supabase, profil, besoinsUtilises),
      filtrerRecettesSecurite(supabase, profil),
      filtrerRoutinesSecurite(supabase, profil, besoinsUtilises)
    ]);

    console.log(`[NIVEAU 1] ${produitsSurs.length} produits | ${recettesSures.length} recettes | ${routinesSures.length} routines sûrs`);

    // ========================================================================
    // NIVEAU 2 : SELECTION INTELLIGENTE
    // ========================================================================

    console.log('\n[NIVEAU 2] === SELECTION INTELLIGENTE ===');

    const historique = await recupererHistoriqueRotation(supabase, profil_id);
    const produitsScores = scorerProduits(produitsSurs, contexte, historique);
    // Note: scorerProduits utilise maintenant le besoin_score des tables junction

    const nutraceutiquesSelectionnes = produitsScores
      .filter(p => p.type === 'nutraceutique')
      .slice(0, 3);

    const aromatherapieSelectionnee = produitsScores
      .filter(p => p.type === 'aromatherapie')
      .slice(0, 2);

    const styleCulinaire = selectionnerStyleCulinaire(profil, historique);

    const routinesSelectionnees = selectionnerRoutines(
      routinesSures as any,
      contexte,
      historique,
      3
    );

    // FIX P1 BIS : Ingrédients dynamiques basés sur les produits scorés
    const produitsAlimentaires = produitsScores.filter(p => p.type === 'aliment');
    const ingredientsObligatoires = produitsAlimentaires.length >= 2
      ? produitsAlimentaires.slice(0, 4).map(p => p.nom)
      : selectionnerIngredientsParObjectif(contexte.objectif_principal || 'bien-etre-general');

    console.log(`[NIVEAU 2] Style: ${styleCulinaire}`);
    console.log(`[NIVEAU 2] Ingrédients: ${ingredientsObligatoires.join(', ')}`);

    // ========================================================================
    // NIVEAU 3 : GENERATION CREATIVE (LLM)
    // ========================================================================

    console.log('\n[NIVEAU 3] === GENERATION CREATIVE (LLM) ===');

    const forceRegen = force_regeneration === true;
    const [recettePetitDej, recetteDejeuner, recetteDiner] = await Promise.all([
      genererRecetteAvecFallback(supabase, 'petit-dejeuner', styleCulinaire, ingredientsObligatoires, profil, contexte, historique, forceRegen),
      genererRecetteAvecFallback(supabase, 'dejeuner',       styleCulinaire, ingredientsObligatoires, profil, contexte, historique, forceRegen),
      genererRecetteAvecFallback(supabase, 'diner',          styleCulinaire, ingredientsObligatoires, profil, contexte, historique, forceRegen)
    ]);

    const messageMotivation = await genererMessageMotivation(contexte, {});

    // ========================================================================
    // COMPOSITION PLAN FINAL
    // ========================================================================

    const plan: PlanGenere = {
      profil_id,
      objectif:  contexte.objectif_principal || 'bien-etre-general',
      symptomes: contexte.symptomes_declares  || [],

      petit_dejeuner: recettePetitDej,
      dejeuner:       recetteDejeuner,
      diner:          recetteDiner,

      nutraceutiques: nutraceutiquesSelectionnes.map(p => ({
        id:             p.id,
        nom:            p.nom,
        type:           p.type,
        dosage:         (p as any).posologie || '1 gélule/jour',
        timing:         (p as any).timing    || 'Matin avec petit-déjeuner',
        moment_optimal: 'matin',
        raison:         `Aide pour ${p.symptomes_cibles?.[0] || 'bien-être'}`,
        niveau_preuve:  p.niveau_preuve
      })),

      aromatherapie: aromatherapieSelectionnee.map(p => ({
        id:             p.id,
        nom:            p.nom,
        type:           p.type,
        dosage:         (p as any).dosage_standard || '2-3 gouttes',
        timing:         (p as any).timing || 'Soir avant coucher',
        moment_optimal: 'soir',
        raison:         `Favorise ${p.symptomes_cibles?.[0] || 'détente'}`,
        niveau_preuve:  p.niveau_preuve
      })),

      routines: routinesSelectionnees.map(r => ({
        id:        r.id,
        nom:       r.nom,
        categorie: r.categorie,
        duree:     r.duree_quotidienne || '10 min',
        moment:    r.moment_optimal    || 'matin',
        protocole: (r as any).protocole_detaille || 'Suivre les instructions détaillées',
        raison:    `Aide pour ${r.symptomes_cibles?.[0] || 'bien-être'}`
      })),

      message_motivation: messageMotivation,
      conseils_generaux: [
        'Prends le temps de savourer chaque repas',
        'Hydrate-toi régulièrement tout au long de la journée',
        'Écoute les signaux de ton corps'
      ],

      genere_le: new Date().toISOString(),
      expire_le: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };

    // ========================================================================
    // SAUVEGARDE & TRACKING
    // ========================================================================

    const planId = await enregistrerPlanGenere(supabase, profil_id, plan);

    if (planId) {
      const itemsVus = [
        ...nutraceutiquesSelectionnes.map(p => ({
          type: 'nutraceutique', id: p.id, nom: p.nom, categorie: p.categorie
        })),
        ...aromatherapieSelectionnee.map(p => ({
          type: 'aromatherapie', id: p.id, nom: p.nom
        })),
        {
          type: 'recette', id: recettePetitDej.id || `gen-matin-${Date.now()}`,
          nom: recettePetitDej.nom, style_culinaire: recettePetitDej.style_culinaire,
          type_repas: 'petit-dejeuner',
          ingredients: recettePetitDej.ingredients.map((i: any) => i.nom)
        },
        {
          type: 'recette', id: recetteDejeuner.id || `gen-midi-${Date.now()}`,
          nom: recetteDejeuner.nom, style_culinaire: recetteDejeuner.style_culinaire,
          type_repas: 'dejeuner',
          ingredients: recetteDejeuner.ingredients.map((i: any) => i.nom)
        },
        {
          type: 'recette', id: recetteDiner.id || `gen-soir-${Date.now()}`,
          nom: recetteDiner.nom, style_culinaire: recetteDiner.style_culinaire,
          type_repas: 'diner',
          ingredients: recetteDiner.ingredients.map((i: any) => i.nom)
        },
        ...routinesSelectionnees.map(r => ({
          type: 'routine', id: r.id, nom: r.nom, moment: r.moment_optimal
        }))
      ];

      await enregistrerItemsVus(supabase, profil_id, planId, itemsVus);
    }

    // Note: sauvegarderRecetteGeneree supprimé — évite de polluer recettes_sauvegardees
    // avec des recettes LLM non évaluées qui seraient servies comme "cache" aux autres profils

    console.log('\n[SUCCESS] Plan généré avec succès\n');

    return new Response(
      JSON.stringify(formaterReponseAPI(plan, planId), null, 2),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (error) {
    console.error('[ERROR] Erreur génération plan:', error);
    return new Response(
      JSON.stringify(formaterErreurAPI(
        error instanceof Error ? error.message : 'Erreur inconnue'
      )),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});

console.log('[INIT] Edge Function generer-plan v2 chargée');
