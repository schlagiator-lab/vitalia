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
  filtrerRoutinesSecurite,
  filtrerAlimentsBesoins
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

// ─── Rate limiting : 10 générations/heure par utilisateur ──────────────────
const _planRateLimitMap = new Map<string, number[]>();
const PLAN_RATE_LIMIT_MAX = 10;
const PLAN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 heure

function checkPlanRateLimit(profilId: string): boolean {
  const now = Date.now();
  const calls = (_planRateLimitMap.get(profilId) || []).filter(t => now - t < PLAN_RATE_LIMIT_WINDOW_MS);
  if (calls.length >= PLAN_RATE_LIMIT_MAX) return false;
  calls.push(now);
  _planRateLimitMap.set(profilId, calls);
  return true;
}

// ============================================================================
// HELPERS STATIQUES
// ============================================================================

// Pools structurés pour le fallback statique (uniquement si la BDD renvoie 0 aliment)
// Garantissent qu'un repas principal a toujours une vraie protéine + légume + féculent
const PROTEINES_FALLBACK_ANIMALES: string[] = [
  'Filet de poulet', 'Pavé de saumon', 'Bœuf haché', 'Filet de cabillaud',
  'Dinde', 'Crevettes', 'Thon en conserve', 'Maquereau'
];
const PROTEINES_FALLBACK_VEGETALES: string[] = [
  'Lentilles corail', 'Pois chiches', 'Tofu ferme', 'Tempeh', 'Haricots rouges', 'Edamame'
];
const LEGUMES_FALLBACK: string[] = [
  'Courgette', 'Brocoli', 'Épinards', 'Haricots verts', 'Poivron rouge',
  'Patate douce', 'Carotte', 'Chou-fleur', 'Aubergine'
];
const FECULENTS_FALLBACK: string[] = [
  'Quinoa', 'Riz basmati', 'Pâtes complètes', 'Pain complet', "Flocons d'avoine"
];

// Détecte si une catégorie correspond à une protéine animale (viande, poisson, crustacé, abats)
function estProtéineAnimale(categorie: string): boolean {
  const cat = (categorie || '').toLowerCase();
  return ['viande', 'volaille', 'poisson', 'fruits de mer', 'crustacé', 'mollusque',
    'abats', 'gibier'].some(m => cat.includes(m));
}

// Pool EXCLUSIF petit-déjeuner : uniquement fruits, céréales, laitage — jamais de légumes/savoureux
// Utilisé pour remplacer les ingPetitDej issus du pool wellness (qui contiennent des légumes)
const PETIT_DEJ_POOL: string[] = [
  "flocons d'avoine", "banane", "myrtilles", "fraises", "framboises",
  "granola", "miel", "graines de chia", "mangue", "kiwi", "pomme",
  "noix de coco râpée", "beurre d'amande", "compote de pommes", "dattes",
  "yaourt grec", "fromage blanc", "ricotta", "abricots secs", "raisins secs"
];

// Ingrédients contenant du gluten dans les pools statiques
const GLUTEN_FALLBACK = new Set(['pâtes complètes', "flocons d'avoine", 'pain complet', 'seigle', 'orge', 'épeautre', 'couscous', 'boulgour']);
// Ingrédients poisson/fruits de mer dans PROTEINES_FALLBACK_ANIMALES
const POISSON_FALLBACK = new Set(['pavé de saumon', 'filet de cabillaud', 'thon en conserve', 'maquereau', 'crevettes']);

