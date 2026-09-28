// Tests du module de sécurité niveau 1 — lancer : deno test supabase/functions/_shared/securite_test.ts
import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  normaliser, construireProfilSecurite, ErreurSecurite, ProfilSecurite,
  alimentEstSur, produitEstSur, routineEstSure, recetteBddEstSure,
  filtrerIngredients, ingredientEstSur, verifierRecette, recetteGeneriqueSure, consignesPrompt,
} from './securite.ts';

// ─── Profils types ──────────────────────────────────────────────────────────
function profil(overrides: Record<string, unknown> = {}): ProfilSecurite {
  return construireProfilSecurite({
    id: 'test', enceinte: false, allaitement: false,
    allergies: [], regimes_alimentaires: ['omnivore'], medications_actuelles: [], pathologies_chroniques: [],
    ...overrides,
  });
}
const SANS_RESTRICTION = profil();
const POISSON     = profil({ allergies: ['poisson'] });
const NOIX        = profil({ allergies: ['noix'] });
const GLUTEN      = profil({ regimes_alimentaires: ['sans_gluten'] });       // valeur réelle en BDD (underscore)
const LACTOSE     = profil({ allergies: ['lactose'] });
const VEGAN       = profil({ regimes_alimentaires: ['vegan'] });
const ENCEINTE    = profil({ enceinte: true });
const ALLAITANTE  = profil({ allaitement: true });
const ANTICOAG    = profil({ medications_actuelles: ['Xarelto 20 mg'] });
const MEDIC_INCONNU = profil({ medications_actuelles: ['Truc-machin'] });

// Profil cumulant toutes les restrictions (pour valider le fallback générique)
const TOUT = profil({
  allergies: ['poisson', 'crustaces', 'noix', 'arachides', 'soja', 'sesame', 'gluten', 'lactose'],
  regimes_alimentaires: ['vegan', 'vegetarien', 'sans_gluten', 'sans_lactose', 'halal', 'casher'],
  enceinte: true, allaitement: true,
  medications_actuelles: ['Marcoumar'], pathologies_chroniques: ['diabete', 'hypertension'],
});

// Données types (formes réelles des tables)
const alim = (o: Record<string, unknown>) => ({
  regime_vegan: true, regime_vegetarien: true, sans_gluten: true, sans_lactose: true,
  categorie: 'Légume', allergenes: 'Aucun', contre_indications: 'Aucune majeure', ...o,
});
const NUTRA_MAGNESIUM = { nom: 'Magnésium', contre_indications: 'Insuffisance rénale', statut: 'Validé' };
const NUTRA_OMEGA3 = { nom: 'Oméga-3', forme_recommandee: 'Huile de poisson en capsules', contre_indications: 'Risque accru de saignements', statut: 'Validé' };
const HE_LAVANDE = { nom: 'Lavande vraie', contre_indications_majeures: 'Grossesse 1er trimestre, enfants <3 ans', statut: 'Validé' };

const exclus = (noms: string[], p: ProfilSecurite) => filtrerIngredients(noms, p, 'test').exclus.map(e => e.nom);
const autorises = (noms: string[], p: ProfilSecurite) => filtrerIngredients(noms, p, 'test').autorises;

// ─── Normalisation ──────────────────────────────────────────────────────────
Deno.test('normaliser : casse, accents, œ, ponctuation', () => {
  assertEquals(normaliser("Œufs BROUILLÉS, crème-fraîche & beurre d'Amande"), 'oeufs brouilles creme fraiche beurre d amande');
});

// ─── Profil : fail closed ───────────────────────────────────────────────────
Deno.test('profil : champs de sécurité manquants → ErreurSecurite PROFIL_INCOMPLET', () => {
  const e1 = assertThrows(() => profil({ enceinte: null }), ErreurSecurite) as ErreurSecurite;
  assertEquals(e1.code, 'PROFIL_INCOMPLET');
  const e2 = assertThrows(() => profil({ allergies: null }), ErreurSecurite) as ErreurSecurite;
  assertEquals(e2.code, 'PROFIL_INCOMPLET');
  assertThrows(() => profil({ medications_actuelles: undefined }), ErreurSecurite);
  assertThrows(() => profil({ regimes_alimentaires: null }), ErreurSecurite);
  assertThrows(() => profil({ pathologies_chroniques: null }), ErreurSecurite);
});

Deno.test('profil : introuvable → ErreurSecurite PROFIL_INTROUVABLE', () => {
  const e = assertThrows(() => construireProfilSecurite(null), ErreurSecurite) as ErreurSecurite;
  assertEquals(e.code, 'PROFIL_INTROUVABLE');
});

