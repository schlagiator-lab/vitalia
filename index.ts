// ==========================================
// EDGE FUNCTION SUPABASE : generer-routine
// Architecture Hybride - Niveaux 1 & 2
// ==========================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ==========================================
// TYPES & INTERFACES
// ==========================================

interface ProfilUtilisateur {
  id: string
  age: number
  sexe: 'homme' | 'femme' | 'autre'
  poids?: number
  taille?: number
  enceinte: boolean
  semaines_grossesse?: number
  allaitement: boolean
  pathologies_chroniques: string[]
  medications_actuelles: string[]
  allergies: string[]
  regimes_alimentaires: string[]
  niveau_activite: string
  objectifs_generaux: string[]
}

interface DemandeRoutine {
  profil_id: string
  symptomes?: string[] // [SYMP_001, SYMP_003, ...]
  preferences_moment?: {
    envie?: string // "sucrÃ©", "salÃ©", "Ã©picÃ©"
    temps_max?: number // minutes
    budget_max?: number // euros
    style_culinaire?: string // "mÃ©diterranÃ©en", "asiatique", etc.
  }
  duree_jours?: number // 1, 7, 14, 30
  force_regeneration?: boolean // Forcer nouvelle gÃ©nÃ©ration (pas de cache)
}

interface ProduitEligible {
  id: string
  nom: string
  type_produit: 'ALI' | 'NUT' | 'ARO' | 'ROU'
  score_pertinence: number
  score_final?: number
  data_specifiques: any
}

// ==========================================
// CONFIGURATION
// ==========================================

const PENALITE_REPETITION = {
  MOINS_7_JOURS: 0.50,   // -50%
  ENTRE_7_14_JOURS: 0.30, // -30%
  ENTRE_14_30_JOURS: 0.15 // -15%
}

const SELECTION_PONDEREE = {
  TOP_3_PROBABILITY: 0.70,  // 70% du temps
  TOP_10_PROBABILITY: 0.90, // 90% cumulÃ© (20% pour top 4-10)
  RANDOM_PROBABILITY: 1.0   // 10% restant = alÃ©atoire total
}

// ==========================================
// FONCTION PRINCIPALE
// ==========================================

