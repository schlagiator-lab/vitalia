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
  const nom = proteineAssignee
    ? `${proteineAssignee} ${typeRepas === 'petit-dejeuner' ? 'du matin' : 'maison'}`
    : (typeRepas === 'petit-dejeuner' ? 'Bol de céréales' : 'Plat équilibré');
  const ingredients = proteineAssignee
    ? [{ nom: proteineAssignee, quantite: 150, unite: 'g' }, { nom: 'Légumes de saison', quantite: 200, unite: 'g' }]
    : [{ nom: 'Légumes', quantite: 250, unite: 'g' }, { nom: 'Légumineuses', quantite: 100, unite: 'g' }];
  return {
    nom,
    type_repas: typeRepas,
    style_culinaire: 'maison',
    ingredients,
    instructions: ['Préparer les ingrédients.', 'Cuisiner selon votre méthode.', 'Assaisonner et servir.'],
    temps_preparation: 10,
    temps_cuisson: 15,
    portions: 2,
    valeurs_nutritionnelles: { calories: 420, proteines: 18, glucides: 48, lipides: 12 },
    astuces: ['Choisissez des produits de saison pour plus de saveur.'],
    variantes: ['Adaptez les légumes selon votre goût.'],
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
    .slice(0, 3);

  const aromatherapie = deduper(resAro.data || [], 'aromatherapie')
    .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
    .slice(0, 2);

  const routines = deduper(resRoutines.data || [], 'routines')
    .sort((a: any, b: any) => (b.besoin_score || 0) - (a.besoin_score || 0))
    .slice(0, 3);

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

    // Générer toutes les recettes en parallèle (7 jours × 3 repas = 21 appels)
    console.log('[generer-plan-semaine] Génération 21 recettes en parallèle...');

    type RecettePromise = Promise<any>;
    const recettesPromises: RecettePromise[] = [];

    for (let j = 0; j < 7; j++) {
      const style = stylesJours[j];
      const [protDej, protDin] = pairesProteines[j];
      const autresProteines = pairesProteines
        .filter((_, k) => k !== j)
        .flatMap(([a, b]) => [a, b]);

      // Petit-déjeuner (pas de protéine assignée)
      recettesPromises.push(
        genererRecetteIA('petit-dejeuner', style, null, profilNorm, symptomesArr, [])
          .then(r => r || recetteFallback('petit-dejeuner', null))
      );

      // Déjeuner
      recettesPromises.push(
        genererRecetteIA('dejeuner', style, protDej, profilNorm, symptomesArr, autresProteines)
          .then(r => r || recetteFallback('dejeuner', protDej))
      );

      // Dîner
      recettesPromises.push(
        genererRecetteIA('diner', style, protDin, profilNorm, symptomesArr, autresProteines)
          .then(r => r || recetteFallback('diner', protDin))
      );
    }

    const recettesResultats = await Promise.all(recettesPromises);

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
