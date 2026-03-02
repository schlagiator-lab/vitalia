// supabase/functions/generer-plan-semaine/index.ts
// Génère un plan alimentaire sur 7 jours
// Input : { profil_id, symptomes }
// Output: { success, semaine: { lundi, mardi, ... }, nutraceutiques, aromatherapie, routines, message_motivation, conseil_du_jour }

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

const JOURS_SEMAINE = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

const STYLES_CULINAIRES = ['mediterraneen', 'asiatique', 'francais', 'italien', 'mexicain', 'nordique', 'oriental'];

// ─── Utilitaires ───────────────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normaliserArray(valeur: any): string[] {
  if (!valeur) return [];
  if (Array.isArray(valeur)) return valeur.filter(Boolean);
  if (typeof valeur === 'string') {
    return valeur
      .replace(/^\{|\}$/g, '')
      .split(/,(?![^{]*})/)
      .map((s: string) => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
  return [];
}

// ─── Collation par défaut (sans LLM) ──────────────────────────────────────

function collationParDefaut(profil: any): any {
  const estSansLactose = profil.estSansLactose;
  const estVegan = profil.estVegan;

  const options = [
    {
      nom: 'Pomme & Amandes',
      ingredients: [{ nom: 'Pomme', quantite: 1, unite: 'pièce' }, { nom: 'Amandes', quantite: 20, unite: 'g' }],
      instructions: ['Laver la pomme et la couper en tranches.', 'Servir avec les amandes.'],
      temps_preparation: 2, temps_cuisson: 0, portions: 1,
      valeurs_nutritionnelles: { calories: 130, proteines: 3, glucides: 20, lipides: 6 },
      astuces: ['Les amandes apportent des acides gras bénéfiques pour le cœur.'],
    },
    {
      nom: 'Carré de Chocolat Noir & Noix',
      ingredients: [{ nom: 'Chocolat noir 70%', quantite: 20, unite: 'g' }, { nom: 'Noix', quantite: 15, unite: 'g' }],
      instructions: ['Laisser fondre le chocolat en bouche.', 'Manger les noix lentement.'],
      temps_preparation: 1, temps_cuisson: 0, portions: 1,
      valeurs_nutritionnelles: { calories: 140, proteines: 3, glucides: 9, lipides: 11 },
      astuces: ['Le chocolat noir 70%+ contient 64mg de magnésium anti-stress.'],
    },
    {
      nom: 'Banane & Beurre d\'Amande',
      ingredients: [{ nom: 'Banane', quantite: 1, unite: 'pièce' }, { nom: 'Beurre d\'amande', quantite: 15, unite: 'g' }],
      instructions: ['Éplucher la banane.', 'Étaler le beurre d\'amande dessus.'],
      temps_preparation: 2, temps_cuisson: 0, portions: 1,
      valeurs_nutritionnelles: { calories: 170, proteines: 4, glucides: 25, lipides: 7 },
      astuces: ['La banane est riche en potassium et en tryptophane, précurseur de la sérotonine.'],
    },
  ];

  const pool = options.filter(o => {
    if (estVegan && o.ingredients.some(i => i.nom.toLowerCase().includes('chocolat'))) return true;
    if (estSansLactose) return true;
    return true;
  });

  return {
    ...pool[Math.floor(Math.random() * pool.length)],
    nom: pool[Math.floor(Math.random() * pool.length)].nom,
    type_repas: 'collation',
    style_culinaire: 'maison',
    genere_par_llm: false,
  };
}

// ─── Construction du prompt recette ───────────────────────────────────────

function construirePromptRecette(
  typeRepas: string,
  styleCulinaire: string,
  proteineAssignee: string | null,
  profil: any,
  symptomes: string[],
  proteinesAutresJours: string[]
): string {

  const estPetitDej = typeRepas === 'petit-dejeuner';
  const regimes = profil.contraintesRegime || [];
  const allergenes = profil.allergenes || [];
  const tempsMax = profil.temps_preparation || 45;

  const objectifMap: Record<string, string> = {
    vitalite: 'Riche en fer, vitamines B et magnésium pour booster la vitalité',
    serenite: 'Riche en magnésium et tryptophane pour la sérénité',
    digestion: 'Riche en fibres et prébiotiques pour la digestion',
    sommeil: 'Riche en tryptophane et mélatonine pour le sommeil',
    mobilite: 'Anti-inflammatoire, riche en oméga-3 pour la mobilité',
    hormones: 'Riche en acides gras et phytoestrogènes pour l\'équilibre hormonal',
  };
  const objectif = symptomes.length > 0 ? (objectifMap[symptomes[0]] || 'Équilibrée et nutritive') : 'Équilibrée et nutritive';

  const estSansLactose = profil.estSansLactose;

  const proteineConsigne = (!estPetitDej && proteineAssignee && !profil.estVegan && !profil.estVegetarien)
    ? `\n**PROTÉINE PRINCIPALE OBLIGATOIRE** : ${proteineAssignee}. Ne pas la remplacer. Dans le JSON, le nom de cet ingrédient doit être EXACTEMENT "${proteineAssignee}".`
    : '';

  const eviterConsigne = proteinesAutresJours.length > 0 && !estPetitDej
    ? `\n**Protéines à ÉVITER** (déjà utilisées dans d'autres jours) :\n${proteinesAutresJours.map(p => `- ${p}`).join('\n')}`
    : '';

  const contraintes_petit_dej = estPetitDej ? `
## CONTRAINTES PETIT-DÉJEUNER
- Saveur SUCRÉE (fruits, céréales, miel${estSansLactose ? '' : ', yaourt'})
- PAS de recette salée, pas de légumes
- Maximum 5 ingrédients, temps ≤ 10 min
- Zéro cuisson longue (cru, blender, ou grille-pain max)
${estSansLactose ? '- Aucun produit laitier (lait végétal uniquement)' : ''}
` : '';

  const nbEtapes = estPetitDej ? (Math.floor(Math.random() * 3) + 3) : (Math.floor(Math.random() * 2) + 4);

  return `Tu es un chef nutritionniste expert. Crée une recette ORIGINALE.

## CONTRAINTES STRICTES

**Type de repas** : ${typeRepas}
**Style culinaire** : ${styleCulinaire}
**Régime** : ${regimes.join(', ') || 'Aucune restriction'}${proteineConsigne}${eviterConsigne}
**Allergènes à éviter** : ${allergenes.join(', ') || 'Aucun'}
**Temps max** : ${estPetitDej ? 15 : tempsMax} minutes
**Objectif** : ${objectif}
**Portions** : 2
${contraintes_petit_dej}
**EXACTEMENT ${nbEtapes} étapes** dans les instructions.

## FORMAT JSON STRICT (sans backticks, sans texte autour)

{
  "nom": "Nom créatif et original",
  "ingredients": [{"nom": "ingrédient", "quantite": 150, "unite": "g"}],
  "instructions": ["Étape 1", "Étape 2", "Étape 3"],
  "temps_preparation": ${estPetitDej ? 8 : 15},
  "temps_cuisson": ${estPetitDej ? 0 : 20},
  "portions": 2,
  "valeurs_nutritionnelles": {"calories": ${estPetitDej ? 350 : 450}, "proteines": ${estPetitDej ? 10 : 20}, "glucides": ${estPetitDej ? 45 : 50}, "lipides": ${estPetitDej ? 10 : 15}},
  "astuces": ["Astuce nutritionnelle liée à : ${symptomes.join(', ') || 'bien-être général'}"],
  "variantes": ["Variante 1"]
}`;
}

// ─── Appel Claude AI (une recette) ────────────────────────────────────────

async function genererRecetteIA(
  typeRepas: string,
  styleCulinaire: string,
  proteineAssignee: string | null,
  profil: any,
  symptomes: string[],
  proteinesAutresJours: string[]
): Promise<any | null> {

  if (!ANTHROPIC_API_KEY) return null;

  const prompt = construirePromptRecette(typeRepas, styleCulinaire, proteineAssignee, profil, symptomes, proteinesAutresJours);

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
        max_tokens: 1200,
        temperature: 0.85,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error(`[ERROR] Claude ${response.status}`);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let recetteJSON: any = null;
    const jsonBlock = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlock) { try { recetteJSON = JSON.parse(jsonBlock[1]); } catch (_) {} }
    if (!recetteJSON) {
      const jsonRaw = text.match(/\{[\s\S]*\}/);
      if (jsonRaw) { try { recetteJSON = JSON.parse(jsonRaw[0]); } catch (_) {} }
    }

    if (!recetteJSON?.nom || !Array.isArray(recetteJSON?.ingredients) || !Array.isArray(recetteJSON?.instructions)) {
      return null;
    }

    return {
      nom: recetteJSON.nom,
      type_repas: typeRepas,
      style_culinaire: styleCulinaire,
      ingredients: (recetteJSON.ingredients || []).map((ing: any) => ({
        nom: ing.nom || 'Ingrédient',
        quantite: ing.quantite || 0,
        unite: ing.unite || 'g',
      })),
      instructions: recetteJSON.instructions || [],
      temps_preparation: recetteJSON.temps_preparation ?? 15,
      temps_cuisson: recetteJSON.temps_cuisson ?? 0,
      portions: recetteJSON.portions || 2,
      valeurs_nutritionnelles: recetteJSON.valeurs_nutritionnelles,
      astuces: recetteJSON.astuces || [],
      variantes: recetteJSON.variantes || [],
      genere_par_llm: true,
    };

  } catch (error) {
    console.error('[ERROR] Exception Claude recette:', error);
    return null;
  }
}

