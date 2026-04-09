// ── Point d'entrée Vite — Étape 3 : modules branchés ──
import { st } from './modules/state.js'
import { _sb, setupAuth, deconnexion } from './modules/auth.js'
import {
  chargerProfilSupabase, sauvegarderProfil, migrerFavoris,
  chargerRecettesSauvegardeesSupabase, chargerFavorisSupabase, chargerListeCoursesSupabase
} from './modules/api.js'
import {
  ouvrirConfig, fermerConfig, ouvrirProfilPanel, fermerProfilPanel, fermerTout,
  switchTab, switchAtfaireSection,
  toggleSymptom, toggleSharedRegime, selectSharedTemps, selectSharedBudget,
  autoSauvegarderPreferences, autoSauvegarderProfilComplet, syncAllPreferencesChips,
  updateProfilRecaps, updateObjectifPrincipalBadge, appliquerProfil,
  chargerProfilUI, toggleProfilObjectif, toggleProfilRegime, toggleProfilAllergie,
  selectProfilTempsCuisine, modifierProfilComplet, toggleEmailDigest,
  ouvrirAlly, fermerAlly, setText, changerDefaultPortions,
  ouvrirSheet, fermerSheet,
  switchBloodtypeTab
} from './modules/ui.js'
import {
  toggleInstructions, toggleRoutineItem,
  afficherPlan, changerPortions, noterRecette, sauvegarderRecette,
  noterPlan, genererPlan,
  toggleSemaineSymptom, toggleDay, toggleDayMeal, genererSemaine,
  afficherSemaine, chargerEtapesRecette, changerPortionsSemaine, noterRecetteSemaine,
  sauvegarderRecetteSemaine, toggleSelectRecetteSemaine, reagregerDepuisRecettes,
  afficherListeCourses, toggleCoursesModalItem, fermerListeCourses, sauvegarderListeCourses,
  genererRecettePourRepas
} from './modules/plan.js'
import {
  toggleRepasInclus, selectTypeRepas, toggleRecetteSymptom,
  ajouterIngredientFrigo, supprimerIngredientFrigo,
  genererRecetteUnique, afficherRecetteUnique, sauvegarderRecetteUnique,
  afficherRecettesSauvegardees, filtrerRecettesSauvegardees,
  afficherFavoris, filtrerFavoris, supprimerFavori, ajouterFavoriAuxCourses,
  toggleSavedRecette, supprimerRecetteSauvegardee, noterRecetteSauvegardee,
  toggleSelectSaved, changerPortionsSaved, changerPortionsFavori,
  afficherListeCoursesProfile, toggleCoursesVuByIdx, ajouterArticleManuelCourses,
  supprimerArticleManuelCourses, toggleCoursesVu,
  supprimerRecetteDeListeProfile, changerPortionsListeProfile, viderListeCourses,
  mettreAJourDashboardCuisine, switchRecettesView, filtrerRecettesOuFavoris
} from './modules/recipes.js'
import {
  afficherCheckinModal, fermerCheckinModal, sauvegarderCheckin, verifierCheckinDuJour,
  afficherEvolution, afficherHistoriqueCompact, afficherHistorique
} from './modules/checkin.js'
import { prendrePhoto, prendrePhotoSemaine, prendrePhotoRecetteUnique, prendrePhotoSauvegardee } from './modules/photos.js'

