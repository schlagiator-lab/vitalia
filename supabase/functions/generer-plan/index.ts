// ==========================================
// EDGE FUNCTION SUPABASE : generer-plan
// Niveau 3 — Génération créative par LLM
// ==========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ==========================================
// TYPES
// ==========================================

interface MomentPlan {
  titre: string
  description: string
  message_motivant: string
  calories_estimees?: number
  instructions: {
    ingredients: string[]
    steps: string[]
    tip: string
  }
}

interface PlanComplet {
  message_personnalise: string
  score_nutritionnel: number
  matin: MomentPlan
  midi: MomentPlan
  apres_midi: MomentPlan
  soir: MomentPlan
  routine_du_jour: {
    complement_phare: string
    aromatherapie?: string
    pratique?: string
    conseil_hydratation?: string
  }
  conseil_du_jour: string
}

interface DemandeGenerationPlan {
  profil_id: string
  symptomes?: string[]
  preferences_moment?: {
    envie?: string
    temps_max?: number
    budget_max?: number
    style_culinaire?: string
  }
  force_regeneration?: boolean
}

// ==========================================
// CONFIGURATION
// ==========================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const LLM_MODEL  = 'claude-haiku-4-5-20251001'
const LLM_TOKENS = 2000

// ==========================================
// FONCTION PRINCIPALE
// ==========================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const supabaseUrl  = Deno.env.get('SUPABASE_URL')!
    const supabaseKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!
    const supabase     = createClient(supabaseUrl, supabaseKey)

    const incomingAuth = req.headers.get('Authorization') ?? `Bearer ${supabaseKey}`

    const demande: DemandeGenerationPlan = await req.json()

    console.log('🌿 generer-plan : démarrage pour', demande.profil_id)

    // ──────────────────────────────────────
    // ÉTAPE 1 : Appel N1+N2 (generer-routine)
    // ──────────────────────────────────────

    console.log('⚙️  Appel N1+N2...')

    const n1n2Response = await fetch(
      `${supabaseUrl}/functions/v1/generer-routine`,
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': incomingAuth,
        },
        body: JSON.stringify({
          profil_id:          demande.profil_id,
          symptomes:          demande.symptomes,
          preferences_moment: demande.preferences_moment,
          force_regeneration: demande.force_regeneration,
        }),
      }
    )

    if (!n1n2Response.ok) {
      const err = await n1n2Response.text()
      console.error('❌ N1+N2 failed:', err)
      throw new Error(`generer-routine a échoué: ${n1n2Response.status}`)
    }

    const n1n2Data = await n1n2Response.json()
    console.log('✅ N1+N2 OK —', n1n2Data.metadata)

    const {
      profil,
      ingredients_selectionnes: ingredients,
      preferences,
      symptomes_declares,
    } = n1n2Data

    // ──────────────────────────────────────
    // ÉTAPE 2 : Construction du prompt LLM
    // ──────────────────────────────────────

    const prompt = construirePrompt(profil, ingredients, preferences, symptomes_declares || demande.symptomes || [])
    console.log('📝 Prompt construit (' + prompt.length + ' chars)')

    // ──────────────────────────────────────
    // ÉTAPE 3 : Appel LLM (Anthropic Claude)
    // ──────────────────────────────────────

    console.log('🤖 Appel LLM...')
    const planBrut = await appellerLLM(prompt, anthropicKey)
    console.log('✅ LLM répondu')

    // ──────────────────────────────────────
    // ÉTAPE 4 : Parse + validation du JSON
    // ──────────────────────────────────────

    const plan = parserEtValiderPlan(planBrut, profil, ingredients)
    console.log('✅ Plan validé')

    // ──────────────────────────────────────
    // ÉTAPE 5 : Logger dans l'historique
    // ──────────────────────────────────────

    await loggerDansHistorique(plan, profil, ingredients, supabase)

    // ──────────────────────────────────────
    // RÉPONSE FINALE
    // ──────────────────────────────────────

    return new Response(
      JSON.stringify({ success: true, plan }),
      { status: 200, headers: CORS_HEADERS }
    )

  } catch (error) {
    console.error('❌ Erreur generer-plan:', error)
    return new Response(
      JSON.stringify({ error: 'Erreur génération', details: error.message }),
      { status: 500, headers: CORS_HEADERS }
    )
  }
})

