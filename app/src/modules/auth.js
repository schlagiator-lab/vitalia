import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_ANON_KEY, st } from './state.js'

// ── Client Supabase (SDK auth automatique) ──
export const _sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Écoute des changements de session ──
// Appelé une seule fois depuis main.js après init du DOM.
export function setupAuth() {
  _sb.auth.onAuthStateChange(function(event, session) {
    console.log('[onAuthStateChange]', event, session
      ? 'session=' + (session.access_token ? session.access_token.slice(0,20) + '...' : 'no_token')
      : 'null')
    if (session && session.access_token) {
      st.authToken = session.access_token
    } else {
      st.authToken = SUPABASE_ANON_KEY
      // SIGNED_OUT inattendu seulement APRÈS que la session soit confirmée (évite boucle redirect)
      if (event === 'SIGNED_OUT' && !st._deconnexionEnCours && st._sessionInitialisee) {
        console.warn('[auth] SIGNED_OUT inattendu → redirection reconnexion')
        setTimeout(function() {
          window.location.href = 'onboarding.html?reconnect=1' +
            (st.profil_id ? '&profil_id=' + st.profil_id : '')
        }, 500)
      }
    }
  })
}

// ── Wrapper fetch : injecte le bon token et gère le 401 avec retry ──
// Timeout de 45s pour les Edge Functions (génération IA), 15s pour le reste.
export async function authFetch(url, options) {
  // Les Edge Functions utilisent SERVICE_ROLE_KEY en interne — passer la clé anon suffit.
  var isFunctionUrl  = url.includes('/functions/v1/')
  var tokenEffectif  = isFunctionUrl ? SUPABASE_ANON_KEY : st.authToken

  var controller = new AbortController()
  var timeoutMs  = isFunctionUrl ? 45000 : 15000
  var timer      = setTimeout(function() { controller.abort() }, timeoutMs)

  var opts = Object.assign({}, options, {
    signal:  controller.signal,
    headers: Object.assign({}, options.headers, { 'Authorization': 'Bearer ' + tokenEffectif })
  })
  var resp
  try {
    resp = await fetch(url, opts)
    clearTimeout(timer)
  } catch(e) {
    clearTimeout(timer)
    if (e.name === 'AbortError') throw new Error('Délai dépassé — le serveur met trop de temps à répondre, réessaie.')
    throw e
  }

  if (resp.status === 401) {
    if (isFunctionUrl) {
      console.error('[authFetch] Edge Function 401 persistant avec clé anon :', url.split('/').pop())
      return resp
    }
    // REST API : tenter un refresh du token utilisateur
    console.warn('[authFetch] REST 401 → tentative refreshSession()')
    try {
      var refreshed = await _sb.auth.refreshSession()
      var newToken  = refreshed && refreshed.data && refreshed.data.session &&
                      refreshed.data.session.access_token
      if (newToken) {
        st.authToken = newToken
        console.log('[authFetch] ✓ Refresh réussi, retry REST avec nouveau token')
        var retryHeaders = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + newToken })
        return fetch(url, Object.assign({}, opts, { headers: retryHeaders }))
      }
    } catch(e) { console.warn('[authFetch] Refresh échoué:', e) }

    // Refresh impossible → session expirée
    if (!st._deconnexionEnCours) {
      console.warn('[authFetch] Session REST expirée → redirection')
      // Importe dynamiquement pour éviter la dépendance circulaire au chargement
      const { afficherToast } = await import('./ui.js')
      afficherToast('Session expirée – reconnecte-toi')
      setTimeout(function() {
        window.location.href = 'onboarding.html?reconnect=1' +
          (st.profil_id ? '&profil_id=' + st.profil_id : '')
      }, 1500)
    }
  }
  return resp
}

// ── Déconnexion et effacement des données locales ──
export async function deconnexion() {
  if (!confirm('Changer de compte ? Vos données locales seront effacées.')) return
  st._deconnexionEnCours = true
  try { await _sb.auth.signOut() } catch(e) {}
  var keysToRemove = [
    'vitalia_user_id','vitalia_email','vitalia_profil_id','vitalia_profil',
    'vitalia_profil_complet','vitalia_plan_session_home','vitalia_recettes_sauvegardees',
    'vitalia_favoris','vitalia_liste_courses','vitalia_courses_vu',
    'vitalia_semaine_session','vitalia_recette_session',
    'sb-ptzmyuugxhsbrynjwlhp-auth-token'
  ]
  keysToRemove.forEach(function(k) { localStorage.removeItem(k); sessionStorage.removeItem(k) })
  window.location.href = 'onboarding.html'
}
