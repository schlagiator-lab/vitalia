// ── Constantes Supabase ──
export const SUPABASE_URL      = 'https://ptzmyuugxhsbrynjwlhp.supabase.co'
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0em15dXVneGhzYnJ5bmp3bGhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNDY1NjUsImV4cCI6MjA4NTYyMjU2NX0.Pel8am6iplwwFSqolEV7JOG6nxsOx4BxxJPLsObRC-4'

// ── État mutable partagé entre tous les modules ──
// Tous les modules importent `st` et lisent/écrivent ses propriétés.
export const st = {
  // Auth
  authToken:           SUPABASE_ANON_KEY,
  _deconnexionEnCours: false,
  _sessionInitialisee: false,

  // Profil utilisateur
  profil_id:         null,
  profilUtilisateur: null,

  // Préférences / chips partagés
  currentTab:               'aujourdhui',
  selectedSymptoms:         ['vitalite', 'serenite'],
  selectedRegimes:          [],
  selectedBudget:           'moyen',
  profilTempsCuisineCourant: 30,
  profilAllergiesCourantes: [],
  currentActiveAllies:      [],
  defaultPortions:          2,

  // Plan du jour
  currentPlan:     null,
  recipeServings:  { matin: 1, midi: 1, apres_midi: 1, soir: 1 },
  recipeBaseIng:   {},

  // Semaine
  semainePlanData:          null,
  semaineCheckedThisSession: false,
  semaineRepasInclus:       ['petit_dejeuner', 'dejeuner', 'diner', 'pause'],
  semaineServings:          {},
  semaineBaseIng:           {},
  semaineRatings:           {},
  semaineSelected:          {},
  semaineJourOuvert:        'lundi',

  // Recette à la demande
  recetteIngredientsFrigo: [],
  recetteTypeRepas:        'dejeuner',
  recetteSelectedSymptoms: ['vitalite', 'serenite'],
  recetteCourante:         null,
  recetteFrigoTags:        [],

  // Profil panel — tags dynamiques
  ppAllergiesPresets:   [],
  ppAllergiesCustom:    [],
  ppPathologiesPresets: [],
  ppPathologiesCustom:  [],
  ppMedicaments:        [],

  // À faire — recettes sauvegardées
  savedRecipes:   [],
  savedSelected:  {},
  savedServings:  {},

  // Liste de courses (modale semaine)
  coursesChecked:       {},
  _coursesIngredients:  [],
}
