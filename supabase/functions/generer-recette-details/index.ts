// supabase/functions/generer-recette-details/index.ts
// Lazy loading des instructions d'une recette générée en batch.
// Appelée depuis le frontend quand l'utilisateur tape sur une recette.
// Input  : { recette_nom, ingredients, type_repas, macros, profil, symptomes }
// Output : { instructions, astuces, message_motivant }
// Modèle : Haiku (rapide + économique — instructions simples)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

// ─── Tool structuré pour garantir le JSON ─────────────────────────────────

const DETAILS_TOOL = {
  name: 'detailler_recette',
  description: 'Génère les instructions étape par étape et les astuces d\'une recette',
  input_schema: {
    type: 'object',
    properties: {
      instructions: {
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 7,
        description: 'Étapes de préparation précises et actionnables'
      },
      astuces: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 2,
        description: 'Astuces nutritionnelles ou culinaires liées aux symptômes'
      },
      message_motivant: {
        type: 'string',
        description: 'Une phrase courte et bienveillante pour encourager à cuisiner ce plat'
      }
    },
    required: ['instructions', 'astuces', 'message_motivant']
  }
};

// ─── Fallbacks statiques par type de repas ─────────────────────────────────

function instructionsFallback(typeRepas: string, nom: string): {
  instructions: string[];
  astuces: string[];
  message_motivant: string;
} {
  if (typeRepas === 'petit-dejeuner') {
    return {
      instructions: [
        'Rassembler tous les ingrédients et les mesurer à l\'avance.',
        'Préparer le bol ou l\'assiette de service.',
        'Assembler les ingrédients dans l\'ordre indiqué.',
        'Servir immédiatement pour profiter de toutes les saveurs.',
      ],
      astuces: ['Un petit-déjeuner équilibré avec protéines et bons glucides stabilise la glycémie pour toute la matinée.'],
      message_motivant: 'Un bon début de journée commence dans l\'assiette !',
    };
  }
  return {
    instructions: [
      'Préparer et mesurer tous les ingrédients avant de commencer la cuisson.',
      'Chauffer une poêle ou une casserole à feu moyen avec un filet d\'huile d\'olive.',
      'Cuire les ingrédients les plus longs en premier, ajouter les plus fragiles en dernier.',
      'Assaisonner en cours de cuisson et rectifier avant de servir.',
      'Laisser reposer 2 minutes hors du feu avant de dresser.',
    ],
    astuces: ['Cuisiner à la vapeur ou poêlé préserve les nutriments essentiels.'],
    message_motivant: `${nom} — un plat fait maison pour prendre soin de vous.`,
  };
}

// ─── Construction du prompt ────────────────────────────────────────────────

function construirePrompt(
  nom: string,
  ingredients: any[],
  typeRepas: string,
  macros: any,
  symptomes: string[]
): string {
  const estPetitDej = typeRepas === 'petit-dejeuner';

  // Formater les ingrédients pour le prompt
  const listeIngredients = Array.isArray(ingredients)
    ? ingredients.map((ing: any) => {
        if (typeof ing === 'string') return `- ${ing}`;
        const q = ing.quantite ? `${ing.quantite}${ing.unite || 'g'}` : '';
        return `- ${q ? q + ' de ' : ''}${ing.nom}`;
      }).join('\n')
    : '- Ingrédients non disponibles';

  const objectifNutri: Record<string, string> = {
    vitalite: 'vitalité et énergie',
    serenite: 'gestion du stress et sérénité',
    digestion: 'digestion et microbiome',
    sommeil: 'qualité du sommeil',
    mobilite: 'mobilité et inflammation',
    hormones: 'équilibre hormonal',
  };
  const objectif = symptomes.map(s => objectifNutri[s] || s).join(', ') || 'bien-être général';

  const contraintesPetitDej = estPetitDej ? `
- Préparation SANS cuisson longue (cru, blender, ou toast max)
- Temps total ≤ 10 minutes
- EXACTEMENT 4 étapes dans les instructions` : `
- Temps de cuisson cohérent avec les ingrédients
- Préciser températures et durées
- EXACTEMENT 5 étapes dans les instructions`;

  const macrosTxt = macros
    ? `~${macros.calories || 0} kcal | ${macros.proteines || 0}g protéines | ${macros.glucides || 0}g glucides | ${macros.lipides || 0}g lipides`
    : 'Non disponibles';

  return `Tu es un chef cuisinier expert en nutrition. Génère les instructions de cuisine pour cette recette.

## RECETTE : "${nom}"
**Type** : ${typeRepas}
**Ingrédients** :
${listeIngredients}
**Valeurs nutritionnelles** : ${macrosTxt}
**Objectif santé** : ${objectif}

## CONTRAINTES${contraintesPetitDej}
- Instructions claires, actionnables, avec temps et températures précis
- Jamais de vague "cuire selon méthode" ou "ajuster selon goût"
- Astuces en lien direct avec : ${objectif}
- Message motivant court (max 15 mots)`;
}

// ─── Handler principal ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const { recette_nom, ingredients, type_repas, macros, symptomes } = body;

    if (!recette_nom || !type_repas) {
      return new Response(
        JSON.stringify({ success: false, error: 'recette_nom et type_repas requis' }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const symptomesArr: string[] = Array.isArray(symptomes) ? symptomes : [];

    if (!ANTHROPIC_API_KEY) {
      const fb = instructionsFallback(type_repas, recette_nom);
      return new Response(
        JSON.stringify({ success: true, ...fb, _source: 'fallback' }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    const prompt = construirePrompt(recette_nom, ingredients || [], type_repas, macros, symptomesArr);

    // 2 tentatives avec backoff
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 800,
          temperature: 0.7,
          tools: [DETAILS_TOOL],
          tool_choice: { type: 'tool', name: 'detailler_recette' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (response.status === 429 || response.status >= 500) {
        const waitMs = attempt === 0 ? 4000 : 8000;
        console.warn(`[generer-recette-details] HTTP ${response.status} — attente ${waitMs / 1000}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (!response.ok) {
        console.error(`[generer-recette-details] HTTP ${response.status}`);
        break;
      }

      const data = await response.json();
      const toolUse = data.content?.find((c: any) => c.type === 'tool_use');
      const result = toolUse?.input;

      if (
        !result ||
        !Array.isArray(result.instructions) ||
        result.instructions.length < 3 ||
        !Array.isArray(result.astuces)
      ) {
        console.error('[generer-recette-details] Réponse tool_use invalide');
        break;
      }

      console.log(`[generer-recette-details] Instructions générées pour "${recette_nom}" (${result.instructions.length} étapes)`);

      return new Response(
        JSON.stringify({
          success: true,
          instructions: result.instructions,
          astuces: result.astuces,
          message_motivant: result.message_motivant || '',
          _source: 'llm',
        }),
        { status: 200, headers: CORS_HEADERS }
      );
    }

    // Fallback si le LLM échoue
    const fb = instructionsFallback(type_repas, recette_nom);
    return new Response(
      JSON.stringify({ success: true, ...fb, _source: 'fallback' }),
      { status: 200, headers: CORS_HEADERS }
    );

  } catch (error: any) {
    console.error('[ERROR] generer-recette-details:', error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || 'Erreur inconnue' }),
      { status: 500, headers: CORS_HEADERS }
    );
  }
});