// ─── Fallbacks recettes ────────────────────────────────────────────────────

function recetteFallback(typeRepas: string, proteineAssignee: string | null): any {
  if (typeRepas === 'petit-dejeuner') {
    return {
      nom: 'Bol Énergie du Matin',
      type_repas: 'petit-dejeuner',
      style_culinaire: 'maison',
      ingredients: [
        { nom: 'Flocons d\'avoine', quantite: 60, unite: 'g' },
        { nom: 'Lait végétal ou animal', quantite: 150, unite: 'ml' },
        { nom: 'Banane', quantite: 1, unite: 'pièce' },
        { nom: 'Miel', quantite: 10, unite: 'g' },
        { nom: 'Amandes effilées', quantite: 15, unite: 'g' },
      ],
      instructions: [
        'Verser les flocons d\'avoine dans un bol et couvrir avec le lait froid ou chaud.',
        'Laisser gonfler 3 minutes si vous utilisez du lait chaud, ou préparer la veille avec du lait froid pour un porridge overnight.',
        'Éplucher la banane et la couper en rondelles.',
        'Déposer les rondelles de banane sur les flocons d\'avoine gonflés.',
        'Arroser de miel et parsemer d\'amandes effilées.',
        'Déguster immédiatement pour profiter de la texture crémeuse.',
      ],
      temps_preparation: 5,
      temps_cuisson: 3,
      portions: 1,
      valeurs_nutritionnelles: { calories: 380, proteines: 10, glucides: 62, lipides: 9 },
      astuces: ['Les flocons d\'avoine à index glycémique bas libèrent l\'énergie progressivement pour tenir jusqu\'au déjeuner.'],
      variantes: ['Remplacez la banane par des fruits rouges surgelés décongelés la veille.'],
      genere_par_llm: false,
    };
  }

  // Déjeuner / Dîner avec protéine assignée
  const prot = proteineAssignee || 'Filet de poulet';
  const protLow = prot.toLowerCase();

  let instructions: string[];
  let ingredients: any[];
  let nom: string;
  let calories = 430;
  let proteines = 28;

  if (protLow.includes('maquereau') || protLow.includes('sardine') || protLow.includes('hareng')) {
    nom = `${prot} en papillote aux herbes`;
    ingredients = [
      { nom: prot, quantite: 160, unite: 'g' },
      { nom: 'Tomates cerises', quantite: 150, unite: 'g' },
      { nom: 'Courgette', quantite: 150, unite: 'g' },
      { nom: 'Citron', quantite: 1, unite: 'pièce' },
      { nom: 'Herbes de Provence', quantite: 5, unite: 'g' },
      { nom: 'Huile d\'olive', quantite: 15, unite: 'ml' },
    ];
    instructions = [
      'Préchauffer le four à 200 °C. Découper deux grandes feuilles de papier sulfurisé.',
      'Couper la courgette en fines rondelles et les tomates cerises en deux.',
      'Déposer les légumes au centre de chaque feuille, arroser d\'un filet d\'huile d\'olive.',
      'Placer le poisson par-dessus, presser le demi-citron et parsemer d\'herbes de Provence.',
      'Refermer hermétiquement les papillotes en repliant les bords et enfourner 18 minutes.',
      'Ouvrir délicatement à la sortie du four (attention à la vapeur) et servir directement dans la papillote.',
    ];
    calories = 380; proteines = 26;
  } else if (protLow.includes('saumon') || protLow.includes('truite') || protLow.includes('cabillaud') || protLow.includes('dorade') || protLow.includes('bar') || protLow.includes('daurade')) {
    nom = `${prot} poêlé au citron et câpres`;
    ingredients = [
      { nom: prot, quantite: 160, unite: 'g' },
      { nom: 'Haricots verts', quantite: 180, unite: 'g' },
      { nom: 'Citron', quantite: 1, unite: 'pièce' },
      { nom: 'Câpres', quantite: 10, unite: 'g' },
      { nom: 'Beurre ou huile d\'olive', quantite: 10, unite: 'g' },
      { nom: 'Sel, poivre', quantite: 2, unite: 'g' },
    ];
    instructions = [
      'Sortir le poisson du réfrigérateur 10 minutes avant la cuisson pour une cuisson homogène.',
      'Faire bouillir de l\'eau salée et cuire les haricots verts 6 à 7 minutes. Égoutter et réserver au chaud.',
      'Chauffer une poêle antiadhésive à feu vif avec le beurre ou l\'huile d\'olive.',
      'Saler et poivrer le poisson côté peau. Déposer côté peau dans la poêle chaude et cuire 4 minutes sans y toucher.',
      'Retourner délicatement et cuire encore 2 à 3 minutes selon l\'épaisseur. Ajouter les câpres et presser le citron.',
      'Servir le poisson sur les haricots verts, napper du jus de cuisson citronnée.',
    ];
    calories = 400; proteines = 30;
  } else if (protLow.includes('poulet') || protLow.includes('dinde')) {
    nom = `${prot} rôti aux légumes du soleil`;
    ingredients = [
      { nom: prot, quantite: 160, unite: 'g' },
      { nom: 'Poivron rouge', quantite: 120, unite: 'g' },
      { nom: 'Courgette', quantite: 120, unite: 'g' },
      { nom: 'Oignon rouge', quantite: 80, unite: 'g' },
      { nom: 'Ail', quantite: 2, unite: 'gousses' },
      { nom: 'Huile d\'olive', quantite: 15, unite: 'ml' },
      { nom: 'Paprika, thym', quantite: 3, unite: 'g' },
    ];
    instructions = [
      'Préchauffer le four à 200 °C. Couper le poivron, la courgette et l\'oignon en morceaux de 3 cm.',
      'Écraser les gousses d\'ail sans les éplucher. Déposer tous les légumes dans un plat allant au four.',
      'Arroser d\'huile d\'olive, saupoudrer de paprika et thym, saler et poivrer. Mélanger pour enrober.',
      'Déposer le poulet ou la dinde par-dessus les légumes. Badigeonner avec un peu d\'huile et d\'épices.',
      'Enfourner 25 à 30 minutes jusqu\'à ce que la viande soit dorée et les légumes légèrement caramélisés.',
      'Laisser reposer 3 minutes avant de découper et servir avec les légumes confits.',
    ];
    calories = 440; proteines = 34;
  } else if (protLow.includes('bœuf') || protLow.includes('boeuf') || protLow.includes('steak') || protLow.includes('veau')) {
    nom = `${prot} poêlé, purée de patate douce`;
    ingredients = [
      { nom: prot, quantite: 150, unite: 'g' },
      { nom: 'Patate douce', quantite: 200, unite: 'g' },
      { nom: 'Épinards frais', quantite: 100, unite: 'g' },
      { nom: 'Ail', quantite: 1, unite: 'gousse' },
      { nom: 'Huile d\'olive', quantite: 10, unite: 'ml' },
      { nom: 'Romarin, sel, poivre', quantite: 3, unite: 'g' },
    ];
    instructions = [
      'Éplucher la patate douce, la couper en cubes et la cuire à l\'eau bouillante salée 15 minutes.',
      'Égoutter et écraser à la fourchette avec un filet d\'huile d\'olive, saler et poivrer. Réserver au chaud.',
      'Sortir la viande du réfrigérateur 15 minutes avant. La saler et poivrer des deux côtés.',
      'Chauffer une poêle à feu très vif. Cuire la viande 2 à 3 minutes de chaque côté selon l\'épaisseur pour une cuisson rosée.',
      'Dans la même poêle, faire revenir l\'ail écrasé 30 secondes puis ajouter les épinards. Faire tomber 2 minutes à feu moyen.',
      'Servir la viande tranchée sur la purée de patate douce, accompagnée des épinards à l\'ail.',
    ];
    calories = 480; proteines = 36;
  } else if (protLow.includes('lentille') || protLow.includes('pois chiche') || protLow.includes('haricot') || protLow.includes('tofu') || protLow.includes('tempeh')) {
    nom = `${prot} mijotés aux épices douces`;
    ingredients = [
      { nom: prot, quantite: 180, unite: 'g' },
      { nom: 'Tomates concassées', quantite: 200, unite: 'g' },
      { nom: 'Oignon', quantite: 100, unite: 'g' },
      { nom: 'Carottes', quantite: 120, unite: 'g' },
      { nom: 'Cumin, curcuma, coriandre', quantite: 5, unite: 'g' },
      { nom: 'Huile d\'olive', quantite: 10, unite: 'ml' },
    ];
    instructions = [
      'Émincer l\'oignon et couper les carottes en rondelles fines. Faire revenir dans l\'huile d\'olive à feu moyen 5 minutes.',
      'Ajouter le cumin, le curcuma et la coriandre moulus. Faire revenir 1 minute pour libérer les arômes.',
      'Incorporer les tomates concassées et mélanger. Laisser réduire 5 minutes à feu moyen.',
      'Ajouter la protéine (lentilles rincées, pois chiches égouttés ou tofu en dés). Mélanger délicatement.',
      'Couvrir et laisser mijoter 15 à 20 minutes à feu doux en remuant de temps en temps.',
      'Rectifier l\'assaisonnement, parsemer de coriandre fraîche si disponible et servir.',
    ];
    calories = 390; proteines = 20;
  } else if (protLow.includes('œuf') || protLow.includes('oeuf')) {
    nom = 'Omelette aux légumes et fromage de chèvre';
    ingredients = [
      { nom: 'Œufs', quantite: 3, unite: 'pièces' },
      { nom: 'Fromage de chèvre frais', quantite: 40, unite: 'g' },
      { nom: 'Tomates cerises', quantite: 100, unite: 'g' },
      { nom: 'Épinards frais', quantite: 80, unite: 'g' },
      { nom: 'Huile d\'olive', quantite: 5, unite: 'ml' },
      { nom: 'Sel, poivre, ciboulette', quantite: 3, unite: 'g' },
    ];
    instructions = [
      'Battre les œufs énergiquement avec une pincée de sel et de poivre jusqu\'à obtenir un mélange homogène et légèrement mousseux.',
      'Couper les tomates cerises en deux. Faire tomber les épinards dans la poêle chaude 1 minute puis réserver.',
      'Essuyer la poêle, ajouter l\'huile d\'olive à feu moyen-vif.',
      'Verser les œufs battus. Laisser coaguler 30 secondes sur les bords, puis rabattre délicatement vers le centre avec une spatule.',
      'Quand l\'omelette est encore baveuse au centre, répartir les épinards, les tomates et le fromage de chèvre émietté sur la moitié.',
      'Plier l\'omelette en deux, glisser dans l\'assiette et parsemer de ciboulette ciselée. Servir immédiatement.',
    ];
    calories = 350; proteines = 24;
  } else {
    // Protéine générique ou inconnue
    nom = `${prot} poêlé aux légumes de saison`;
    ingredients = [
      { nom: prot, quantite: 150, unite: 'g' },
      { nom: 'Légumes de saison variés', quantite: 250, unite: 'g' },
      { nom: 'Oignon', quantite: 80, unite: 'g' },
      { nom: 'Ail', quantite: 2, unite: 'gousses' },
      { nom: 'Huile d\'olive', quantite: 15, unite: 'ml' },
      { nom: 'Herbes fraîches, sel, poivre', quantite: 5, unite: 'g' },
    ];
    instructions = [
      'Préparer et couper les légumes en morceaux réguliers (2 à 3 cm). Émincer l\'oignon et écraser l\'ail.',
      'Chauffer l\'huile d\'olive dans une grande poêle ou wok à feu vif.',
      'Faire revenir l\'oignon et l\'ail 2 minutes jusqu\'à ce qu\'ils soient translucides et dorés.',
      'Ajouter les légumes les plus durs en premier (carottes, brocoli), puis les plus tendres après 3 minutes.',
      'Incorporer la protéine préparée (coupée en dés ou en tranches selon sa nature). Saler, poivrer et mélanger.',
      'Cuire encore 5 à 8 minutes à feu moyen en remuant régulièrement. Parsemer d\'herbes fraîches et servir.',
    ];
  }

  return {
    nom,
    type_repas: typeRepas,
    style_culinaire: 'maison',
    ingredients,
    instructions,
    temps_preparation: 10,
    temps_cuisson: 20,
    portions: 2,
    valeurs_nutritionnelles: { calories, proteines, glucides: 40, lipides: 14 },
    astuces: ['Choisissez des légumes de saison pour plus de nutriments et de saveur.'],
    variantes: ['Adaptez les épices selon vos goûts et les légumes selon la saison.'],
    genere_par_llm: false,
  };
}

