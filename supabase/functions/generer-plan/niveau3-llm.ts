// supabase/functions/generer-plan/niveau3-llm.ts

import { 
  RecetteGeneree, 
  Ingredient,
  ProfilUtilisateur,
  ContexteUtilisateur 
} from './types.ts';

/**
 * NIVEAU 3 : CRÉATIVITÉ & VARIÉTÉ (LLM)
 * Génération de recettes originales avec DeepSeek API
 */

const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY') || '';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';

// ============================================================================
// GÉNÉRATION RECETTE VIA LLM
// ============================================================================

export async function genererRecetteLLM(
  typeRepas: string,
  styleCulinaire: string,
  ingredientsObligatoires: string[],
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur
): Promise<RecetteGeneree | null> {
  
  console.log(`🎨 NIVEAU 3 : Génération recette LLM (${typeRepas}, ${styleCulinaire})...`);
  
  try {
    const prompt = construirePromptRecette(
      typeRepas,
      styleCulinaire,
      ingredientsObligatoires,
      profil,
      contexte
    );
    
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'Tu es un chef expert en nutrition bien-être et cuisine créative. Tu génères des recettes originales, savoureuses et équilibrées.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.8, // Créativité élevée
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });
    
    if (!response.ok) {
      console.error('Erreur API DeepSeek:', response.status);
      return null;
    }
    
    const data = await response.json();
    const recetteJSON = JSON.parse(data.choices[0].message.content);
    
    // Validation & transformation
    const recette: RecetteGeneree = {
      nom: recetteJSON.nom,
      type_repas: typeRepas,
      style_culinaire: styleCulinaire,
      ingredients: recetteJSON.ingredients.map((ing: any) => ({
        nom: ing.nom,
        quantite: ing.quantite,
        unite: ing.unite
      })),
      instructions: recetteJSON.instructions,
      temps_preparation: recetteJSON.temps_preparation || 15,
      temps_cuisson: recetteJSON.temps_cuisson || 20,
      portions: recetteJSON.portions || 2,
      valeurs_nutritionnelles: recetteJSON.valeurs_nutritionnelles,
      astuces: recetteJSON.astuces || [],
      variantes: recetteJSON.variantes || [],
      genere_par_llm: true
    };
    
    console.log(`🎨 Recette générée : ${recette.nom}`);
    
    return recette;
    
  } catch (error) {
    console.error('Erreur génération LLM:', error);
    return null;
  }
}

// ============================================================================
// CONSTRUCTION DU PROMPT
// ============================================================================

function construirePromptRecette(
  typeRepas: string,
  styleCulinaire: string,
  ingredientsObligatoires: string[],
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur
): string {
  
  // Contraintes régime alimentaire
  const contraintesRegime = [];
  if (profil.regime_alimentaire?.includes('vegan')) {
    contraintesRegime.push('100% VÉGANE (aucun produit animal)');
  } else if (profil.regime_alimentaire?.includes('vegetarien')) {
    contraintesRegime.push('VÉGÉTARIEN (pas de viande/poisson)');
  }
  
  if (profil.allergenes?.includes('gluten') || profil.regime_alimentaire?.includes('sans-gluten')) {
    contraintesRegime.push('SANS GLUTEN');
  }
  
  if (profil.allergenes?.includes('lactose')) {
    contraintesRegime.push('SANS LACTOSE');
  }
  
  if (profil.regime_alimentaire?.includes('paleo')) {
    contraintesRegime.push('PALÉO');
  }
  
  if (profil.regime_alimentaire?.includes('keto')) {
    contraintesRegime.push('KETO (faible en glucides)');
  }
  
  // Contraintes allergènes
  const allergenes = profil.allergenes || [];
  
  // Temps de préparation
  const tempsMax = profil.temps_preparation || 45;
  
  // Budget
  const budget = profil.budget === 'faible' 
    ? '5-8€/portion'
    : profil.budget === 'moyen'
    ? '8-12€/portion'
    : '12-20€/portion';
  
  // Objectif nutritionnel
  const objectifNutri = contexte.objectif_principal === 'energie'
    ? 'Riche en protéines et glucides complexes pour booster l\'énergie'
    : contexte.objectif_principal === 'digestion'
    ? 'Facile à digérer, riche en fibres et probiotiques'
    : contexte.objectif_principal === 'sommeil'
    ? 'Riche en tryptophane et magnésium pour favoriser le sommeil'
    : contexte.objectif_principal === 'immunite'
    ? 'Riche en vitamines C, D, zinc pour renforcer l\'immunité'
    : 'Équilibré et nutritif';
  
  const prompt = `
Tu es un chef expert en nutrition bien-être. Crée une recette ORIGINALE et CRÉATIVE.

## CONTRAINTES STRICTES (NON NÉGOCIABLES)

**Type de repas** : ${typeRepas}
**Style culinaire** : ${styleCulinaire}
**Régime alimentaire** : ${contraintesRegime.join(', ') || 'Aucune restriction'}
**Allergènes à ÉVITER ABSOLUMENT** : ${allergenes.join(', ') || 'Aucun'}

**Ingrédients OBLIGATOIRES à inclure** :
${ingredientsObligatoires.map(i => `- ${i}`).join('\n')}

**Temps max** : ${tempsMax} minutes (préparation + cuisson)
**Budget** : ${budget}
**Objectif nutritionnel** : ${objectifNutri}
**Portions** : 2

## RÈGLES CRÉATIVES

1. **Nom accrocheur** : Évite les noms génériques. Sois créatif !
   ❌ "Salade de quinoa"
   ✅ "Buddha Bowl Arc-en-Ciel Énergisant"

2. **Saveurs équilibrées** : Joue sur les textures (croquant, fondant, crémeux) et saveurs (sucré, salé, acidulé, umami)

3. **Astuces nutritionnelles** : Explique POURQUOI cette recette est bonne pour les symptômes : ${contexte.symptomes_declares?.join(', ') || 'bien-être général'}

4. **Instructions CLAIRES** : Pas à pas, précis, facile à suivre

5. **Variantes** : Propose 2-3 variations pour éviter la monotonie

## FORMAT DE SORTIE (JSON STRICT)

\`\`\`json
{
  "nom": "Nom créatif et accrocheur",
  "ingredients": [
    {
      "nom": "Nom ingrédient",
      "quantite": 150,
      "unite": "g"
    }
  ],
  "instructions": [
    "Étape 1 détaillée...",
    "Étape 2 détaillée..."
  ],
  "temps_preparation": 15,
  "temps_cuisson": 20,
  "portions": 2,
  "valeurs_nutritionnelles": {
    "calories": 450,
    "proteines": 18,
    "glucides": 55,
    "lipides": 12
  },
  "astuces": [
    "Astuce nutritionnelle 1",
    "Astuce de préparation 2"
  ],
  "variantes": [
    "Variante 1 : remplacer X par Y",
    "Variante 2 : ajouter Z"
  ]
}
\`\`\`

## TON

Bienveillant, encourageant, mais pas paternaliste. Explique simplement pourquoi c'est bon pour la santé.

**Génère MAINTENANT la recette en JSON pur (sans markdown) :**
`;
  
  return prompt;
}