// ── Exposition globale pour les onclick inline du HTML ──
Object.assign(window, {
  // auth
  deconnexion,
  // api
  sauvegarderProfil,
  // ui
  ouvrirConfig, fermerConfig, ouvrirProfilPanel, fermerProfilPanel, fermerTout,
  switchTab, switchAtfaireSection,
  toggleSymptom, toggleSharedRegime, selectSharedTemps, selectSharedBudget,
  autoSauvegarderPreferences, autoSauvegarderProfilComplet, syncAllPreferencesChips,
  updateProfilRecaps, updateObjectifPrincipalBadge,
  chargerProfilUI, toggleProfilObjectif, toggleProfilRegime, toggleProfilAllergie,
  selectProfilTempsCuisine, modifierProfilComplet, toggleEmailDigest,
  ouvrirAlly, fermerAlly, setText, changerDefaultPortions,
  ouvrirSheet, fermerSheet, switchBloodtypeTab,
  // plan
  toggleInstructions, toggleRoutineItem,
  changerPortions, noterRecette, sauvegarderRecette,
  noterPlan, genererPlan,
  toggleSemaineSymptom, toggleDay, toggleDayMeal, genererSemaine,
  chargerEtapesRecette, changerPortionsSemaine, noterRecetteSemaine,
  sauvegarderRecetteSemaine, toggleSelectRecetteSemaine, reagregerDepuisRecettes,
  afficherListeCourses, toggleCoursesModalItem, fermerListeCourses, sauvegarderListeCourses,
  genererRecettePourRepas,
  // recipes
  toggleRepasInclus, selectTypeRepas, toggleRecetteSymptom,
  ajouterIngredientFrigo, supprimerIngredientFrigo,
  genererRecetteUnique, sauvegarderRecetteUnique,
  afficherRecettesSauvegardees, filtrerRecettesSauvegardees,
  afficherFavoris, filtrerFavoris, supprimerFavori, ajouterFavoriAuxCourses,
  toggleSavedRecette, supprimerRecetteSauvegardee, noterRecetteSauvegardee,
  toggleSelectSaved, changerPortionsSaved, changerPortionsFavori,
  afficherListeCoursesProfile, toggleCoursesVuByIdx, ajouterArticleManuelCourses,
  supprimerArticleManuelCourses, toggleCoursesVu,
  supprimerRecetteDeListeProfile, changerPortionsListeProfile, viderListeCourses,
  mettreAJourDashboardCuisine, switchRecettesView, filtrerRecettesOuFavoris,
  // checkin
  afficherCheckinModal, fermerCheckinModal, sauvegarderCheckin,
  afficherEvolution, afficherHistoriqueCompact, afficherHistorique,
  // photos
  prendrePhoto, prendrePhotoSemaine, prendrePhotoRecetteUnique, prendrePhotoSauvegardee,
})