// Sélectionne les ingrédients pour les 3 repas du jour (fallback BDD vide)
// Déjeuner & dîner : toujours 1 protéine + 1 légume + 1 féculent pour garantir
// une recette nourrissante (évite "noix + cerises" comme repas principal).
// ingredientsBanis : ingrédients vus < 7j, exclus du pool pour la rotation.
function selectionnerIngredientsTroisRepas(
  objectif: string,
  besoinsActifs: string[],
  ingredientsBanis: Set<string> = new Set(),
  profil?: any
): { petitDej: string[]; dejeuner: string[]; diner: string[] } {
  // Extraire les allergènes déclarés pour filtrer les pools statiques
  const allergenes: string[] = (profil?.allergenes || []).map((a: string) => a.toLowerCase());
  const estSansGluten  = allergenes.includes('gluten');
  const estSansPoisson = allergenes.includes('poisson') || allergenes.includes('fruits de mer');

  // Pool protéines adapté au régime alimentaire ET aux allergies
  const estVegan      = profil?.regime_alimentaire?.some((r: string) => ['vegan', 'végétalien'].includes(r.toLowerCase())) ?? false;
  const estVegetarien = profil?.regime_alimentaire?.some((r: string) => ['vegetarien', 'végétarien'].includes(r.toLowerCase())) ?? false;

  let proteinesAnimales = PROTEINES_FALLBACK_ANIMALES;
  if (estSansPoisson) {
    proteinesAnimales = proteinesAnimales.filter(p => !POISSON_FALLBACK.has(p.toLowerCase()));
  }
  // Omnivore → animal proteins ONLY (never mix with vegetale in the same pool)
  // Mixing caused ~43% chance of selecting a vegetable protein for omnivore profiles
  const proteinesPool = (estVegan || estVegetarien)
    ? PROTEINES_FALLBACK_VEGETALES
    : proteinesAnimales;

  // Pool féculents filtré pour l'allergie gluten
  let feculentsPool = FECULENTS_FALLBACK;
  if (estSansGluten) {
    feculentsPool = feculentsPool.filter(f => !GLUTEN_FALLBACK.has(f.toLowerCase()));
    // Dernier recours si tout est filtré
    if (feculentsPool.length === 0) feculentsPool = ['Quinoa', 'Riz basmati'];
  }

  // Piocher un élément au hasard en excluant les bannis
  function piocher(pool: string[], exclu: Set<string>): string | undefined {
    const dispo = pool.filter(x => !exclu.has(x.toLowerCase().trim()));
    const src   = dispo.length > 0 ? dispo : pool;
    return src.length > 0 ? src[Math.floor(Math.random() * src.length)] : undefined;
  }

  // Déjeuner : 1 protéine + 1 légume + 1 féculent
  const protDej     = piocher(proteinesPool, ingredientsBanis);
  const legumeDej   = piocher(LEGUMES_FALLBACK, ingredientsBanis);
  const feculentDej = piocher(feculentsPool, ingredientsBanis);
  const dejeuner    = [protDej, legumeDej, feculentDej].filter(Boolean) as string[];

  // Dîner : varier la protéine et le légume par rapport au déjeuner
  const excluDiner = new Set([
    ...ingredientsBanis,
    ...(protDej   ? [protDej.toLowerCase()]   : []),
    ...(legumeDej ? [legumeDej.toLowerCase()]  : []),
  ]);
  const protDin     = piocher(proteinesPool, excluDiner);
  const legumeDin   = piocher(LEGUMES_FALLBACK, excluDiner);
  const feculentDin = piocher(feculentsPool, ingredientsBanis);
  const diner       = [protDin, legumeDin, feculentDin].filter(Boolean) as string[];

  // Petit-déjeuner géré séparément via PETIT_DEJ_POOL (ne pas toucher ici)
  return { petitDej: [], dejeuner, diner };
}


// Pool de petits-déjeuners de secours pour le plan journalier
// Tourne aléatoirement pour éviter toujours le même nom si le LLM échoue
const PETIT_DEJ_DEFAUT_POOL = [
  {
    nom: 'Porridge Avoine Banane & Miel',
    ingredients: [
      { nom: "Flocons d'avoine", quantite: 60, unite: 'g' },
      { nom: 'Lait végétal', quantite: 200, unite: 'ml' },
      { nom: 'Banane', quantite: 1, unite: 'pièce' },
      { nom: 'Miel', quantite: 10, unite: 'g' },
      { nom: 'Amandes effilées', quantite: 15, unite: 'g' },
    ],
    instructions: [
      "Chauffer le lait végétal dans une casserole à feu moyen.",
      "Ajouter les flocons d'avoine et remuer 3 minutes jusqu'à consistance crémeuse.",
      "Éplucher et trancher la banane. Déposer sur le porridge.",
      "Arroser de miel et parsemer d'amandes effilées. Servir chaud.",
    ],
  },
  {
    nom: 'Smoothie Bowl Myrtilles & Granola',
    ingredients: [
      { nom: 'Myrtilles surgelées', quantite: 150, unite: 'g' },
      { nom: 'Banane congelée', quantite: 1, unite: 'pièce' },
      { nom: 'Lait végétal', quantite: 80, unite: 'ml' },
      { nom: 'Granola', quantite: 40, unite: 'g' },
      { nom: 'Graines de lin', quantite: 10, unite: 'g' },
    ],
    instructions: [
      "Mixer les myrtilles, la banane et le lait végétal jusqu'à consistance épaisse.",
      "Verser dans un bol large.",
      "Parsemer de granola et de graines de lin.",
      "Déguster immédiatement.",
    ],
  },
  {
    nom: 'Tartines Avocat & Citron sur Pain Complet',
    ingredients: [
      { nom: 'Pain complet', quantite: 2, unite: 'tranches' },
      { nom: 'Avocat mûr', quantite: 1, unite: 'pièce' },
      { nom: 'Citron', quantite: 0.5, unite: 'pièce' },
      { nom: 'Graines de sésame', quantite: 5, unite: 'g' },
      { nom: 'Sel, poivre', quantite: 2, unite: 'g' },
    ],
    instructions: [
      "Toaster les tranches de pain 2 minutes.",
      "Écraser l'avocat à la fourchette avec le jus de citron, saler et poivrer.",
      "Tartiner sur les toasts et parsemer de graines de sésame.",
    ],
  },
];

