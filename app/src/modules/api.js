import { SUPABASE_URL, SUPABASE_ANON_KEY, st } from './state.js'
import { authFetch } from './auth.js'
import { appliquerProfil, afficherToast } from './ui.js'

// ── Chargement du profil depuis Supabase ──
export async function chargerProfilSupabase(id) {
  try {
    var r = await authFetch(
      SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + id + '&limit=1',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken } }
    )
    if (r.ok) {
      var d = await r.json()
      if (d && d[0]) {
        st.profilUtilisateur = d[0]
        appliquerProfil(d[0])
        localStorage.setItem('vitalia_profil', JSON.stringify(d[0]))
      }
    }
  } catch(e) { console.warn('Profile load error:', e) }
}

// ── Sauvegarde complète du profil ──
export async function sauvegarderProfil() {
  const { _sb } = await import('./auth.js')
  var _budgetMaxMap = { faible: 8, moyen: 15, eleve: 25 }
  var btn = document.getElementById('profilSaveBtn')
  if (btn) { btn.disabled = true; btn.style.opacity = '0.7' }

  if (st.profilUtilisateur) {
    st.profilUtilisateur.objectifs_generaux   = st.selectedSymptoms.slice()
    st.profilUtilisateur.regimes_alimentaires = st.selectedRegimes.slice()
    st.profilUtilisateur.allergies            = st.profilAllergiesCourantes.slice()
    st.profilUtilisateur.temps_cuisine_max    = st.profilTempsCuisineCourant
    st.profilUtilisateur.budget_complements   = st.selectedBudget
    localStorage.setItem('vitalia_profil', JSON.stringify(st.profilUtilisateur))
  }

  if (st.profil_id && st.profil_id !== 'new') {
    var result = await _sb.from('profils_utilisateurs').update({
      objectifs_generaux:   st.selectedSymptoms,
      regimes_alimentaires: st.selectedRegimes,
      allergies:            st.profilAllergiesCourantes,
      temps_cuisine_max:    st.profilTempsCuisineCourant,
      temps_max:            st.profilTempsCuisineCourant,
      budget_complements:   st.selectedBudget,
      budget_max:           _budgetMaxMap[st.selectedBudget] || 15,
    }).eq('id', st.profil_id)
    if (result.error) {
      afficherToast('Erreur sauvegarde : ' + result.error.message)
      if (btn) { btn.disabled = false; btn.style.opacity = '1' }
      return
    }
  }
  afficherToast('Préférences sauvegardées ✓')
  if (btn) { btn.disabled = false; btn.style.opacity = '1' }
}

// ── Sync besoins vers Supabase ──
export async function syncBesoinsVersProfil() {
  if (st.profilUtilisateur) {
    st.profilUtilisateur.objectifs_generaux   = st.selectedSymptoms.slice()
    st.profilUtilisateur.regimes_alimentaires = st.selectedRegimes.slice()
    localStorage.setItem('vitalia_profil', JSON.stringify(st.profilUtilisateur))
  }
  if (!st.profil_id || st.profil_id === 'new') return
  try {
    await authFetch(SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + st.profil_id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken },
      body: JSON.stringify({ objectifs_generaux: st.selectedSymptoms, regimes_alimentaires: st.selectedRegimes })
    })
  } catch(e) {}
}

// ── Migration anciens favoris ──
export function migrerFavoris() {
  try {
    var favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]')
    if (favs.length > 0) return
    var saved   = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]')
    var migrated = saved.filter(function(r) { return r.note && r.note >= 4 })
    if (migrated.length > 0) localStorage.setItem('vitalia_favoris', JSON.stringify(migrated))
  } catch(e) {}
}