// ==========================================
// CONSTRUCTION DU PROMPT
// ==========================================

function construirePrompt(
  profil: any,
  ingredients: any,
  preferences: any,
  symptomes: string[]
): string {
  // FIX : utiliser ?? [] pour éviter le crash si un champ est undefined
  const noms = (arr: any[]) => (arr ?? []).map((p: any) => p.nom).join(', ') || 'aucun spécifié'

  const resumeIngredients = `
- Protéines/légumineuses : ${noms(ingredients.proteines)}
- Légumes/fruits : ${noms(ingredients.legumes)}
- Céréales/féculents : ${noms(ingredients.cereales)}
- Épices/condiments : ${noms(ingredients.epices)}
- Compléments nutritionnels : ${noms(ingredients.complements)}
- Pratiques bien-être : ${noms(ingredients.routines)}`

  const contraintes = [
    ...(profil?.regimes || []).map((r: string) => `régime ${r}`),
    ...(profil?.allergies || []).map((a: string) => `SANS ${a} (allergie)`),
    profil?.enceinte ? 'FEMME ENCEINTE — précautions maximales' : '',
  ].filter(Boolean).join(', ') || 'aucune contrainte particulière'

  const contexteSymptomes = (symptomes ?? []).length > 0
    ? `L'utilisateur ressent : ${symptomes.join(', ')}.`
    : "L'utilisateur souhaite un plan de bien-être général."

  const prefsTexte = preferences?.temps_max
    ? `Temps de préparation maximum : ${preferences.temps_max} minutes.`
    : 'Temps de préparation : flexible.'

  const prenom = profil?.prenom || 'toi'

  return `Tu es un expert en nutrition fonctionnelle et bien-être holistique.
${contexteSymptomes}

INGRÉDIENTS VALIDÉS ET SÉCURISÉS (utilise-les intelligemment, pas tous obligatoirement) :
${resumeIngredients}

CONTRAINTES STRICTES : ${contraintes}
${prefsTexte}
Prénomme l'utilisateur "${prenom}".

MISSION : Génère un plan journalier complet, varié et motivant.
Chaque moment a ses propres ingrédients en petites quantités précises (ex: "40g flocons sarrasin").
Les étapes de préparation doivent être courtes et actionnables (1 phrase chacune).

RÉPONDS UNIQUEMENT avec ce JSON valide, sans texte avant ni après :
{
  "message_personnalise": "Message chaleureux et motivant de 1-2 phrases pour ${prenom}",
  "score_nutritionnel": <nombre entre 7 et 10>,
  "matin": {
    "titre": "Nom créatif du repas",
    "description": "Description appétissante en 1-2 phrases",
    "message_motivant": "Courte phrase inspirante avec 1 emoji",
    "calories_estimees": <nombre>,
    "instructions": {
      "ingredients": ["quantité + ingrédient", "quantité + ingrédient"],
      "steps": ["Étape 1 courte.", "Étape 2 courte.", "Étape 3 courte."],
      "tip": "Fait nutritionnel scientifique intéressant sur un ingrédient clé."
    }
  },
  "midi": { },
  "apres_midi": { },
  "soir": { },
  "routine_du_jour": {
    "complement_phare": "Nom du complément + dosage + timing",
    "aromatherapie": "Suggestion aromatique si disponible",
    "pratique": "Pratique bien-être du jour",
    "conseil_hydratation": "Conseil hydratation personnalisé"
  },
  "conseil_du_jour": "Conseil bien-être inspirant et actionnable en 2 phrases."
}`
}