// ============================================================================
// GÉNÉRATION MESSAGE DE MOTIVATION
// ============================================================================

export async function genererMessageMotivation(
  contexte: ContexteUtilisateur,
  planGenere: any
): Promise<string> {
  
  console.log('🎨 Génération message motivation...');
  
  try {
    const prompt = `
Tu es un coach en bien-être bienveillant. Génère un message de motivation COURT (2-3 phrases max) pour encourager l'utilisateur.

**Contexte** :
- Symptômes : ${contexte.symptomes_declares?.join(', ') || 'aucun'}
- Objectif : ${contexte.objectif_principal || 'bien-être général'}

**Ton** :
- Encourageant mais pas excessif
- Authentique et humain
- Évite les clichés type "Vous êtes sur la bonne voie !"

**Exemples de BON message** :
"Ce plan va nourrir ton corps avec ce dont il a besoin. Prends le temps de savourer chaque bouchée ! 🌟"

**Exemples de MAUVAIS message** :
"Félicitations ! Vous avez fait le premier pas vers une vie saine. Continuez comme ça !"

Génère UN message court et authentique (max 150 caractères) :
`;
    
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'Tu es un coach bien-être bienveillant qui génère des messages courts et authentiques.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.9,
        max_tokens: 150
      })
    });
    
    if (!response.ok) {
      return "Ce plan est fait pour toi ! Profite de chaque moment. 🌟";
    }
    
    const data = await response.json();
    const message = data.choices[0].message.content.trim();
    
    console.log(`🎨 Message : ${message}`);
    
    return message;
    
  } catch (error) {
    console.error('Erreur génération message:', error);
    return "Prends soin de toi avec ce plan sur mesure ! 🌿";
  }
}

// ============================================================================
// FALLBACK : Recette depuis BDD si LLM échoue
// ============================================================================

export function transformerRecetteBDD(recetteBDD: any): RecetteGeneree {
  return {
    id: recetteBDD.id,
    nom: recetteBDD.nom,
    type_repas: recetteBDD.type_repas,
    style_culinaire: recetteBDD.categorie || 'autre',
    ingredients: parseIngredients(recetteBDD.ingredients_ids, recetteBDD.quantites),
    instructions: parseInstructions(recetteBDD.instructions),
    temps_preparation: recetteBDD.temps_preparation || 15,
    temps_cuisson: recetteBDD.temps_cuisson || 20,
    portions: recetteBDD.nb_portions || 2,
    valeurs_nutritionnelles: {
      calories: recetteBDD.calories_totales || 0,
      proteines: recetteBDD.proteines || 0,
      glucides: recetteBDD.glucides || 0,
      lipides: recetteBDD.lipides || 0
    },
    astuces: parseVariantes(recetteBDD.variantes),
    variantes: [],
    genere_par_llm: false
  };
}

function parseIngredients(ids: string[], quantites: string[]): Ingredient[] {
  // Parse format CSV ou JSON
  if (!ids || !quantites) return [];
  
  return ids.map((id, i) => ({
    id,
    nom: id, // TODO: récupérer nom depuis table ingrédients
    quantite: parseFloat(quantites[i]) || 0,
    unite: 'g' // TODO: parser unité
  }));
}

function parseInstructions(instructions: string): string[] {
  if (!instructions) return [];
  
  // Split par numéros ou par lignes
  return instructions
    .split(/\d+\.\s|[\n\r]+/)
    .filter(s => s.trim().length > 0)
    .map(s => s.trim());
}

function parseVariantes(variantes: string): string[] {
  if (!variantes) return [];
  
  return variantes
    .split(/[\n\r]+/)
    .filter(s => s.trim().length > 0)
    .map(s => s.trim());
}
