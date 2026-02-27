// supabase/functions/generer-plan/niveau3-llm.ts
// VERSION CORRIGÉE V2 :
// - FIX P2 : Model string corrigé → 'claude-opus-4-5-20251022' (Sonnet 4.5)
//            L'ancien 'claude-sonnet-4-20250514' n'existe pas → erreur 400 Anthropic

import { 
  RecetteGeneree, 
  Ingredient,
  ProfilUtilisateur,
  ContexteUtilisateur 
} from './types.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// FIX P2 : Identifiant de modèle valide
// Utiliser claude-haiku-4-5-20251001 pour coût réduit, ou claude-sonnet-4-5-20251022 pour qualité
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

// ============================================================================
// GENERATION RECETTE VIA CLAUDE AI
// ============================================================================

export async function genererRecetteLLM(
  typeRepas: string,
  styleCulinaire: string,
  ingredientsObligatoires: string[],
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur
): Promise<RecetteGeneree | null> {
  
  console.log(`[NIVEAU 3] Génération recette Claude AI (${typeRepas}, ${styleCulinaire})...`);
  
  if (!ANTHROPIC_API_KEY) {
    console.error('[ERROR] ANTHROPIC_API_KEY non configurée dans les secrets Supabase');
    return null;
  }
  
  try {
    const prompt = construirePromptRecette(
      typeRepas,
      styleCulinaire,
      ingredientsObligatoires,
      profil,
      contexte
    );
    
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 2000,
        temperature: 0.8,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ERROR] API Claude ${response.status}:`, errorText);
      // Log clair pour diagnostiquer les erreurs 400 (model invalide, etc.)
      if (response.status === 400) {
        console.error('[ERROR] Vérifier : model string, format body, clé API');
      }
      return null;
    }
    
    const data = await response.json();
    
    // Vérifier que la réponse contient bien du contenu
    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error('[ERROR] Réponse Claude vide ou malformée');
      return null;
    }
    
    const textContent = data.content[0].text;
    
    // Parser le JSON (Claude peut retourner du texte avec ```json``` ou du JSON brut)
    let recetteJSON: any = null;
    
    // Tentative 1 : blocs ```json ... ```
    const jsonBlock = textContent.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlock) {
      try { recetteJSON = JSON.parse(jsonBlock[1]); } catch (_) {}
    }
    
    // Tentative 2 : JSON brut (objet complet)
    if (!recetteJSON) {
      const jsonRaw = textContent.match(/\{[\s\S]*\}/);
      if (jsonRaw) {
        try { recetteJSON = JSON.parse(jsonRaw[0]); } catch (_) {}
      }
    }
    
    if (!recetteJSON) {
      console.error('[ERROR] Pas de JSON valide dans la réponse Claude');
      console.error('[DEBUG] Début réponse:', textContent.substring(0, 200));
      return null;
    }
    
    // Validation des champs obligatoires
    if (!recetteJSON.nom || !recetteJSON.ingredients || !recetteJSON.instructions) {
      console.error('[ERROR] JSON incomplet — champs manquants:', Object.keys(recetteJSON));
      return null;
    }
    
    const recette: RecetteGeneree = {
      nom:             recetteJSON.nom,
      type_repas:      typeRepas,
      style_culinaire: styleCulinaire,
      ingredients:     (recetteJSON.ingredients || []).map((ing: any) => ({
        nom:      ing.nom      || ing.name || 'Ingrédient',
        quantite: ing.quantite || ing.quantity || 0,
        unite:    ing.unite    || ing.unit || 'g'
      })),
      instructions:    recetteJSON.instructions || [],
      temps_preparation: recetteJSON.temps_preparation || 15,
      temps_cuisson:   recetteJSON.temps_cuisson || 20,
      portions:        recetteJSON.portions || 2,
      valeurs_nutritionnelles: recetteJSON.valeurs_nutritionnelles || undefined,
      astuces:         recetteJSON.astuces || [],
      variantes:       recetteJSON.variantes || [],
      genere_par_llm:  true
    };
    
    console.log(`[NIVEAU 3] Recette générée : ${recette.nom}`);
    return recette;
    
  } catch (error) {
    console.error('[ERROR] Exception génération Claude AI:', error);
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
  
  const contraintesRegime: string[] = [];
  
  if (profil.regime_alimentaire?.includes('vegan')) {
    contraintesRegime.push('100% VEGANE (aucun produit animal)');
  } else if (profil.regime_alimentaire?.includes('vegetarien')) {
    contraintesRegime.push('VEGETARIEN (pas de viande ni poisson)');
  }
  if (profil.allergenes?.includes('gluten') || profil.regime_alimentaire?.includes('sans-gluten')) {
    contraintesRegime.push('SANS GLUTEN');
  }
  if (profil.allergenes?.includes('lactose')) {
    contraintesRegime.push('SANS LACTOSE');
  }
  if (profil.regime_alimentaire?.includes('paleo')) {
    contraintesRegime.push('PALEO');
  }
  if (profil.regime_alimentaire?.includes('keto')) {
    contraintesRegime.push('KETO (faible en glucides)');
  }
  
  const allergenes = profil.allergenes || [];
  const tempsMax = profil.temps_preparation || 45;
  
  const budget = profil.budget === 'faible'  ? '5-8 euros/portion'
               : profil.budget === 'eleve'   ? '12-20 euros/portion'
               : '8-12 euros/portion';

  // Contraintes spécifiques petit-déjeuner
  const estPetitDej = typeRepas === 'petit-dejeuner';

  // Mapping besoins_utilisateurs → objectif nutritionnel
  const objectifNutri: Record<string, string> = {
    'vitalite':          'Riche en fer, vitamines B et magnésium pour booster la vitalité et l\'énergie',
    'serenite':          'Riche en magnésium, tryptophane et adaptogènes pour la sérénité et la gestion du stress',
    'digestion':         'Facile à digérer, riche en fibres solubles, prébiotiques et probiotiques',
    'sommeil':           'Riche en tryptophane, mélatonine et magnésium pour favoriser le sommeil réparateur',
    'mobilite':          'Anti-inflammatoire, riche en oméga-3, curcumine et antioxydants pour la mobilité',
    'hormones':          'Riche en acides gras essentiels, phytoestrogènes et zinc pour l\'équilibre hormonal',
    // Rétrocompatibilité
    'energie':           'Riche en protéines et glucides complexes pour booster l\'énergie',
    'stress':            'Riche en magnésium et adaptogènes pour réduire le stress',
    'bien-etre-general': 'Équilibré, varié et nutritif'
  };

  const objectifTexte = objectifNutri[contexte.objectif_principal || ''] || 'Équilibré, varié et nutritif';

  // Contrainte protéines animales si profil omnivore (non vegan, non végétarien)
  const estOmnivore = profil.regime_alimentaire?.includes('omnivore')
    && !profil.regime_alimentaire?.includes('vegan')
    && !profil.regime_alimentaire?.includes('vegetarien');

  const proteineAnimaleConsigne = estOmnivore
    ? (profil.budget === 'faible'
        ? '\n**PROTÉINE ANIMALE OBLIGATOIRE** : inclure œufs, sardines en boîte, thon en boîte, poulet, jambon ou fromage (budget accessible).'
        : profil.budget === 'eleve'
        ? '\n**PROTÉINE ANIMALE OBLIGATOIRE** : inclure saumon sauvage, crevettes, bœuf de qualité, filet de volaille bio ou œufs bio (budget premium).'
        : '\n**PROTÉINE ANIMALE OBLIGATOIRE** : inclure poulet, dinde, saumon, thon, œufs, fromage ou viande maigre dans chaque repas.')
    : '';

  // Contraintes spéciales petit-déjeuner
  const contraintesPetitDej = estPetitDej ? `
## CONTRAINTES SUPPLÉMENTAIRES PETIT-DÉJEUNER (OBLIGATOIRES)
- **Maximum 5 ingrédients** (hors sel/poivre/huile)
- **Maximum 5 étapes** dans les instructions
- **Temps total ≤ 15 minutes** (préparation + cuisson)
- **Pas de cuisson longue** : favoriser cru, toast, bol, smoothie, yaourt, œufs rapides (≤ 5 min)
- Recette simple, rapide, adaptée au matin — pas un plat élaboré
` : '';

  return `Tu es un chef expert en nutrition bien-être. Crée une recette ORIGINALE et CREATIVE.

## CONTRAINTES STRICTES (NON NÉGOCIABLES)

**Type de repas** : ${typeRepas}
**Style culinaire** : ${styleCulinaire}
**Régime alimentaire** : ${contraintesRegime.join(', ') || 'Aucune restriction'}${proteineAnimaleConsigne}
**Allergènes à ÉVITER ABSOLUMENT** : ${allergenes.join(', ') || 'Aucun'}

**Ingrédients OBLIGATOIRES à inclure** :
${ingredientsObligatoires.map(i => `- ${i}`).join('\n')}

**Temps max** : ${estPetitDej ? 15 : tempsMax} minutes (préparation + cuisson combinés)
**Budget** : ${budget}
**Objectif nutritionnel** : ${objectifTexte}
**Portions** : 2
${contraintesPetitDej}
## RÈGLES CRÉATIVES

1. **Nom accrocheur** : Sois créatif, évite les noms génériques.
   Mauvais : "Salade de quinoa"
   Bon : "Buddha Bowl Arc-en-Ciel Énergisant"

2. **Instructions CLAIRES** : Étape par étape, précis, facile à suivre${estPetitDej ? ' (5 étapes MAX)' : ''}

3. **Astuces nutritionnelles** : Explique POURQUOI cette recette aide pour : ${contexte.symptomes_declares?.join(', ') || 'bien-être général'}

4. **Variantes** : Propose 2 variations pour éviter la monotonie

## FORMAT DE SORTIE (JSON STRICT - SANS BACKTICKS)

Réponds UNIQUEMENT avec cet objet JSON exact, sans texte avant ou après :

{
  "nom": "Nom créatif",
  "ingredients": [
    {"nom": "Nom ingrédient", "quantite": 150, "unite": "g"}
  ],
  "instructions": [
    "Étape 1 détaillée...",
    "Étape 2 détaillée..."
  ],
  "temps_preparation": ${estPetitDej ? 10 : 15},
  "temps_cuisson": ${estPetitDej ? 5 : 20},
  "portions": 2,
  "valeurs_nutritionnelles": {
    "calories": ${estPetitDej ? 350 : 450},
    "proteines": ${estPetitDej ? 12 : 18},
    "glucides": ${estPetitDej ? 40 : 55},
    "lipides": ${estPetitDej ? 10 : 12}
  },
  "astuces": [
    "Astuce nutritionnelle 1"
  ],
  "variantes": [
    "Variante 1 : remplacer X par Y"
  ]
}`;
}

// ============================================================================
// GENERATION COLLATION 15H30 VIA LLM
// Prompt explicitement anti-NAC : uniquement de la vraie nourriture
// ============================================================================

export async function genererPauseLLM(
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur
): Promise<any | null> {

  console.log('[NIVEAU 3] Génération collation 15h30 via Claude AI...');

  if (!ANTHROPIC_API_KEY) return null;

  const contraintesRegime: string[] = [];
  if (profil.regime_alimentaire?.includes('vegan'))        contraintesRegime.push('100% VEGANE');
  else if (profil.regime_alimentaire?.includes('vegetarien')) contraintesRegime.push('VÉGÉTARIENNE');
  if (profil.allergenes?.includes('gluten') || profil.regime_alimentaire?.includes('sans-gluten'))
    contraintesRegime.push('SANS GLUTEN');
  if (profil.allergenes?.includes('lactose')) contraintesRegime.push('SANS LACTOSE');

  const objectifNutri: Record<string, string> = {
    'vitalite':  'riche en énergie durable (glucides complexes + bonnes graisses)',
    'serenite':  'apaisante, riche en magnésium et tryptophane',
    'digestion': 'douce pour l\'intestin, riche en fibres solubles',
    'sommeil':   'relaxante, riche en mélatonine ou tryptophane naturels',
    'mobilite':  'anti-inflammatoire naturelle, riche en oméga-3 ou antioxydants',
    'hormones':  'équilibrante, riche en acides gras essentiels et phytoestrogènes',
    'energie':   'énergisante, à index glycémique modéré',
    'stress':    'anti-stress, riche en magnésium',
  };
  const objectifTexte = objectifNutri[contexte.objectif_principal || ''] || 'saine et équilibrée';

  const prompt = `Tu es un chef nutritionniste. Crée une collation de 15h30 originale.

## CONTRAINTES ABSOLUES

**INTERDIT** (aucune exception) :
- Compléments alimentaires, poudres, gélules, pilules
- Superaliments en poudre : spiruline, maca, ashwagandha, chlorelle, protéines en poudre, collagène
- Suppléments : magnésium en poudre, zinc en gélule, oméga-3 en capsule
- Tout produit vendu en pharmacie ou rayon compléments

**AUTORISÉ** : uniquement de la vraie nourriture du quotidien (fruits, légumes, noix, yaourt, pain, chocolat noir, etc.)

**Régime** : ${contraintesRegime.join(', ') || 'Aucune restriction'}
**Allergènes à éviter** : ${(profil.allergenes || []).join(', ') || 'Aucun'}
**Objectif nutritionnel** : ${objectifTexte}
**Temps de préparation max** : 5 minutes, sans cuisson ou cuisson très rapide
**Portions** : 1 personne

## FORMAT JSON STRICT (sans backticks, sans texte autour)

{
  "nom": "Nom créatif et appétissant",
  "ingredients": [
    {"nom": "ingrédient", "quantite": 30, "unite": "g"}
  ],
  "instructions": ["Étape 1", "Étape 2"],
  "temps_preparation": 3,
  "temps_cuisson": 0,
  "portions": 1,
  "valeurs_nutritionnelles": {"calories": 150, "proteines": 4, "glucides": 18, "lipides": 7},
  "astuces": ["Pourquoi cette collation est bonne pour : ${contexte.objectif_principal || 'le bien-être'}"]
}`;

  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        temperature: 0.9,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      console.error(`[ERROR] Claude pause ${response.status}`);
      return null;
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let pauseJSON: any = null;
    const jsonBlock = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlock) { try { pauseJSON = JSON.parse(jsonBlock[1]); } catch (_) {} }
    if (!pauseJSON) {
      const jsonRaw = text.match(/\{[\s\S]*\}/);
      if (jsonRaw) { try { pauseJSON = JSON.parse(jsonRaw[0]); } catch (_) {} }
    }

    if (!pauseJSON?.nom || !pauseJSON?.ingredients) {
      console.error('[ERROR] JSON pause invalide');
      return null;
    }

    console.log(`[NIVEAU 3] Collation générée : ${pauseJSON.nom}`);
    return { ...pauseJSON, genere_par_llm: true };

  } catch (error) {
    console.error('[ERROR] Exception génération pause LLM:', error);
    return null;
  }
}

// ============================================================================
// GENERATION MESSAGE DE MOTIVATION
// ============================================================================

export async function genererMessageMotivation(
  contexte: ContexteUtilisateur,
  planGenere: any
): Promise<string> {
  
  console.log('[NIVEAU 3] Génération message motivation...');
  
  if (!ANTHROPIC_API_KEY) {
    return "Ce plan est fait pour toi ! Profite de chaque moment. 🌿";
  }
  
  try {
    const prompt = `Tu es un coach bien-être bienveillant. Génère un message de motivation COURT (2-3 phrases max) pour encourager l'utilisateur.

Contexte :
- Symptômes : ${contexte.symptomes_declares?.join(', ') || 'aucun'}
- Objectif : ${contexte.objectif_principal || 'bien-être général'}

Règles :
- Ton encourageant mais pas excessif
- Authentique et humain
- Évite les clichés
- Maximum 150 caractères
- Réponds UNIQUEMENT avec le message, sans guillemets ni ponctuation finale superflue`;
    
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 150,
        temperature: 0.9,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    
    if (!response.ok) {
      return "Prends soin de toi avec ce plan sur mesure ! 🌿";
    }
    
    const data = await response.json();
    const message = data.content?.[0]?.text?.trim() || "Prends soin de toi ! 🌿";
    
    console.log(`[NIVEAU 3] Message : ${message}`);
    return message;
    
  } catch (error) {
    console.error('[ERROR] Erreur génération message:', error);
    return "Prends soin de toi avec ce plan sur mesure ! 🌿";
  }
}

// ============================================================================
// FALLBACK : Transformer recette BDD → interface RecetteGeneree
// ============================================================================

export function transformerRecetteBDD(recetteBDD: any): RecetteGeneree {
  return {
    id:              recetteBDD.id,
    nom:             recetteBDD.nom,
    type_repas:      recetteBDD.type_repas,
    style_culinaire: recetteBDD.categorie || recetteBDD.style_culinaire || 'autre',
    ingredients:     parseIngredients(recetteBDD.ingredients_ids, recetteBDD.quantites),
    instructions:    parseInstructions(recetteBDD.instructions),
    temps_preparation: recetteBDD.temps_preparation || 15,
    temps_cuisson:   recetteBDD.temps_cuisson || 20,
    portions:        recetteBDD.nb_portions || 2,
    valeurs_nutritionnelles: {
      calories:   recetteBDD.calories_totales || 0,
      proteines:  recetteBDD.proteines        || 0,
      glucides:   recetteBDD.glucides         || 0,
      lipides:    recetteBDD.lipides          || 0
    },
    astuces:        parseVariantes(recetteBDD.variantes),
    variantes:      [],
    genere_par_llm: false
  };
}

function parseIngredients(ids: string[], quantites: string[]): Ingredient[] {
  if (!ids || !quantites) return [];
  return ids.map((id, i) => ({
    id,
    nom:      id,
    quantite: parseFloat(quantites[i]) || 0,
    unite:    'g'
  }));
}

function parseInstructions(instructions: string): string[] {
  if (!instructions) return [];
  return instructions
    .split(/\d+[.)]\s*|[\n\r]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

function parseVariantes(variantes: string): string[] {
  if (!variantes) return [];
  return variantes
    .split(/[\n\r]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