// Recette de dernier recours si LLM + BDD échouent tous les deux
function genererRecetteParDefaut(typeRepas: string, _ingredients: string[]): any {
  if (typeRepas === 'petit-dejeuner') {
    // Choisir aléatoirement dans le pool pour ne pas toujours retourner la même recette
    const opt = PETIT_DEJ_DEFAUT_POOL[Math.floor(Math.random() * PETIT_DEJ_DEFAUT_POOL.length)];
    return {
      ...opt,
      type_repas: 'petit-dejeuner',
      style_culinaire: 'maison',
      temps_preparation: 5,
      temps_cuisson: 3,
      portions: 2,
      valeurs_nutritionnelles: { calories: 370, proteines: 9, glucides: 58, lipides: 10 },
      astuces: ["Un petit-déjeuner riche en fibres et protéines stabilise la glycémie jusqu'au déjeuner."],
      variantes: ['Varier les fruits selon la saison.'],
      genere_par_llm: false,
    };
  }

  const nomsRepas: Record<string, string> = {
    'dejeuner': 'Assiette Équilibrée du Midi',
    'diner':    'Dîner Léger & Nutritif'
  };
  return {
    nom: nomsRepas[typeRepas] || `Recette ${typeRepas} équilibrée`,
    type_repas: typeRepas,
    style_culinaire: 'simple',
    ingredients: (_ingredients || []).slice(0, 4).map((nom, i) => ({
      nom,
      quantite: [100, 150, 80, 50][i] || 100,
      unite: 'g'
    })),
    instructions: [
      'Préparer et laver soigneusement tous les ingrédients.',
      'Cuisiner selon la méthode adaptée à chaque ingrédient.',
      'Assembler, assaisonner et déguster.',
    ],
    temps_preparation: 15,
    temps_cuisson: 20,
    portions: 2,
    genere_par_llm: false,
  };
}

