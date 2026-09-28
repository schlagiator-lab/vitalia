// supabase/functions/_shared/securite.ts
// NIVEAU 1 — SÉCURITÉ : source de vérité UNIQUE pour toutes les fonctions de génération
// (generer-plan, generer-plan-semaine, generer-recette-unique, generer-recette-details).
//
// Principes :
// - FAIL CLOSED : donnée de sécurité manquante (profil ou item) → exclusion / refus de générer.
// - Matching insensible à la casse et aux accents, sur mots entiers (pluriel s/x toléré).
// - Tout pool codé en dur, tout fallback et toute sortie LLM passent par ce module.
// - Si un pool se vide après filtrage : recette générique sûre, jamais le pool non filtré.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ============================================================================
// TYPES
// ============================================================================

export interface ProfilSecurite {
  profilId:           string;
  allergies:          string[];   // ids canoniques : poisson, crustaces, noix, arachides, soja, sesame, gluten, lactose…
  regimes:            string[];   // ids canoniques pertinents sécurité : vegan, vegetarien, sans_gluten, sans_lactose, halal, casher
  enceinte:           boolean;
  allaitement:        boolean;
  medicaments:        string[];   // texte libre normalisé
  classesMedicaments: string[];   // ex. 'anticoagulant'
  pathologies:        string[];   // ids canoniques : diabete, hypertension, hypothyroidie, sibo_ibs, endometriose…
}

export interface Violation {
  regle: string;   // ex. 'poisson', 'vegan', 'grossesse'
  mot:   string;   // mot-clé détecté (normalisé)
  champ?: string;  // champ de la recette où il a été trouvé
}

export class ErreurSecurite extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ErreurSecurite';
    this.code = code;
  }
}

// Message affiché à la place des compléments / huiles essentielles quand ils sont exclus d'office
export const MESSAGE_COMPLEMENTS_MEDECIN =
  'Compléments et huiles essentielles : à discuter avec ton médecin ou ton pharmacien.';

// ============================================================================
// NORMALISATION
// ============================================================================