Deno.test('profil : canonisation (sans_gluten / sans-gluten, alias, anticoagulants)', () => {
  assertEquals(profil({ regimes_alimentaires: ['sans-gluten'] }).regimes, ['sans_gluten']);
  assertEquals(profil({ regimes_alimentaires: ['Végétalien', 'omnivore', 'keto'] }).regimes, ['vegan']);
  assertEquals(profil({ allergies: ['Crustacés', 'Fruits à coque'] }).allergies, ['crustaces', 'noix']);
  assertEquals(ANTICOAG.classesMedicaments, ['anticoagulant']);
  assertEquals(MEDIC_INCONNU.classesMedicaments, []);
});

// ─── Allergie poisson ───────────────────────────────────────────────────────
Deno.test('allergie poisson : ingrédients, aliments BDD, oméga-3, sortie LLM', () => {
  assertEquals(
    exclus(['Pavé de saumon', 'Thon en conserve', 'Filet de cabillaud', 'Sauce nuoc-mâm', 'Courgette', 'Lentilles corail'], POISSON),
    ['Pavé de saumon', 'Thon en conserve', 'Filet de cabillaud', 'Sauce nuoc-mâm'],
  );
  assert(!alimentEstSur(alim({ nom: 'Maquereau', categorie: 'Poisson gras', allergenes: 'Poisson', regime_vegan: false, regime_vegetarien: false }), POISSON).sur);
  assert(!alimentEstSur(alim({ nom: 'Alose', categorie: "Poisson d'eau douce", allergenes: 'Poissons' }), POISSON).sur);
  assert(alimentEstSur(alim({ nom: 'Brocoli' }), POISSON).sur);
  assert(!produitEstSur(NUTRA_OMEGA3, 'nutraceutique', POISSON).sur);
  assert(produitEstSur(NUTRA_OMEGA3, 'nutraceutique', SANS_RESTRICTION).sur);
  // Poisson caché dans une variante → violation
  const v = verifierRecette({ nom: 'Bowl', ingredients: [{ nom: 'Riz' }], instructions: ['Cuire le riz.'], variantes: ['Ajouter du saumon fumé.'] }, POISSON);
  assertEquals(v.map(x => x.regle), ['poisson']);
  // Pas de faux positif sur « au lieu de »
  assertEquals(verifierRecette({ nom: 'Riz', instructions: ["Utiliser de l'huile au lieu du beurre."] }, POISSON), []);
});

// ─── Allergie fruits à coque ────────────────────────────────────────────────
Deno.test('allergie fruits à coque : pools petit-déj, beurre et lait d\'amande, pralin', () => {
  assertEquals(
    exclus(["beurre d'amande", 'noix de cajou', 'Noisettes', 'Pistaches', 'Praliné', "Lait d'amande", 'Noix de coco râpée', 'banane', 'myrtilles'], NOIX),
    ["beurre d'amande", 'noix de cajou', 'Noisettes', 'Pistaches', 'Praliné', "Lait d'amande", 'Noix de coco râpée'],
  );
  assert(!alimentEstSur(alim({ nom: 'Noix du Brésil', categorie: 'Fruits oléagineux', allergenes: 'Fruits à coque' }), NOIX).sur);
  assert(!alimentEstSur(alim({ nom: 'Macadamia', categorie: 'Divers', allergenes: 'Fruits à coque (traces possibles)' }), NOIX).sur);
  // Granola / muesli / pâte à tartiner : souvent aux noix → exclus (fail closed)
  assertEquals(exclus(['Granola', 'Muesli croustillant', 'Pâte à tartiner', 'Flocons de riz'], NOIX), ['Granola', 'Muesli croustillant', 'Pâte à tartiner']);
});

// ─── Sans gluten ────────────────────────────────────────────────────────────
Deno.test('sans gluten (régime sans_gluten) : céréales à gluten exclues, alternatives gardées', () => {
  assertEquals(
    exclus(['Pâtes complètes', 'Pain complet', "Flocons d'avoine", 'Couscous', 'Granola', 'Sauce soja', 'Chapelure'], GLUTEN).length, 7,
  );
  assertEquals(
    autorises(['Pâtes sans gluten', 'Farine de riz', 'Quinoa', 'Riz basmati', 'Galettes de sarrasin', 'Pâte de curry', 'Blé noir'], GLUTEN).length, 7,
  );
  assert(!alimentEstSur(alim({ nom: 'Épeautre', sans_gluten: false }), GLUTEN).sur);
  assert(!alimentEstSur(alim({ nom: 'Mystère', sans_gluten: null }), GLUTEN).sur, 'flag null → exclu (fail closed)');
  assertEquals(verifierRecette({ instructions: ['Toaster 2 minutes au grille-pain.'] }, GLUTEN), []);
  // Donnée BDD réelle : « Fromage à pâte dure » n'est pas du gluten ; « Avoine » flaggée sans_gluten=true reste exclue
  assert(alimentEstSur(alim({ nom: 'Parmesan', categorie: 'Fromage à pâte dure pressée cuite' }), GLUTEN).sur);
  assert(!alimentEstSur(alim({ nom: 'Avoine', categorie: 'Céréale complète', sans_gluten: true }), GLUTEN).sur);
  // L'allergie « gluten » déclenche la même règle
  assert(!ingredientEstSur('Pain complet', profil({ allergies: ['gluten'] })).sur);
});

