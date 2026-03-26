// supabase/functions/generer-recette-unique/index.ts
// Génère une seule recette à la demande (onglet "Recette unique" de home.html)
// Input : { profil_id, type_repas, ingredients_frigo, symptomes }
// Output: { success, recette: RecetteGeneree }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// ─── Rate limiting in-memory (par instance Deno) ────────────────────────────
const _rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

function checkRateLimit(profilId: string): boolean {
  const now = Date.now();
  const calls = (_rateLimitMap.get(profilId) || []).filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  if (calls.length >= RATE_LIMIT_MAX) return false;
  calls.push(now);
  _rateLimitMap.set(profilId, calls);
  return true;
}

// ─── Fallback recette riche (même logique que generer-plan-semaine) ──────────

function recetteFallback(typeRepas: string, ingredientsFrigo: string[], directiveChef = ''): any {
  // Essayer d'honorer la directive chef avec des fallbacks ciblés
  if (directiveChef && (typeRepas === 'dejeuner' || typeRepas === 'diner')) {
    const dir = directiveChef.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (dir.includes('soupe') || dir.includes('potage') || dir.includes('veloute')) {
      return {
        nom: `Soupe maison aux légumes — ${directiveChef}`,
        type_repas: typeRepas,
        style_culinaire: 'maison',
        ingredients: [
          { nom: 'Carottes', quantite: 200, unite: 'g' },
          { nom: 'Courgette', quantite: 150, unite: 'g' },
          { nom: 'Oignon', quantite: 80, unite: 'g' },
          { nom: 'Bouillon de légumes', quantite: 800, unite: 'ml' },
          { nom: "Huile d'olive", quantite: 10, unite: 'ml' },
        ],
        instructions: [
          'Éplucher et couper les légumes en cubes.',
          "Faire revenir l'oignon dans l'huile d'olive 3 min.",
          'Ajouter les légumes et le bouillon. Porter à ébullition.',
          'Laisser mijoter 20 min à feu moyen. Mixer selon la consistance souhaitée.',
          'Rectifier l\'assaisonnement et servir chaud.',
        ],
        temps_preparation: 10, temps_cuisson: 25, portions: 2,
        valeurs_nutritionnelles: { calories: 180, proteines: 5, glucides: 28, lipides: 5 },
        astuces: ['Une soupe maison simple et nourrissante, riche en fibres et vitamines.'],
        variantes: ['Ajoutez des lentilles corail pour une version plus protéinée.'],
        genere_par_llm: false,
      };
    }
    if (dir.includes('salade')) {
      return {
        nom: `Salade composée — ${directiveChef}`,
        type_repas: typeRepas,
        style_culinaire: 'maison',
        ingredients: [
          { nom: 'Salade verte', quantite: 100, unite: 'g' },
          { nom: 'Tomates cerises', quantite: 100, unite: 'g' },
          { nom: 'Concombre', quantite: 80, unite: 'g' },
          { nom: 'Pois chiches cuits', quantite: 120, unite: 'g' },
          { nom: "Huile d'olive, jus de citron", quantite: 15, unite: 'ml' },
        ],
        instructions: [
          'Laver et essuyer la salade. Couper les tomates en deux et le concombre en rondelles.',
          'Rincer et égoutter les pois chiches.',
          'Assembler tous les ingrédients dans un grand saladier.',
          "Assaisonner d'huile d'olive, jus de citron, sel et poivre. Mélanger et servir.",
        ],
        temps_preparation: 10, temps_cuisson: 0, portions: 2,
        valeurs_nutritionnelles: { calories: 280, proteines: 12, glucides: 35, lipides: 10 },
        astuces: ['Les pois chiches apportent protéines végétales et fibres pour la satiété.'],
        variantes: ['Ajoutez du feta ou de l\'avocat pour enrichir la salade.'],
        genere_par_llm: false,
      };
    }
  }
  if (typeRepas === 'patisserie') {
    return {
      nom: 'Fondant Chocolat Noir & Amandes',
      type_repas: typeRepas,
      style_culinaire: 'maison',
      ingredients: [
        { nom: 'Chocolat noir 70%', quantite: 100, unite: 'g' },
        { nom: 'Beurre doux', quantite: 60, unite: 'g' },
        { nom: 'Œufs', quantite: 2, unite: 'pièces' },
        { nom: 'Sucre de coco', quantite: 40, unite: 'g' },
        { nom: 'Farine de riz ou farine T65', quantite: 30, unite: 'g' },
        { nom: 'Amandes effilées', quantite: 20, unite: 'g' },
      ],
      instructions: [
        'Préchauffer le four à 180 °C. Beurrer deux petits moules à fondant ou ramequins.',
        'Faire fondre le chocolat et le beurre au bain-marie à feu doux, en remuant jusqu\'à obtenir un mélange lisse et brillant.',
        'Hors du feu, incorporer le sucre de coco au mélange chocolaté. Bien mélanger.',
        'Ajouter les œufs un à un en fouettant vivement après chaque ajout pour incorporer de l\'air.',
        'Tamiser la farine sur la préparation et mélanger délicatement à la spatule jusqu\'à ce qu\'elle soit entièrement absorbée.',
        'Répartir dans les moules, parsemer d\'amandes effilées et enfourner 9 à 11 minutes — le cœur doit rester légèrement tremblant.',
        'Laisser reposer 2 minutes avant de démouler. Déguster tiède avec quelques framboises fraîches.',
      ],
      temps_preparation: 10,
      temps_cuisson: 11,
      portions: 2,
      valeurs_nutritionnelles: { calories: 420, proteines: 9, glucides: 32, lipides: 28 },
      astuces: ['Le chocolat noir 70%+ est riche en magnésium et en antioxydants (flavonoïdes) pour la sérénité et la vitalité.'],
      variantes: ['Remplacez la farine par de la poudre d\'amandes pour une version sans gluten encore plus fondante.'],
      genere_par_llm: false,
    };
  }

  if (typeRepas === 'petit-dejeuner' || typeRepas === 'collation') {
    return {
      nom: 'Bol Énergie du Matin',
      type_repas: typeRepas,
      style_culinaire: 'maison',
      ingredients: [
        { nom: "Flocons d'avoine", quantite: 60, unite: 'g' },
        { nom: 'Lait végétal ou animal', quantite: 150, unite: 'ml' },
        { nom: 'Banane', quantite: 1, unite: 'pièce' },
        { nom: 'Miel', quantite: 10, unite: 'g' },
        { nom: 'Amandes effilées', quantite: 15, unite: 'g' },
      ],
      instructions: [
        "Verser les flocons d'avoine dans un bol et couvrir avec le lait froid ou chaud.",
        "Laisser gonfler 3 minutes si vous utilisez du lait chaud, ou préparer la veille avec du lait froid pour un porridge overnight.",
        'Éplucher la banane et la couper en rondelles.',
        'Déposer les rondelles de banane sur les flocons gonflés.',
        "Arroser de miel et parsemer d'amandes effilées.",
        'Déguster immédiatement pour profiter de la texture crémeuse.',
      ],
      temps_preparation: 5, temps_cuisson: 3, portions: 1,
      valeurs_nutritionnelles: { calories: 380, proteines: 10, glucides: 62, lipides: 9 },
      astuces: ["Les flocons d'avoine à index glycémique bas libèrent l'énergie progressivement pour tenir jusqu'au déjeuner."],
      variantes: ['Remplacez la banane par des fruits rouges surgelés décongelés la veille.'],
      genere_par_llm: false,
    };
  }

  // Pour déjeuner/dîner : choisir une protéine (frigo ou pool aléatoire)
  const PROTEINES_POOL = ['Filet de poulet', 'Pavé de saumon', 'Bœuf haché', 'Filet de dinde', 'Lentilles corail', 'Cabillaud', 'Pois chiches', 'Œufs'];
  const prot = ingredientsFrigo.length > 0
    ? ingredientsFrigo[0]
    : PROTEINES_POOL[Math.floor(Math.random() * PROTEINES_POOL.length)];
  const protLow = prot.toLowerCase();

  let nom: string, ingredients: any[], instructions: string[], calories = 430, proteines = 28;

  if (protLow.includes('saumon') || protLow.includes('cabillaud') || protLow.includes('dorade') || protLow.includes('bar')) {
    nom = `${prot} poêlé au citron`;
    ingredients = [
      { nom: prot, quantite: 160, unite: 'g' }, { nom: 'Haricots verts', quantite: 180, unite: 'g' },
      { nom: 'Citron', quantite: 1, unite: 'pièce' }, { nom: 'Câpres', quantite: 10, unite: 'g' },
      { nom: "Huile d'olive", quantite: 10, unite: 'ml' }, { nom: 'Sel, poivre', quantite: 2, unite: 'g' },
    ];
    instructions = [
      'Sortir le poisson du réfrigérateur 10 minutes avant la cuisson pour une cuisson homogène.',
      "Faire bouillir de l'eau salée et cuire les haricots verts 6 à 7 minutes. Égoutter et réserver au chaud.",
      "Chauffer une poêle antiadhésive à feu vif avec l'huile d'olive.",
      "Saler et poivrer le poisson côté peau. Déposer côté peau dans la poêle chaude et cuire 4 minutes sans y toucher.",
      'Retourner délicatement et cuire encore 2 à 3 minutes selon l\'épaisseur. Ajouter les câpres et presser le citron.',
      'Servir le poisson sur les haricots verts, napper du jus de cuisson citronnée.',
    ];
    calories = 400; proteines = 30;
  } else if (protLow.includes('poulet') || protLow.includes('dinde')) {
    nom = `${prot} rôti aux légumes du soleil`;
    ingredients = [
      { nom: prot, quantite: 160, unite: 'g' }, { nom: 'Poivron rouge', quantite: 120, unite: 'g' },
      { nom: 'Courgette', quantite: 120, unite: 'g' }, { nom: 'Oignon rouge', quantite: 80, unite: 'g' },
      { nom: 'Ail', quantite: 2, unite: 'gousses' }, { nom: "Huile d'olive, paprika, thym", quantite: 15, unite: 'ml+g' },
    ];
    instructions = [
      'Préchauffer le four à 200 °C. Couper le poivron, la courgette et l\'oignon en morceaux de 3 cm.',
      "Écraser les gousses d'ail sans les éplucher. Déposer tous les légumes dans un plat allant au four.",
      "Arroser d'huile d'olive, saupoudrer de paprika et thym, saler et poivrer. Mélanger pour enrober.",
      "Déposer la viande par-dessus les légumes. Badigeonner avec un peu d'huile et d'épices.",
      'Enfourner 25 à 30 minutes jusqu\'à ce que la viande soit dorée et les légumes légèrement caramélisés.',
      'Laisser reposer 3 minutes avant de découper et servir avec les légumes confits.',
    ];
    calories = 440; proteines = 34;
  } else if (protLow.includes('bœuf') || protLow.includes('boeuf') || protLow.includes('haché')) {
    nom = `${prot} poêlé, purée de patate douce`;
    ingredients = [
      { nom: prot, quantite: 150, unite: 'g' }, { nom: 'Patate douce', quantite: 200, unite: 'g' },
      { nom: 'Épinards frais', quantite: 100, unite: 'g' }, { nom: 'Ail', quantite: 1, unite: 'gousse' },
      { nom: "Huile d'olive", quantite: 10, unite: 'ml' }, { nom: 'Romarin, sel, poivre', quantite: 3, unite: 'g' },
    ];
    instructions = [
      "Éplucher la patate douce, la couper en cubes et la cuire à l'eau bouillante salée 15 minutes.",
      "Égoutter et écraser à la fourchette avec un filet d'huile d'olive, saler et poivrer. Réserver au chaud.",
      'Saler et poivrer la viande des deux côtés.',
      'Chauffer une poêle à feu très vif. Cuire 2 à 3 minutes de chaque côté pour une cuisson rosée.',
      "Dans la même poêle, faire revenir l'ail écrasé 30 secondes puis ajouter les épinards. Faire tomber 2 minutes.",
      'Servir la viande sur la purée de patate douce, accompagnée des épinards à l\'ail.',
    ];
    calories = 480; proteines = 36;
  } else if (protLow.includes('lentille') || protLow.includes('pois chiche') || protLow.includes('haricot')) {
    nom = `${prot} mijotés aux épices douces`;
    ingredients = [
      { nom: prot, quantite: 180, unite: 'g' }, { nom: 'Tomates concassées', quantite: 200, unite: 'g' },
      { nom: 'Oignon', quantite: 100, unite: 'g' }, { nom: 'Carottes', quantite: 120, unite: 'g' },
      { nom: 'Cumin, curcuma, coriandre', quantite: 5, unite: 'g' }, { nom: "Huile d'olive", quantite: 10, unite: 'ml' },
    ];
    instructions = [
      "Émincer l'oignon et couper les carottes en rondelles fines. Faire revenir dans l'huile d'olive 5 minutes.",
      'Ajouter le cumin, le curcuma et la coriandre moulus. Faire revenir 1 minute pour libérer les arômes.',
      'Incorporer les tomates concassées et mélanger. Laisser réduire 5 minutes.',
      "Ajouter les légumineuses rincées et égouttées. Mélanger délicatement.",
      'Couvrir et laisser mijoter 15 à 20 minutes à feu doux en remuant de temps en temps.',
      "Rectifier l'assaisonnement, parsemer de coriandre fraîche si disponible et servir.",
    ];
    calories = 390; proteines = 20;
  } else if (protLow.includes('œuf') || protLow.includes('oeuf')) {
    nom = 'Omelette aux légumes et fromage de chèvre';
    ingredients = [
      { nom: 'Œufs', quantite: 3, unite: 'pièces' }, { nom: 'Fromage de chèvre frais', quantite: 40, unite: 'g' },
      { nom: 'Tomates cerises', quantite: 100, unite: 'g' }, { nom: 'Épinards frais', quantite: 80, unite: 'g' },
      { nom: "Huile d'olive", quantite: 5, unite: 'ml' }, { nom: 'Sel, poivre, ciboulette', quantite: 3, unite: 'g' },
    ];
    instructions = [
      "Battre les œufs énergiquement avec une pincée de sel et de poivre jusqu'à obtenir un mélange mousseux.",
      'Faire tomber les épinards dans la poêle chaude 1 minute puis réserver.',
      "Essuyer la poêle, ajouter l'huile d'olive à feu moyen-vif.",
      "Verser les œufs battus. Laisser coaguler 30 secondes sur les bords, puis rabattre vers le centre.",
      "Quand l'omelette est encore baveuse, répartir épinards, tomates et fromage de chèvre émietté sur la moitié.",
      "Plier l'omelette en deux, glisser dans l'assiette et parsemer de ciboulette. Servir immédiatement.",
    ];
    calories = 350; proteines = 24;
  } else {
    nom = `${prot} poêlé aux légumes de saison`;
    ingredients = [
      { nom: prot, quantite: 150, unite: 'g' }, { nom: 'Légumes de saison variés', quantite: 250, unite: 'g' },
      { nom: 'Oignon', quantite: 80, unite: 'g' }, { nom: 'Ail', quantite: 2, unite: 'gousses' },
      { nom: "Huile d'olive", quantite: 15, unite: 'ml' }, { nom: 'Herbes fraîches, sel, poivre', quantite: 5, unite: 'g' },
    ];
    instructions = [
      'Préparer et couper les légumes en morceaux réguliers (2 à 3 cm). Émincer l\'oignon et écraser l\'ail.',
      "Chauffer l'huile d'olive dans une grande poêle ou wok à feu vif.",
      "Faire revenir l'oignon et l'ail 2 minutes jusqu'à ce qu'ils soient translucides.",
      'Ajouter les légumes les plus durs en premier (carottes, brocoli), puis les plus tendres après 3 minutes.',
      'Incorporer la protéine coupée en dés. Saler, poivrer et mélanger. Cuire 5 à 8 minutes à feu moyen.',
      'Parsemer d\'herbes fraîches et servir sans attendre.',
    ];
  }

  return {
    nom, type_repas: typeRepas, style_culinaire: 'maison',
    ingredients, instructions,
    temps_preparation: 10, temps_cuisson: 20, portions: 2,
    valeurs_nutritionnelles: { calories, proteines, glucides: 40, lipides: 14 },
    astuces: ['Choisissez des légumes de saison pour plus de nutriments et de saveur.'],
    variantes: ['Adaptez les épices selon vos goûts et les légumes selon la saison.'],
    genere_par_llm: false,
  };
}