// ── Initialisation ──
document.addEventListener('DOMContentLoaded', async function() {
  var urlParams = new URLSearchParams(window.location.search)
  var idFromUrl = urlParams.get('profil_id')
  st.profil_id  = idFromUrl || localStorage.getItem('vitalia_profil_id')

  if (!st.profil_id || st.profil_id === 'new') {
    document.getElementById('loadingText').textContent = 'Bienvenue sur Vitalia ! 🌿'
    setTimeout(function() { window.location.href = 'onboarding.html' }, 1200)
    return
  }

  // Initialiser l'écoute auth (onAuthStateChange)
  setupAuth()

  // Initialiser le token AVANT tout appel réseau
  try {
    var sessionResult  = await _sb.auth.getSession()
    var initSession    = sessionResult && sessionResult.data && sessionResult.data.session
    var maintenant     = Math.floor(Date.now() / 1000)
    var tokenFrais     = initSession && initSession.access_token &&
                         initSession.expires_at && (initSession.expires_at - maintenant > 60)
    if (tokenFrais) {
      st.authToken = initSession.access_token
      console.log('[auth] Token valide initialisé depuis getSession() ✓')
    } else {
      if (initSession) console.warn('[auth] Token expiré (exp=' + initSession.expires_at + ') → refreshSession()')
      var refreshResult    = await _sb.auth.refreshSession()
      var refreshedSession = refreshResult && refreshResult.data && refreshResult.data.session
      if (refreshedSession && refreshedSession.access_token) {
        st.authToken = refreshedSession.access_token
        console.log('[auth] Token rafraîchi via refreshSession() ✓')
      } else if (!initSession) {
        console.warn('[auth] Aucune session → redirection reconnexion')
        window.location.href = 'onboarding.html?reconnect=1' +
          (st.profil_id ? '&profil_id=' + st.profil_id : '')
        return
      } else {
        var refreshErr = refreshResult && refreshResult.error
        if (refreshErr && refreshErr.message) {
          console.warn('[auth] Refresh token invalide (' + refreshErr.message + ') → redirection reconnexion')
          window.location.href = 'onboarding.html?reconnect=1' +
            (st.profil_id ? '&profil_id=' + st.profil_id : '')
          return
        }
        console.warn('[auth] Refresh sans réponse (réseau ?) → token expiré en cache')
      }
    }
  } catch(e) { console.warn('[auth] Session init error:', e) }

  st._sessionInitialisee = true
  console.log('[auth] Session initialisée, authToken=',
    st.authToken === st.authToken && st.authToken.length > 100
      ? 'user_token(' + st.authToken.slice(0, 20) + '...)'
      : 'ANON_KEY')

  localStorage.setItem('vitalia_profil_id', st.profil_id)

  // Profil depuis cache
  var cached = localStorage.getItem('vitalia_profil')
  if (cached) {
    try { st.profilUtilisateur = JSON.parse(cached); appliquerProfil(st.profilUtilisateur) } catch(e) {}
  }

  // Profil frais depuis Supabase
  chargerProfilSupabase(st.profil_id)

  // Favoris & À faire
  migrerFavoris()
  chargerFavorisSupabase()
  chargerRecettesSauvegardeesSupabase()

  // Badge objectif principal
  updateObjectifPrincipalBadge()

  // Date badge
  var db = document.getElementById('dateBadge')
  if (db) db.textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })

  // Icône onglet semaine = jour courant
  ;(function() {
    var el = document.getElementById('semaineTabDay')
    if (el) el.textContent = new Date().getDate()
  })()

  // Restaurer ou générer le plan du jour
  var planSession = sessionStorage.getItem('vitalia_plan_session_home')
  var planValide  = false
  var today       = new Date().toISOString().slice(0, 10)
  if (planSession) {
    try {
      var planRestaure = JSON.parse(planSession)
      var planDate     = planRestaure && planRestaure._date
      if (planRestaure && (planRestaure.matin || planRestaure.petit_dejeuner) && planDate === today) {
        planValide = true
        setTimeout(function() {
          var ls = document.getElementById('loadingScreen')
          var ap = document.getElementById('app')
          if (ls) ls.classList.add('hidden')
          if (ap) ap.style.opacity = '1'
          document.getElementById('generateFab').classList.add('visible')
          afficherPlan(planRestaure)
          verifierCheckinDuJour()
        }, 600)
      }
    } catch(e) { sessionStorage.removeItem('vitalia_plan_session_home') }
  }
  if (!planValide) {
    sessionStorage.removeItem('vitalia_plan_session_home')
    setTimeout(function() { genererPlan(false) }, 400)
  }

  // Restaurer le plan semaine depuis localStorage
  var semaineSession = localStorage.getItem('vitalia_semaine_session')
  if (semaineSession) {
    try {
      var semaineData = JSON.parse(semaineSession)
      if (semaineData && semaineData.semaine) {
        st.semainePlanData = semaineData
        afficherSemaine(semaineData)
      }
    } catch(e) { localStorage.removeItem('vitalia_semaine_session') }
  }

  // Liste de courses
  chargerListeCoursesSupabase()
  afficherListeCoursesProfile()

  // Fermer modale courses sur Escape
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { fermerListeCourses() }
  })

  // Restaurer recette à la demande depuis localStorage
  var recetteSession = localStorage.getItem('vitalia_recette_session')
  if (recetteSession) {
    try {
      var recetteData = JSON.parse(recetteSession)
      if (recetteData && recetteData.recette) {
        st.recetteCourante  = recetteData.recette
        st.recetteTypeRepas = recetteData.type || 'dejeuner'
        afficherRecetteUnique(recetteData.recette)
        var btnText = document.getElementById('recetteBtnText')
        if (btnText) btnText.textContent = '🔄 Nouvelle recette'
        document.querySelectorAll('#recetteTypeChips .chip').forEach(function(c) {
          c.classList.toggle('selected', c.dataset.val === st.recetteTypeRepas)
        })
      }
    } catch(e) { localStorage.removeItem('vitalia_recette_session') }
  }
})

// ── Sync Supabase quand l'onglet redevient visible (cross-device) ──
var _lastVisibilitySync = 0
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return
  if (!st.profil_id || st.profil_id === 'new') return
  var now = Date.now()
  if (now - _lastVisibilitySync < 5 * 60 * 1000) return
  _lastVisibilitySync = now
  chargerProfilSupabase(st.profil_id)
  chargerFavorisSupabase()
  chargerRecettesSauvegardeesSupabase()
  chargerListeCoursesSupabase()
})

// ── Mise à jour automatique quand un nouveau Service Worker prend le contrôle ──
// Quand skipWaiting active le nouveau SW, controllerchange se déclenche → on recharge.
if ('serviceWorker' in navigator) {
  var _swReloading = false
  navigator.serviceWorker.addEventListener('controllerchange', function() {
    if (_swReloading) return
    _swReloading = true
    window.location.reload()
  })
}
