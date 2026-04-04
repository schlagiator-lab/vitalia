import { SUPABASE_URL, SUPABASE_ANON_KEY, st } from './state.js'

const BUCKET      = 'recette-photos'
const MAX_WIDTH   = 1200
const JPEG_QUALITY = 0.75

// ── Compression Canvas ──
export function compresserImage(file) {
  return new Promise(function(resolve, reject) {
    var img = new Image()
    img.onload = function() {
      var scale  = Math.min(1, MAX_WIDTH / img.width)
      var w      = Math.round(img.width * scale)
      var h      = Math.round(img.height * scale)
      var canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(function(blob) {
        URL.revokeObjectURL(img.src)
        resolve(blob)
      }, 'image/jpeg', JPEG_QUALITY)
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

// ── Upload vers Supabase Storage ──
export async function uploadPhoto(blob, slug) {
  var path = (st.profil_id || 'anon') + '/' + slug + '_' + Date.now() + '.jpg'
  var res  = await fetch(SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + st.authToken, 'Content-Type': 'image/jpeg' },
    body:    blob
  })
  if (!res.ok) throw new Error('Upload échoué (' + res.status + ')')
  return SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + path
}

// ── Sauvegarder dans recette_photos ──
export async function sauvegarderPhotoRecette(titre, photoUrl, consentPartage) {
  return fetch(SUPABASE_URL + '/rest/v1/recette_photos', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': 'Bearer ' + st.authToken,
      'Prefer':        'return=minimal'
    },
    body: JSON.stringify({
      profil_id:       st.profil_id,
      titre:           titre,
      photo_url:       photoUrl,
      consent_partage: consentPartage
    })
  })
}

// ── Récupérer une photo communautaire par titre ──
export async function chargerPhotoCommunaute(titre) {
  try {
    var res = await fetch(
      SUPABASE_URL + '/rest/v1/recette_photos' +
        '?titre=eq.' + encodeURIComponent(titre) +
        '&consent_partage=eq.true' +
        '&select=photo_url' +
        '&order=created_at.desc' +
        '&limit=1',
      { headers: { 'apikey': SUPABASE_ANON_KEY } }
    )
    var data = await res.json()
    return (Array.isArray(data) && data[0]) ? data[0].photo_url : null
  } catch(e) { return null }
}

// ── Récupérer la meilleure photo disponible pour une recette ──
// Priorité : 1) photo propre de l'utilisateur  2) photo communauté
// Retourne { url, isCommunaute } ou null
export async function chargerMeilleurePhoto(titre) {
  if (!titre) return null
  // 1. Photo de l'utilisateur (privée ou partagée)
  if (st.profil_id && st.authToken) {
    try {
      var res = await fetch(
        SUPABASE_URL + '/rest/v1/recette_photos' +
          '?titre=eq.' + encodeURIComponent(titre) +
          '&profil_id=eq.' + st.profil_id +
          '&select=photo_url' +
          '&order=created_at.desc' +
          '&limit=1',
        { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken } }
      )
      var data = await res.json()
      if (Array.isArray(data) && data[0]) return { url: data[0].photo_url, isCommunaute: false }
    } catch(e) {}
  }
  // 2. Photo communauté en fallback
  var communUrl = await chargerPhotoCommunaute(titre)
  if (communUrl) return { url: communUrl, isCommunaute: true }
  return null
}

// ── Injecter la photo dans le panneau d'une recette ──
// containerId : ID de l'élément DOM cible (ex. 'instructions-matin', 'semaine-inner-lundi_dejeuner', 'recette-unique-photo-container', 'saved-photo-0')
export function afficherPhotoRecette(containerId, photoUrl, isCommunaute) {
  var el = document.getElementById(containerId); if (!el) return
  var existing = el.querySelector('.recipe-photo-container')
  if (existing) {
    existing.querySelector('.recipe-photo').src = photoUrl
    return
  }
  var div  = document.createElement('div')
  div.className = 'recipe-photo-container'
  div.innerHTML  = '<img class="recipe-photo" src="' + photoUrl + '" alt="Photo du plat" loading="lazy">' +
    (isCommunaute ? '<span class="recipe-photo-badge">📸 Communauté</span>' : '')
  el.insertBefore(div, el.firstChild)
}