// ─── Construction du prompt ────────────────────────────────────────────────

function construirePrompt(
  typeRepas: string,
  ingredientsFrigo: string[],
  symptomes: string[],
  profil: any,
  directiveChef: string = ''
): string {

  const estPetitDej = typeRepas === 'petit-dejeuner' || typeRepas === 'collation';
  const estPatisserie = typeRepas === 'patisserie';

  const regimes: string[] = [];
  if (profil.regime_alimentaire?.some((r: string) => ['vegan', 'végétalien'].includes(r.toLowerCase()))) {
    regimes.push('100% VEGANE');
  } else if (profil.regime_alimentaire?.some((r: string) => ['vegetarien', 'végétarien'].includes(r.toLowerCase()))) {
    regimes.push('VÉGÉTARIENNE');
  }
  if (profil.regime_alimentaire?.includes('sans-gluten') || profil.allergenes?.includes('gluten')) {
    regimes.push('SANS GLUTEN');
  }
  if (profil.allergenes?.includes('lactose') ||
      profil.regime_alimentaire?.some((r: string) => ['sans_lactose', 'sans-lactose'].includes(r.toLowerCase()))) {
    regimes.push('SANS LACTOSE');
  }
  if (profil.regime_alimentaire?.includes('keto')) regimes.push('KETO');
  if (profil.regime_alimentaire?.includes('paleo')) regimes.push('PALEO');

  const objectifMap: Record<string, string> = {
    vitalite: 'Riche en fer, vitamines B et magnésium pour booster la vitalité',
    serenite: 'Riche en magnésium et tryptophane pour la sérénité',
    digestion: 'Riche en fibres et prébiotiques pour la digestion',
    sommeil: 'Riche en tryptophane et mélatonine pour le sommeil',
    mobilite: 'Anti-inflammatoire, riche en oméga-3 pour la mobilité',
    hormones: 'Riche en acides gras et phytoestrogènes pour l\'équilibre hormonal',
  };

  const objectif = symptomes.length > 0
    ? (objectifMap[symptomes[0]] || 'Équilibrée et nutritive')
    : 'Saine et équilibrée, sans objectif santé spécifique';

  const tempsMax = profil.temps_preparation || 45;
  const allergenes = profil.allergenes || [];
  const budgetLabel = profil.budget === 'faible' ? '5-8€/pers.'
                    : profil.budget === 'eleve'  ? '12-20€/pers.'
                    : '8-12€/pers.';

  const frigoSection = ingredientsFrigo.length > 0
    ? `**INGRÉDIENTS DU FRIGO À UTILISER OBLIGATOIREMENT** :\n${ingredientsFrigo.map((i: string) => `- ${i}`).join('\n')}`
    : '**Ingrédients** : Utiliser des ingrédients courants et accessibles';

  const contraintesPetitDej = (typeRepas === 'petit-dejeuner') ? `
## CONTRAINTES PETIT-DÉJEUNER
- Saveur SUCRÉE uniquement (fruits, céréales, miel)
- Temps ≤ 10 minutes, sans cuisson longue
- Maximum 5 ingrédients
` : '';

  const contraintesCollation = (typeRepas === 'collation') ? `
## CONTRAINTES COLLATION
- Légère, nourrissante, temps ≤ 5 minutes
- Maximum 4 ingrédients, pas de compléments en poudre
` : '';

  const PATISSERIE_TYPES = [
    'tarte aux fruits frais (ex: fraises, framboises, poires, abricots) sur crème pâtissière légère',
    'muffins moelleux à la banane et aux noix de pécan',
    'panna cotta à la vanille et coulis de fruits rouges',
    'crumble aux pommes et cannelle avec topping avoine-amandes',
    'cheesecake léger à la ricotta et zestes de citron',
    'clafoutis aux cerises ou aux myrtilles',
    'cookies croustillants aux flocons d\'avoine, dattes et noix',
    'mousse légère au citron et meringue',
    'gâteau yaourt aux agrumes et pavot',
    'financiers aux amandes et framboises',
    'tarte tatin aux poires et caramel de coco',
    'rochers coco chocolat noir',
    'pudding chia aux fruits exotiques',
    'galette des rois frangipane amandes-noisettes',
    'cake marbré vanille-cacao',
    'tartelettes aux fraises et crème d\'amandes',
    'beignets légers aux pommes et sucre de coco',
    'soufflé glacé aux fruits de la passion',
    'madeleines au miel et fleur d\'oranger',
    'brownie à la patate douce et pépites de chocolat',
  ];
  const patisserieInspiration = PATISSERIE_TYPES[Math.floor(Math.random() * PATISSERIE_TYPES.length)];

  const contraintesPatisserie = estPatisserie ? `
## CONTRAINTES PÂTISSERIE — RÈGLES ABSOLUES
- C'est un DESSERT GOURMAND, PAS un plat principal
- INTERDIT ABSOLUMENT : légumes salés, viandes, poissons, fruits de mer, protéines animales brutes
- INTERDIT : recettes salées ou plats de résistance sous quelque forme que ce soit
- Saveurs UNIQUEMENT sucrées : fruits, vanille, caramel, cannelle, noisette, agrumes, coco, chocolat...
- Le dessert doit être APPÉTISSANT et GOURMAND tout en étant nutritionnellement valorisé
- Tu peux utiliser des ingrédients nutritifs (patate douce, avocat, amandes, dattes) UNIQUEMENT s'ils servent la dimension sucrée
- Valorise la dimension nutritionnelle dans les "astuces" sans compromettre le côté dessert
- **DIRECTION CRÉATIVE IMPOSÉE pour cette génération** : crée une recette dans l'esprit de → ${patisserieInspiration}
- Sois ORIGINAL sur le nom et les détails, ne copie pas mot pour mot la direction, inspire-t'en
` : '';

  const directiveSection = directiveChef.trim()
    ? `\n## DIRECTIVE DU CHEF — PRIORITÉ ABSOLUE\nL'utilisateur demande SPÉCIFIQUEMENT : "${directiveChef.trim()}"\nTu DOIS créer une recette qui correspond exactement à cette demande. C'est la contrainte la plus importante.\n`
    : '';

  return `Tu es un chef pâtissier nutritionniste expert. Crée une recette ORIGINALE et CREATIVE.

## CONTRAINTES STRICTES

**Type de repas** : ${estPatisserie ? 'DESSERT / PÂTISSERIE GOURMANDE' : typeRepas}
**Régime** : ${regimes.join(', ') || 'Aucune restriction'}
**Allergènes à éviter** : ${allergenes.join(', ') || 'Aucun'}
**Temps max** : ${estPetitDej ? 15 : tempsMax} minutes
**Budget** : ${budgetLabel}
**Objectif nutritionnel** : ${estPatisserie ? 'Dessert gourmand avec ingrédients de qualité nutritionnelle (chocolat noir, fruits, oléagineux)' : objectif}
**Portions** : 2 personnes
${directiveSection}
${frigoSection}
${contraintesPetitDej}
${contraintesCollation}
${contraintesPatisserie}

## FORMAT JSON STRICT (sans backticks, sans texte autour)

{
  "nom": "Nom créatif",
  "ingredients": [
    {"nom": "ingrédient", "quantite": 150, "unite": "g"}
  ],
  "instructions": ["Étape 1 détaillée", "Étape 2 détaillée", "Étape 3 détaillée"],
  "temps_preparation": 15,
  "temps_cuisson": 20,
  "portions": 2,
  "valeurs_nutritionnelles": {"calories": 450, "proteines": 18, "glucides": 55, "lipides": 12},
  "astuces": ["Astuce nutritionnelle sur : ${symptomes.join(', ') || 'bien-être général'}"],
  "variantes": ["Variante 1"]
}`;
}