// ─── Chargement aliments depuis BDD ───────────────────────────────────────

async function chargerAliments(supabase: any, besoins: string[], profilNorm: any): Promise<any[]> {
  const besoinsActifs = besoins.length > 0
    ? besoins
    : ['vitalite', 'serenite', 'sommeil', 'digestion', 'mobilite', 'hormones'];

  const { data, error } = await supabase
    .from('alimentation_besoins')
    .select('besoin_id, score, alimentation(*)')
    .in('besoin_id', besoinsActifs);

  if (error || !data?.length) {
    console.warn('[WARN] alimentation_besoins vide:', error?.message);
    return [];
  }

  // Déduplication par nom normalisé
  const alimentMap = new Map<string, any>();
  for (const row of data as any[]) {
    const a = row.alimentation;
    if (!a) continue;
    const nomKey = (a.nom || '').toLowerCase().trim();
    const existing = alimentMap.get(nomKey);
    if (!existing || (existing.besoin_score || 0) < (row.score || 0)) {
      alimentMap.set(nomKey, { ...a, besoin_score: row.score || 1 });
    }
  }

  let aliments = Array.from(alimentMap.values());

  // Filtrer selon régime
  if (profilNorm.estVegan) {
    aliments = aliments.filter(a => !estCategorieAnimale(a.categorie || ''));
  } else if (profilNorm.estVegetarien) {
    aliments = aliments.filter(a => !estViandePoissonCrustace(a.categorie || ''));
  }

  if (profilNorm.estSansLactose) {
    aliments = aliments.filter(a => {
      const cat = (a.categorie || '').toLowerCase();
      const nom = (a.nom || '').toLowerCase();
      return !cat.includes('laitier') && !cat.includes('fromage') && !cat.includes('yaourt')
        && !nom.includes('yaourt') && !nom.includes('fromage') && !nom.includes('ricotta');
    });
  }

  return aliments;
}

