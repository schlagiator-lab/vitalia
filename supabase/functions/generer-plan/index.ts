// supabase/functions/generer-plan/index.ts
// VERSION CORRIGÉE : Sans emojis pour compatibilité Deno

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
  sauvegarderRecetteGeneree,
  validerProfil,
  validerContexte,
  formaterReponseAPI,
  formaterErreurAPI
} from './utils.ts';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ============================================================================
// FONCTION PRINCIPALE
// ============================================================================

serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    console.log('[START] === GENERATION PLAN HYBRIDE (3 NIVEAUX) ===');
    
    // Parse body
    const { profil, contexte } = await req.json();
    
    // Validation
    if (!validerProfil(profil)) {
      return new Response(
        JSON.stringify(formaterErreurAPI('Profil invalide', 'INVALID_PROFILE')),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    if (!validerContexte(contexte)) {
      return new Response(
        JSON.stringify(formaterErreurAPI('Contexte invalide', 'INVALID_CONTEXT')),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }
    
    // Initialiser Supabase client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // ========================================================================
    // NIVEAU 1 : FILTRAGE SECURITE (BDD)
    // ========================================================================
    
    console.log('\n[NIVEAU 1] === FILTRAGE SECURITE ===');
    
    const [produitsSurs, recettesSures, routinesSures] = await Promise.all([
      filtrerProduitsSecurite(supabase, profil as ProfilUtilisateur),
      filtrerRecettesSecurite(supabase, profil as ProfilUtilisateur),
      filtrerRoutinesSecurite(supabase, profil as ProfilUtilisateur)
    ]);
    
    console.log(`[NIVEAU 1] Termine : ${produitsSurs.length} produits, ${recettesSures.length} recettes, ${routinesSures.length} routines surs`);
    
    // ========================================================================
    // NIVEAU 2 : SELECTION INTELLIGENTE (Algorithme)
    // ========================================================================
    
    console.log('\n[NIVEAU 2] === SELECTION INTELLIGENTE ===');
    
    // Récupérer historique rotation
    const historique = await recupererHistoriqueRotation(supabase, profil.id);
    
    // Scorer produits
    const produitsScores = scorerProduits(
      produitsSurs, 
      contexte as ContexteUtilisateur,
      historique
    );
    
    // Sélectionner top produits
    const nutraceutiquesSelectionnes = produitsScores
      .filter(p => p.type === 'nutraceutique')
      .slice(0, 3); // Top 3
    
    const aromatherapieSelectionnee = produitsScores
      .filter(p => p.type === 'aromatherapie')
      .slice(0, 2); // Top 2
    
    // Sélectionner style culinaire
    const styleCulinaire = selectionnerStyleCulinaire(
      profil as ProfilUtilisateur,
      historique
    );
    
    // Sélectionner routines
    const routinesSelectionnees = selectionnerRoutines(
      routinesSures as any,
      contexte as ContexteUtilisateur,
      historique,
      3
    );
    
    console.log(`[NIVEAU 2] Termine : ${nutraceutiquesSelectionnes.length} nutraceutiques, ${aromatherapieSelectionnee.length} HE, style=${styleCulinaire}, ${routinesSelectionnees.length} routines`);
    
    // ========================================================================
    // NIVEAU 3 : GENERATION CREATIVE (LLM)
    // ========================================================================
    
    console.log('\n[NIVEAU 3] === GENERATION CREATIVE (LLM) ===');
    
    // Déterminer ingrédients obligatoires (basés sur nutraceutiques)
    const ingredientsObligatoires = ['lentilles', 'epinards', 'patate douce']; // TODO: logique dynamique
    
    // Générer recettes via LLM (avec fallback BDD)
    const [recettePetitDej, recetteDejeuner, recetteDiner] = await Promise.all([
      genererRecetteAvecFallback(
        supabase,
        'petit-dejeuner',
        styleCulinaire,
        ingredientsObligatoires,
        profil as ProfilUtilisateur,
        contexte as ContexteUtilisateur,
        historique
      ),
      genererRecetteAvecFallback(
        supabase,
        'dejeuner',
        styleCulinaire,
        ingredientsObligatoires,
        profil as ProfilUtilisateur,
        contexte as ContexteUtilisateur,
        historique
      ),
      genererRecetteAvecFallback(
        supabase,
        'diner',
        styleCulinaire,
        ingredientsObligatoires,
        profil as ProfilUtilisateur,
        contexte as ContexteUtilisateur,
        historique
      )
    ]);
    
    // Générer message motivation
    const messageMotivation = await genererMessageMotivation(
      contexte as ContexteUtilisateur,
      {}
    );
    
    console.log('[NIVEAU 3] Termine : 3 recettes generees, message motivation');
    
    // ========================================================================
    // COMPOSITION PLAN FINAL
    // ========================================================================
    
    console.log('\n[COMPOSITION] === PLAN FINAL ===');
    
    const plan: PlanGenere = {
      profil_id: profil.id,
      objectif: contexte.objectif_principal || 'bien-etre-general',
      symptomes: contexte.symptomes_declares || [],
      
      petit_dejeuner: recettePetitDej,
      dejeuner: recetteDejeuner,
      diner: recetteDiner,
      
      nutraceutiques: nutraceutiquesSelectionnes.map(p => ({
        id: p.id,
        nom: p.nom,
        type: p.type,
        dosage: '1 gelule/jour', // TODO: récupérer depuis BDD
        timing: 'Matin avec petit-dejeuner',
        moment_optimal: 'matin',
        raison: `Aide pour ${p.symptomes_cibles?.[0] || 'bien-etre'}`,
        niveau_preuve: p.niveau_preuve
      })),
      
      aromatherapie: aromatherapieSelectionnee.map(p => ({
        id: p.id,
        nom: p.nom,
        type: p.type,
        dosage: '2-3 gouttes',
        timing: 'Soir avant coucher',
        moment_optimal: 'soir',
        raison: `Favorise ${p.symptomes_cibles?.[0] || 'detente'}`,
        niveau_preuve: p.niveau_preuve
      })),
      
      routines: routinesSelectionnees.map(r => ({
        id: r.id,
        nom: r.nom,
        categorie: r.categorie,
        duree: r.duree_quotidienne || '10 min',
        moment: r.moment_optimal || 'matin',
        protocole: 'Suivre instructions detaillees',
        raison: `Aide pour ${r.symptomes_cibles?.[0] || 'bien-etre'}`
      })),
      
      message_motivation: messageMotivation,
      conseils_generaux: [
        'Prends le temps de savourer chaque repas',
        'Hydrate-toi regulierement tout au long de la journee',
        'Ecoute les signaux de ton corps'
      ],
      
      genere_le: new Date().toISOString(),
      expire_le: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    
    // ========================================================================
    // SAUVEGARDE & TRACKING
    // ========================================================================
    
    console.log('\n[SAUVEGARDE] === TRACKING ===');
    
    // Enregistrer plan
    const planId = await enregistrerPlanGenere(supabase, profil.id, plan);
    
    // Enregistrer items vus
    const itemsVus = [
      ...nutraceutiquesSelectionnes.map(p => ({
        type: 'nutraceutique',
        id: p.id,
        nom: p.nom,
        categorie: p.categorie
      })),
      ...aromatherapieSelectionnee.map(p => ({
        type: 'aromatherapie',
        id: p.id,
        nom: p.nom
      })),
      {
        type: 'recette',
        id: recettePetitDej.id || 'gen-' + Date.now(),
        nom: recettePetitDej.nom,
        style_culinaire: recettePetitDej.style_culinaire,
        type_repas: 'petit-dejeuner',
        ingredients: recettePetitDej.ingredients.map((i: any) => i.nom)
      },
      {
        type: 'recette',
        id: recetteDejeuner.id || 'gen-' + Date.now() + 1,
        nom: recetteDejeuner.nom,
        style_culinaire: recetteDejeuner.style_culinaire,
        type_repas: 'dejeuner',
        ingredients: recetteDejeuner.ingredients.map((i: any) => i.nom)
      },
      {
        type: 'recette',
        id: recetteDiner.id || 'gen-' + Date.now() + 2,
        nom: recetteDiner.nom,
        style_culinaire: recetteDiner.style_culinaire,
        type_repas: 'diner',
        ingredients: recetteDiner.ingredients.map((i: any) => i.nom)
      },
      ...routinesSelectionnees.map(r => ({
        type: 'routine',
        id: r.id,
        nom: r.nom,
        moment: r.moment_optimal
      }))
    ];
    
    if (planId) {
      await enregistrerItemsVus(supabase, profil.id, planId, itemsVus);
    }
    
    // Sauvegarder recettes générées par LLM
    await Promise.all([
      sauvegarderRecetteGeneree(supabase, recettePetitDej, profil.id),
      sauvegarderRecetteGeneree(supabase, recetteDejeuner, profil.id),
      sauvegarderRecetteGeneree(supabase, recetteDiner, profil.id)
    ]);
    
    console.log('[SAUVEGARDE] Terminee');
    
    // ========================================================================
    // REPONSE FINALE
    // ========================================================================
    
    console.log('\n[SUCCESS] === PLAN GENERE AVEC SUCCES ===\n');
    
    return new Response(
      JSON.stringify(formaterReponseAPI(plan, planId), null, 2),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
    
  } catch (error) {
    console.error('[ERROR] Erreur generation plan:', error);
    
    return new Response(
      JSON.stringify(formaterErreurAPI(
        error instanceof Error ? error.message : 'Erreur inconnue'
      )),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );
  }
});

// ============================================================================
// FONCTION HELPER : Génération recette avec fallback
// ============================================================================

async function genererRecetteAvecFallback(
  supabase: any,
  typeRepas: string,
  styleCulinaire: string,
  ingredientsObligatoires: string[],
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur,
  historique: any
): Promise<any> {
  
  // 1. Essayer cache
  const recetteCache = await chercherRecetteCache(
    supabase,
    ingredientsObligatoires,
    styleCulinaire,
    typeRepas
  );
  
  if (recetteCache) {
    console.log(`[CACHE] Recette ${typeRepas} depuis cache`);
    return transformerRecetteBDD(recetteCache);
  }
  
  // 2. Essayer LLM
  const recetteLLM = await genererRecetteLLM(
    typeRepas,
    styleCulinaire,
    ingredientsObligatoires,
    profil,
    contexte
  );
  
  if (recetteLLM) {
    console.log(`[LLM] Recette ${typeRepas} generee par LLM`);
    return recetteLLM;
  }
  
  // 3. Fallback : sélection depuis BDD
  console.log(`[FALLBACK] Recette ${typeRepas} depuis BDD`);
  const { petitDej, dejeuner, diner } = await selectionnerRecettes(
    supabase,
    profil,
    styleCulinaire,
    historique
  );
  
  const recetteBDD = typeRepas === 'petit-dejeuner' 
    ? petitDej
    : typeRepas === 'dejeuner'
    ? dejeuner
    : diner;
  
  return recetteBDD ? transformerRecetteBDD(recetteBDD) : genererRecetteParDefaut(typeRepas);
}

function genererRecetteParDefaut(typeRepas: string): any {
  // Recette de secours si tout échoue
  return {
    nom: `Recette ${typeRepas} equilibree`,
    type_repas: typeRepas,
    style_culinaire: 'simple',
    ingredients: [
      { nom: 'Ingredient 1', quantite: 100, unite: 'g' },
      { nom: 'Ingredient 2', quantite: 50, unite: 'g' }
    ],
    instructions: [
      'Preparer les ingredients',
      'Suivre les etapes de cuisson'
    ],
    temps_preparation: 15,
    temps_cuisson: 20,
    portions: 2,
    genere_par_llm: false
  };
}

console.log('[INIT] Edge Function generer-plan chargee');