// ─── Calcul nutrition réelle depuis alimentation ───────────────────────────

function convertirEnGrammes(quantite: number, unite: string, nomIng: string): number | null {
  if (!quantite || quantite <= 0) return null;
  const u = (unite || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

  if (['g', 'gr', 'gramme', 'grammes'].includes(u)) return quantite;
  if (u === 'kg') return quantite * 1000;
  if (u === 'ml') return quantite;
  if (u === 'cl') return quantite * 10;
  if (u === 'l' || u === 'litre') return quantite * 1000;
  if (u.includes('soupe') || u === 'cas' || u === 'tbsp') return quantite * 15;
  if (u.includes('cafe')  || u === 'cac' || u === 'tsp')  return quantite * 5;
  if (u === 'verre')   return quantite * 200;
  if (u === 'poignee') return quantite * 30;
  if (['piece', 'pieces', 'pc', 'pcs', 'unite', ''].includes(u)) {
    const n = nomIng.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const table: Record<string, number> = {
      'oeuf': 55, 'citron': 100, 'orange': 150, 'pomme': 130, 'poire': 140,
      'banane': 120, 'tomate': 100, 'oignon': 80, 'echalote': 40,
      'gousse': 5, 'carotte': 80, 'courgette': 200, 'poivron': 150,
      'avocat': 150, 'mangue': 200, 'peche': 130, 'prune': 50, 'kiwi': 75,
    };
    for (const [key, g] of Object.entries(table)) {
      if (n.includes(key)) return quantite * g;
    }
    return quantite * 100;
  }
  return null;
}

function extraireMotCle(nom: string): string | null {
  const stop = new Set([
    'de','du','des','le','la','les','et','en','au','aux','un','une','avec','sans',
    'frais','fraiche','bio','nature','maison','sur','par','pour',
    'filet','pave','tranche','steak','cuisse','aile','blanc','rouge','noir','vert',
    'dore','grille','cuit','cru','entier','hache',
    'sel','poivre','herbe','epice','persil','ciboulette','thym','romarin','basilic',
  ]);
  const normalized = nom.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '').trim();
  const words = normalized.split(/\s+/).filter(w => w.length > 3 && !stop.has(w));
  return words[0] || (normalized.length > 2 ? normalized.split(/\s+/)[0] : null);
}

