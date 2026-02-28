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
  selectionnerRoutines,
  selectionnerNutraceutiques,
  selectionnerAromatherapie,
  getIngredientsBanis
} from './niveau2-selection.ts';
import {
  genererRecetteLLM,
  genererPauseLLM,
  genererMessageMotivation,
  genererConseilDuJour,
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

// Pool d'ingrédients par besoin
const INGREDIENTS_POOL: Record<string, string[]> = {
  'vitalite':          ['lentilles corail', 'quinoa', 'épinards', 'patate douce', 'pois chiches', 'riz brun', 'œufs', 'banane', 'flocons d\'avoine', 'noix de cajou'],
  'serenite':          ['cacao', 'noix de cajou', 'sarrasin', 'épinards', 'avocat', 'graines de lin', 'banane', 'légumes verts', 'saumon', 'amandes'],
  'digestion':         ['gingembre', 'fenouil', 'courgette', 'riz complet', 'yaourt', 'artichaut', 'papaye', 'carotte', 'céleri', 'pomme'],
  'sommeil':           ['patate douce', 'banane', 'amandes', 'avoine', 'cerises', 'noix', 'graines de courge', 'kiwi', 'riz complet', 'lentilles'],
  'mobilite':          ['curcuma', 'gingembre', 'saumon', 'myrtilles', 'noix', 'huile d\'olive', 'brocoli', 'cerises', 'graines de lin', 'épinards'],
  'hormones':          ['avocat', 'graines de lin', 'saumon', 'noix', 'brocoli', 'patate douce', 'quinoa', 'légumineuses', 'graines de courge', 'huile d\'olive'],
  'energie':           ['lentilles corail', 'quinoa', 'épinards', 'patate douce', 'pois chiches', 'riz brun', 'œufs', 'banane', 'flocons d\'avoine', 'noix de cajou'],
  'stress':            ['cacao', 'noix de cajou', 'sarrasin', 'épinards', 'avocat', 'graines de lin', 'banane', 'légumes verts', 'saumon', 'amandes'],
  'bien-etre-general': ['lentilles corail', 'épinards', 'quinoa', 'avocat', 'patate douce', 'brocoli', 'pois chiches', 'myrtilles', 'noix', 'tomate']
};

// Pool EXCLUSIF petit-déjeuner : uniquement fruits, céréales, laitage — jamais de légumes/savoureux
// Utilisé pour remplacer les ingPetitDej issus du pool wellness (qui contiennent des légumes)
const PETIT_DEJ_POOL: string[] = [
  "flocons d'avoine", "banane", "myrtilles", "fraises", "framboises",
  "granola", "miel", "graines de chia", "mangue", "kiwi", "pomme",
  "noix de coco râpée", "beurre d'amande", "compote de pommes", "dattes",
  "yaourt grec", "fromage blanc", "ricotta", "abricots secs", "raisins secs"
];

// FIX P1 BIS : Ingrédients différents pour chaque repas de la journée
// Retourne 3 listes non-chevauchantes (petit-dej, déjeuner, dîner)
// ingredientsBanis : ingrédients vus < 7j, exclus du pool (Faille 4)
function selectionnerIngredientsTroisRepas(
  objectif: string,
  besoinsActifs: string[],
  ingredientsBanis: Set<string> = new Set()
): { petitDej: string[]; dejeuner: string[]; diner: string[] } {
  // Combiner les pools de tous les besoins actifs pour plus de diversité
  const tous = [...new Set(
    besoinsActifs.flatMap(b => INGREDIENTS_POOL[b] || [])
    .concat(INGREDIENTS_POOL[objectif] || INGREDIENTS_POOL['vitalite'])
  )];

  // Filtrer les ingrédients bannis (vus < 7j)
  const disponibles = tous.filter(ing => !ingredientsBanis.has(ing.toLowerCase().trim()));
  // Fallback si le pool filtré est trop petit (< 9 ingrédients)
  const pool = disponibles.length >= 9 ? disponibles : tous;

  // Shuffle Fisher-Yates unique pour garantir des ingrédients non répétés entre repas
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Partitionner en 3 groupes distincts (3 ingrédients chacun)
  return {
    petitDej: shuffled.slice(0, 3),
    dejeuner: shuffled.slice(3, 6),
    diner:    shuffled.slice(6, 9)
  };
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
  forceRegeneration: boolean = false,
  ingredientsAEviter: string[] = []
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
    typeRepas, styleCulinaire, ingredientsObligatoires, profil, contexte, ingredientsAEviter
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

// Pool de pauses par objectif — 3 options par besoin, sélection aléatoire à chaque génération.
// Toutes 100% alimentaires, sans aucun complément. Le LLM est exclu intentionnellement
// car il tend à inclure des NAC (spiruline, ashwagandha, etc.) malgré les consignes.
function recettePauseParDefaut(objectif: string): any {
  const pauses: Record<string, any[]> = {
    'vitalite': [
      {
        nom: 'Mix Énergie Banane & Noix de Cajou',
        ingredients: [{nom:'banane',quantite:1,unite:''},{nom:'noix de cajou',quantite:30,unite:'g'},{nom:'datte medjool',quantite:2,unite:''}],
        instructions: ['Éplucher la banane et la couper en rondelles.','Disposer dans un bol avec les noix de cajou et les dattes.','Déguster lentement pour une énergie stable.'],
        astuces: ['Le sucre naturel de la banane offre une énergie rapide, les graisses des noix de cajou la prolongent.'],
        valeurs_nutritionnelles: {calories:200,proteines:5,glucides:30,lipides:8},
        temps_preparation: 2, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Tartine Ricotta & Fruits Rouges',
        ingredients: [{nom:'pain complet',quantite:1,unite:'tranche'},{nom:'ricotta',quantite:50,unite:'g'},{nom:'fraises ou myrtilles',quantite:80,unite:'g'},{nom:'miel',quantite:0.5,unite:'c.a.c'}],
        instructions: ['Toaster légèrement le pain.','Étaler la ricotta généreusement.','Disposer les fruits rouges dessus et ajouter un filet de miel.'],
        astuces: ['La ricotta apporte des protéines légères ; les fruits rouges sont riches en antioxydants et vitamine C pour booster l\'énergie.'],
        valeurs_nutritionnelles: {calories:190,proteines:8,glucides:24,lipides:6},
        temps_preparation: 3, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Bol Avoine Express Pomme & Cannelle',
        ingredients: [{nom:'flocons d\'avoine',quantite:40,unite:'g'},{nom:'pomme',quantite:0.5,unite:''},{nom:'cannelle',quantite:1,unite:'pincée'},{nom:'lait végétal',quantite:100,unite:'ml'}],
        instructions: ['Chauffer le lait végétal 1 min au micro-ondes.','Verser sur les flocons d\'avoine et laisser gonfler 2 min.','Ajouter la pomme râpée et la cannelle.'],
        astuces: ['Les bêta-glucanes de l\'avoine stabilisent la glycémie pour une énergie sans pic ni chute.'],
        valeurs_nutritionnelles: {calories:210,proteines:6,glucides:35,lipides:4},
        temps_preparation: 4, temps_cuisson: 0, portions: 1
      }
    ],
    'serenite': [
      {
        nom: 'Carré de Chocolat Noir & Tisane Camomille',
        ingredients: [{nom:'chocolat noir 70%+',quantite:2,unite:'carrés'},{nom:'camomille bio',quantite:1,unite:'sachet'},{nom:'miel',quantite:1,unite:'c.a.c'}],
        instructions: ['Infuser la camomille 5 min dans 250ml d\'eau bouillante.','Ajouter une cuillère de miel.','Déguster avec les carrés de chocolat noir en les laissant fondre lentement.'],
        astuces: ['La camomille calme le système nerveux. Le cacao contient de la théobromine, douce et apaisante.'],
        valeurs_nutritionnelles: {calories:130,proteines:2,glucides:15,lipides:7},
        temps_preparation: 5, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Smoothie Banane Lait d\'Amande Chaud',
        ingredients: [{nom:'banane mûre',quantite:1,unite:''},{nom:'lait d\'amande',quantite:200,unite:'ml'},{nom:'cannelle',quantite:1,unite:'pincée'},{nom:'vanille',quantite:1,unite:'trait'}],
        instructions: ['Chauffer doucement le lait d\'amande sans bouillir.','Mixer avec la banane, la cannelle et la vanille.','Boire chaud, lentement, en pleine conscience.'],
        astuces: ['La banane est riche en tryptophane précurseur de la sérotonine — l\'hormone du bien-être et de la sérénité.'],
        valeurs_nutritionnelles: {calories:160,proteines:3,glucides:28,lipides:4},
        temps_preparation: 4, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Noix du Brésil & Raisins Secs',
        ingredients: [{nom:'noix du Brésil',quantite:3,unite:''},{nom:'raisins secs',quantite:20,unite:'g'},{nom:'tisane mélisse',quantite:1,unite:'tasse'}],
        instructions: ['Préparer une tisane de mélisse (infuser 5 min).','Disposer les noix et les raisins dans un petit bol.','Déguster en savourant chaque bouchée.'],
        astuces: ['3 noix du Brésil couvrent 100% des besoins journaliers en sélénium, minéral clé pour réduire l\'anxiété.'],
        valeurs_nutritionnelles: {calories:120,proteines:3,glucides:14,lipides:7},
        temps_preparation: 5, temps_cuisson: 0, portions: 1
      }
    ],
    'digestion': [
      {
        nom: 'Pomme & Beurre d\'Amande au Gingembre',
        ingredients: [{nom:'pomme',quantite:1,unite:''},{nom:'beurre d\'amande',quantite:1,unite:'c.a.s'},{nom:'gingembre frais',quantite:1,unite:'pincée râpée'}],
        instructions: ['Laver et trancher la pomme en quartiers.','Mélanger le beurre d\'amande avec le gingembre râpé.','Tremper les quartiers de pomme dans le beurre d\'amande épicé.'],
        astuces: ['Les enzymes de la pomme et le gingembre stimulent doucement la digestion en milieu d\'après-midi.'],
        valeurs_nutritionnelles: {calories:180,proteines:4,glucides:22,lipides:9},
        temps_preparation: 3, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Yaourt Nature & Kiwi',
        ingredients: [{nom:'yaourt nature entier',quantite:125,unite:'g'},{nom:'kiwi',quantite:1,unite:''},{nom:'graines de chia',quantite:1,unite:'c.a.c'}],
        instructions: ['Éplucher et trancher le kiwi.','Verser le yaourt dans un bol.','Disposer le kiwi sur le dessus et saupoudrer de graines de chia.'],
        astuces: ['Le yaourt apporte des probiotiques ; le kiwi contient de l\'actinidine, enzyme qui améliore la digestion des protéines.'],
        valeurs_nutritionnelles: {calories:130,proteines:7,glucides:16,lipides:4},
        temps_preparation: 2, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Crackers Complets & Houmous Maison',
        ingredients: [{nom:'crackers complets',quantite:4,unite:''},{nom:'houmous',quantite:3,unite:'c.a.s'},{nom:'concombre',quantite:5,unite:'rondelles'}],
        instructions: ['Disposer les crackers sur une assiette.','Étaler l\'houmous sur chaque cracker.','Ajouter les rondelles de concombre par-dessus.'],
        astuces: ['Les pois chiches de l\'houmous sont riches en fibres prébiotiques qui nourrissent le microbiome intestinal.'],
        valeurs_nutritionnelles: {calories:170,proteines:6,glucides:22,lipides:6},
        temps_preparation: 2, temps_cuisson: 0, portions: 1
      }
    ],
    'sommeil': [
      {
        nom: 'Poignée de Cerises & Amandes',
        ingredients: [{nom:'cerises fraîches ou séchées',quantite:80,unite:'g'},{nom:'amandes',quantite:15,unite:'g'},{nom:'tisane valériane',quantite:1,unite:'sachet (optionnel)'}],
        instructions: ['Laver les cerises si fraîches.','Disposer cerises et amandes dans un petit bol.','Déguster tranquillement, idéalement en s\'éloignant des écrans.'],
        astuces: ['Les cerises sont l\'une des rares sources alimentaires de mélatonine naturelle. Les amandes apportent du magnésium.'],
        valeurs_nutritionnelles: {calories:150,proteines:4,glucides:18,lipides:7},
        temps_preparation: 2, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Lait Chaud Miel & Muscade',
        ingredients: [{nom:'lait entier ou végétal',quantite:200,unite:'ml'},{nom:'miel',quantite:1,unite:'c.a.c'},{nom:'muscade râpée',quantite:1,unite:'pincée'}],
        instructions: ['Chauffer doucement le lait sans bouillir.','Ajouter le miel et remuer jusqu\'à dissolution.','Râper une pincée de muscade sur le dessus et déguster chaud.'],
        astuces: ['La muscade contient de la myristique aux propriétés légèrement sédatives. Le miel favorise le passage du tryptophane vers le cerveau.'],
        valeurs_nutritionnelles: {calories:140,proteines:4,glucides:18,lipides:5},
        temps_preparation: 3, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Kiwi & Noix du Brésil',
        ingredients: [{nom:'kiwi',quantite:2,unite:''},{nom:'noix du Brésil',quantite:2,unite:''},{nom:'tisane passiflore',quantite:1,unite:'tasse (optionnel)'}],
        instructions: ['Éplucher et couper les kiwis en dés.','Disposer dans un bol avec les noix du Brésil.','Accompagner d\'une tisane de passiflore si disponible.'],
        astuces: ['Des études montrent que 2 kiwis le soir améliorent la qualité et la durée du sommeil grâce à leur teneur en sérotonine et antioxydants.'],
        valeurs_nutritionnelles: {calories:120,proteines:3,glucides:20,lipides:4},
        temps_preparation: 2, temps_cuisson: 0, portions: 1
      }
    ],
    'mobilite': [
      {
        nom: 'Smoothie Anti-Inflammatoire Myrtilles & Curcuma',
        ingredients: [{nom:'myrtilles',quantite:100,unite:'g'},{nom:'banane',quantite:0.5,unite:''},{nom:'lait d\'amande',quantite:150,unite:'ml'},{nom:'curcuma',quantite:0.25,unite:'c.a.c'}],
        instructions: ['Mixer tous les ingrédients jusqu\'à consistance lisse.','Verser dans un verre.','Boire immédiatement pour profiter des antioxydants.'],
        astuces: ['Les myrtilles et le curcuma sont de puissants anti-inflammatoires naturels qui soulagent les articulations.'],
        valeurs_nutritionnelles: {calories:160,proteines:3,glucides:28,lipides:4},
        temps_preparation: 4, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Noix & Cerises Séchées',
        ingredients: [{nom:'cerises séchées',quantite:30,unite:'g'},{nom:'noix',quantite:20,unite:'g'},{nom:'gingembre confit',quantite:5,unite:'g'}],
        instructions: ['Mélanger les cerises séchées, les noix et le gingembre confit dans un bol.','Déguster lentement.'],
        astuces: ['Les oméga-3 des noix et les anthocyanes des cerises réduisent l\'inflammation articulaire. Le gingembre amplifie cet effet.'],
        valeurs_nutritionnelles: {calories:175,proteines:4,glucides:20,lipides:9},
        temps_preparation: 1, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Tartine Avocat & Saumon Fumé',
        ingredients: [{nom:'pain de seigle',quantite:1,unite:'tranche'},{nom:'avocat',quantite:0.25,unite:''},{nom:'saumon fumé',quantite:30,unite:'g'},{nom:'jus de citron',quantite:1,unite:'trait'}],
        instructions: ['Écraser l\'avocat avec le citron et une pincée de sel.','Étaler sur le pain de seigle.','Disposer le saumon fumé par-dessus.'],
        astuces: ['Le saumon est l\'une des meilleures sources d\'oméga-3 EPA/DHA à action anti-inflammatoire directe sur les articulations.'],
        valeurs_nutritionnelles: {calories:190,proteines:12,glucides:14,lipides:9},
        temps_preparation: 3, temps_cuisson: 0, portions: 1
      }
    ],
    'hormones': [
      {
        nom: 'Avocat Toast Complet & Graines de Lin',
        ingredients: [{nom:'pain complet sans gluten',quantite:1,unite:'tranche'},{nom:'avocat',quantite:0.5,unite:''},{nom:'graines de lin',quantite:1,unite:'c.a.c'},{nom:'jus de citron',quantite:1,unite:'trait'}],
        instructions: ['Toaster le pain.','Écraser l\'avocat avec le jus de citron et une pincée de sel.','Tartiner et parsemer de graines de lin.'],
        astuces: ['Les acides gras essentiels de l\'avocat et les lignanes du lin soutiennent l\'équilibre hormonal.'],
        valeurs_nutritionnelles: {calories:210,proteines:4,glucides:18,lipides:14},
        temps_preparation: 5, temps_cuisson: 2, portions: 1
      },
      {
        nom: 'Bol de Graines de Courge & Noix',
        ingredients: [{nom:'graines de courge',quantite:25,unite:'g'},{nom:'noix',quantite:20,unite:'g'},{nom:'figues séchées',quantite:2,unite:''}],
        instructions: ['Mélanger les graines de courge et les noix dans un petit bol.','Couper les figues en petits morceaux et ajouter.','Déguster lentement.'],
        astuces: ['Les graines de courge sont l\'une des meilleures sources alimentaires de zinc, minéral essentiel à la production hormonale.'],
        valeurs_nutritionnelles: {calories:200,proteines:8,glucides:16,lipides:13},
        temps_preparation: 1, temps_cuisson: 0, portions: 1
      },
      {
        nom: 'Smoothie Épinards Banane & Graines de Lin',
        ingredients: [{nom:'épinards frais',quantite:30,unite:'g'},{nom:'banane',quantite:1,unite:''},{nom:'graines de lin moulues',quantite:1,unite:'c.a.s'},{nom:'lait végétal',quantite:150,unite:'ml'}],
        instructions: ['Mixer tous les ingrédients jusqu\'à consistance lisse.','Ajouter un peu d\'eau si trop épais.','Consommer immédiatement.'],
        astuces: ['Les phytoestrogènes du lin et les folates des épinards contribuent à l\'équilibre des hormones féminines et à la réduction du SPM.'],
        valeurs_nutritionnelles: {calories:180,proteines:5,glucides:28,lipides:6},
        temps_preparation: 3, temps_cuisson: 0, portions: 1
      }
    ]
  };

  // Alias pour les besoins qui ne sont pas dans la liste principale
  const pool = pauses[objectif] ?? pauses['energie'] ?? pauses['vitalite'];
  const index = Math.floor(Math.random() * pool.length);
  console.log(`[PAUSE] Option ${index + 1}/${pool.length} sélectionnée pour objectif : ${objectif}`);
  return pool[index];
}

// Pause 15h30 : LLM en premier (prompt anti-NAC strict), pool statique en fallback.
async function genererPauseAvecFallback(
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur
): Promise<any> {
  const objectif = contexte.objectif_principal || 'vitalite';

  // 1. LLM — prompt interdit explicitement tout complément alimentaire
  const pauseLLM = await genererPauseLLM(profil, contexte);
  if (pauseLLM) return pauseLLM;

  // 2. Fallback : pool statique garanti sans NAC
  console.log(`[PAUSE] Fallback pool statique pour objectif : ${objectif}`);
  const recette = recettePauseParDefaut(objectif);

  // Si végane : retirer le miel de la recette sérénité si présent
  if (profil.regime_alimentaire?.includes('vegan')) {
    recette.ingredients = recette.ingredients.map((i: any) => {
      if (i.nom === 'miel') return { ...i, nom: 'sirop d\'agave' };
      return i;
    });
  }

  return recette;
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
    const { profil_id, symptomes, force_regeneration, meme_theme } = body;

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
    const ingredientsBanis = getIngredientsBanis(historique);
    const produitsScores = scorerProduits(produitsSurs, contexte, historique);
    // Note: scorerProduits utilise maintenant le besoin_score des tables junction

    // Weighted Random Sampling — remplace les .slice() qui ignoraient le scoring
    const nutraceutiquesSelectionnes = selectionnerNutraceutiques(produitsScores, 3);
    const aromatherapieSelectionnee  = selectionnerAromatherapie(produitsScores, 2);

    // Fix 3 : par défaut, 3 styles différents (un par repas)
    // Si meme_theme=true envoyé par le frontend, un seul style pour les 3 repas
    let stylePetitDej: string, styleDejeuner: string, styleDiner: string;
    if (meme_theme === true) {
      const styleCulinaire = selectionnerStyleCulinaire(profil, historique);
      stylePetitDej = styleCulinaire;
      styleDejeuner = styleCulinaire;
      styleDiner    = styleCulinaire;
    } else {
      stylePetitDej = selectionnerStyleCulinaire(profil, historique, []);
      styleDejeuner = selectionnerStyleCulinaire(profil, historique, [stylePetitDej]);
      styleDiner    = selectionnerStyleCulinaire(profil, historique, [stylePetitDej, styleDejeuner]);
    }
    console.log(`[NIVEAU 2] Styles choisis — Petit-dej: ${stylePetitDej} | Déjeuner: ${styleDejeuner} | Dîner: ${styleDiner}`);

    const routinesSelectionnees = selectionnerRoutines(
      routinesSures as any,
      contexte,
      historique,
      3
    );

    // FIX P1 BIS : Ingrédients différents pour chaque repas
    const produitsAlimentaires = produitsScores.filter(p => p.type === 'aliment');

    let ingPetitDej: string[], ingDejeuner: string[], ingDiner: string[];

    if (produitsAlimentaires.length >= 6) {
      // Assez de produits BDD pour partitionner en 3 groupes distincts
      const shuffledAliments = [...produitsAlimentaires];
      for (let i = shuffledAliments.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledAliments[i], shuffledAliments[j]] = [shuffledAliments[j], shuffledAliments[i]];
      }
      ingPetitDej = shuffledAliments.slice(0, 2).map(p => p.nom);
      ingDejeuner = shuffledAliments.slice(2, 4).map(p => p.nom);
      ingDiner    = shuffledAliments.slice(4, 6).map(p => p.nom);
    } else {
      // Fallback : sélection depuis les pools de besoins, non-chevauchante
      const troisRepas = selectionnerIngredientsTroisRepas(
        contexte.objectif_principal || 'bien-etre-general',
        besoinsUtilises,
        ingredientsBanis
      );
      ingPetitDej = troisRepas.petitDej;
      ingDejeuner = troisRepas.dejeuner;
      ingDiner    = troisRepas.diner;
    }

    // Petit-déjeuner : toujours remplacé par des ingrédients sucrés/fruits
    // (le pool wellness contient des légumes incompatibles avec la contrainte "sucré")
    const shuffledPetitDej = [...PETIT_DEJ_POOL].sort(() => Math.random() - 0.5);
    ingPetitDej = shuffledPetitDej.slice(0, 3);

    console.log(`[NIVEAU 2] Styles: ${stylePetitDej} / ${styleDejeuner} / ${styleDiner}`);
    console.log(`[NIVEAU 2] Ingrédients Petit-dej : ${ingPetitDej.join(', ')}`);
    console.log(`[NIVEAU 2] Ingrédients Déjeuner  : ${ingDejeuner.join(', ')}`);
    console.log(`[NIVEAU 2] Ingrédients Dîner     : ${ingDiner.join(', ')}`);

    // ========================================================================
    // NIVEAU 3 : GENERATION CREATIVE (LLM)
    // ========================================================================

    console.log('\n[NIVEAU 3] === GENERATION CREATIVE (LLM) ===');

    const forceRegen = force_regeneration === true;
    const [recettePause, recettePetitDej, recetteDejeuner, recetteDiner, messageMotivation, conseilDuJour] = await Promise.all([
      genererPauseAvecFallback(profil, contexte),
      genererRecetteAvecFallback(supabase, 'petit-dejeuner', stylePetitDej, ingPetitDej, profil, contexte, historique, forceRegen, [...ingDejeuner, ...ingDiner]),
      genererRecetteAvecFallback(supabase, 'dejeuner',       styleDejeuner, ingDejeuner, profil, contexte, historique, forceRegen, [...ingPetitDej, ...ingDiner]),
      genererRecetteAvecFallback(supabase, 'diner',          styleDiner,    ingDiner,    profil, contexte, historique, forceRegen, [...ingPetitDej, ...ingDejeuner]),
      genererMessageMotivation(contexte, {}),
      genererConseilDuJour(contexte)
    ]);

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
      pause:          recettePause,

      nutraceutiques: nutraceutiquesSelectionnes.map(p => ({
        id:                 p.id,
        nom:                p.nom,
        type:               p.type,
        dosage:             (p as any).posologie || '1 gélule/jour',
        timing:             (p as any).timing    || 'Matin avec petit-déjeuner',
        moment_optimal:     'matin',
        raison:             `Aide pour ${p.symptomes_cibles?.[0] || 'bien-être'}`,
        niveau_preuve:      p.niveau_preuve,
        contre_indications: (p as any).contre_indications || []
      })),

      aromatherapie: aromatherapieSelectionnee.map(p => ({
        id:                 p.id,
        nom:                p.nom,
        type:               p.type,
        dosage:             (p as any).dosage_standard || '2-3 gouttes',
        timing:             (p as any).timing || 'Soir avant coucher',
        moment_optimal:     'soir',
        raison:             `Favorise ${p.symptomes_cibles?.[0] || 'détente'}`,
        niveau_preuve:      p.niveau_preuve,
        contre_indications: (p as any).contre_indications || (p as any).contre_indications_majeures || []
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
      conseil_du_jour: conseilDuJour,
      conseils_generaux: [conseilDuJour],

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
