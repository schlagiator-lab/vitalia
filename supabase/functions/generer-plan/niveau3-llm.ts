// supabase/functions/generer-plan/niveau3-llm.ts
// VERSION CORRIGÉE V2 :
// - FIX P2 : Model string corrigé → 'claude-opus-4-5-20251022' (Sonnet 4.5)
//            L'ancien 'claude-sonnet-4-20250514' n'existe pas → erreur 400 Anthropic

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  RecetteGeneree,
  Ingredient,
  ProfilUtilisateur,
  ContexteUtilisateur
} from './types.ts';
import { calculerNutritionReelle } from './utils.ts';
import { loggerAppelLLM } from '../_shared/llm-guard.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const SUPABASE_URL             = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// FIX P2 : Identifiant de modèle valide
// Utiliser claude-haiku-4-5-20251001 pour coût réduit, ou claude-sonnet-4-5-20251022 pour qualité
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

// ─── Tool_use structuré : garantit un JSON 100% valide sans parsing fragile ─
const RECETTE_TOOL = {
  name: 'creer_recette',
  description: 'Crée une recette nutritive originale selon les contraintes du plan alimentaire',
  input_schema: {
    type: 'object',
    properties: {
      nom: { type: 'string', description: 'Nom créatif et appétissant de la recette' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nom:      { type: 'string' },
            quantite: { type: 'number' },
            unite:    { type: 'string' }
          },
          required: ['nom', 'quantite', 'unite']
        },
        minItems: 3
      },
      instructions:       { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 7 },
      temps_preparation:  { type: 'integer' },
      temps_cuisson:      { type: 'integer' },
      portions:           { type: 'integer' },
      valeurs_nutritionnelles: {
        type: 'object',
        properties: {
          calories:  { type: 'integer' },
          proteines: { type: 'number' },
          glucides:  { type: 'number' },
          lipides:   { type: 'number' }
        },
        required: ['calories', 'proteines', 'glucides', 'lipides']
      },
      astuces:   { type: 'array', items: { type: 'string' } },
      variantes: { type: 'array', items: { type: 'string' } }
    },
    required: ['nom', 'ingredients', 'instructions', 'temps_preparation', 'temps_cuisson',
               'portions', 'valeurs_nutritionnelles', 'astuces', 'variantes']
  }
};

// ─── Tool_use pour collation ────────────────────────────────────────────────
const PAUSE_TOOL = {
  name: 'creer_collation',
  description: 'Crée une collation de 15h30 saine et originale',
  input_schema: {
    type: 'object',
    properties: {
      nom: { type: 'string' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            nom:      { type: 'string' },
            quantite: { type: 'number' },
            unite:    { type: 'string' }
          },
          required: ['nom', 'quantite', 'unite']
        },
        minItems: 2
      },
      instructions:      { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3 },
      temps_preparation: { type: 'integer' },
      temps_cuisson:     { type: 'integer' },
      portions:          { type: 'integer' },
      valeurs_nutritionnelles: {
        type: 'object',
        properties: {
          calories:  { type: 'integer' },
          proteines: { type: 'number' },
          glucides:  { type: 'number' },
          lipides:   { type: 'number' }
        },
        required: ['calories', 'proteines', 'glucides', 'lipides']
      },
      astuces: { type: 'array', items: { type: 'string' } }
    },
    required: ['nom', 'ingredients', 'instructions', 'temps_preparation', 'temps_cuisson',
               'portions', 'valeurs_nutritionnelles', 'astuces']
  }
};

// ============================================================================
// GENERATION RECETTE VIA CLAUDE AI
// ============================================================================