async function calculerNutritionReelle(
  ingredients: Array<{ nom: string; quantite: number; unite: string }>,
  supabase: any
): Promise<{ calories: number; proteines: number; glucides: number; lipides: number; couverture: string; source: string } | null> {
  let totCal = 0, totProt = 0, totGluc = 0, totLip = 0, matched = 0;

  for (const ing of ingredients) {
    const g = convertirEnGrammes(ing.quantite, ing.unite, ing.nom);
    if (!g) continue;
    const kw = extraireMotCle(ing.nom);
    if (!kw || kw.length < 3) continue;

    const { data } = await supabase
      .from('alimentation')
      .select('calories, proteines, glucides, lipides')
      .ilike('nom', `%${kw}%`)
      .limit(1);

    const ali = data?.[0];
    if (ali?.calories != null) {
      const r = g / 100;
      totCal  += (ali.calories  || 0) * r;
      totProt += (ali.proteines || 0) * r;
      totGluc += (ali.glucides  || 0) * r;
      totLip  += (ali.lipides   || 0) * r;
      matched++;
    }
  }

  if (matched < 2) return null;
  return {
    calories:  Math.round(totCal),
    proteines: Math.round(totProt * 10) / 10,
    glucides:  Math.round(totGluc * 10) / 10,
    lipides:   Math.round(totLip  * 10) / 10,
    couverture: `${matched}/${ingredients.length} ingrédients`,
    source: matched >= Math.ceil(ingredients.length * 0.6) ? 'calculé' : 'partiel',
  };
}