// ── Modal de consentement ──
function afficherModalConsentement(onAccept, onRefuse) {
  var id  = 'photoConsentModal'
  var old = document.getElementById(id); if (old) old.remove()

  var modal = document.createElement('div')
  modal.id  = id
  modal.innerHTML =
    '<div class="photo-consent-backdrop" id="photoConsentBackdrop">' +
      '<div class="photo-consent-modal">' +
        '<div class="photo-consent-icon">📸</div>' +
        '<h3>Partager votre photo ?</h3>' +
        '<p>Cette photo pourra aider d\'autres utilisateurs à reconnaître ce plat lorsqu\'il leur sera proposé.</p>' +
        '<p class="photo-consent-note">Aucune information personnelle ne sera partagée.</p>' +
        '<div class="photo-consent-actions">' +
          '<button class="photo-consent-btn photo-consent-refuse" id="photoBtnRefuse">Garder privée</button>' +
          '<button class="photo-consent-btn photo-consent-accept" id="photoBtnAccept">Partager 🤝</button>' +
        '</div>' +
      '</div>' +
    '</div>'
  document.body.appendChild(modal)

  function cleanup(cb) {
    modal.remove()
    if (cb) cb()
  }
  document.getElementById('photoBtnAccept').onclick = function() { cleanup(onAccept) }
  document.getElementById('photoBtnRefuse').onclick = function() { cleanup(onRefuse) }
  document.getElementById('photoConsentBackdrop').onclick = function(e) {
    if (e.target === this) cleanup(onRefuse)
  }
}

// ── Helper interne : déclenche le flux capture → compression → consentement → upload ──
function _lancerPrisePhoto(slug, titre, containerId, btnId, onUploaded) {
  var input   = document.createElement('input')
  input.type  = 'file'
  input.accept = 'image/*'
  input.setAttribute('capture', 'environment')

  input.onchange = async function() {
    var file = input.files && input.files[0]; if (!file) return
    var btn  = document.getElementById(btnId)
    if (btn) { btn.textContent = '⏳'; btn.disabled = true }

    try {
      var blob = await compresserImage(file)

      var doUpload = async function(consentPartage) {
        var url = await uploadPhoto(blob, slug)
        afficherPhotoRecette(containerId, url, false)
        if (onUploaded) onUploaded(url)
        await sauvegarderPhotoRecette(titre, url, consentPartage).catch(function() {})
        if (btn) { btn.textContent = '📸'; btn.disabled = false }
      }

      afficherModalConsentement(
        function() { doUpload(true)  },
        function() { doUpload(false) }
      )
    } catch(e) {
      console.error('[photos]', e)
      if (btn) { btn.textContent = '📸'; btn.disabled = false }
    }
  }

  input.click()
}

// ── Handler plan du jour ──
export function prendrePhoto(moment) {
  var recette = st.currentPlan && st.currentPlan[moment]
  if (!recette) return
  _lancerPrisePhoto(
    moment,
    recette.nom || recette.titre || moment,
    'instructions-' + moment,
    'photo-btn-' + moment,
    function(url) { recette.photo_url = url }
  )
}

// ── Handler plan semaine ──
export function prendrePhotoSemaine(id) {
  var parts   = id.split('_')
  var jour    = parts[0]
  var mealKey = parts.slice(1).join('_')
  var recette = st.semainePlanData && st.semainePlanData.semaine &&
                st.semainePlanData.semaine[jour] && st.semainePlanData.semaine[jour][mealKey]
  if (!recette) return
  _lancerPrisePhoto(
    'semaine_' + id,
    recette.nom || recette.titre || id,
    'semaine-inner-' + id,
    'photo-semaine-btn-' + id,
    function(url) { recette.photo_url = url }
  )
}

// ── Handler recette unique ──
export function prendrePhotoRecetteUnique() {
  var recette = st.recetteCourante; if (!recette) return
  _lancerPrisePhoto(
    'recette_unique',
    recette.nom || recette.titre || 'recette',
    'recette-unique-photo-container',
    'photo-btn-recette-unique',
    function(url) { recette.photo_url = url }
  )
}

// ── Handler recettes sauvegardées & favoris ──
export function prendrePhotoSauvegardee(idx, from) {
  var storageKey = from === 'fav' ? 'vitalia_favoris' : 'vitalia_recettes_sauvegardees'
  var list = []
  try { list = JSON.parse(localStorage.getItem(storageKey) || '[]') } catch(e) {}
  var recette = list[idx]; if (!recette) return
  var titre = recette.nom || recette.titre || ''
  _lancerPrisePhoto(
    (from === 'fav' ? 'fav' : 'saved') + '_' + idx,
    titre,
    (from === 'fav' ? 'fav-photo-' : 'saved-photo-') + idx,
    (from === 'fav' ? 'fav-photo-btn-' : 'saved-photo-btn-') + idx,
    function(url) {
      recette.photo_url = url
      list[idx] = recette
      try { localStorage.setItem(storageKey, JSON.stringify(list)) } catch(e) {}
    }
  )
}