// ─── Sans lactose ───────────────────────────────────────────────────────────
Deno.test('sans lactose : laitiers exclus, alternatives végétales gardées', () => {
  assertEquals(exclus(['Yaourt grec', 'Ricotta', 'Fromage blanc', 'Crème fraîche', 'Beurre'], LACTOSE).length, 5);
  assertEquals(autorises(["Lait d'amande", 'Yaourt végétal', 'Crème de coco', 'Beurre de cacahuète', 'Yaourt sans lactose'], LACTOSE).length, 5);
  assertEquals(verifierRecette({ instructions: ["Mixer jusqu'à consistance crémeuse."], astuces: ['Idéal pour les intolérants au lactose.'] }, LACTOSE), []);
});

// ─── Vegan ──────────────────────────────────────────────────────────────────
Deno.test('vegan : produits animaux exclus (y compris sans lactose, miel, gélatine)', () => {
  assertEquals(
    exclus(['Filet de poulet', 'Œufs', 'Miel', 'Yaourt sans lactose', 'Gélatine', 'Bouillon de volaille', 'Noix de Saint-Jacques', 'Anchois'], VEGAN).length, 8,
  );
  assertEquals(autorises(['Tofu ferme', "Lait d'avoine", 'Lentilles corail', 'Sirop d\'agave', 'Fruits à coque concassés'], VEGAN).length, 5);
  assert(!alimentEstSur(alim({ nom: 'Poulet', regime_vegan: false }), VEGAN).sur);
  assert(!alimentEstSur(alim({ nom: 'Mystère', regime_vegan: null }), VEGAN).sur);
  assert(!produitEstSur(NUTRA_OMEGA3, 'nutraceutique', VEGAN).sur);
});

// ─── Grossesse ──────────────────────────────────────────────────────────────
Deno.test('grossesse : compléments et HE exclus, aliments et routines à risque exclus', () => {
  assert(!produitEstSur(NUTRA_MAGNESIUM, 'nutraceutique', ENCEINTE).sur, 'nutraceutique sans mention grossesse → exclu quand même');
  assert(!produitEstSur(HE_LAVANDE, 'aromatherapie', ENCEINTE).sur);
  assert(!alimentEstSur(alim({ nom: 'Foie de Veau', contre_indications: 'Hypervitaminose A (grossesse, enfants)' }), ENCEINTE).sur);
  assert(!alimentEstSur(alim({ nom: 'Thon (frais ou au naturel)', contre_indications: 'Mercure' }), ENCEINTE).sur, 'thon interdit par mot-clé');
  // Faux positif assumé (fail closed) : la mâche mentionne les femmes enceintes
  assert(!alimentEstSur(alim({ nom: 'Mâche', contre_indications: 'particulièrement recommandée pour les femmes enceintes' }), ENCEINTE).sur);
  assert(alimentEstSur(alim({ nom: 'Courgette' }), ENCEINTE).sur);
  assert(!routineEstSure({ nom: 'Yoga Nidra', contre_indications: 'Dépression sévère, grossesse avancée sans avis médical' }, ENCEINTE).sur);
  assert(routineEstSure({ nom: 'Marche', contre_indications: 'Douleurs articulaires aiguës' }, ENCEINTE).sur);
  const v = verifierRecette({ nom: 'Carpaccio de bœuf', ingredients: [{ nom: 'Vin blanc' }, { nom: 'Vinaigre de vin' }] }, ENCEINTE);
  assertEquals(v.map(x => x.mot).sort(), ['carpaccio', 'vin'].sort());
});

// ─── Allaitement ────────────────────────────────────────────────────────────
Deno.test('allaitement : compléments et HE exclus, alcool et poissons à mercure interdits', () => {
  assert(!produitEstSur(NUTRA_MAGNESIUM, 'nutraceutique', ALLAITANTE).sur);
  assert(!produitEstSur(HE_LAVANDE, 'aromatherapie', ALLAITANTE).sur);
  assert(!alimentEstSur(alim({ nom: 'Mélisse', contre_indications: 'femmes enceintes/allaitantes (consulter médecin)' }), ALLAITANTE).sur);
  assertEquals(exclus(['Steak d\'espadon', 'Bière', 'Courgette'], ALLAITANTE), ["Steak d'espadon", 'Bière']);
});