function estCategorieAnimale(cat: string): boolean {
  const c = cat.toLowerCase();
  return ['viande', 'volaille', 'poisson', 'fruits de mer', 'crustacé', 'mollusque',
    'abats', 'gibier', 'œuf', 'oeuf', 'produit laitier', 'fromage', 'laitier'].some(m => c.includes(m));
}

function estViandePoissonCrustace(cat: string): boolean {
  const c = cat.toLowerCase();
  return ['viande', 'volaille', 'poisson', 'fruits de mer', 'crustacé', 'mollusque', 'abats', 'gibier'].some(m => c.includes(m));
}

function estPoisson(nom: string): boolean {
  const n = nom.toLowerCase();
  return ['saumon', 'maquereau', 'sardine', 'thon', 'truite', 'cabillaud', 'dorade', 'flétan', 'bar', 'sole'].some(p => n.includes(p));
}

// ─── Sélection nutraceutiques, aromathérapie, routines ────────────────────

async function chargerWellness(supabase: any, besoins: string[], profil: any): Promise<{
  nutraceutiques: any[], aromatherapie: any[], routines: any[]
}> {
  const besoinsActifs = besoins.length > 0
    ? besoins
    : ['vitalite', 'serenite', 'sommeil', 'digestion', 'mobilite', 'hormones'];

  const [resNutra, resAro, resRoutines] = await Promise.all([
    supabase.from('nutraceutiques_besoins').select('besoin_id, score, nutraceutiques(*)').in('besoin_id', besoinsActifs),
    supabase.from('aromatherapie_besoins').select('besoin_id, score, aromatherapie(*)').in('besoin_id', besoinsActifs),
    supabase.from('routines_besoins').select('besoin_id, score, routines(*)').in('besoin_id', besoinsActifs),
  ]);

  // Dédupliquer et scorer
  function deduper(rows: any[], key: string) {
    const map = new Map<string, any>();
    for (const row of rows || []) {
      const p = row[key];
      if (!p) continue;
      const existing = map.get(p.id);
      if (!existing || (existing.besoin_score || 0) < (row.score || 0)) {
        map.set(p.id, { ...p, besoin_score: row.score || 1 });
      }
    }
    return Array.from(map.values());
  }

  const nutraceutiques = deduper(resNutra.data || [], 'nutraceutiques')
    .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
    .slice(0, 1);

  const aromatherapie = deduper(resAro.data || [], 'aromatherapie')
    .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
    .slice(0, 1);

  const routines = deduper(resRoutines.data || [], 'routines')
    .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
    .slice(0, 1);

  // Si la BDD ne retourne rien, générer via LLM
  if (!nutraceutiques.length && !aromatherapie.length && !routines.length) {
    return await genererWellnessLLM(besoins);
  }

  return { nutraceutiques, aromatherapie, routines };
}