// ==========================================
// APPEL LLM — Anthropic Claude
// ==========================================

async function appellerLLM(prompt: string, apiKey: string, tentative = 1): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      LLM_MODEL,
      max_tokens: LLM_TOKENS,
      system:     'Tu es un expert en nutrition et bien-être. Tu réponds UNIQUEMENT en JSON valide, sans markdown ni texte additionnel.',
      messages: [
        { role: 'user', content: prompt },
      ],
    }),
  })

  if (response.status === 529) {
    if (tentative < 3) {
      const delai = tentative * 2000
      console.log(`⏳ LLM surchargé (tentative ${tentative}/3), retry dans ${delai}ms...`)
      await new Promise(r => setTimeout(r, delai))
      return appellerLLM(prompt, apiKey, tentative + 1)
    }
  }

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`LLM API erreur ${response.status}: ${err}`)
  }

  const data = await response.json()
  const text = data.content?.[0]?.text || ''

  if (!text) throw new Error('LLM a retourné une réponse vide')

  console.log('📄 LLM raw (500 chars):', text.substring(0, 500))

  return text
}

// ==========================================
// PARSE ET VALIDATION DU PLAN
// ==========================================

function parserEtValiderPlan(
  brut: string,
  profil: any,
  ingredients: any
): PlanComplet {
  let json = brut.trim()
  json = json.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  const firstBrace = json.indexOf('{')
  const lastBrace  = json.lastIndexOf('}')
  if (firstBrace > 0) {
    console.log('⚠️ Texte avant JSON ignoré:', json.substring(0, firstBrace))
    json = json.substring(firstBrace, lastBrace + 1)
  }

  let plan: any
  try {
    plan = JSON.parse(json)
  } catch (e) {
    console.error('❌ Parse JSON échoué, tentative de réparation...')
    const match = json.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        plan = JSON.parse(match[0])
        console.log('✅ JSON réparé via regex')
      } catch {
        try {
          let fixed = match[0]
          const opens  = (fixed.match(/\{/g) || []).length
          const closes = (fixed.match(/\}/g) || []).length
          fixed += '}'.repeat(Math.max(0, opens - closes))
          plan = JSON.parse(fixed)
          console.log('✅ JSON réparé en ajoutant accolades manquantes')
        } catch {
          throw new Error('Impossible de parser la réponse LLM')
        }
      }
    } else {
      throw new Error('Aucun JSON trouvé dans la réponse LLM')
    }
  }

  const moments: Array<keyof PlanComplet> = ['matin', 'midi', 'apres_midi', 'soir']
  for (const moment of moments) {
    if (!plan[moment]) {
      console.warn(`⚠️ Moment "${moment}" manquant, génération fallback`)
      plan[moment] = genererMomentFallback(moment as string, ingredients)
    } else {
      plan[moment] = validerMoment(plan[moment], moment as string)
    }
  }

  plan.message_personnalise = plan.message_personnalise ||
    `Bonjour ${profil?.prenom || ''} ! Voici ton plan bien-être du jour. 🌿`
  plan.score_nutritionnel = Math.min(10, Math.max(1, plan.score_nutritionnel || 8))
  plan.conseil_du_jour = plan.conseil_du_jour ||
    "Prends le temps de manger lentement et en pleine conscience aujourd'hui."
  plan.routine_du_jour = plan.routine_du_jour || {
    complement_phare: 'Magnésium bisglycinate 300mg ce soir',
    pratique: 'Cohérence cardiaque 5 minutes avant le dîner',
    conseil_hydratation: "Boire 1,5L d'eau, dont 1 verre tiède le matin.",
  }

  return plan as PlanComplet
}