// ── Recettes sauvegardées depuis Supabase ──
export async function chargerRecettesSauvegardeesSupabase() {
  if (!st.profil_id || st.profil_id === 'new') return
  try {
    var r = await authFetch(
      SUPABASE_URL + '/rest/v1/recettes_sauvegardees?profil_id=eq.' + st.profil_id + '&order=date_sauvegarde.desc&limit=50',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken } }
    )
    if (!r.ok) return
    var rows = await r.json()
    if (!Array.isArray(rows) || !rows.length) return
    var saved = []
    try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
    rows.forEach(function(row) {
      var nom = (row.titre || row.nom || '').toLowerCase().trim(); if (!nom) return
      var exists = saved.some(function(s) { return (s.nom || s.titre || '').toLowerCase().trim() === nom })
      if (!exists) saved.push({
        nom: row.titre || row.nom, titre: row.titre || row.nom,
        ingredients: row.ingredients || [], instructions: row.instructions || row.steps || [],
        astuces: row.tip ? [row.tip] : [], type_repas: row.moment || '',
        saved_at: row.date_sauvegarde, note: row.note || 0
      })
    })
    localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved.slice(0, 50)))
  } catch(e) {}
}

// ── Liste de courses : sync Supabase ──
var _coursesDebounceTimer = null

function _patchListeCoursesSupabase(raw) {
  if (!st.profil_id || st.profil_id === 'new') return
  try {
    authFetch(
      SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + st.profil_id,
      { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + st.authToken, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ liste_courses: raw }) }
    ).catch(function() {})
  } catch(e) {}
}

export function sauvegarderListeCoursesSupabase() {
  if (!st.profil_id || st.profil_id === 'new') return
  clearTimeout(_coursesDebounceTimer)
  _coursesDebounceTimer = setTimeout(function() {
    var raw = null
    try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    _patchListeCoursesSupabase(raw)
  }, 1500)
}

export function effacerListeCoursesSupabase() {
  if (!st.profil_id || st.profil_id === 'new') return
  clearTimeout(_coursesDebounceTimer)
  _patchListeCoursesSupabase(null)
}

export async function chargerListeCoursesSupabase() {
  if (!st.profil_id || st.profil_id === 'new') return
  try {
    var r = await authFetch(
      SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + st.profil_id + '&select=liste_courses&limit=1',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken } }
    )
    if (!r.ok) return
    var rows   = await r.json()
    var remote = rows && rows[0] && rows[0].liste_courses
    if (!remote) return
    var local  = null
    try { local = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    var manuels = local ? (local.ingredients || []).filter(function(i) { return i.manuel }) : []
    var merged  = {
      date: remote.date || new Date().toISOString(),
      ingredients: (remote.ingredients || []).concat(manuels.filter(function(m) {
        return !(remote.ingredients || []).some(function(r) { return r.nom === m.nom })
      })),
      recettes: remote.recettes || []
    }
    localStorage.setItem('vitalia_liste_courses', JSON.stringify(merged))
    // Import dynamique car afficherListeCoursesProfile est dans recipes.js
    import('./recipes.js').then(function(m) { m.afficherListeCoursesProfile() })
  } catch(e) {}
}

// ── Favoris depuis Supabase ──
export async function chargerFavorisSupabase() {
  if (!st.profil_id || st.profil_id === 'new') return
  try {
    var r = await authFetch(
      SUPABASE_URL + '/rest/v1/recettes_favorites?profil_id=eq.' + st.profil_id + '&order=sauvegardee_le.desc&limit=50',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken } }
    )
    if (!r.ok) return
    var rows = await r.json()
    if (!Array.isArray(rows) || !rows.length) return
    var favs = []
    try { favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]') } catch(e) {}
    rows.forEach(function(row) {
      var nom = (row.titre || row.nom || '').toLowerCase().trim(); if (!nom) return
      var exists = favs.some(function(f) { return (f.nom || f.titre || '').toLowerCase().trim() === nom })
      if (!exists) favs.push({
        nom: row.titre || row.nom, titre: row.titre || row.nom,
        ingredients: row.ingredients || [], instructions: row.instructions || row.steps || [],
        astuces: row.tip ? [row.tip] : [], type_repas: row.moment || '',
        saved_at: row.sauvegardee_le || row.saved_at, note: row.note || 0
      })
    })
    localStorage.setItem('vitalia_favoris', JSON.stringify(favs))
  } catch(e) {}
}