// ─── Génération message motivation + conseil ───────────────────────────────

async function genererMotivation(symptomes: string[]): Promise<{ message: string; conseil: string }> {
  const fallbackMessage = 'Votre plan de la semaine est prêt ! Chaque jour est une nouvelle opportunité de prendre soin de vous.';
  const fallbackConseil = 'Une alimentation colorée et variée est la base d\'une bonne santé — chaque couleur apporte des nutriments uniques.';

  if (!ANTHROPIC_API_KEY) return { message: fallbackMessage, conseil: fallbackConseil };

  try {
    const prompt = `En 2 phrases courtes et bienveillantes, donne :
1. Un message de motivation pour suivre un plan alimentaire hebdomadaire axé sur : ${symptomes.join(', ') || 'bien-être général'}
2. Un fait scientifique surprenant sur la nutrition lié à ces besoins

Format : JSON strict {"message": "...", "conseil": "..."}`;

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 250, temperature: 0.9, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!response.ok) return { message: fallbackMessage, conseil: fallbackConseil };

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        message: parsed.message || fallbackMessage,
        conseil: parsed.conseil || fallbackConseil,
      };
    }
  } catch (_) {}

  return { message: fallbackMessage, conseil: fallbackConseil };
}

// ─── Génération wellness via LLM (fallback si DB vide) ────────────────────

