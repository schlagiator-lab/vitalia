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

// ─── Fallback recette par défaut ───────────────────────────────────────────

function recetteFallback(typeRepas: string, ingredientsFrigo: string[]) {
  const principaux = ingredientsFrigo.length > 0
    ? ingredientsFrigo.slice(0, 3)
    : ['légumes de saison'];

  return {
    nom: 'Recette Simple & Équilibrée',
    type_repas: typeRepas,
    style_culinaire: 'maison',
    ingredients: principaux.map((i: string) => ({ nom: i, quantite: 150, unite: 'g' })),
    instructions: [
      'Préparer les ingrédients.',
      'Cuisiner selon votre méthode préférée.',
      'Assaisonner et déguster !',
    ],
    temps_preparation: 10,
    temps_cuisson: 15,
    portions: 2,
    valeurs_nutritionnelles: { calories: 400, proteines: 15, glucides: 45, lipides: 12 },
    astuces: ['Ajoutez une herbe fraîche pour plus de saveur.'],
    variantes: ['Remplacez par des légumes de saison.'],
    genere_par_llm: false,
  };
}

// ─── Construction du prompt ────────────────────────────────────────────────

function construirePrompt(
  typeRepas: string,
  ingredientsFrigo: string[],
  symptomes: string[],
  profil: any
): string {

  const estPetitDej = typeRepas === 'petit-dejeuner' || typeRepas === 'collation';

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
    : 'Équilibrée et nutritive';

  const tempsMax = profil.temps_preparation || 45;
  const allergenes = profil.allergenes || [];

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

  return `Tu es un chef nutritionniste expert. Crée une recette ORIGINALE et CREATIVE.

## CONTRAINTES STRICTES

**Type de repas** : ${typeRepas}
**Régime** : ${regimes.join(', ') || 'Aucune restriction'}
**Allergènes à éviter** : ${allergenes.join(', ') || 'Aucun'}
**Temps max** : ${estPetitDej ? 15 : tempsMax} minutes
**Objectif nutritionnel** : ${objectif}
**Portions** : 2 personnes

${frigoSection}
${contraintesPetitDej}
${contraintesCollation}

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

// ─── Appel Claude AI ───────────────────────────────────────────────────────

async function genererRecetteIA(
  typeRepas: string,
  ingredientsFrigo: string[],
  symptomes: string[],
  profil: any
): Promise<any | null> {

  if (!ANTHROPIC_API_KEY) {
    console.error('[ERROR] ANTHROPIC_API_KEY manquante');
    return null;
  }

  const prompt = construirePrompt(typeRepas, ingredientsFrigo, symptomes, profil);

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
    const { profil_id, type_repas, ingredients_frigo, symptomes } = body;

    if (!profil_id || !type_repas) {
      return new Response(
        JSON.stringify({ success: false, error: 'profil_id et type_repas requis' }),
        { status: 400, headers: CORS_HEADERS }
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
    };

    console.log(`[generer-recette-unique] type=${typeRepasNorm}, frigo=${ingredientsFrigo.length} ingrédients, symptomes=${symptomesArr.join(',')}`);

    // Générer la recette via Claude
    let recette = await genererRecetteIA(typeRepasNorm, ingredientsFrigo, symptomesArr, profilNorm);

    // Fallback si la génération échoue
    if (!recette) {
      console.warn('[WARN] Fallback recette par défaut');
      recette = recetteFallback(typeRepasNorm, ingredientsFrigo);
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