// ─── Anticoagulants ─────────────────────────────────────────────────────────
Deno.test('anticoagulants (Xarelto) : compléments et HE exclus, aliments à interaction exclus', () => {
  assert(!produitEstSur(NUTRA_MAGNESIUM, 'nutraceutique', ANTICOAG).sur);
  assert(!produitEstSur(HE_LAVANDE, 'aromatherapie', ANTICOAG).sur);
  assert(!alimentEstSur(alim({ nom: 'Épinards', contre_indications: 'Calculs rénaux, hypervitaminose K (anticoagulants)' }), ANTICOAG).sur);
  assert(!alimentEstSur(alim({ nom: 'Curcuma', contre_indications: 'Grossesse, calculs biliaires, anticoagulants' }), ANTICOAG).sur);
  assert(alimentEstSur(alim({ nom: 'Haricots verts', contre_indications: 'Aucune majeure; surveiller sodium en conserve' }), ANTICOAG).sur);
  assertEquals(exclus(['Pamplemousse rose', 'Orange'], ANTICOAG), ['Pamplemousse rose']);
});

Deno.test('médicament non reconnu : compléments et HE exclus, aliments « interactions médicaments » exclus', () => {
  assert(!produitEstSur(NUTRA_MAGNESIUM, 'nutraceutique', MEDIC_INCONNU).sur);
  assert(!alimentEstSur(alim({ nom: 'Thé vert', contre_indications: 'interactions médicaments (warfarine)' }), MEDIC_INCONNU).sur);
  assert(alimentEstSur(alim({ nom: 'Carotte' }), MEDIC_INCONNU).sur);
});

// ─── Pathologies, statut HE, recettes BDD ───────────────────────────────────
Deno.test('pathologies : contre-indication accentuée détectée (diabete → diabétiques)', () => {
  const diab = profil({ pathologies_chroniques: ['diabete'] });
  assert(!routineEstSure({ nom: 'Pédiluve', contre_indications: 'Consulter un professionnel pour patients diabétiques' }, diab).sur);
  assert(!produitEstSur({ nom: 'Cannelle', contre_indications: 'interaction antidiabétiques', statut: 'Validé' }, 'nutraceutique', diab).sur);
  assert(produitEstSur(NUTRA_MAGNESIUM, 'nutraceutique', diab).sur);
});

Deno.test('aromathérapie « À traiter » exclue même sans restriction', () => {
  assert(!produitEstSur({ ...HE_LAVANDE, statut: 'À traiter' }, 'aromatherapie', SANS_RESTRICTION).sur);
  assert(produitEstSur(HE_LAVANDE, 'aromatherapie', SANS_RESTRICTION).sur);
});

Deno.test('recettes BDD : ingrédients inconnus + restrictions → exclue', () => {
  const r = { nom: 'Porridge Énergisant', ingredients_ids: null, regime_vegan: true, regime_vegetarien: true, sans_gluten: true, regime_halal: true, regime_casher: true };
  assert(!recetteBddEstSure(r, POISSON).sur);
  assert(recetteBddEstSure(r, SANS_RESTRICTION).sur);
});

// ─── Halal / casher ─────────────────────────────────────────────────────────
Deno.test('halal et casher', () => {
  const halal = profil({ regimes_alimentaires: ['halal'] });
  const casher = profil({ regimes_alimentaires: ['casher'] });
  assertEquals(exclus(['Lardons fumés', 'Vin rouge', 'Vinaigre de vin', 'Poulet'], halal), ['Lardons fumés', 'Vin rouge']);
  assertEquals(exclus(['Jambon cru', 'Crevettes', 'Saumon'], casher), ['Jambon cru', 'Crevettes']);
});

// ─── Fallback générique ─────────────────────────────────────────────────────
Deno.test('recette générique : sûre pour le profil cumulant TOUTES les restrictions', () => {
  for (const type of ['petit-dejeuner', 'dejeuner', 'diner', 'collation', 'pause']) {
    for (const mode of ['chaud', 'froid'] as const) {
      const r = recetteGeneriqueSure(type, mode, TOUT);
      assertEquals(verifierRecette(r, TOUT), [], `${type}/${mode}`);
      assertEquals(r.genere_par_llm, false);
    }
  }
});

// ─── Consignes prompt ───────────────────────────────────────────────────────
Deno.test('consignes prompt : listent les mots interdits, vides sans restriction', () => {
  assertEquals(consignesPrompt(SANS_RESTRICTION), '');
  const c = consignesPrompt(POISSON);
  assert(c.includes('saumon') && c.includes('cabillaud') && c.includes('STRICTEMENT INTERDITS'));
});