// Génération recette avec cascade : (cache) → LLM → BDD → défaut
// force_regeneration=true : ignore le cache, toujours appeler le LLM
// nomsDejaUtilises : noms des repas déjà générés dans la même journée (à éviter)
async function genererRecetteAvecFallback(
  supabase: any,
  typeRepas: string,
  styleCulinaire: string,
  ingredientsObligatoires: string[],
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur,
  historique: any,
  forceRegeneration: boolean = false,
  ingredientsAEviter: string[] = [],
  nomsDejaUtilises: string[] = []
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
    typeRepas, styleCulinaire, ingredientsObligatoires, profil, contexte, ingredientsAEviter, nomsDejaUtilises
  );
  if (recetteLLM) {
    // Validation qualité : rejeter les recettes trop pauvres ou vagues
    const PHRASES_VAGUES = ['selon la méthode', 'selon votre préférence', 'comme souhaité', 'adaptée', 'selon les goûts', 'à votre goût'];
    const recettePauvre =
      recetteLLM.ingredients.length < 4 ||
      recetteLLM.instructions.length < 3 ||
      recetteLLM.instructions.some((step: string) =>
        PHRASES_VAGUES.some(p => step.toLowerCase().includes(p))
      );
    if (recettePauvre) {
      console.warn(`[QUALITE] Recette ${typeRepas} insuffisante (${recetteLLM.ingredients.length} ings, ${recetteLLM.instructions.length} steps) → fallback BDD`);
    } else {
      console.log(`[LLM] Recette ${typeRepas} générée : ${recetteLLM.nom}`);
      return recetteLLM;
    }
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

  // Si sans lactose : remplacer les laitiers des pauses statiques par des alternatives végétales
  const profilSansLactose = profil.allergenes?.includes('lactose') ||
    profil.regime_alimentaire?.some((r: string) => ['sans_lactose', 'sans-lactose'].includes(r.toLowerCase()));
  if (profilSansLactose) {
    recette.ingredients = recette.ingredients.map((i: any) => {
      const nom = (i.nom || '').toLowerCase();
      if (nom.includes('ricotta'))           return { ...i, nom: 'purée d\'amande' };
      if (nom.includes('yaourt'))            return { ...i, nom: 'yaourt végétal (coco ou soja)' };
      if (nom.includes('lait entier'))       return { ...i, nom: 'lait d\'amande' };
      if (nom.includes('fromage blanc'))     return { ...i, nom: 'yaourt végétal nature' };
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
    const { profil_id, symptomes, force_regeneration, meme_theme, preferences_moment } = body;

    // Helper : convertit un budget numérique (CHF) en catégorie 'faible'/'moyen'/'eleve'
    function budgetNumeriquesVersCategorie(budgetChf: number | null | undefined): 'faible' | 'moyen' | 'eleve' {
      if (!budgetChf) return 'moyen';
      if (budgetChf <= 18) return 'faible';
      if (budgetChf <= 32) return 'moyen';
      return 'eleve';
    }

    if (!profil_id) {
      return new Response(
        JSON.stringify(formaterErreurAPI('profil_id manquant dans la requête', 'MISSING_PROFIL_ID')),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── CACHE JOURNALIER : retour immédiat si plan existant ─────────────────
    // Activé si force_regeneration !== true
    // ── Lecture cache ──────────────────────────────────────────────────────
    try {
      const { data: cached } = await supabase
        .from('plans_generes_cache')
        .select('plan_json, created_at')
        .eq('profil_id', profil_id)
        .eq('source', 'journalier')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cached?.plan_json && !force_regeneration) {
        console.log(`[CACHE] Plan journalier trouvé — généré le ${cached.created_at}`);
        return new Response(
          JSON.stringify({ ...cached.plan_json, _source: 'cache' }),
          { status: 200, headers: CORS_HEADERS }
        );
      }
    } catch (cacheErr) {
      console.warn('[CACHE] Lecture cache journalier échouée (non bloquant):', cacheErr);
    }

    // ── RATE LIMITING : 10 générations/heure, re-génération immédiate possible ──
    if (!checkPlanRateLimit(profil_id)) {
      console.warn(`[RATE LIMIT] profil ${profil_id} a dépassé ${PLAN_RATE_LIMIT_MAX} générations/heure`);
      return new Response(
        JSON.stringify({ success: false, error: 'Limite atteinte : 10 plans maximum par heure.' }),
        { status: 429, headers: CORS_HEADERS }
      );
    }

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
      // Budget : preference frontend > budget_max BDD > défaut 'moyen'
      // NB: budget_complements est le budget suppléments (hors alimentation) — ne pas utiliser ici
      budget:                  budgetNumeriquesVersCategorie(
                                 preferences_moment?.budget_max ?? profilBDD.budget_max
                               ),
      temps_preparation:       preferences_moment?.temps_max ?? profilBDD.temps_cuisine_max ?? 45,
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

    // Fallback si aucun besoin défini : utiliser tous les besoins (cohérent avec generer-plan-semaine)
    const besoinsUtilises = besoinsActifs.length > 0
      ? besoinsActifs
      : ['vitalite', 'serenite', 'sommeil', 'digestion', 'mobilite', 'hormones'];

    const contexte: ContexteUtilisateur = {
      symptomes_declares: besoinsUtilises,
      objectif_principal: besoinsActifs.length > 0 ? (besoinsUtilises[0] || 'vitalite') : 'bien-etre-general',
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

    const [produitsSurs, recettesSures, routinesSures, alimentsBesoins] = await Promise.all([
      filtrerProduitsSecurite(supabase, profil, besoinsUtilises),
      filtrerRecettesSecurite(supabase, profil),
      filtrerRoutinesSecurite(supabase, profil, besoinsUtilises),
      filtrerAlimentsBesoins(supabase, profil, besoinsUtilises)
    ]);

    console.log(`[NIVEAU 1] ${produitsSurs.length} produits | ${recettesSures.length} recettes | ${routinesSures.length} routines | ${alimentsBesoins.length} aliments sûrs`);

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

    // ── Sélection ingrédients depuis BDD alimentation_besoins avec rotation anti-répétition ──
    const estProfilOmnivore = !(profil.regime_alimentaire?.some(r =>
      ['vegan', 'végétalien', 'vegetarien', 'végétarien'].includes(r.toLowerCase())
    ));

    // Séparer protéines animales vs autres aliments (déjà filtrés par régime + allergènes dans niveau 1)
    const proteinesDB = estProfilOmnivore
      ? alimentsBesoins
          .filter(a => estProtéineAnimale(a.categorie || ''))
          .filter(a => !ingredientsBanis.has((a.nom || '').toLowerCase().trim()))
      : [];
    const autresAlimentsDB = alimentsBesoins
      .filter(a => !estProtéineAnimale(a.categorie || ''))
      .filter(a => !ingredientsBanis.has((a.nom || '').toLowerCase().trim()));

    // Tri par score décroissant + shuffle aléatoire à score égal pour la rotation
    function shuffleParScore(liste: any[]): any[] {
      const byScore: Record<number, any[]> = {};
      for (const a of liste) {
        const s = a.besoin_score || 1;
        (byScore[s] = byScore[s] || []).push(a);
      }
      return Object.keys(byScore).map(Number).sort((a, b) => b - a)
        .flatMap(s => {
          const arr = [...byScore[s]];
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
          return arr;
        });
    }

    // Filet de sécurité : déduplication par nom normalisé après shuffle
    // (au cas où la déduplication niveau1 ne suffit pas ou que des homonymes passent)
    function deduplicerParNom(liste: any[]): any[] {
      const seen = new Set<string>();
      return liste.filter(a => {
        const key = (a.nom || '').toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    const proteinesSorted = deduplicerParNom(shuffleParScore(proteinesDB));
    const autresSorted    = deduplicerParNom(shuffleParScore(autresAlimentsDB));

    // Détecte si un aliment est un poisson/fruit de mer (pour la diversification de famille)
    function estPoisson(aliment: any): boolean {
      const cat = (aliment?.categorie || '').toLowerCase();
      return ['poisson', 'hareng', 'anchois', 'sardine', 'thon', 'saumon', 'maquereau']
        .some(k => cat.includes(k));
    }

    // Protéines pour déjeuner et dîner (2 protéines différentes si possible)
    // FIX diversité : si la première protéine est un poisson, chercher une viande pour le dîner
    // (évite d'avoir maquereau + sardines le même jour, ce qui arrive souvent car les poissons
    // gras dominent le score 5 pour les objectifs mobilite / vitalite)
    const protDejAliment = proteinesSorted[0];
    const protDej = protDejAliment?.nom;

    let protDin: string | undefined;
    if (protDejAliment && estPoisson(protDejAliment) && proteinesSorted.length > 1) {
      // Chercher la première protéine non-poisson disponible pour varier
      const autreViande = proteinesSorted.find((a, i) => i > 0 && !estPoisson(a));
      protDin = autreViande?.nom || proteinesSorted[1]?.nom || protDej;
    } else {
      protDin = proteinesSorted[1]?.nom || protDej;
    }

    // Aliments complémentaires (sans répéter les protéines choisies)
    const autresPool = autresSorted.filter(a => a.nom !== protDej && a.nom !== protDin);
    const autreDej   = autresPool[0]?.nom;
    const autreDin   = autresPool[1]?.nom || autresPool[0]?.nom;

    let ingPetitDej: string[], ingDejeuner: string[], ingDiner: string[];

    if (protDej) {
      // At least one animal protein from DB — supplement other ingredient from static pool if needed
      const legumesDispos = LEGUMES_FALLBACK.filter(l => !ingredientsBanis.has(l.toLowerCase()));
      const legumeFallback = () => {
        const pool = legumesDispos.length > 0 ? legumesDispos : LEGUMES_FALLBACK;
        return pool[Math.floor(Math.random() * pool.length)];
      };
      const suppDej = autreDej || legumeFallback();
      ingDejeuner = [protDej, suppDej];
      const suppDin = autreDin || legumeFallback();
      ingDiner = protDin ? [protDin, suppDin] : ingDejeuner;
      console.log(`[NIVEAU 2] Protéines DB — Déjeuner: ${protDej} | Dîner: ${protDin || protDej}`);
    } else {
      // Fallback pool statique si pas assez d'aliments BDD
      const troisRepas = selectionnerIngredientsTroisRepas(
        contexte.objectif_principal || 'bien-etre-general',
        besoinsUtilises,
        ingredientsBanis,
        profil
      );
      ingDejeuner = troisRepas.dejeuner;
      ingDiner    = troisRepas.diner;
      console.log(`[NIVEAU 2] Fallback pool statique (proteinesDB=${proteinesDB.length}, autresDB=${autresAlimentsDB.length})`);
    }

    // Petit-déjeuner : toujours depuis PETIT_DEJ_POOL (fruité/sucré, jamais protéines animales)
    // Filtrage allergies : lactose ET gluten retirés selon le profil
    const estSansLactose = profil.allergenes?.includes('lactose') ||
      profil.regime_alimentaire?.some((r: string) => ['sans_lactose', 'sans-lactose'].includes(r.toLowerCase()));
    const estSansGlutenProfil = profil.allergenes?.includes('gluten') ||
      profil.regime_alimentaire?.includes('sans-gluten');
    const LAITIERS_PETIT_DEJ = new Set(['yaourt grec', 'fromage blanc', 'ricotta']);
    const GLUTEN_PETIT_DEJ   = new Set(["flocons d'avoine", 'granola']);
    let poolPetitDej = PETIT_DEJ_POOL;
    if (estSansLactose)    poolPetitDej = poolPetitDej.filter(item => !LAITIERS_PETIT_DEJ.has(item));
    if (estSansGlutenProfil) poolPetitDej = poolPetitDej.filter(item => !GLUTEN_PETIT_DEJ.has(item));
    const shuffledPetitDej = [...poolPetitDej].sort(() => Math.random() - 0.5);
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

    // Lancer pause + motivation + conseil en parallèle (indépendants des recettes)
    const [recettePause, messageMotivation, conseilDuJour] = await Promise.all([
      genererPauseAvecFallback(profil, contexte),
      genererMessageMotivation(contexte, {}),
      genererConseilDuJour(contexte)
    ]);

    // Générer les 3 repas séquentiellement pour passer les noms précédents au LLM
    // → évite que le LLM répète le même concept d'un repas à l'autre dans la même journée
    const recettePetitDej = await genererRecetteAvecFallback(
      supabase, 'petit-dejeuner', stylePetitDej, ingPetitDej,
      profil, contexte, historique, forceRegen,
      [...ingDejeuner, ...ingDiner],
      []   // premier repas : aucun nom précédent
    );
    const recetteDejeuner = await genererRecetteAvecFallback(
      supabase, 'dejeuner', styleDejeuner, ingDejeuner,
      profil, contexte, historique, forceRegen,
      [...ingPetitDej, ...ingDiner],
      [recettePetitDej?.nom].filter(Boolean) as string[]
    );
    const recetteDiner = await genererRecetteAvecFallback(
      supabase, 'diner', styleDiner, ingDiner,
      profil, contexte, historique, forceRegen,
      [...ingPetitDej, ...ingDejeuner],
      [recettePetitDej?.nom, recetteDejeuner?.nom].filter(Boolean) as string[]
    );

    // ========================================================================
    // VALIDATION RECETTES — garantit que chaque repas est complet avant envoi
    // Un repas est considéré "vide" si : nom manquant, ou ingredients[], ou instructions[]
    // En cas d'échec, le fallback statique garanti est appliqué.
    // ========================================================================

    function recetteEstValide(r: any): boolean {
      if (!r) return false;
      if (!r.nom || r.nom.trim() === '') return false;
      if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) return false;
      if (!Array.isArray(r.instructions) || r.instructions.length === 0) return false;
      // Au moins un ingrédient avec un nom non vide
      return r.ingredients.some((i: any) => i?.nom && i.nom.trim() !== '');
    }

    function pauseEstValide(p: any): boolean {
      if (!p) return false;
      if (!p.nom || p.nom.trim() === '') return false;
      if (!Array.isArray(p.ingredients) || p.ingredients.length === 0) return false;
      if (!Array.isArray(p.instructions) || p.instructions.length === 0) return false;
      return true;
    }

    let recettePetitDejFinal  = recettePetitDej;
    let recetteDejeunerFinal  = recetteDejeuner;
    let recetteDinerFinal     = recetteDiner;
    let recettePauseFinal     = recettePause;

    if (!recetteEstValide(recettePetitDej)) {
      console.warn('[VALIDATION] Petit-déjeuner vide ou incomplet → fallback par défaut');
      recettePetitDejFinal = genererRecetteParDefaut('petit-dejeuner', ingPetitDej);
    }
    if (!recetteEstValide(recetteDejeuner)) {
      console.warn('[VALIDATION] Déjeuner vide ou incomplet → fallback par défaut');
      recetteDejeunerFinal = genererRecetteParDefaut('dejeuner', ingDejeuner);
    }
    if (!recetteEstValide(recetteDiner)) {
      console.warn('[VALIDATION] Dîner vide ou incomplet → fallback par défaut');
      recetteDinerFinal = genererRecetteParDefaut('diner', ingDiner);
    }
    if (!pauseEstValide(recettePause)) {
      console.warn('[VALIDATION] Pause vide ou incomplète → fallback pool statique');
      recettePauseFinal = recettePauseParDefaut(contexte.objectif_principal || 'vitalite');
    }

    console.log(`[VALIDATION] Petit-dej OK=${recetteEstValide(recettePetitDejFinal)} | Déjeuner OK=${recetteEstValide(recetteDejeunerFinal)} | Dîner OK=${recetteEstValide(recetteDinerFinal)} | Pause OK=${pauseEstValide(recettePauseFinal)}`);

    // ========================================================================
    // COMPOSITION PLAN FINAL
    // ========================================================================

    const plan: PlanGenere = {
      profil_id,
      objectif:  contexte.objectif_principal || 'bien-etre-general',
      symptomes: contexte.symptomes_declares  || [],

      petit_dejeuner: recettePetitDejFinal,
      dejeuner:       recetteDejeunerFinal,
      diner:          recetteDinerFinal,
      pause:          recettePauseFinal,

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
          type: 'recette', id: recettePetitDejFinal.id || `gen-matin-${Date.now()}`,
          nom: recettePetitDejFinal.nom, style_culinaire: recettePetitDejFinal.style_culinaire,
          type_repas: 'petit-dejeuner',
          ingredients: recettePetitDejFinal.ingredients.map((i: any) => i.nom)
        },
        {
          type: 'recette', id: recetteDejeunerFinal.id || `gen-midi-${Date.now()}`,
          nom: recetteDejeunerFinal.nom, style_culinaire: recetteDejeunerFinal.style_culinaire,
          type_repas: 'dejeuner',
          // FIX anti-répétition inter-plans : ajouter les noms bruts DB en plus des noms LLM
          // (le LLM peut renommer "Maquereau" en "Filets de maquereau grillés" → ban cassé)
          ingredients: [
            ...recetteDejeunerFinal.ingredients.map((i: any) => i.nom),
            ...(protDej ? [protDej] : [])
          ]
        },
        {
          type: 'recette', id: recetteDinerFinal.id || `gen-soir-${Date.now()}`,
          nom: recetteDinerFinal.nom, style_culinaire: recetteDinerFinal.style_culinaire,
          type_repas: 'diner',
          // FIX idem pour le dîner
          ingredients: [
            ...recetteDinerFinal.ingredients.map((i: any) => i.nom),
            ...(protDin && protDin !== protDej ? [protDin] : [])
          ]
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

    // ── SAUVEGARDE CACHE JOURNALIER (upsert — contrainte UNIQUE(profil_id, source)) ──
    const planFormatePourCache = formaterReponseAPI(plan, planId);
    const { error: cacheError } = await supabase
      .from('plans_generes_cache')
      .upsert(
        {
          profil_id,
          source: 'journalier',
          symptomes: Array.isArray(symptomes) ? symptomes : [],
          plan_json: planFormatePourCache,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: 'profil_id,source' }
      );
    if (cacheError) {
      console.error('[CACHE] Erreur upsert plan journalier:', cacheError.message, cacheError.code);
    } else {
      console.log('[CACHE] Plan journalier sauvegardé (upsert ok)');
    }

    return new Response(
      JSON.stringify(planFormatePourCache, null, 2),
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