async function genererWellnessLLM(symptomes: string[]): Promise<{
  nutraceutiques: any[], aromatherapie: any[], routines: any[]
}> {
  const objectifLabel = symptomes.length > 0 ? symptomes.join(', ') : 'bien-être général';

  const prompt = `Tu es un expert en nutrition et bien-être. Pour un plan alimentaire hebdomadaire axé sur : ${objectifLabel}

Génère en JSON strict (sans backticks) :
{
  "nutraceutique": {
    "nom": "Nom du complément alimentaire",
    "description": "Description des bienfaits en 2-3 phrases",
    "dosage": "ex: 500mg par jour",
    "moment_optimal": "ex: Le matin à jeun",
    "conseil": "Astuce pratique courte"
  },
  "aromatherapie": {
    "nom": "Nom de l'huile essentielle ou du soin",
    "description": "Description des bienfaits en 2 phrases",
    "utilisation": "Mode d'utilisation précis",
    "conseil": "Précaution ou astuce"
  },
  "routine": {
    "nom": "Nom de la routine bien-être",
    "description": "Description de la routine en 2-3 phrases",
    "duree": "ex: 10 minutes",
    "moment_optimal": "ex: Le soir avant le coucher",
    "frequence": "ex: Quotidienne"
  }
}`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 600, temperature: 0.8, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!response.ok) throw new Error('LLM wellness failed');

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      nutraceutiques: parsed.nutraceutique ? [parsed.nutraceutique] : [],
      aromatherapie:  parsed.aromatherapie  ? [parsed.aromatherapie]  : [],
      routines:       parsed.routine        ? [parsed.routine]        : [],
    };
  } catch (_) {
    // Fallback statique minimal
    const fallbacks: Record<string, { nutraceutique: any, aromatherapie: any, routine: any }> = {
      vitalite: {
        nutraceutique: { nom: 'Vitamine B12', description: 'Essentielle au métabolisme énergétique et à la formation des globules rouges. Réduit la fatigue persistante.', dosage: '1000 µg/jour', moment_optimal: 'Le matin au petit-déjeuner', conseil: 'Optez pour une forme méthylcobalamine pour une meilleure assimilation.' },
        aromatherapie:  { nom: 'Huile essentielle de menthe poivrée', description: 'Stimulante et énergisante, elle combat la fatigue mentale et physique.', utilisation: '2 gouttes sur les poignets, à inhaler le matin.', conseil: 'Ne pas utiliser le soir, peut perturber le sommeil.' },
        routine:        { nom: 'Marche énergisante matinale', description: 'Une marche rapide de 20 minutes le matin booste la sérotonine et l\'énergie pour toute la journée.', duree: '20 minutes', moment_optimal: 'Le matin au réveil', frequence: 'Quotidienne' },
      },
      serenite: {
        nutraceutique: { nom: 'Magnésium bisglycinate', description: 'Le magnésium régule le système nerveux et réduit le stress et l\'anxiété. La forme bisglycinate est la mieux tolérée.', dosage: '300 mg/jour', moment_optimal: 'Le soir au dîner', conseil: 'À prendre avec un repas pour éviter les effets digestifs.' },
        aromatherapie:  { nom: 'Huile essentielle de lavande vraie', description: 'Reconnue pour ses propriétés apaisantes et anxiolytiques. Favorise la détente profonde.', utilisation: '3 gouttes en diffusion 20 minutes le soir, ou 1 goutte sur les tempes.', conseil: 'La lavande vraie est la plus douce, safe pour un usage quotidien.' },
        routine:        { nom: 'Respiration 4-7-8 anti-stress', description: 'Cette technique de cohérence cardiaque active le système nerveux parasympathique pour une détente immédiate.', duree: '5 minutes', moment_optimal: 'En cas de stress ou le soir', frequence: '2 fois par jour' },
      },
      sommeil: {
        nutraceutique: { nom: 'Mélatonine + Valériane', description: 'La mélatonine régule le cycle circadien tandis que la valériane améliore la qualité du sommeil profond.', dosage: '0,5 mg mélatonine + 300 mg valériane', moment_optimal: '30 minutes avant le coucher', conseil: 'Commencez par la dose minimale de mélatonine efficace.' },
        aromatherapie:  { nom: 'Huile essentielle de camomille romaine', description: 'Puissant sédatif naturel qui favorise l\'endormissement et réduit les réveils nocturnes.', utilisation: '2 gouttes sur l\'oreiller ou en diffusion 15 minutes avant le coucher.', conseil: 'Associer avec la lavande pour un effet renforcé.' },
        routine:        { nom: 'Rituel de déconnexion numérique', description: 'Éteindre tous les écrans 1h avant de dormir et lire ou méditer pour préparer le cerveau au sommeil.', duree: '60 minutes', moment_optimal: '1h avant le coucher', frequence: 'Quotidienne' },
      },
      digestion: {
        nutraceutique: { nom: 'Probiotiques Lactobacillus', description: 'Les probiotiques rééquilibrent le microbiome intestinal, réduisent les ballonnements et améliorent le transit.', dosage: '10 milliards UFC/jour', moment_optimal: 'Le matin à jeun', conseil: 'Conservez au réfrigérateur pour préserver les bactéries vivantes.' },
        aromatherapie:  { nom: 'Huile essentielle de basilic tropical', description: 'Spasmolytique puissant, elle soulage les crampes abdominales, les ballonnements et les spasmes digestifs.', utilisation: '2 gouttes dans une huile végétale, masser le ventre dans le sens des aiguilles d\'une montre.', conseil: 'Diluer à 10% dans une huile de noisette ou d\'amande douce.' },
        routine:        { nom: 'Yoga digestif du matin', description: 'Quelques postures spécifiques (torsions, position du chat-vache) activent le péristaltisme et soulagent les inconforts digestifs.', duree: '10 minutes', moment_optimal: 'Le matin à jeun', frequence: 'Quotidienne' },
      },
      mobilite: {
        nutraceutique: { nom: 'Oméga-3 EPA/DHA', description: 'Les acides gras oméga-3 réduisent l\'inflammation articulaire et améliorent la souplesse. Essentiels pour la santé des articulations.', dosage: '2 g EPA+DHA/jour', moment_optimal: 'Avec les repas principaux', conseil: 'Choisissez une source certifiée sans métaux lourds (EPAX, MEG-3).' },
        aromatherapie:  { nom: 'Huile essentielle de gaulthérie', description: 'Riche en salicylate de méthyle, elle soulage les douleurs musculaires et articulaires comme un anti-inflammatoire naturel.', utilisation: 'Diluer à 5% dans une huile végétale et masser les zones douloureuses.', conseil: 'Ne pas utiliser en cas d\'allergie à l\'aspirine.' },
        routine:        { nom: 'Stretching articulaire quotidien', description: 'Une séance de mobilité douce préserve la santé articulaire, améliore la souplesse et réduit les raideurs.', duree: '15 minutes', moment_optimal: 'Le matin ou après l\'effort', frequence: 'Quotidienne' },
      },
      hormones: {
        nutraceutique: { nom: 'Vitex Agnus Castus', description: 'Régule les hormones féminines, réduit les symptômes prémenstruels et contribue à l\'équilibre hormonal naturel.', dosage: '400 mg/jour', moment_optimal: 'Le matin', conseil: 'Prendre en cure de 3 mois minimum pour observer les effets.' },
        aromatherapie:  { nom: 'Huile essentielle de sauge sclarée', description: 'Phytœstrogène naturel qui rééquilibre les hormones féminines et atténue les bouffées de chaleur.', utilisation: '2 gouttes diluées dans une huile végétale, appliquer sur le bas-ventre.', conseil: 'Déconseillé pendant la grossesse et l\'allaitement.' },
        routine:        { nom: 'Marche méditative en nature', description: 'L\'exercice modéré régule le cortisol et les hormones sexuelles. La nature amplifie l\'effet anti-stress.', duree: '30 minutes', moment_optimal: 'En fin d\'après-midi', frequence: '5 fois par semaine' },
      },
    };

    const key = symptomes[0] || 'vitalite';
    const fb = fallbacks[key] || fallbacks['vitalite'];
    return {
      nutraceutiques: [fb.nutraceutique],
      aromatherapie:  [fb.aromatherapie],
      routines:       [fb.routine],
    };
  }
}