export async function genererRecetteLLM(
  typeRepas: string,
  styleCulinaire: string,
  ingredientsObligatoires: string[],
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur,
  ingredientsAEviter: string[] = [],
  nomsDejaUtilises: string[] = []
): Promise<RecetteGeneree | null> {

  console.log(`[NIVEAU 3] Génération recette Claude AI (${typeRepas}, ${styleCulinaire})...`);

  if (!ANTHROPIC_API_KEY) {
    console.error('[ERROR] ANTHROPIC_API_KEY non configurée dans les secrets Supabase');
    return null;
  }

  const prompt = construirePromptRecette(
    typeRepas, styleCulinaire, ingredientsObligatoires,
    profil, contexte, ingredientsAEviter, nomsDejaUtilises
  );

  // Retry 1× sur 429 / 5xx
  for (let attempt = 0; attempt < 2; attempt++) {
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
          max_tokens: 2000,
          temperature: 0.8,
          tools: [RECETTE_TOOL],
          tool_choice: { type: 'tool', name: 'creer_recette' },
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (response.status === 429 || response.status >= 500) {
        console.warn(`[WARN] Claude ${response.status} (tentative ${attempt + 1}/2) — attente 3s...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ERROR] API Claude ${response.status}:`, errorText.substring(0, 200));
        return null;
      }

      const data = await response.json();

      // Log tokens (fire-and-forget)
      if (data.usage) {
        const _supaLog = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        loggerAppelLLM(_supaLog, {
          profilId:  profil.id,
          fonction:  'generer-plan',
          appel:     'recette-' + typeRepas,
          model:     ANTHROPIC_MODEL,
          tokensIn:  data.usage.input_tokens,
          tokensOut: data.usage.output_tokens,
          succes:    true,
        });
      }

      // tool_use : l'API garantit un JSON valide — pas de regex fragile
      const toolUse = data.content?.find((c: any) => c.type === 'tool_use');
      const recetteJSON = toolUse?.input;

      if (!recetteJSON?.nom || !Array.isArray(recetteJSON?.ingredients) || !Array.isArray(recetteJSON?.instructions)) {
        console.error('[ERROR] Réponse tool_use vide/invalide');
        console.error('[DEBUG] stop_reason:', data.stop_reason, '| content types:', data.content?.map((c: any) => c.type).join(','));
        return null;
      }

      const ingredientsBuilt = (recetteJSON.ingredients || []).map((ing: any) => ({
        nom:      ing.nom      || ing.name || 'Ingrédient',
        quantite: ing.quantite || ing.quantity || 0,
        unite:    ing.unite    || ing.unit || 'g'
      }));

      // Calcul nutrition réelle depuis la table alimentation
      const supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const nutritionReelle = await calculerNutritionReelle(ingredientsBuilt, supabaseClient);
      const llmNutri = recetteJSON.valeurs_nutritionnelles;
      const valeurs_nutritionnelles = nutritionReelle
        ? { ...nutritionReelle, llm_estime: llmNutri }  // calcul réel prioritaire
        : { ...(llmNutri || {}), source: 'estimé_llm' }; // fallback LLM

      console.log(`[NIVEAU 3] Nutrition ${recetteJSON.nom}: ${nutritionReelle
        ? `calculée (${nutritionReelle.couverture}) → ${nutritionReelle.calories} kcal`
        : `estimée LLM → ${llmNutri?.calories ?? '?'} kcal`}`);

      const recette: RecetteGeneree = {
        nom:             recetteJSON.nom,
        type_repas:      typeRepas,
        style_culinaire: styleCulinaire,
        ingredients:     ingredientsBuilt,
        instructions:    recetteJSON.instructions || [],
        temps_preparation: recetteJSON.temps_preparation ?? 15,
        temps_cuisson:   typeRepas === 'petit-dejeuner'
          ? Math.min(recetteJSON.temps_cuisson ?? 0, 2)
          : (recetteJSON.temps_cuisson ?? 20),
        portions:        recetteJSON.portions || 2,
        valeurs_nutritionnelles,
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

  return null;
}

// ============================================================================
// CONSTRUCTION DU PROMPT
// ============================================================================

function construirePromptRecette(
  typeRepas: string,
  styleCulinaire: string,
  ingredientsObligatoires: string[],
  profil: ProfilUtilisateur,
  contexte: ContexteUtilisateur,
  ingredientsAEviter: string[] = [],
  nomsDejaUtilises: string[] = []
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
  if (profil.allergenes?.includes('lactose') ||
      profil.regime_alimentaire?.some(r => ['sans_lactose', 'sans-lactose'].includes(r.toLowerCase()))) {
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
  
  const budget = profil.budget === 'faible'
    ? '5-8 euros/portion (ingrédients économiques : lentilles, oeufs, riz, légumes de saison, sardines en boîte, flocons d\'avoine — éviter viande rouge, poisson frais noble, noix de cajou)'
    : profil.budget === 'eleve'
    ? '12-20 euros/portion (ingrédients premium : saumon, crevettes, noix, graines, légumes bio, viande de qualité, fromages affinés)'
    : '8-12 euros/portion (équilibre qualité/prix : poulet, légumineuses, légumes variés, oeufs bio, fromage courant)';

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

  const objectifTexte = (contexte.symptomes_declares && contexte.symptomes_declares.length > 0)
    ? contexte.symptomes_declares.map(s => objectifNutri[s]).filter(Boolean).join(' + ') || 'Équilibré, varié et nutritif'
    : 'Équilibré, varié et nutritif';

  // Omnivore = défaut dès qu'il n'y a pas de restriction végétale explicite.
  // L'ancien check includes('omnivore') échouait si le profil avait un tableau vide.
  const estVegan      = profil.regime_alimentaire?.some(r => ['vegan', 'végétalien'].includes(r.toLowerCase())) ?? false;
  const estVegetarien = profil.regime_alimentaire?.some(r => ['vegetarien', 'végétarien'].includes(r.toLowerCase())) ?? false;
  const estOmnivore   = !estVegan && !estVegetarien;

  // Protéine animale : uniquement déjeuner & dîner (pas petit-dej → conflit avec contrainte sucrée)
  // La protéine est sélectionnée depuis la BDD et passée via ingredientsObligatoires — ne pas hardcoder.
  const proteineAnimaleConsigne = (estOmnivore && !estPetitDej)
    ? '\n**PROTÉINE ANIMALE OBLIGATOIRE** : utiliser la protéine animale présente dans les ingrédients obligatoires ci-dessus. Ne pas la remplacer. Dans le JSON de sortie, le champ "nom" de cet ingrédient DOIT être EXACTEMENT le même mot que dans la liste (ex: si la liste dit "Maquereau", écrire "Maquereau" — pas "Filets de maquereau", pas "Maquereau grillé").'
    : '';

  // Nombre d'étapes aléatoire entre 3 et 5 pour le petit-déjeuner
  const nbEtapesPetitDej = Math.floor(Math.random() * 3) + 3; // 3, 4 ou 5

  const estSansLactose = profil.allergenes?.includes('lactose') ||
    profil.regime_alimentaire?.some(r => ['sans_lactose', 'sans-lactose'].includes(r.toLowerCase()));

  // Contraintes spéciales petit-déjeuner — exemples laitiers retirés si sans lactose
  const contraintesPetitDej = estPetitDej ? `
## CONTRAINTES SUPPLÉMENTAIRES PETIT-DÉJEUNER (TOUTES OBLIGATOIRES)
- **Saveur SUCRÉE** : fruits frais, compote, miel, sirop d'érable${estSansLactose ? '' : ', yaourt sucré'} — PAS de recette salée au petit-déjeuner
- **Base FRUITS ou CÉRÉALES** : favoriser fruits frais, flocons d'avoine, granola, smoothie${estSansLactose ? '' : ', yaourt'}, pain complet avec confiture/miel — PAS de légumes, pas de tomate, pas de courgette${estSansLactose ? '\n- **AUCUN produit laitier** : pas de yaourt, pas de fromage blanc, pas de ricotta, pas de lait animal — utiliser uniquement lait végétal si nécessaire' : ''}
- **ZÉRO cuisson longue** : pas de poêle, pas de four, pas de casserole — uniquement cru, blender, micro-ondes max 2 min, ou toast grille-pain
- **Maximum 5 ingrédients** (hors sel/cannelle/vanille)
- **EXACTEMENT ${nbEtapesPetitDej} étapes** dans les instructions (ni plus, ni moins — respecter ce nombre précisément)
- **Temps total ≤ 10 minutes**
- **temps_cuisson = 0** si smoothie/bowl/overnight oats/tartine/açaï bowl (pas de cuisson réelle)
- Exemples acceptables : bol de fruits + granola, smoothie bowl, overnight oats${estSansLactose ? ', tartine fruits + beurre d\'amande, açaï bowl' : ', tartine fruits + ricotta, bol de fruits + yaourt + granola, açaï bowl'}
- Exemples INTERDITS : omelette aux légumes, toast avocat-tomate, salade, soupe${estSansLactose ? ', bol yaourt, tartine ricotta, fromage blanc' : ''}
` : '';

  // Ingrédients déjà utilisés dans les autres repas du plan (éviter la répétition)
  const consigneEviter = ingredientsAEviter.length > 0 ? `
**Ingrédients à ÉVITER ABSOLUMENT** (déjà utilisés dans d'autres repas du plan — ne pas répéter) :
${ingredientsAEviter.map(i => `- ${i}`).join('\n')}
` : '';

  // Recettes déjà générées dans le même plan (éviter les doublons de concept)
  const consigneNoms = nomsDejaUtilises.length > 0 ? `
**RECETTES DÉJÀ CRÉÉES DANS CE PLAN (interdites — ne pas reproduire ni imiter) :**
${nomsDejaUtilises.map(n => `- "${n}"`).join('\n')}
Crée quelque chose de complètement différent : autres ingrédients principaux, autre technique, autre concept.
` : '';

  return `Tu es un chef expert en nutrition bien-être. Crée une recette ORIGINALE et CREATIVE.

## CONTRAINTES STRICTES (NON NÉGOCIABLES)

**Type de repas** : ${typeRepas}
**Style culinaire** : ${styleCulinaire}
**Régime alimentaire** : ${contraintesRegime.join(', ') || 'Aucune restriction'}${proteineAnimaleConsigne}
**Allergènes à ÉVITER ABSOLUMENT** : ${allergenes.join(', ') || 'Aucun'}
${consigneNoms}${consigneEviter}
**Ingrédients OBLIGATOIRES à inclure** :
${ingredientsObligatoires.map(i => `- ${i}`).join('\n')}

**Temps max** : ${estPetitDej ? 15 : tempsMax} minutes (préparation + cuisson combinés)
**Budget** : ${budget}
**Objectif nutritionnel** : ${objectifTexte}
**Portions** : ${profil.nb_personnes || 2} personne${(profil.nb_personnes || 2) > 1 ? 's' : ''}
${contraintesPetitDej}
**QUALITÉ OBLIGATOIRE** :
- Minimum 5 ingrédients avec quantités précises en grammes/ml/pièces
- Chaque étape doit contenir une action culinaire précise (température, durée, technique)
- Jamais d'instructions vagues comme "cuisiner selon méthode", "ajuster selon préférence", "comme souhaité"
- Temps de cuisson cohérent avec la méthode (ex : poisson poêlé = 4-6 min, poulet rôti = 25-30 min)

## RÈGLES CRÉATIVES

1. **Nom accrocheur** : Sois créatif, évite les noms génériques.
   Mauvais : "Salade de quinoa"
   Bon : "Buddha Bowl Arc-en-Ciel Énergisant"

2. **Instructions CLAIRES** : Étape par étape, précis, facile à suivre${estPetitDej ? ` (EXACTEMENT ${nbEtapesPetitDej} étapes)` : ''}

3. **Astuces nutritionnelles** : Explique POURQUOI cette recette aide pour : ${contexte.symptomes_declares?.join(', ') || 'bien-être général'}

4. **Variantes** : Propose 2 variations pour éviter la monotonie

**Valeurs nutritionnelles** : vise ${estPetitDej ? '~350 kcal, ~12 g protéines, ~40 g glucides, ~10 g lipides' : '~450 kcal, ~18 g protéines, ~55 g glucides, ~12 g lipides'} — ajuster selon les vrais ingrédients.
**Astuces** : 1 à 2, en lien avec "${contexte.symptomes_declares?.join(', ') || 'bien-être général'}".
**Variantes** : 1 à 2 suggestions de remplacement ou de variation créative.`;
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
  if (profil.allergenes?.includes('lactose') ||
      profil.regime_alimentaire?.some(r => ['sans_lactose', 'sans-lactose'].includes(r.toLowerCase())))
    contraintesRegime.push('SANS LACTOSE');

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
  const objectifTexte = (contexte.symptomes_declares && contexte.symptomes_declares.length > 0)
    ? contexte.symptomes_declares.map(s => objectifNutri[s]).filter(Boolean).join(' + ') || 'saine et équilibrée'
    : 'saine et équilibrée';

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
**Valeurs nutritionnelles visées** : ~150 kcal, ~4 g protéines, ~18 g glucides, ~7 g lipides.
**Astuces** : expliquer en quoi cette collation aide pour "${contexte.objectif_principal || 'le bien-être'}".`;

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
        tools: [PAUSE_TOOL],
        tool_choice: { type: 'tool', name: 'creer_collation' },
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      console.error(`[ERROR] Claude pause ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Log tokens (fire-and-forget)
    if (data.usage) {
      const _supaLog = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      loggerAppelLLM(_supaLog, {
        profilId:  profil.id,
        fonction:  'generer-plan',
        appel:     'pause',
        model:     ANTHROPIC_MODEL,
        tokensIn:  data.usage.input_tokens,
        tokensOut: data.usage.output_tokens,
        succes:    true,
      });
    }

    const toolUse = data.content?.find((c: any) => c.type === 'tool_use');
    const pauseJSON = toolUse?.input;

    if (!pauseJSON?.nom || !Array.isArray(pauseJSON?.ingredients)) {
      console.error('[ERROR] Réponse tool_use pause invalide');
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
  planGenere: any,
  profilId?: string
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

    if (data.usage) {
      const _supaLog = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      loggerAppelLLM(_supaLog, {
        profilId,
        fonction:  'generer-plan',
        appel:     'motivation',
        model:     ANTHROPIC_MODEL,
        tokensIn:  data.usage.input_tokens,
        tokensOut: data.usage.output_tokens,
        succes:    true,
      });
    }

    const message = data.content?.[0]?.text?.trim() || "Prends soin de toi ! 🌿";

    console.log(`[NIVEAU 3] Message : ${message}`);
    return message;
    
  } catch (error) {
    console.error('[ERROR] Erreur génération message:', error);
    return "Prends soin de toi avec ce plan sur mesure ! 🌿";
  }
}

// ============================================================================
// GENERATION CONSEIL "LE SAVIEZ-VOUS ?" VIA LLM
// ============================================================================

export async function genererConseilDuJour(
  contexte: ContexteUtilisateur,
  profilId?: string
): Promise<string> {

  console.log('[NIVEAU 3] Génération conseil du jour...');

  const fallbacks: Record<string, string> = {
    'vitalite':  'Le magnésium intervient dans plus de 300 réactions enzymatiques dont la production d\'énergie cellulaire.',
    'serenite':  'Le tryptophane, précurseur de la sérotonine, se trouve dans la banane, la dinde et le chocolat noir à 70%+.',
    'digestion': 'Mâcher lentement (20 fois par bouchée) divise par deux la charge digestive de l\'estomac.',
    'sommeil':   'Les cerises acidulées sont l\'une des rares sources alimentaires naturelles de mélatonine.',
    'mobilite':  'La curcumine du curcuma est à consommer avec du poivre noir pour une absorption 20× supérieure.',
    'hormones':  'Les lignanes du lin (graines moulues) ont une action phytoestrogénique douce qui aide à réguler le cycle hormonal.',
  };
  const fallback = fallbacks[contexte.objectif_principal || '']
    || 'Une alimentation colorée et variée est la base d\'une bonne santé — chaque couleur apporte des nutriments uniques.';

  if (!ANTHROPIC_API_KEY) return fallback;

  const objectifsLabel: Record<string, string> = {
    'vitalite':  'vitalité et énergie',
    'serenite':  'stress et sérénité',
    'digestion': 'digestion et microbiome',
    'sommeil':   'sommeil et récupération',
    'mobilite':  'mobilité et inflammation',
    'hormones':  'équilibre hormonal',
    'energie':   'énergie et métabolisme',
    'stress':    'gestion du stress',
  };
  const sujet = contexte.symptomes_declares?.map(s => objectifsLabel[s] || s).join(', ')
    || objectifsLabel[contexte.objectif_principal || '']
    || 'bien-être général';

  const prompt = `Tu es un nutritionniste expert. Génère UN SEUL fait scientifique surprenant et utile sur l'alimentation ou la nutrition, en lien avec : ${sujet}.

Règles STRICTES :
- 1 à 2 phrases maximum, percutantes et mémorables
- Basé sur des données scientifiques réelles (pas de pseudo-science)
- Donner un chiffre ou un mécanisme concret quand c'est possible
- Jamais de conseil général bateau ("mangez varié", "buvez de l'eau")
- Pas de guillemets, pas d'introduction, pas de titre
- Réponds UNIQUEMENT avec le fait, rien d'autre`;

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
        max_tokens: 120,
        temperature: 1.0,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) return fallback;

    const data = await response.json();

    if (data.usage) {
      const _supaLog = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      loggerAppelLLM(_supaLog, {
        profilId,
        fonction:  'generer-plan',
        appel:     'conseil-du-jour',
        model:     ANTHROPIC_MODEL,
        tokensIn:  data.usage.input_tokens,
        tokensOut: data.usage.output_tokens,
        succes:    true,
      });
    }

    const conseil = data.content?.[0]?.text?.trim() || fallback;
    console.log(`[NIVEAU 3] Conseil du jour : ${conseil}`);
    return conseil;

  } catch (error) {
    console.error('[ERROR] Erreur génération conseil:', error);
    return fallback;
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
    temps_preparation: recetteBDD.temps_preparation ?? 15,
    temps_cuisson:   recetteBDD.temps_cuisson ?? 0,
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