// ─── Appel Claude AI ───────────────────────────────────────────────────────

async function genererRecetteIA(
  typeRepas: string,
  ingredientsFrigo: string[],
  symptomes: string[],
  profil: any,
  directiveChef: string = ''
): Promise<any | null> {

  if (!ANTHROPIC_API_KEY) {
    console.error('[ERROR] ANTHROPIC_API_KEY manquante');
    return null;
  }

  const prompt = construirePrompt(typeRepas, ingredientsFrigo, symptomes, profil, directiveChef);

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        temperature: 0.9,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error(`[ERROR] Claude API ${response.status}:`, await response.text());
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    // Parse JSON (blocs ```json ou brut)
    let recetteJSON: any = null;
    const jsonBlock = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlock) { try { recetteJSON = JSON.parse(jsonBlock[1]); } catch (_) {} }
    if (!recetteJSON) {
      const jsonRaw = text.match(/\{[\s\S]*\}/);
      if (jsonRaw) { try { recetteJSON = JSON.parse(jsonRaw[0]); } catch (_) {} }
    }

    if (!recetteJSON?.nom || !Array.isArray(recetteJSON?.ingredients) || !Array.isArray(recetteJSON?.instructions)) {
      console.error('[ERROR] JSON LLM invalide');
      return null;
    }

    return {
      nom: recetteJSON.nom,
      type_repas: typeRepas,
      style_culinaire: 'maison',
      ingredients: recetteJSON.ingredients.map((ing: any) => ({
        nom: ing.nom || ing.name || 'Ingrédient',
        quantite: ing.quantite || ing.quantity || 0,
        unite: ing.unite || ing.unit || 'g',
      })),
      instructions: recetteJSON.instructions || [],
      temps_preparation: recetteJSON.temps_preparation ?? 15,
      temps_cuisson: recetteJSON.temps_cuisson ?? 0,
      portions: recetteJSON.portions || 2,
      valeurs_nutritionnelles: recetteJSON.valeurs_nutritionnelles || undefined,
      astuces: recetteJSON.astuces || [],
      variantes: recetteJSON.variantes || [],
      genere_par_llm: true,
    };

  } catch (error) {
    console.error('[ERROR] Exception Claude:', error);
    return null;
  }
}