serve(async (req) => {
  try {
    // Initialiser client Supabase
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // Parser la requÃªte
    const demande: DemandeRoutine = await req.json()
    
    console.log('ðŸ“¥ Demande reÃ§ue:', {
      profil_id: demande.profil_id,
      symptomes: demande.symptomes,
      preferences: demande.preferences_moment
    })

    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
    // Ã‰TAPE 1 : RÃ‰CUPÃ‰RER LE PROFIL UTILISATEUR
    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
    
    const { data: profil, error: profilError } = await supabase
      .from('profils_utilisateurs')
      .select('*')
      .eq('id', demande.profil_id)
      .single()

    if (profilError || !profil) {
      return new Response(
        JSON.stringify({ error: 'Profil utilisateur non trouvÃ©', details: profilError }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      )
    }

    console.log('âœ… Profil rÃ©cupÃ©rÃ©:', profil.id)

    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
    // NIVEAU 1 : FILTRAGE DE SÃ‰CURITÃ‰ (BDD)
    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
    
    console.log('ðŸ”’ NIVEAU 1 : Filtrage de sÃ©curitÃ©...')
    const exclusions = await getExclusionsSecurity(profil, supabase)
    console.log(`   â†’ ${exclusions.length} produits exclus pour sÃ©curitÃ©`)

    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
    // NIVEAU 2 : SÃ‰LECTION INTELLIGENTE (Algo)
    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
    
    console.log('ðŸ§® NIVEAU 2 : SÃ©lection intelligente...')

    // 2.1 : RÃ©cupÃ©rer historique utilisateur
    const historique = await getHistoriqueUtilisateur(demande.profil_id, supabase)
    console.log(`   â†’ Historique : ${historique.length} utilisations rÃ©centes`)

    // 2.2 : SÃ©lectionner produits pertinents
    let produitsEligibles: ProduitEligible[] = []
    
    if (demande.symptomes && demande.symptomes.length > 0) {
      // Mode symptÃ´mes : produits ciblÃ©s
      produitsEligibles = await getProduitsParSymptomes(
        demande.symptomes,
        exclusions,
        supabase
      )
      console.log(`   â†’ ${produitsEligibles.length} produits pertinents pour symptÃ´mes`)
    } else {
      // Mode bien-Ãªtre gÃ©nÃ©ral : produits prÃ©ventifs
      produitsEligibles = await getProduitsBienEtreGeneral(
        profil,
        exclusions,
        supabase
      )
      console.log(`   â†’ ${produitsEligibles.length} produits bien-Ãªtre gÃ©nÃ©ral`)
    }

    // 2.3 : Appliquer rotation anti-rÃ©pÃ©tition
    const produitsAvecScore = appliquerRotation(produitsEligibles, historique)
    console.log('   â†’ Scores de rotation appliquÃ©s')

    // 2.4 : SÃ©lectionner ingrÃ©dients avec Ã©quilibrage nutritionnel
    const ingredientsSelectionnes = selectionnerIngredientsEquilibres(
      produitsAvecScore,
      demande.preferences_moment
    )
    console.log('   â†’ IngrÃ©dients sÃ©lectionnÃ©s:', {
      proteines: ingredientsSelectionnes.proteines.length,
      legumes: ingredientsSelectionnes.legumes.length,
      cereales: ingredientsSelectionnes.cereales.length,
      complements: ingredientsSelectionnes.complements.length
    })

    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
    // RETOUR DES DONNÃ‰ES POUR NIVEAU 3 (LLM)
    // â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”â”
    
    const reponse = {
      success: true,
      profil: {
        id: profil.id,
        regimes: profil.regimes_alimentaires,
        allergies: profil.allergies,
        enceinte: profil.enceinte
      },
      ingredients_selectionnes: ingredientsSelectionnes,
      exclusions: exclusions,
      metadata: {
        niveau_1_exclusions: exclusions.length,
        niveau_2_produits_eligibles: produitsEligibles.length,
        niveau_2_produits_scores: produitsAvecScore.length,
        historique_size: historique.length,
        timestamp: new Date().toISOString()
      }
    }

    console.log('âœ… Routine gÃ©nÃ©rÃ©e avec succÃ¨s')

    return new Response(
      JSON.stringify(reponse),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('âŒ Erreur:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Erreur interne du serveur',
        details: error.message 
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})

// ==========================================
// NIVEAU 1 : FONCTIONS DE SÃ‰CURITÃ‰
// ==========================================

/**
 * Calcule tous les produits Ã  exclure pour raisons de sÃ©curitÃ©
 */
async function getExclusionsSecurity(
  profil: ProfilUtilisateur,
  supabase: any
): Promise<string[]> {
  const exclusions = new Set<string>()

  // 1. EXCLUSION PAR ALLERGIES
  if (profil.allergies && profil.allergies.length > 0) {
    const { data: produitsAllergenes } = await supabase
      .from('produits')
      .select('id')
      .overlaps('allergenes', profil.allergies)
    
    if (produitsAllergenes) {
      produitsAllergenes.forEach((p: any) => exclusions.add(p.id))
      console.log(`   â†’ Exclusion allergies : ${produitsAllergenes.length} produits`)
    }
  }

  // 2. EXCLUSION PAR RÃ‰GIMES ALIMENTAIRES
  if (profil.regimes_alimentaires && profil.regimes_alimentaires.length > 0) {
    // VÃ©gan
    if (profil.regimes_alimentaires.includes('vegan')) {
      const { data: produitsNonVegan } = await supabase
        .from('produits')
        .select('id')
        .eq('compatible_vegan', false)
      
      if (produitsNonVegan) {
        produitsNonVegan.forEach((p: any) => exclusions.add(p.id))
      }
    }

    // Sans gluten
    if (profil.regimes_alimentaires.includes('sans_gluten')) {
      const { data: produitsGluten } = await supabase
        .from('produits')
        .select('id')
        .eq('sans_gluten', false)
      
      if (produitsGluten) {
        produitsGluten.forEach((p: any) => exclusions.add(p.id))
      }
    }

    // Sans lactose
    if (profil.regimes_alimentaires.includes('sans_lactose')) {
      const { data: produitsLactose } = await supabase
        .from('produits')
        .select('id')
        .eq('sans_lactose', false)
      
      if (produitsLactose) {
        produitsLactose.forEach((p: any) => exclusions.add(p.id))
      }
    }

    // Keto
    if (profil.regimes_alimentaires.includes('keto')) {
      const { data: produitsNonKeto } = await supabase
        .from('produits')
        .select('id')
        .eq('compatible_keto', false)
      
      if (produitsNonKeto) {
        produitsNonKeto.forEach((p: any) => exclusions.add(p.id))
      }
    }
  }

  // 3. EXCLUSION PAR CONTRE-INDICATIONS (populations Ã  risque)
  const conditionsRisque: string[] = []
  
  if (profil.enceinte) conditionsRisque.push('enceinte')
  if (profil.allaitement) conditionsRisque.push('allaitement')
  if (profil.pathologies_chroniques) {
    conditionsRisque.push(...profil.pathologies_chroniques)
  }

  if (conditionsRisque.length > 0) {
    const { data: produitsCI } = await supabase
      .from('produits')
      .select('id')
      .overlaps('populations_risque', conditionsRisque)
    
    if (produitsCI) {
      produitsCI.forEach((p: any) => exclusions.add(p.id))
      console.log(`   â†’ Exclusion CI : ${produitsCI.length} produits`)
    }
  }

  // 4. EXCLUSION PAR INTERACTIONS MÃ‰DICAMENTEUSES
  if (profil.medications_actuelles && profil.medications_actuelles.length > 0) {
    const { data: produitsInteractions } = await supabase
      .from('produits')
      .select('id')
      .overlaps('interactions_medicaments', profil.medications_actuelles)
    
    if (produitsInteractions) {
      produitsInteractions.forEach((p: any) => exclusions.add(p.id))
      console.log(`   â†’ Exclusion interactions : ${produitsInteractions.length} produits`)
    }
  }

  return Array.from(exclusions)
}

// ==========================================
// NIVEAU 2 : FONCTIONS DE SÃ‰LECTION
// ==========================================

/**
 * RÃ©cupÃ¨re l'historique des recommandations de l'utilisateur
 */
async function getHistoriqueUtilisateur(
  profil_id: string,
  supabase: any
): Promise<any[]> {
  const { data: historique } = await supabase
    .from('historique_recommandations')
    .select('*')
    .eq('profil_utilisateur_id', profil_id)
    .gte('date_utilisation', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()) // 30 derniers jours
    .order('date_utilisation', { ascending: false })

  return historique || []
}

/**
 * RÃ©cupÃ¨re les produits pertinents pour les symptÃ´mes dÃ©clarÃ©s
 */
async function getProduitsParSymptomes(
  symptomes: string[],
  exclusions: string[],
  supabase: any
): Promise<ProduitEligible[]> {
  // Construction de la clause NOT IN pour exclusions
  const exclusionsClause = exclusions.length > 0 
    ? `(${exclusions.map(id => `'${id}'`).join(',')})`
    : "('')"

  const { data: produits } = await supabase
    .from('produits_symptomes')
    .select(`
      produit_id,
      score_pertinence,
      tier,
      produits (
        id,
        nom,
        type_produit,
        data_specifiques,
        niveau_preuve,
        efficacite_estimee
      )
    `)
    .in('symptome_id', symptomes)
    .not('produit_id', 'in', exclusionsClause)
    .eq('produits.actif', true)
    .order('tier', { ascending: true })
    .order('score_pertinence', { ascending: false })
    .limit(30)

  if (!produits) return []

  return produits.map((p: any) => ({
    id: p.produits.id,
    nom: p.produits.nom,
    type_produit: p.produits.type_produit,
    score_pertinence: p.score_pertinence,
    data_specifiques: p.produits.data_specifiques
  }))
}

/**
 * RÃ©cupÃ¨re les produits pour bien-Ãªtre gÃ©nÃ©ral (sans symptÃ´mes)
 */
async function getProduitsBienEtreGeneral(
  profil: ProfilUtilisateur,
  exclusions: string[],
  supabase: any
): Promise<ProduitEligible[]> {
  // Mapping objectifs â†’ catÃ©gories
  const objectifsMapping: Record<string, string[]> = {
    'energie': ['Fatigue et Ã©nergie', 'Troubles mÃ©taboliques'],
    'sommeil': ['Troubles du sommeil'],
    'stress': ['Stress et anxiÃ©tÃ©'],
    'immunite': ['Troubles respiratoires', 'Troubles ORL'],
    'digestion': ['Troubles digestifs']
  }

  // RÃ©cupÃ©rer catÃ©gories ciblÃ©es selon objectifs
  const categoriesCiblees = profil.objectifs_generaux
    .flatMap(obj => objectifsMapping[obj] || [])

  if (categoriesCiblees.length === 0) {
    // Pas d'objectifs spÃ©cifiques â†’ produits prÃ©ventifs gÃ©nÃ©raux
    categoriesCiblees.push('Fatigue et Ã©nergie', 'Stress et anxiÃ©tÃ©')
  }

  const { data: categories } = await supabase
    .from('categories')
    .select('id')
    .in('nom', categoriesCiblees)

  const categoriesIds = categories?.map((c: any) => c.id) || []

  const exclusionsClause = exclusions.length > 0 
    ? `(${exclusions.map(id => `'${id}'`).join(',')})`
    : "('')"

  const { data: produits } = await supabase
    .from('produits')
    .select('*')
    .in('categorie_id', categoriesIds)
    .not('id', 'in', exclusionsClause)
    .gte('niveau_preuve', 3) // Niveau de preuve solide
    .gte('efficacite_estimee', 6)
    .eq('actif', true)
    .order('efficacite_estimee', { ascending: false })
    .limit(20)

  if (!produits) return []

  return produits.map((p: any) => ({
    id: p.id,
    nom: p.nom,
    type_produit: p.type_produit,
    score_pertinence: p.efficacite_estimee, // Utiliser efficacitÃ© comme score de base
    data_specifiques: p.data_specifiques
  }))
}

/**
 * Applique l'algorithme de rotation anti-rÃ©pÃ©tition
 */
function appliquerRotation(
  produits: ProduitEligible[],
  historique: any[]
): ProduitEligible[] {
  const maintenant = Date.now()

  return produits.map(produit => {
    // Trouver utilisations rÃ©centes de ce produit
    const utilisations = historique.filter(h => h.produit_id === produit.id)

    // Bruit aleatoire +-10% : garantit variete meme J1 sans historique
    const bruit = 0.90 + Math.random() * 0.20

    if (utilisations.length === 0) {
      // Jamais utilisÃ© â†’ score maximal
      produit.score_final = produit.score_pertinence * bruit
      return produit
    }

    // Calculer pÃ©nalitÃ© selon derniÃ¨re utilisation
    let penaliteTotale = 0

    utilisations.forEach(util => {
      const joursDepuis = (maintenant - new Date(util.date_utilisation).getTime()) / (1000 * 60 * 60 * 24)

      if (joursDepuis < 7) {
        penaliteTotale += PENALITE_REPETITION.MOINS_7_JOURS
      } else if (joursDepuis < 14) {
        penaliteTotale += PENALITE_REPETITION.ENTRE_7_14_JOURS
      } else if (joursDepuis < 30) {
        penaliteTotale += PENALITE_REPETITION.ENTRE_14_30_JOURS
      }
    })

    // Appliquer pÃ©nalitÃ© (max 95% de rÃ©duction)
    const facteurReduction = Math.max(0.05, 1 - Math.min(penaliteTotale, 0.95))
    produit.score_final = produit.score_pertinence * facteurReduction * bruit

    return produit
  }).sort((a, b) => (b.score_final || 0) - (a.score_final || 0))
}

/**
 * SÃ©lection pondÃ©rÃ©e (pas toujours le meilleur score)
 */
function selectionPonderee<T extends { score_final?: number }>(items: T[]): T {
  if (items.length === 0) throw new Error('Aucun Ã©lÃ©ment Ã  sÃ©lectionner')
  if (items.length === 1) return items[0]

  const rand = Math.random()

  if (rand < SELECTION_PONDEREE.TOP_3_PROBABILITY) {
    // Top 3
    const top3 = items.slice(0, Math.min(3, items.length))
    return top3[Math.floor(Math.random() * top3.length)]
  } else if (rand < SELECTION_PONDEREE.TOP_10_PROBABILITY) {
    // Top 4-10
    const top10 = items.slice(3, Math.min(10, items.length))
    return top10[Math.floor(Math.random() * top10.length)]
  } else {
    // AlÃ©atoire total
    return items[Math.floor(Math.random() * items.length)]
  }
}

/**
 * SÃ©lectionne ingrÃ©dients avec Ã©quilibrage nutritionnel
 */
function selectionnerIngredientsEquilibres(
  produits: ProduitEligible[],
  preferences?: any
) {
  // CatÃ©goriser produits par type
  const parType: Record<string, ProduitEligible[]> = {
    proteines: [],
    legumes: [],
    cereales: [],
    epices: [],
    complements: [],
    routines: []
  }

  produits.forEach(p => {
    if (p.type_produit === 'ALI') {
      const categorie = p.data_specifiques?.categorie?.toLowerCase() || ''
      if (categorie.includes('protÃ©ine') || categorie.includes('lÃ©gumineuse')) {
        parType.proteines.push(p)
      } else if (categorie.includes('lÃ©gume') || categorie.includes('fruit')) {
        parType.legumes.push(p)
      } else if (categorie.includes('cÃ©rÃ©ale') || categorie.includes('fÃ©culent')) {
        parType.cereales.push(p)
      } else if (categorie.includes('Ã©pice') || categorie.includes('condiment')) {
        parType.epices.push(p)
      }
    } else if (p.type_produit === 'NUT') {
      parType.complements.push(p)
    } else if (p.type_produit === 'ROU') {
      parType.routines.push(p)
    }
  })

  // Selectionner avec equilibrage - correction Bug1:
  // selectionPonderee() recoit le TABLEAU COMPLET, pas un singleton
  // Sinon elle retourne toujours le meme element (pas de choix possible)
  function pickN(arr, n) {
    const result = []
    const pool = [...arr]
    for (let i = 0; i < n && pool.length > 0; i++) {
      const chosen = selectionPonderee(pool)
      result.push(chosen)
      pool.splice(pool.indexOf(chosen), 1) // retirer pour eviter doublon
    }
    return result
  }

  return {
    proteines:  pickN(parType.proteines,  2),
    legumes:    pickN(parType.legumes,    4),
    cereales:   pickN(parType.cereales,   2),
    epices:     pickN(parType.epices,     2),
    complements: pickN(parType.complements, 3),
    routines:   pickN(parType.routines,   2)
  }
}