function validerMoment(moment: any, nom: string): MomentPlan {
  if (typeof moment.instructions === 'string') {
    const texte = moment.instructions as string
    const phrases = texte.split('. ').filter((s: string) => s.trim().length > 5)
    moment.instructions = {
      ingredients: [],
      steps: phrases.length > 0 ? phrases.map((p: string) => p.endsWith('.') ? p : p + '.') : [texte],
      tip: '',
    }
  }

  const inst = moment.instructions || {}
  return {
    titre:            moment.titre            || `Repas de ${nom}`,
    description:      moment.description      || 'Un repas sain et équilibré.',
    message_motivant: moment.message_motivant || 'Prends soin de toi ! 🌿',
    calories_estimees: moment.calories_estimees || 0,
    instructions: {
      ingredients: Array.isArray(inst.ingredients) ? inst.ingredients : [],
      steps:       Array.isArray(inst.steps)       ? inst.steps       : [inst.steps || 'Préparer selon les ingrédients.'],
      tip:         inst.tip || '',
    },
  }
}

function genererMomentFallback(moment: string, ingredients: any): MomentPlan {
  // FIX : utiliser ?? [] pour éviter le crash si un champ est undefined
  const proteines = (ingredients.proteines ?? [])[0]?.nom || 'légumineuses'
  const legume    = (ingredients.legumes   ?? [])[0]?.nom || 'légumes de saison'
  const cereale   = (ingredients.cereales  ?? [])[0]?.nom || 'céréales complètes'

  const configs: Record<string, any> = {
    matin:      { titre: 'Petit-déjeuner Vitalisant',  ing: [`${cereale}`, 'lait végétal', 'fruits frais'] },
    midi:       { titre: 'Bowl Énergie du Midi',        ing: [`${proteines}`, `${legume}`, `${cereale}`] },
    apres_midi: { titre: 'Pause Bien-être',             ing: ['chocolat noir 70%+', 'tisane adaptogène'] },
    soir:       { titre: 'Dîner Léger & Récupérateur', ing: [`${legume}`, `${proteines}`, 'bouillon maison'] },
  }

  const cfg = configs[moment] || configs['midi']
  return {
    titre:            cfg.titre,
    description:      'Un repas équilibré adapté à vos besoins.',
    message_motivant: 'Chaque repas est une occasion de prendre soin de soi. 🌿',
    instructions: {
      ingredients: cfg.ing,
      steps:       ['Préparer les ingrédients.', 'Assembler et assaisonner.', 'Savourer en pleine conscience.'],
      tip:         'Mâcher lentement améliore la digestion et la satiété.',
    },
  }
}

// ==========================================
// LOGGING HISTORIQUE
// ==========================================

async function loggerDansHistorique(
  plan: PlanComplet,
  profil: any,
  ingredients: any,
  supabase: any
): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0]

    // FIX : utiliser ?? [] sur chaque champ pour éviter le crash sur undefined
    const tousProduits = [
      ...(ingredients.proteines  ?? []),
      ...(ingredients.legumes    ?? []),
      ...(ingredients.cereales   ?? []),
      ...(ingredients.epices     ?? []),
      ...(ingredients.complements ?? []),
      ...(ingredients.routines   ?? []),
      // NOTE : 'aromates' supprimé — ce champ n'existe pas dans generer-routine
    ]

    const lignes = tousProduits.map((p: any) => ({
      profil_utilisateur_id: profil.id,
      produit_id:            p.id,
      produit_nom:           p.nom,
      date_utilisation:      today,
    }))

    if (lignes.length > 0) {
      const { error } = await supabase
        .from('historique_recommandations')
        .upsert(lignes, {
          onConflict: 'profil_utilisateur_id,produit_id,date_utilisation',
          ignoreDuplicates: true,
        })

      if (error) console.warn('⚠️ Logging historique partiel:', error.message)
      else       console.log(`✅ ${lignes.length} produits loggés dans l'historique`)
    }
  } catch (e) {
    console.warn('⚠️ Erreur logging (non bloquant):', e)
  }
}