// ─── Handler principal ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { profil_id, type_repas, ingredients_frigo, symptomes, directive_chef } = body;

    if (!profil_id || !type_repas) {
      return new Response(
        JSON.stringify({ success: false, error: 'profil_id et type_repas requis' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    if (!checkRateLimit(profil_id)) {
      console.warn(`[RATE LIMIT] profil ${profil_id} a dépassé ${RATE_LIMIT_MAX} appels en 10 min`);
      return new Response(
        JSON.stringify({ success: false, error: 'Trop de requêtes. Réessaie dans quelques minutes.' }),
        { status: 429, headers: CORS_HEADERS }
      );
    }

    const typeRepasNorm = type_repas.toLowerCase()
      .replace('déjeuner', 'dejeuner')
      .replace('dîner', 'diner')
      .replace('petit-déjeuner', 'petit-dejeuner');

    const ingredientsFrigo: string[] = Array.isArray(ingredients_frigo)
      ? ingredients_frigo.slice(0, 10)
      : [];
    const symptomesArr: string[] = Array.isArray(symptomes) ? symptomes : [];
    const directiveChef: string = typeof directive_chef === 'string' ? directive_chef.slice(0, 120) : '';

    // Charger le profil utilisateur
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: profils } = await supabase
      .from('profils_utilisateurs')
      .select('*')
      .eq('id', profil_id)
      .limit(1);

    const profil = profils?.[0] || {};

    // Normaliser le profil pour le prompt
    const profilNorm = {
      regime_alimentaire: profil.regimes_alimentaires || profil.regime_alimentaire || [],
      allergenes: profil.allergies || profil.allergenes || [],
      temps_preparation: profil.temps_cuisine_max || profil.temps_preparation || 45,
      budget: profil.budget_complements || profil.budget || 'moyen',
    };

    console.log(`[generer-recette-unique] type=${typeRepasNorm}, frigo=${ingredientsFrigo.length} ingrédients, symptomes=${symptomesArr.join(',')}, directive="${directiveChef}"`);

    // Générer la recette via Claude
    let recette = await genererRecetteIA(typeRepasNorm, ingredientsFrigo, symptomesArr, profilNorm, directiveChef);

    // Fallback si la génération échoue
    if (!recette) {
      console.warn('[WARN] Fallback recette par défaut');
      recette = recetteFallback(typeRepasNorm, ingredientsFrigo, directiveChef);
    }

    // Calcul nutrition réelle depuis la table alimentation
    if (recette?.ingredients?.length) {
      const nutritionReelle = await calculerNutritionReelle(recette.ingredients, supabase);
      if (nutritionReelle) {
        console.log(`[nutrition] calculée (${nutritionReelle.couverture}) → ${nutritionReelle.calories} kcal`);
        recette.valeurs_nutritionnelles = {
          ...nutritionReelle,
          llm_estime: recette.valeurs_nutritionnelles,
        };
      } else {
        console.log(`[nutrition] < 2 ingrédients matchés → estimation LLM conservée`);
        if (recette.valeurs_nutritionnelles) {
          recette.valeurs_nutritionnelles.source = 'estimé_llm';
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, recette }),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (error: any) {
    console.error('[ERROR] Exception principale:', error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Erreur inconnue' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