export function normaliser(texte: unknown): string {
  return String(texte ?? '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Tableau ou texte → texte unique (les champs BDD sont tantôt text, tantôt text[])
function enTexte(valeur: unknown): string {
  if (Array.isArray(valeur)) return valeur.map(v => String(v ?? '')).join(' ');
  return String(valeur ?? '');
}

// ============================================================================
// RÈGLES PAR MOTS-CLÉS
// mots        : mots entiers interdits (normalisés à la compilation, pluriel s/x toléré)
// exceptions  : regex (texte normalisé, sans accents) retirées du texte AVANT la recherche
// motsProduits: mots supplémentaires appliqués uniquement aux nutraceutiques / HE
// ============================================================================

interface DefinitionRegle {
  label:         string;
  mots:          string[];
  exceptions?:   string[];
  motsProduits?: string[];
}

const MOTS_POISSON = [
  'poisson', 'saumon', 'thon', 'cabillaud', 'morue', 'colin', 'merlu', 'lieu noir', 'lieu jaune',
  'sardine', 'maquereau', 'hareng', 'anchois', 'truite', 'bar', 'loup de mer', 'dorade', 'daurade',
  'sole', 'espadon', 'merou', 'alose', 'fletan', 'turbot', 'lotte', 'rouget', 'sandre', 'perche',
  'brochet', 'carpe', 'tilapia', 'pangasius', 'eglefin', 'haddock', 'surimi', 'caviar', 'tarama',
  'nuoc mam', 'sauce poisson', 'bonite', 'mulet', 'saint pierre', 'raie', 'eperlan', 'rascasse',
  'marlin', 'requin', 'gravlax',
];
const MOTS_CRUSTACES = [
  'crustace', 'crevette', 'crabe', 'homard', 'langouste', 'langoustine', 'ecrevisse', 'gambas',
  'scampi', 'krill', 'tourteau',
];
const MOTS_MOLLUSQUES = [
  'mollusque', 'moule', 'huitre', 'palourde', 'praire', 'saint jacques', 'calamar', 'calmar',
  'seiche', 'poulpe', 'encornet', 'bulot', 'escargot', 'bigorneau', 'ormeau', 'fruits de mer',
];
const MOTS_VIANDE = [
  'viande', 'boeuf', 'veau', 'porc', 'cochon', 'agneau', 'mouton', 'poulet', 'dinde', 'canard',
  'volaille', 'lapin', 'jambon', 'lard', 'lardon', 'bacon', 'saucisse', 'saucisson', 'chorizo',
  'merguez', 'steak', 'foie', 'gibier', 'cerf', 'chevreuil', 'sanglier', 'caille', 'pintade', 'oie',
  'magret', 'rillettes', 'pancetta', 'prosciutto', 'coppa', 'salami', 'andouille', 'charcuterie',
  'gelatine', 'abats',
];
const MOTS_PORC = [
  'porc', 'cochon', 'jambon', 'lard', 'lardon', 'bacon', 'saucisse', 'saucisson', 'chorizo',
  'pancetta', 'prosciutto', 'coppa', 'salami', 'andouille', 'rillettes', 'charcuterie', 'gelatine',
];
const MOTS_ALCOOL = [
  'alcool', 'vin', 'biere', 'rhum', 'cognac', 'calvados', 'kirsch', 'liqueur', 'marsala', 'porto',
  'mirin', 'vodka', 'whisky', 'champagne', 'cidre', 'sake',
];
const EXCEPTIONS_ALCOOL = ['vinaigres? de vin', 'vinaigres? de cidre', 'sans alcool'];

const MOTS_LAITIERS = [
  'lait', 'laitage', 'beurre', 'creme', 'fromage', 'yaourt', 'yogourt', 'yoghourt', 'ricotta',
  'mozzarella', 'parmesan', 'feta', 'mascarpone', 'emmental', 'gruyere', 'comte', 'chevre', 'brebis',
  'skyr', 'kefir', 'ghee', 'lactoserum', 'whey', 'babeurre', 'petit suisse', 'cottage', 'cheddar',
  'burrata', 'raclette', 'reblochon', 'camembert', 'brie', 'gorgonzola', 'roquefort', 'halloumi',
  'paneer', 'labneh', 'quark', 'sere',
];
// Alternatives végétales (valables pour lactose ET vegan)
const EXCEPTIONS_VEGETALES = [
  'laits? (?:d amande|de coco|d avoine|de riz|de soja|vegetal|vegetaux|de noisette|de cajou|d epeautre)',
  'cremes? (?:de coco|de marrons?|d amande|vegetale|de riz|de soja)',
  'beurres? (?:d amande|de cacahuetes?|de noix|de noisettes?|de cajou|d arachide|de sesame|de coco|vegetal)',
  'yaourts? (?:vegetal|vegetaux|de soja|de coco|d amande)',
  'fromages? vegetal',
];

const MOTS_OEUF = ['oeuf', 'mayonnaise', 'meringue'];

const REGLES: Record<string, DefinitionRegle> = {
  poisson: {
    label: 'allergie poisson',
    mots: MOTS_POISSON,
    motsProduits: ['omega 3', 'huile de poisson', 'epa', 'dha', 'collagene marin'],
  },
  crustaces: { label: 'allergie crustacés', mots: MOTS_CRUSTACES },
  mollusques: { label: 'allergie mollusques', mots: MOTS_MOLLUSQUES },
  noix: {
    label: 'allergie fruits à coque',
    mots: [
      'noix', 'noisette', 'amande', 'amandine', 'pistache', 'macadamia', 'pecan', 'cajou',
      'noix du bresil', 'pralin', 'praline', 'frangipane', 'massepain', 'nougat', 'gianduja',
      'fruits a coque', 'fruit a coque',
      // Souvent à base de fruits à coque (fail closed)
      'granola', 'muesli', 'pate a tartiner', 'nutella',
    ],
  },
  arachides: {
    label: 'allergie arachides',
    mots: ['arachide', 'cacahuete', 'peanut'],
  },
  soja: {
    label: 'allergie soja',
    mots: ['soja', 'tofu', 'tempeh', 'edamame', 'miso', 'tamari', 'natto', 'yuba'],
  },
  sesame: {
    label: 'allergie sésame',
    mots: ['sesame', 'tahini', 'tahin', 'halva', 'halwa', 'gomasio', 'houmous', 'hummus', 'baba ganoush'],
  },
  oeuf: { label: 'allergie œuf', mots: MOTS_OEUF },
  gluten: {
    label: 'sans gluten',
    mots: [
      'ble', 'farine', 'pate', 'pain', 'semoule', 'couscous', 'boulgour', 'bulgur', 'seigle', 'orge',
      'epeautre', 'avoine', 'granola', 'muesli', 'chapelure', 'seitan', 'panko', 'biscuit', 'brioche',
      'croissant', 'crepe', 'gaufre', 'tortilla', 'wrap', 'baguette', 'toast', 'pita', 'naan',
      'lasagne', 'spaghetti', 'tagliatelle', 'penne', 'fusilli', 'macaroni', 'nouille', 'vermicelle',
      'gnocchi', 'ravioli', 'biere', 'kamut', 'triticale', 'malt', 'cracker', 'gateau', 'sauce soja',
      'crouton', 'focaccia', 'bagel',
    ],
    exceptions: [
      '\\S+(?: de \\S+| d \\S+)? sans gluten',
      'farines? (?:de riz|de sarrasin|de mais|de pois chiches?|de coco|d amande|de chataigne|de quinoa|de millet|de teff)',
      'nouilles? de riz', 'vermicelles? de riz', 'galettes? de riz', 'galettes? de sarrasin',
      'tortillas? de mais', 'crepes? de sarrasin', 'pates? de riz', 'grille pain', 'ble noir',
      'pates? (?:de curry|d amande|de sesame|de dattes?|de tomates?|de miso|de coings?|de fruits?|a tartiner)',
      'a pates? (?:dure|molle|pressee|persillee|fleurie|lavee)',   // textures de fromage (« fromage à pâte dure »)
    ],
  },
  lactose: {
    label: 'sans lactose',
    mots: MOTS_LAITIERS,
    exceptions: [...EXCEPTIONS_VEGETALES, '\\S+(?: de \\S+| d \\S+)? sans lactose'],
  },
  vegan: {
    label: 'régime vegan',
    mots: [...MOTS_VIANDE, ...MOTS_POISSON, ...MOTS_CRUSTACES, ...MOTS_MOLLUSQUES, ...MOTS_OEUF,
           ...MOTS_LAITIERS, 'miel', 'gelee royale', 'cire d abeille', 'graisse de canard'],
    exceptions: [...EXCEPTIONS_VEGETALES, 'fruits? a coque'],
    motsProduits: ['omega 3', 'huile de poisson', 'collagene', 'gelule gelatine'],
  },
  vegetarien: {
    label: 'régime végétarien',
    mots: [...MOTS_VIANDE, ...MOTS_POISSON, ...MOTS_CRUSTACES, ...MOTS_MOLLUSQUES],
    exceptions: ['fruits? a coque'],
    motsProduits: ['huile de poisson', 'collagene'],
  },
  halal: {
    label: 'régime halal',
    mots: [...MOTS_PORC, ...MOTS_ALCOOL],
    exceptions: EXCEPTIONS_ALCOOL,
  },
  casher: {
    label: 'régime casher',
    mots: [...MOTS_PORC, ...MOTS_CRUSTACES, ...MOTS_MOLLUSQUES, 'lapin'],
  },
  grossesse: {
    label: 'grossesse',
    mots: [
      ...MOTS_ALCOOL, 'foie', 'foie gras', 'espadon', 'marlin', 'requin', 'thon', 'sushi', 'sashimi',
      'ceviche', 'carpaccio', 'tartare', 'gravlax', 'poisson cru', 'lait cru', 'oeuf cru', 'jambon cru',
      'saucisson', 'salami', 'chorizo', 'rillettes', 'terrine', 'huitre', 'brie', 'camembert',
      'roquefort', 'gorgonzola', 'reblochon', 'mont d or', 'vacherin', 'reglisse', 'graines germees',
      'germes',
    ],
    exceptions: EXCEPTIONS_ALCOOL,
  },
  allaitement: {
    label: 'allaitement',
    mots: [...MOTS_ALCOOL, 'espadon', 'marlin', 'requin'],
    exceptions: EXCEPTIONS_ALCOOL,
  },
  medicaments: {
    label: 'interaction médicamenteuse',
    mots: ['pamplemousse', 'millepertuis'],
  },
};

// Alias → id canonique (après normalisation, espaces → '_')
const ALIAS_ALLERGIES: Record<string, string> = {
  poisson: 'poisson', poissons: 'poisson',
  crustaces: 'crustaces', crustace: 'crustaces',
  mollusques: 'mollusques', mollusque: 'mollusques',
  noix: 'noix', fruits_a_coque: 'noix', fruit_a_coque: 'noix', noisettes: 'noix', amandes: 'noix',
  arachides: 'arachides', arachide: 'arachides', cacahuetes: 'arachides', cacahuete: 'arachides',
  soja: 'soja', sesame: 'sesame',
  gluten: 'gluten', ble: 'gluten',
  lactose: 'lactose', lait: 'lactose', produits_laitiers: 'lactose',
  oeuf: 'oeuf', oeufs: 'oeuf',
};
const ALIAS_REGIMES: Record<string, string | null> = {
  vegan: 'vegan', vegetalien: 'vegan', vegane: 'vegan',
  vegetarien: 'vegetarien', vegetarienne: 'vegetarien',
  sans_gluten: 'sans_gluten', sansgluten: 'sans_gluten',
  sans_lactose: 'sans_lactose', sanslactose: 'sans_lactose',
  halal: 'halal', casher: 'casher', kasher: 'casher', cacher: 'casher',
  // Régimes sans enjeu de sécurité (gérés par le prompt)
  omnivore: null, keto: null, paleo: null, cetogene: null,
};

// Classes de médicaments (noms commerciaux CH/FR + DCI) → utilisées pour les aliments
const CLASSES_MEDICAMENTS: Record<string, string[]> = {
  anticoagulant: [
    'anticoagulant', 'warfarine', 'coumadine', 'marcoumar', 'phenprocoumone', 'sintrom',
    'acenocoumarol', 'xarelto', 'rivaroxaban', 'eliquis', 'apixaban', 'pradaxa', 'dabigatran',
    'lixiana', 'edoxaban', 'heparine', 'clexane', 'enoxaparine', 'fragmin', 'dalteparine',
    'fraxiparine', 'aspirine', 'aspirin', 'kardegic', 'clopidogrel', 'plavix', 'ticagrelor',
    'brilique', 'prasugrel', 'efient', 'avk',
  ],
};

// Pathologie (id profil) → racines recherchées dans les contre-indications
const PATHOLOGIES_SYNONYMES: Record<string, string[]> = {
  diabete:       ['diabet'],
  hypertension:  ['hypertens', 'tension arterielle', 'pression arterielle'],
  hypothyroidie: ['thyroid', 'hypothyroid'],
  sibo_ibs:      ['sibo', 'intestin irritable', 'colon irritable', 'sii', 'ibs', 'fodmap'],
  endometriose:  ['endometriose', 'hormono', 'phytoestrogen', 'oestrogen', 'estrogen'],
};

// Détection dans les textes de contre-indications (racines, préfixe de mot)
const RE_CI_GROSSESSE    = /(?:^| )(?:grossesse|enceinte|gestation|pregnan)/;
const RE_CI_ALLAITEMENT  = /(?:^| )(?:allait|lactation)/;
const RE_CI_MEDICAMENTS  = /(?:^| )(?:interaction|medicament|medic |traitement)/;
const RE_CI_ANTICOAGULANT = /(?:^| )(?:anticoag|antiagreg|avk|warfarin|coumarin|coagulation|vitamine k|fluidifi|saignement)/;

// ============================================================================
// COMPILATION DES RÈGLES
// ============================================================================

interface RegleCompilee {
  id:          string;
  label:       string;
  mots:        { mot: string; re: RegExp }[];
  motsProduits: { mot: string; re: RegExp }[];
  exceptions:  RegExp[];
}

function compilerMot(mot: string): { mot: string; re: RegExp } {
  const m = normaliser(mot);
  return { mot: m, re: new RegExp('(?:^| )' + m + '(?:s|x)?(?= |$)') };
}

const _cacheRegles = new Map<string, RegleCompilee>();

function regleCompilee(id: string): RegleCompilee {
  const cache = _cacheRegles.get(id);
  if (cache) return cache;
  // Allergie inconnue (ex. 'moutarde') : on interdit le mot lui-même (fail closed)
  const def: DefinitionRegle = REGLES[id] ?? { label: `allergie ${id.replace(/_/g, ' ')}`, mots: [id.replace(/_/g, ' ')] };
  const compilee: RegleCompilee = {
    id,
    label: def.label,
    mots: [...new Set(def.mots.map(normaliser))].map(compilerMot),
    motsProduits: (def.motsProduits || []).map(compilerMot),
    exceptions: (def.exceptions || []).map(src => new RegExp('(?:^| )(?:' + src + ')(?= |$)', 'g')),
  };
  _cacheRegles.set(id, compilee);
  return compilee;
}

// Règles actives pour un profil (allergies + régimes + situations)
function reglesActives(profil: ProfilSecurite): RegleCompilee[] {
  const ids = new Set<string>(profil.allergies);
  for (const r of profil.regimes) {
    if (r === 'sans_gluten') ids.add('gluten');
    else if (r === 'sans_lactose') ids.add('lactose');
    else ids.add(r);
  }
  if (profil.enceinte)    ids.add('grossesse');
  if (profil.allaitement) ids.add('allaitement');
  if (profil.medicaments.length > 0) ids.add('medicaments');
  return [...ids].map(regleCompilee);
}

function violationsDansTexte(
  texte: string,
  regles: RegleCompilee[],
  options: { produits?: boolean; champ?: string } = {}
): Violation[] {
  const base = ' ' + normaliser(texte) + ' ';
  if (base.trim() === '') return [];
  const violations: Violation[] = [];
  for (const r of regles) {
    let t = base;
    for (const ex of r.exceptions) t = t.replace(ex, ' ');
    const mots = options.produits ? [...r.mots, ...r.motsProduits] : r.mots;
    const trouve = mots.find(m => m.re.test(t));
    if (trouve) violations.push({ regle: r.id, mot: trouve.mot, ...(options.champ ? { champ: options.champ } : {}) });
  }
  return violations;
}

// ============================================================================
// PROFIL
// ============================================================================

function canoniser(valeur: string): string {
  return normaliser(valeur).replace(/ /g, '_');
}

// Construction pure (testable) — lève ErreurSecurite si un champ de sécurité manque
export function construireProfilSecurite(row: any): ProfilSecurite {
  if (!row || !row.id) {
    throw new ErreurSecurite('PROFIL_INTROUVABLE', 'Profil introuvable : impossible de vérifier ta sécurité alimentaire.');
  }
  const manquants: string[] = [];
  if (typeof row.enceinte !== 'boolean')              manquants.push('enceinte');
  if (typeof row.allaitement !== 'boolean')           manquants.push('allaitement');
  if (!Array.isArray(row.allergies))                  manquants.push('allergies');
  if (!Array.isArray(row.regimes_alimentaires))       manquants.push('regimes_alimentaires');
  if (!Array.isArray(row.medications_actuelles))      manquants.push('medications_actuelles');
  if (!Array.isArray(row.pathologies_chroniques))     manquants.push('pathologies_chroniques');
  if (manquants.length > 0) {
    console.error(`[SECURITE] Profil ${row.id} incomplet — champs manquants : ${manquants.join(', ')}`);
    throw new ErreurSecurite(
      'PROFIL_INCOMPLET',
      'Ton profil santé est incomplet (allergies, régimes, grossesse, médicaments). Complète-le avant de générer un plan.'
    );
  }

  const allergies = new Set<string>();
  for (const a of row.allergies as string[]) {
    const c = canoniser(a);
    if (!c) continue;
    const id = ALIAS_ALLERGIES[c];
    if (!id) console.warn(`[SECURITE] Allergie non répertoriée "${a}" → mot interdit tel quel`);
    allergies.add(id ?? c);
  }

  const regimes = new Set<string>();
  for (const r of row.regimes_alimentaires as string[]) {
    const c = canoniser(r);
    if (!c) continue;
    if (c in ALIAS_REGIMES) {
      const id = ALIAS_REGIMES[c];
      if (id) regimes.add(id);
    } else {
      console.warn(`[SECURITE] Régime non répertorié "${r}" → ignoré (sans enjeu de sécurité connu)`);
    }
  }

  const medicaments = (row.medications_actuelles as string[]).map(normaliser).filter(Boolean);
  const classesMedicaments = Object.entries(CLASSES_MEDICAMENTS)
    .filter(([, noms]) => medicaments.some(m => noms.some(n => new RegExp('(?:^| )' + n).test(m))))
    .map(([classe]) => classe);

  const pathologies = (row.pathologies_chroniques as string[]).map(canoniser).filter(Boolean);

  return {
    profilId: String(row.id),
    allergies: [...allergies],
    regimes: [...regimes],
    enceinte: row.enceinte,
    allaitement: row.allaitement,
    medicaments,
    classesMedicaments,
    pathologies,
  };
}

export async function chargerProfilSecurite(supabase: SupabaseClient, profilId: string): Promise<ProfilSecurite> {
  if (!profilId) {
    throw new ErreurSecurite('PROFIL_ID_MANQUANT', 'Profil non identifié : impossible de vérifier ta sécurité alimentaire.');
  }
  const { data, error } = await supabase
    .from('profils_utilisateurs')
    .select('id, allergies, regimes_alimentaires, enceinte, allaitement, medications_actuelles, pathologies_chroniques')
    .eq('id', profilId)
    .maybeSingle();
  if (error) {
    console.error('[SECURITE] Lecture profil impossible :', error.message);
    throw new ErreurSecurite('PROFIL_ILLISIBLE', 'Impossible de lire ton profil santé pour le moment. Réessaie dans un instant.');
  }
  const profil = construireProfilSecurite(data);
  console.log(`[SECURITE] Profil ${profil.profilId} — allergies=[${profil.allergies}] régimes=[${profil.regimes}] enceinte=${profil.enceinte} allaitement=${profil.allaitement} médicaments=${profil.medicaments.length} (classes=[${profil.classesMedicaments}]) pathologies=[${profil.pathologies}]`);
  return profil;
}

export function aDesRestrictions(profil: ProfilSecurite): boolean {
  return profil.allergies.length > 0 || profil.regimes.length > 0 || profil.enceinte ||
    profil.allaitement || profil.medicaments.length > 0 || profil.pathologies.length > 0;
}

// ============================================================================
// DÉCISIONS PAR ITEM
// ============================================================================

export interface Decision { sur: boolean; raison?: string }
const SUR: Decision = { sur: true };
const exclu = (raison: string): Decision => ({ sur: false, raison });

// Racines ≥ 5 lettres : recherchées n'importe où (« antidiabétiques » contient « diabet ») ;
// racines courtes (sii, ibs) : en début de mot seulement, pour éviter les faux positifs.
function pathologieDansCI(ci: string, profil: ProfilSecurite): string | null {
  for (const p of profil.pathologies) {
    const racines = PATHOLOGIES_SYNONYMES[p] ?? [p.replace(/_/g, ' ')];
    const trouve = racines.some(r => {
      const n = normaliser(r);
      return n.length >= 5 ? ci.includes(n) : new RegExp('(?:^| )' + n).test(ci);
    });
    if (trouve) return p;
  }
  return null;
}

// Aliment (table alimentation)
export function alimentEstSur(a: any, profil: ProfilSecurite): Decision {
  if (!a) return exclu('aliment vide');
  const regimes = new Set(profil.regimes);
  const allergies = new Set(profil.allergies);
  // Booléens de régime : null ou false → exclu (fail closed)
  if (regimes.has('vegan') && a.regime_vegan !== true)            return exclu('régime vegan (flag BDD)');
  if (regimes.has('vegetarien') && a.regime_vegetarien !== true)  return exclu('régime végétarien (flag BDD)');
  if ((regimes.has('sans_gluten') || allergies.has('gluten')) && a.sans_gluten !== true)   return exclu('sans gluten (flag BDD)');
  if ((regimes.has('sans_lactose') || allergies.has('lactose')) && a.sans_lactose !== true) return exclu('sans lactose (flag BDD)');

  const v = violationsDansTexte(`${a.nom ?? ''} | ${a.categorie ?? ''} | ${a.allergenes ?? ''}`, reglesActives(profil));
  if (v.length > 0) return exclu(`${v[0].regle} (« ${v[0].mot} »)`);

  const ci = normaliser(enTexte(a.contre_indications));
  if (profil.enceinte && RE_CI_GROSSESSE.test(ci))      return exclu('grossesse (contre-indication)');
  if (profil.allaitement && RE_CI_ALLAITEMENT.test(ci)) return exclu('allaitement (contre-indication)');
  if (profil.medicaments.length > 0 && RE_CI_MEDICAMENTS.test(ci)) return exclu('interaction médicamenteuse (contre-indication)');
  if (profil.classesMedicaments.includes('anticoagulant') && RE_CI_ANTICOAGULANT.test(ci)) return exclu('anticoagulants (contre-indication)');
  return SUR;
}

// Nutraceutique ou huile essentielle
export function produitEstSur(p: any, type: 'nutraceutique' | 'aromatherapie', profil: ProfilSecurite): Decision {
  if (!p) return exclu('produit vide');
  // Décision produit : grossesse / allaitement / tout médicament → aucun complément ni HE
  if (profil.enceinte)               return exclu('grossesse (compléments et HE exclus d\'office)');
  if (profil.allaitement)            return exclu('allaitement (compléments et HE exclus d\'office)');
  if (profil.medicaments.length > 0) return exclu('médicament déclaré (compléments et HE exclus d\'office)');
  if (type === 'aromatherapie' && normaliser(p.statut) !== 'valide') return exclu(`HE non validée (statut « ${p.statut ?? 'vide'} »)`);

  const ciBrut = type === 'aromatherapie'
    ? enTexte(p.contre_indications_majeures ?? p.contre_indications)
    : enTexte(p.contre_indications);
  const ci = normaliser(ciBrut);
  if (!ci && (profil.pathologies.length > 0 || profil.allergies.length > 0)) return exclu('contre-indications absentes (fail closed)');

  const patho = pathologieDansCI(ci, profil);
  if (patho) return exclu(`pathologie ${patho} (contre-indication)`);

  const identite = [p.nom, p.nom_scientifique, p.nom_latin, p.forme_recommandee, p.categorie].map(enTexte).join(' | ');
  const v = violationsDansTexte(identite, reglesActives(profil), { produits: true });
  if (v.length > 0) return exclu(`${v[0].regle} (« ${v[0].mot} »)`);
  // Allergies citées dans les contre-indications (ex. « allergie poisson »)
  const reglesAllergies = profil.allergies.map(regleCompilee);
  const vCi = violationsDansTexte(ciBrut, reglesAllergies);
  if (vCi.length > 0) return exclu(`${vCi[0].regle} (contre-indication « ${vCi[0].mot} »)`);
  return SUR;
}

// Routine bien-être
export function routineEstSure(r: any, profil: ProfilSecurite): Decision {
  if (!r) return exclu('routine vide');
  const ci = normaliser(enTexte(r.contre_indications));
  if (!ci && (profil.enceinte || profil.allaitement || profil.pathologies.length > 0)) return exclu('contre-indications absentes (fail closed)');
  if (profil.enceinte && RE_CI_GROSSESSE.test(ci))      return exclu('grossesse (contre-indication)');
  if (profil.allaitement && RE_CI_ALLAITEMENT.test(ci)) return exclu('allaitement (contre-indication)');
  const patho = pathologieDansCI(ci, profil);
  if (patho) return exclu(`pathologie ${patho} (contre-indication)`);
  return SUR;
}

// Recette de la table `recettes` (fallback BDD)
export function recetteBddEstSure(r: any, profil: ProfilSecurite): Decision {
  if (!r) return exclu('recette vide');
  const regimes = new Set(profil.regimes);
  const allergies = new Set(profil.allergies);
  if (regimes.has('vegan') && r.regime_vegan !== true)           return exclu('régime vegan (flag BDD)');
  if (regimes.has('vegetarien') && r.regime_vegetarien !== true) return exclu('régime végétarien (flag BDD)');
  if ((regimes.has('sans_gluten') || allergies.has('gluten')) && r.sans_gluten !== true) return exclu('sans gluten (flag BDD)');
  if (regimes.has('halal') && r.regime_halal !== true)           return exclu('régime halal (flag BDD)');
  if (regimes.has('casher') && r.regime_casher !== true)         return exclu('régime casher (flag BDD)');
  // Ingrédients non vérifiables + profil avec restrictions → exclu (fail closed)
  const ids = Array.isArray(r.ingredients_ids) ? r.ingredients_ids.filter(Boolean) : [];
  if (ids.length === 0 && aDesRestrictions(profil)) return exclu('ingrédients inconnus (fail closed)');
  const v = violationsDansTexte(`${r.nom ?? ''} | ${ids.join(' | ')} | ${enTexte(r.instructions)} | ${enTexte(r.variantes)}`, reglesActives(profil));
  if (v.length > 0) return exclu(`${v[0].regle} (« ${v[0].mot} »)`);
  return SUR;
}

// ============================================================================
// INGRÉDIENTS LIBRES (pools codés en dur, protéines imposées, frigo utilisateur)
// ============================================================================

export function ingredientEstSur(nom: string, profil: ProfilSecurite): Decision {
  const v = violationsDansTexte(nom, reglesActives(profil));
  return v.length > 0 ? exclu(`${v[0].regle} (« ${v[0].mot} »)`) : SUR;
}

export function filtrerIngredients(
  noms: string[],
  profil: ProfilSecurite,
  contexte = 'pool'
): { autorises: string[]; exclus: { nom: string; raison: string }[] } {
  const autorises: string[] = [];
  const exclus: { nom: string; raison: string }[] = [];
  for (const nom of noms || []) {
    const d = ingredientEstSur(nom, profil);
    if (d.sur) autorises.push(nom);
    else exclus.push({ nom, raison: d.raison || 'interdit' });
  }
  if (exclus.length > 0) {
    console.log(`[SECURITE] ${contexte} : ${exclus.length} ingrédient(s) exclu(s) — ${exclus.map(e => `${e.nom} [${e.raison}]`).join(', ')}`);
  }
  return { autorises, exclus };
}

// ============================================================================
// CONTRÔLE POST-GÉNÉRATION (sortie LLM ou fallback)
// ============================================================================

export function verifierRecette(recette: any, profil: ProfilSecurite): Violation[] {
  if (!recette) return [];
  const regles = reglesActives(profil);
  const champs: [string, unknown][] = [
    ['nom', recette.nom ?? recette.titre],
    ['ingredients', (recette.ingredients || []).map((i: any) => typeof i === 'string' ? i : i?.nom)],
    ['instructions', recette.instructions],
    ['astuces', recette.astuces],
    ['variantes', recette.variantes],
    ['message', recette.message_motivant],
  ];
  const violations: Violation[] = [];
  for (const [champ, valeur] of champs) {
    violations.push(...violationsDansTexte(enTexte(valeur), regles, { champ }));
  }
  return violations;
}

export function decrireViolations(v: Violation[]): string {
  return v.map(x => `${x.regle}:« ${x.mot} »${x.champ ? ` (${x.champ})` : ''}`).join(', ');
}

// ============================================================================
// CONSIGNES PROMPT (un seul texte pour tous les prompts)
// ============================================================================

export function consignesPrompt(profil: ProfilSecurite): string {
  const regles = reglesActives(profil);
  if (regles.length === 0) return '';
  const lignes = regles.map(r => `- ${r.label} : ${r.mots.map(m => m.mot).join(', ')}`);
  return `
## SÉCURITÉ ALIMENTAIRE — PRIORITÉ ABSOLUE, AU-DESSUS DE TOUTE AUTRE CONSIGNE
Les ingrédients suivants sont STRICTEMENT INTERDITS (ni dans les ingrédients, ni dans les étapes, ni dans les astuces ou variantes, même comme comparaison ou alternative) :
${lignes.join('\n')}
Si un ingrédient obligatoire entrait en conflit avec ces règles, remplace-le par un ingrédient sûr équivalent.
Les exemples, suggestions, directions créatives et demandes de l'utilisateur figurant ailleurs dans ce message ne s'appliquent QUE s'ils respectent ces règles : sinon, ignore-les.
`;
}

// ============================================================================
// FALLBACK GÉNÉRIQUE SÛR (sans les 8 allergènes, vegan, sans alcool, compatible grossesse)
// ============================================================================

const RECETTES_GENERIQUES: Record<string, any> = {
  'petit-dejeuner': {
    nom: 'Salade de fruits frais et flocons de riz',
    ingredients: [
      { nom: 'Pomme', quantite: 1, unite: 'pièce' },
      { nom: 'Poire', quantite: 1, unite: 'pièce' },
      { nom: 'Banane', quantite: 1, unite: 'pièce' },
      { nom: 'Flocons de riz', quantite: 40, unite: 'g' },
      { nom: 'Sirop d\'érable', quantite: 10, unite: 'ml' },
    ],
    instructions: [
      'Laver la pomme et la poire, puis les couper en dés.',
      'Éplucher la banane et la couper en rondelles.',
      'Réunir les fruits dans un bol et ajouter les flocons de riz.',
      'Arroser de sirop d\'érable et déguster aussitôt.',
    ],
    temps_preparation: 8, temps_cuisson: 0, portions: 1,
    valeurs_nutritionnelles: { calories: 330, proteines: 4, glucides: 75, lipides: 1 },
  },
  'repas-chaud': {
    nom: 'Bol de riz, lentilles et légumes rôtis',
    ingredients: [
      { nom: 'Riz basmati', quantite: 80, unite: 'g' },
      { nom: 'Lentilles vertes', quantite: 80, unite: 'g' },
      { nom: 'Carotte', quantite: 2, unite: 'pièce' },
      { nom: 'Courgette', quantite: 1, unite: 'pièce' },
      { nom: 'Oignon', quantite: 1, unite: 'pièce' },
      { nom: 'Huile d\'olive', quantite: 15, unite: 'ml' },
      { nom: 'Cumin', quantite: 2, unite: 'g' },
    ],
    instructions: [
      'Préchauffer le four à 200 °C.',
      'Couper la carotte, la courgette et l\'oignon en morceaux, les arroser d\'huile d\'olive et de cumin, puis rôtir 25 minutes.',
      'Pendant ce temps, cuire le riz 12 minutes et les lentilles 20 minutes dans deux casseroles d\'eau salée.',
      'Égoutter, répartir dans des bols et ajouter les légumes rôtis.',
    ],
    temps_preparation: 10, temps_cuisson: 25, portions: 2,
    valeurs_nutritionnelles: { calories: 480, proteines: 18, glucides: 80, lipides: 9 },
  },
  'repas-froid': {
    nom: 'Salade de quinoa, lentilles et crudités',
    ingredients: [
      { nom: 'Quinoa précuit', quantite: 150, unite: 'g' },
      { nom: 'Lentilles cuites', quantite: 150, unite: 'g' },
      { nom: 'Concombre', quantite: 1, unite: 'pièce' },
      { nom: 'Tomates cerises', quantite: 150, unite: 'g' },
      { nom: 'Carotte', quantite: 1, unite: 'pièce' },
      { nom: 'Huile d\'olive', quantite: 15, unite: 'ml' },
      { nom: 'Jus de citron', quantite: 15, unite: 'ml' },
    ],
    instructions: [
      'Rincer le quinoa précuit et les lentilles cuites, puis les égoutter.',
      'Couper le concombre en dés, les tomates cerises en deux et râper la carotte.',
      'Mélanger le tout dans un saladier.',
      'Assaisonner d\'huile d\'olive, de jus de citron, de sel et de poivre, et servir frais.',
    ],
    temps_preparation: 12, temps_cuisson: 0, portions: 2,
    valeurs_nutritionnelles: { calories: 430, proteines: 17, glucides: 62, lipides: 11 },
  },
  'collation': {
    nom: 'Assiette de fruits frais et galettes de riz',
    ingredients: [
      { nom: 'Pomme', quantite: 1, unite: 'pièce' },
      { nom: 'Galettes de riz', quantite: 2, unite: 'pièce' },
    ],
    instructions: [
      'Laver et couper la pomme en quartiers.',
      'Servir avec les galettes de riz.',
    ],
    temps_preparation: 3, temps_cuisson: 0, portions: 1,
    valeurs_nutritionnelles: { calories: 160, proteines: 2, glucides: 36, lipides: 1 },
  },
};

export function recetteGeneriqueSure(
  typeRepas: string,
  modeRepas: 'chaud' | 'froid',
  profil: ProfilSecurite
): any {
  const t = normaliser(typeRepas);
  const cle = t.startsWith('petit') ? 'petit-dejeuner'
    : (t === 'collation' || t === 'pause') ? 'collation'
    : modeRepas === 'froid' ? 'repas-froid' : 'repas-chaud';
  const recette = {
    ...structuredClone(RECETTES_GENERIQUES[cle]),
    type_repas: typeRepas,
    style_culinaire: 'simple',
    astuces: ['Une assiette simple et équilibrée, choisie pour respecter tes contraintes alimentaires.'],
    variantes: [],
    genere_par_llm: false,
    source_securite: 'fallback_generique',
  };
  const v = verifierRecette(recette, profil);
  if (v.length > 0) {
    console.error(`[SECURITE] Recette générique ${cle} non conforme au profil : ${decrireViolations(v)}`);
    throw new ErreurSecurite('AUCUNE_RECETTE_SURE', 'Impossible de proposer une recette sûre pour ton profil. Contacte le support.');
  }
  return recette;
}

// ============================================================================
// RÉPONSE HTTP D'ERREUR SÉCURITÉ (avec les en-têtes CORS de la fonction appelante)
// ============================================================================

export function reponseErreurSecurite(err: ErreurSecurite, corsHeaders: Record<string, string>): Response {
  const status = err.code === 'PROFIL_INTROUVABLE' ? 404
    : err.code === 'PROFIL_ILLISIBLE' ? 503
    : 422;
  return new Response(
    JSON.stringify({ success: false, error: err.message, code: err.code }),
    { status, headers: corsHeaders }
  );
}