// ─── Handler principal ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { profil_id, symptomes } = body;

    if (!profil_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'profil_id requis' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const symptomesArr: string[] = Array.isArray(symptomes) ? symptomes : [];

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Charger le profil
    const { data: profils } = await supabase
      .from('profils_utilisateurs')
      .select('*')
      .eq('id', profil_id)
      .limit(1);

    const profil = profils?.[0] || {};

    const profilNorm = {
      regime_alimentaire: profil.regimes_alimentaires || profil.regime_alimentaire || [],
      allergenes: profil.allergies || profil.allergenes || [],
      temps_preparation: profil.temps_cuisine_max || profil.temps_preparation || 45,
      estVegan: (profil.regimes_alimentaires || profil.regime_alimentaire || []).some((r: string) =>
        ['vegan', 'végétalien'].includes(r.toLowerCase())),
      estVegetarien: (profil.regimes_alimentaires || profil.regime_alimentaire || []).some((r: string) =>
        ['vegetarien', 'végétarien'].includes(r.toLowerCase())),
      estSansLactose: (profil.allergies || profil.allergenes || []).includes('lactose') ||
        (profil.regimes_alimentaires || profil.regime_alimentaire || []).some((r: string) =>
          ['sans_lactose', 'sans-lactose'].includes(r.toLowerCase())),
      contraintesRegime: [] as string[],
    };

    // Construire les contraintes textuelles
    if (profilNorm.estVegan) profilNorm.contraintesRegime.push('100% VEGANE');
    else if (profilNorm.estVegetarien) profilNorm.contraintesRegime.push('VÉGÉTARIENNE');
    if (profilNorm.estSansLactose) profilNorm.contraintesRegime.push('SANS LACTOSE');
    if ((profil.allergies || []).includes('gluten') || (profil.regimes_alimentaires || []).includes('sans-gluten'))
      profilNorm.contraintesRegime.push('SANS GLUTEN');

    console.log(`[generer-plan-semaine] profil=${profil_id}, symptomes=${symptomesArr.join(',')}`);

    // Charger les aliments
    const aliments = await chargerAliments(supabase, symptomesArr, profilNorm);

    // Sélectionner les protéines disponibles
    let proteinesDisponibles: string[] = [];
    if (!profilNorm.estVegan && !profilNorm.estVegetarien) {
      const proteinesAnimales = aliments
        .filter(a => estViandePoissonCrustace(a.categorie || ''))
        .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
        .map(a => a.nom);
      proteinesDisponibles = proteinesAnimales;
    } else {
      // Pour végétariens/vegans : légumineuses, œufs (végétarien), tofu, tempeh
      proteinesDisponibles = aliments
        .filter(a => {
          const cat = (a.categorie || '').toLowerCase();
          return cat.includes('légumineus') || cat.includes('legumineus') ||
            cat.includes('tofu') || cat.includes('tempeh') || cat.includes('soja');
        })
        .map(a => a.nom);
    }

    // Déduplication des protéines
    const proteinesUniques = [...new Set(proteinesDisponibles)];

    // Si pas assez de protéines en BDD, utiliser des valeurs par défaut
    const proteinesPool = proteinesUniques.length >= 7
      ? shuffleArray(proteinesUniques)
      : shuffleArray([...proteinesUniques, 'Poulet', 'Saumon', 'Boeuf', 'Thon', 'Crevettes', 'Dinde', 'Maquereau'].filter((v, i, a) => a.indexOf(v) === i));

    // Assigner 2 protéines par jour (déjeuner + dîner) sans répétition
    // On s'assure que poisson ≠ poisson dans le même jour
    const pairesProteines: [string, string][] = [];
    const proteinesShuffled = shuffleArray(proteinesPool);
    let idx = 0;
    for (let j = 0; j < 7; j++) {
      const prot1 = proteinesShuffled[idx % proteinesShuffled.length];
      idx++;
      let prot2 = proteinesShuffled[idx % proteinesShuffled.length];
      // Éviter 2 poissons le même jour
      if (estPoisson(prot1) && estPoisson(prot2)) {
        const nonPoissons = proteinesShuffled.filter(p => !estPoisson(p));
        prot2 = nonPoissons.length > 0 ? nonPoissons[idx % nonPoissons.length] : prot2;
      }
      idx++;
      pairesProteines.push([prot1, prot2]);
    }

    // 7 styles culinaires différents (shufflé)
    const stylesJours = shuffleArray([...STYLES_CULINAIRES]).slice(0, 7);

    // Charger les données wellness
    const wellness = await chargerWellness(supabase, symptomesArr, profilNorm);

    // Générer les recettes par batch de 4 pour éviter les rate limits Claude
    // 7 jours × 3 repas = 21 appels → batches de 4 avec 400ms entre chaque
    console.log('[generer-plan-semaine] Génération 21 recettes en batches...');

    type RecetteThunk = () => Promise<any>;
    const recettesThunks: RecetteThunk[] = [];

    for (let j = 0; j < 7; j++) {
      const style = stylesJours[j];
      const [protDej, protDin] = pairesProteines[j];
      const autresProteines = pairesProteines
        .filter((_, k) => k !== j)
        .flatMap(([a, b]) => [a, b]);

      recettesThunks.push(() =>
        genererRecetteIA('petit-dejeuner', style, null, profilNorm, symptomesArr, [])
          .then(r => r || recetteFallback('petit-dejeuner', null))
      );
      recettesThunks.push(() =>
        genererRecetteIA('dejeuner', style, protDej, profilNorm, symptomesArr, autresProteines)
          .then(r => r || recetteFallback('dejeuner', protDej))
      );
      recettesThunks.push(() =>
        genererRecetteIA('diner', style, protDin, profilNorm, symptomesArr, autresProteines)
          .then(r => r || recetteFallback('diner', protDin))
      );
    }

    const BATCH_SIZE = 4;
    const BATCH_DELAY_MS = 400;
    const recettesResultats: any[] = [];
    for (let b = 0; b < recettesThunks.length; b += BATCH_SIZE) {
      if (b > 0) await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
      const batch = recettesThunks.slice(b, b + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(fn => fn()));
      recettesResultats.push(...batchResults);
    }

    // Motivation + conseil en parallèle
    const motivationPromise = genererMotivation(symptomesArr);

    // Construire la structure semaine
    const semaine: Record<string, any> = {};
    for (let j = 0; j < 7; j++) {
      const jour = JOURS_SEMAINE[j];
      const offset = j * 3;
      semaine[jour] = {
        petit_dejeuner: recettesResultats[offset],
        dejeuner: recettesResultats[offset + 1],
        diner: recettesResultats[offset + 2],
        pause: collationParDefaut(profilNorm),
      };
    }

    const { message: messageMotivation, conseil: conseilDuJour } = await motivationPromise;

    console.log('[generer-plan-semaine] ✅ Plan semaine généré avec succès');

    return new Response(
      JSON.stringify({
        success: true,
        semaine,
        nutraceutiques: wellness.nutraceutiques,
        aromatherapie: wellness.aromatherapie,
        routines: wellness.routines,
        message_motivation: messageMotivation,
        conseil_du_jour: conseilDuJour,
      }),
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
