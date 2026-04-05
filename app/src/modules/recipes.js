import { SUPABASE_URL, SUPABASE_ANON_KEY, st } from './state.js'
import { authFetch } from './auth.js'
import { afficherToast } from './ui.js'
import { sauvegarderListeCoursesSupabase, effacerListeCoursesSupabase } from './api.js'
import { afficherPhotoRecette, chargerMeilleurePhoto } from './photos.js'

// ══════════════════════════════════════════════════════
// ONGLET RECETTE
// ══════════════════════════════════════════════════════

export function toggleRepasInclus(el, val) {
  if (st.semaineRepasInclus.includes(val)) {
    if (st.semaineRepasInclus.length <= 1) { afficherToast('Sélectionne au moins un repas.'); return }
    st.semaineRepasInclus = st.semaineRepasInclus.filter(function(v) { return v !== val })
    el.classList.remove('selected')
  } else {
    st.semaineRepasInclus.push(val)
    el.classList.add('selected')
  }
}

export function selectTypeRepas(el, val) {
  st.recetteTypeRepas = val
  document.querySelectorAll('#recetteTypeChips .chip').forEach(function(c) { c.classList.remove('selected') })
  el.classList.add('selected')
}

export function toggleRecetteSymptom(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!st.recetteSelectedSymptoms.includes(val)) st.recetteSelectedSymptoms.push(val)
  } else {
    st.recetteSelectedSymptoms = st.recetteSelectedSymptoms.filter(function(v) { return v !== val })
  }
}

export function ajouterIngredientFrigo() {
  var input = document.getElementById('frigoInput'); if (!input) return
  var val = input.value.trim()
  if (!val || st.recetteIngredientsFrigo.includes(val)) { input.value = ''; return }
  st.recetteIngredientsFrigo.push(val)
  input.value = ''
  renderFrigoChips()
}

export function supprimerIngredientFrigo(ing) {
  st.recetteIngredientsFrigo = st.recetteIngredientsFrigo.filter(function(v) { return v !== ing })
  renderFrigoChips()
}

export function renderFrigoChips() {
  var container = document.getElementById('frigoChips'); if (!container) return
  container.innerHTML = st.recetteIngredientsFrigo.map(function(ing) {
    var safeIng = ing.replace(/\\/g,'\\\\').replace(/'/g,"\\'")
    return '<span class="chip selected" style="cursor:default;">' + ing +
           ' <button onclick="supprimerIngredientFrigo(\'' + safeIng + '\')" style="background:none;border:none;color:white;cursor:pointer;font-size:14px;margin-left:4px;padding:0;line-height:1;vertical-align:middle;">×</button></span>'
  }).join('')
}

export async function genererRecetteUnique() {
  if (!st.profil_id) { afficherToast('Profil non trouvé'); return }
  var btn     = document.getElementById('recetteBtnGenerate')
  var btnText = document.getElementById('recetteBtnText')
  var empty   = document.getElementById('recetteEmpty')
  var result  = document.getElementById('recetteResult')
  if (btn)    { btn.disabled = true; btn.style.opacity = '0.7' }
  if (btnText) btnText.textContent = '⏳ Création en cours…'
  if (result)  result.style.display = 'none'
  if (empty)   empty.style.display = 'flex'
  try {
    var resp = await authFetch(SUPABASE_URL + '/functions/v1/generer-recette-unique', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + st.authToken, 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({
        profil_id:         st.profil_id,
        type_repas:        st.recetteTypeRepas,
        ingredients_frigo: st.recetteIngredientsFrigo,
        symptomes:         st.recetteSelectedSymptoms,
        directive_chef:    (document.getElementById('directiveChefInput') || {}).value || '',
        nb_personnes:      st.defaultPortions,
      }),
    })
    if (!resp.ok) {
      var errData = {}; try { errData = await resp.json() } catch(_) {}
      console.error('[genererRecetteUnique]', resp.status, errData)
      if (resp.status !== 401) afficherToast('Erreur serveur ' + resp.status + ' – réessaie dans un instant')
      return
    }
    var data = await resp.json()
    if (data.success && data.recette) {
      st.recetteCourante = data.recette
      afficherRecetteUnique(data.recette)
      try { localStorage.setItem('vitalia_recette_session', JSON.stringify({ recette: data.recette, type: st.recetteTypeRepas })) } catch(e) {}
    } else { afficherToast('Erreur lors de la génération') }
  } catch(err) { afficherToast('Erreur réseau : ' + err.message)
  } finally {
    if (btn)    { btn.disabled = false; btn.style.opacity = '1' }
    if (btnText) btnText.textContent = '🔄 Nouvelle recette'
  }
}

function getMealIllustration(typeRepas) {
  if (typeRepas === 'petit-dejeuner') return '<svg viewBox="0 0 320 130" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;position:absolute;top:0;left:0;" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="vsg-sky1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#F5C882"/><stop offset="100%" stop-color="#F2D4A8"/></linearGradient></defs><rect width="320" height="130" fill="url(#vsg-sky1)"/><rect y="88" width="320" height="42" fill="#E8956D" opacity="0.35"/><circle cx="160" cy="88" r="32" fill="#F5A623" opacity="0.9"/><circle cx="160" cy="88" r="22" fill="#FCDE78" opacity="0.7"/><g stroke="#F5A623" stroke-width="1.5" stroke-linecap="round" opacity="0.5"><line x1="160" y1="46" x2="160" y2="40"/><line x1="182" y1="53" x2="186" y2="48"/><line x1="196" y1="70" x2="202" y2="67"/><line x1="138" y1="53" x2="134" y2="48"/><line x1="124" y1="70" x2="118" y2="67"/></g><path d="M0 100 Q40 78 80 92 Q120 106 160 88 Q200 70 240 88 Q280 106 320 95 L320 130 L0 130Z" fill="#C4714A" opacity="0.4"/><path d="M0 110 Q50 95 100 108 Q150 121 200 105 Q250 89 320 110 L320 130 L0 130Z" fill="#D4936A" opacity="0.5"/><ellipse cx="160" cy="118" rx="28" ry="8" fill="#3D2B1F" opacity="0.35"/><path d="M134 110 Q134 126 160 126 Q186 126 186 110 Z" fill="#3D2B1F" opacity="0.35"/><path d="M152 104 Q150 98 153 93 Q156 88 154 82" fill="none" stroke="white" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/><path d="M160 102 Q158 96 161 91 Q164 86 162 80" fill="none" stroke="white" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/><path d="M168 104 Q166 98 169 93 Q172 88 170 82" fill="none" stroke="white" stroke-width="1.2" stroke-linecap="round" opacity="0.4"/></svg>'
  if (typeRepas === 'diner') return '<svg viewBox="0 0 320 130" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;position:absolute;top:0;left:0;" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="vsg-sky3" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2D1F14"/><stop offset="60%" stop-color="#5A3820"/><stop offset="100%" stop-color="#7A4A28"/></linearGradient></defs><rect width="320" height="130" fill="url(#vsg-sky3)"/><circle cx="40" cy="18" r="1.2" fill="white" opacity="0.8"/><circle cx="88" cy="28" r="0.8" fill="white" opacity="0.6"/><circle cx="130" cy="12" r="1" fill="white" opacity="0.7"/><circle cx="195" cy="22" r="1.4" fill="white" opacity="0.9"/><circle cx="240" cy="10" r="0.9" fill="white" opacity="0.6"/><circle cx="285" cy="25" r="1.1" fill="white" opacity="0.8"/><circle cx="60" cy="38" r="0.7" fill="white" opacity="0.5"/><circle cx="310" cy="15" r="0.8" fill="white" opacity="0.6"/><circle cx="268" cy="38" r="16" fill="#F5E4C0" opacity="0.85"/><circle cx="276" cy="34" r="13" fill="#5A3820" opacity="0.9"/><rect y="88" width="320" height="42" fill="#3D2B1F" opacity="0.5"/><rect y="88" width="320" height="2" fill="#C4714A" opacity="0.3"/><rect x="155" y="56" width="10" height="32" rx="2" fill="#F2E9DC" opacity="0.85"/><path d="M160 52 Q158 46 160 42 Q162 46 160 52Z" fill="#F5A623" opacity="0.9"/><circle cx="160" cy="50" r="4" fill="#FCDE78" opacity="0.4"/><ellipse cx="160" cy="90" rx="30" ry="6" fill="#F5A623" opacity="0.12"/><ellipse cx="160" cy="108" rx="40" ry="10" fill="#FBF5EE" opacity="0.85"/><ellipse cx="160" cy="107" rx="32" ry="8" fill="#FBF5EE" opacity="0.3"/><path d="M140 104 Q148 100 158 105 Q165 108 170 104 Q175 100 178 106" fill="none" stroke="#C4714A" stroke-width="3" stroke-linecap="round" opacity="0.7"/><circle cx="150" cy="110" r="4" fill="#7A9E7E" opacity="0.7"/><circle cx="168" cy="109" r="3" fill="#D4936A" opacity="0.7"/><path d="M268 88 Q260 96 264 104 L268 104 L272 104 Q276 96 268 88Z" fill="#3D2B1F" opacity="0.4"/><rect x="267" y="104" width="2" height="14" fill="#3D2B1F" opacity="0.4"/><rect x="262" y="118" width="12" height="2" rx="1" fill="#3D2B1F" opacity="0.4"/></svg>'
  if (typeRepas === 'collation') return '<svg viewBox="0 0 320 130" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;position:absolute;top:0;left:0;" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="vsg-sky4" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#E8F4E8"/><stop offset="100%" stop-color="#D0E8C0"/></linearGradient></defs><rect width="320" height="130" fill="url(#vsg-sky4)"/><circle cx="30" cy="30" r="3" fill="#7A9E7E" opacity="0.3"/><circle cx="290" cy="20" r="2.5" fill="#7A9E7E" opacity="0.25"/><circle cx="45" cy="70" r="2" fill="#A8C5AC" opacity="0.3"/><circle cx="275" cy="65" r="3" fill="#7A9E7E" opacity="0.2"/><path d="M90 58 Q78 46 82 38 Q90 28 100 38 Q106 32 114 36 Q122 46 112 58 Q106 70 100 72 Q94 70 90 58Z" fill="#C4714A" opacity="0.85"/><path d="M100 28 Q102 20 108 18" fill="none" stroke="#5A3820" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/><ellipse cx="88" cy="48" rx="5" ry="8" fill="white" opacity="0.15" transform="rotate(-15 88 48)"/><ellipse cx="160" cy="65" rx="14" ry="8" fill="#D4936A" opacity="0.8" transform="rotate(-15 160 65)"/><ellipse cx="183" cy="58" rx="13" ry="7" fill="#C4814A" opacity="0.75" transform="rotate(20 183 58)"/><ellipse cx="172" cy="78" rx="12" ry="7" fill="#E8A870" opacity="0.7" transform="rotate(-5 172 78)"/><line x1="148" y1="65" x2="172" y2="65" stroke="#9E6040" stroke-width="0.8" opacity="0.5" transform="rotate(-15 160 65)"/><line x1="172" y1="58" x2="194" y2="58" stroke="#9E6040" stroke-width="0.8" opacity="0.5" transform="rotate(20 183 58)"/><circle cx="248" cy="60" r="26" fill="#7A9E7E" opacity="0.85"/><circle cx="248" cy="60" r="22" fill="#A8C5AC" opacity="0.9"/><circle cx="248" cy="60" r="10" fill="#F2E9DC" opacity="0.95"/><ellipse cx="248" cy="48" rx="2" ry="3" fill="#3D2B1F" opacity="0.6"/><ellipse cx="257" cy="52" rx="2" ry="3" fill="#3D2B1F" opacity="0.6" transform="rotate(50 257 52)"/><ellipse cx="260" cy="62" rx="2" ry="3" fill="#3D2B1F" opacity="0.6" transform="rotate(100 260 62)"/><ellipse cx="253" cy="71" rx="2" ry="3" fill="#3D2B1F" opacity="0.6" transform="rotate(150 253 71)"/><ellipse cx="243" cy="72" rx="2" ry="3" fill="#3D2B1F" opacity="0.6" transform="rotate(200 243 72)"/><ellipse cx="237" cy="65" rx="2" ry="3" fill="#3D2B1F" opacity="0.6" transform="rotate(250 237 65)"/><ellipse cx="236" cy="55" rx="2" ry="3" fill="#3D2B1F" opacity="0.6" transform="rotate(300 236 55)"/><ellipse cx="243" cy="48" rx="2" ry="3" fill="#3D2B1F" opacity="0.6" transform="rotate(340 243 48)"/><rect y="96" width="320" height="34" fill="#C8DFC8" opacity="0.4"/><path d="M0 96 Q80 88 160 96 Q240 104 320 96" fill="none" stroke="#7A9E7E" stroke-width="1" opacity="0.4"/></svg>'
  // dejeuner (default)
  return '<svg viewBox="0 0 320 130" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block;position:absolute;top:0;left:0;" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="vsg-sky2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#A8C5AC"/><stop offset="100%" stop-color="#C8DFC8"/></linearGradient></defs><rect width="320" height="130" fill="url(#vsg-sky2)"/><rect y="82" width="320" height="48" fill="#E8D5B0" opacity="0.6"/><rect y="82" width="320" height="3" fill="#C4A06A" opacity="0.4"/><ellipse cx="160" cy="100" rx="46" ry="12" fill="white" opacity="0.9"/><ellipse cx="160" cy="99" rx="40" ry="10" fill="white" opacity="0.3"/><circle cx="150" cy="97" r="5" fill="#7A9E7E" opacity="0.8"/><circle cx="163" cy="95" r="6" fill="#C4714A" opacity="0.7"/><circle cx="172" cy="99" r="4" fill="#E8B84B" opacity="0.8"/><circle cx="155" cy="102" r="3" fill="#D4936A" opacity="0.7"/><path d="M108 82 L108 118 M104 82 L104 92 M108 82 L108 92 M112 82 L112 92 M104 92 Q108 96 112 92" fill="none" stroke="#9E8070" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/><path d="M212 82 L212 118 M212 82 Q218 90 212 95" fill="none" stroke="#9E8070" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/><ellipse cx="60" cy="50" rx="12" ry="6" fill="#7A9E7E" opacity="0.5" transform="rotate(-20 60 50)"/><ellipse cx="78" cy="42" rx="10" ry="5" fill="#A8C5AC" opacity="0.6" transform="rotate(10 78 42)"/><ellipse cx="250" cy="45" rx="11" ry="5" fill="#7A9E7E" opacity="0.5" transform="rotate(15 250 45)"/><ellipse cx="268" cy="55" rx="9" ry="4" fill="#A8C5AC" opacity="0.6" transform="rotate(-10 268 55)"/><line x1="52" y1="50" x2="68" y2="50" stroke="#5A7A5E" stroke-width="0.7" opacity="0.5" transform="rotate(-20 60 50)"/><line x1="242" y1="45" x2="258" y2="45" stroke="#5A7A5E" stroke-width="0.7" opacity="0.5" transform="rotate(15 250 45)"/><circle cx="280" cy="28" r="18" fill="#E8B84B" opacity="0.5"/><circle cx="280" cy="28" r="12" fill="#F5D070" opacity="0.4"/></svg>'
}

export function afficherRecetteUnique(recette) {
  var typeLabels = { 'petit-dejeuner':'Petit-déjeuner', 'dejeuner':'Déjeuner', 'collation':'Collation', 'diner':'Dîner', 'patisserie':'Pâtisserie' }
  var typeLabel  = typeLabels[st.recetteTypeRepas] || st.recetteTypeRepas
  var nv = recette.valeurs_nutritionnelles || {}

  var html = '<div class="recette-card">'
  html += '<div class="recette-card-header" style="position:relative;height:160px;overflow:hidden;">'
  html += getMealIllustration(st.recetteTypeRepas)
  html += '<div style="position:absolute;bottom:0;left:0;right:0;padding:14px 18px 12px;background:linear-gradient(to top,rgba(30,15,5,0.65) 0%,transparent 100%);">'
  html += '  <div class="recette-card-type">' + typeLabel + '</div>'
  html += '  <div class="recette-card-name">' + (recette.nom || 'Recette') + '</div>'
  html += '  <div class="recette-card-meta">'
  if (recette.temps_preparation) html += '<span class="recette-meta-chip">⏱ ' + recette.temps_preparation + ' min</span>'
  if (recette.temps_cuisson > 0) html += '<span class="recette-meta-chip">🔥 ' + recette.temps_cuisson + ' min cuisson</span>'
  if (recette.portions)          html += '<span class="recette-meta-chip">🍽 ' + recette.portions + ' pers.</span>'
  html += '  </div></div></div>'
  html += '<div class="recette-card-body">'
  html += '<div id="recette-unique-photo-container"></div>'

  if (nv.calories) {
    html += '<div><div class="recette-section-label">Valeurs nutritionnelles</div><div class="recette-nutrition">'
    html += '<div class="recette-nutri-box"><div class="recette-nutri-val">' + (nv.calories||'—') + '</div><div class="recette-nutri-lbl">kcal</div></div>'
    html += '<div class="recette-nutri-box"><div class="recette-nutri-val">' + (nv.proteines||'—') + 'g</div><div class="recette-nutri-lbl">Protéines</div></div>'
    html += '<div class="recette-nutri-box"><div class="recette-nutri-val">' + (nv.glucides||'—') + 'g</div><div class="recette-nutri-lbl">Glucides</div></div>'
    html += '<div class="recette-nutri-box"><div class="recette-nutri-val">' + (nv.lipides||'—') + 'g</div><div class="recette-nutri-lbl">Lipides</div></div>'
    html += '</div></div>'
  }

  if (recette.ingredients && recette.ingredients.length) {
    html += '<div><div class="recette-section-label">Ingrédients</div><div class="recette-ingredients">'
    recette.ingredients.forEach(function(ing) {
      var lbl = ing.nom + (ing.quantite ? ' · ' + ing.quantite + '\u202f' + (ing.unite || 'g') : '')
      html += '<span class="recette-ing-tag">' + lbl + '</span>'
    })
    html += '</div></div>'
  }

  if (recette.instructions && recette.instructions.length) {
    html += '<div><div class="recette-section-label">Préparation</div><div class="recette-steps">'
    recette.instructions.forEach(function(step, i) {
      html += '<div class="recette-step"><div class="recette-stepnum">' + (i+1) + '</div><div class="recette-step-text">' + step + '</div></div>'
    })
    html += '</div></div>'
  }

  var tip = recette.astuces && recette.astuces[0]
  if (tip) html += '<div class="recette-tip">💡 ' + tip + '</div>'

  if (recette.variantes && recette.variantes.length) {
    html += '<div><div class="recette-section-label">Variantes</div><div class="recette-variantes">'
    recette.variantes.forEach(function(v) { html += '<div class="recette-variante">' + v + '</div>' })
    html += '</div></div>'
  }

  html += '<div style="display:flex;gap:10px;margin-top:4px;">'
  html += '<button id="photo-btn-recette-unique" class="photo-btn" onclick="prendrePhotoRecetteUnique()" title="Prendre une photo du plat" style="flex-shrink:0;height:48px;min-width:48px;border-radius:14px;">📸</button>'
  html += '<button onclick="sauvegarderRecetteUnique()" style="flex:1;background:var(--sage);color:white;border:none;border-radius:16px;padding:14px;font-family:\'DM Sans\',sans-serif;font-size:15px;font-weight:600;cursor:pointer;">✅ Ajouter à faire</button>'
  html += '</div>'
  html += '</div></div>'

  var resultEl = document.getElementById('recetteResult')
  var emptyEl  = document.getElementById('recetteEmpty')
  if (resultEl) { resultEl.innerHTML = html; resultEl.style.display = 'block' }
  if (emptyEl)  emptyEl.style.display = 'none'

  var recetteNom = recette.nom || recette.titre
  if (recette.photo_url) {
    afficherPhotoRecette('recette-unique-photo-container', recette.photo_url, false)
  } else if (recetteNom) {
    chargerMeilleurePhoto(recetteNom).then(function(res) {
      if (res) afficherPhotoRecette('recette-unique-photo-container', res.url, res.isCommunaute)
    })
  }
}

export async function sauvegarderRecetteUnique() {
  if (!st.recetteCourante) return
  try {
    var saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]')
    var entry = Object.assign({}, st.recetteCourante, { id: 'recette_' + Date.now(), saved_at: new Date().toISOString(), note: 0 })
    saved.unshift(entry)
    localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved.slice(0,50)))
  } catch(e) {}
  if (st.profil_id && st.profil_id !== 'new') {
    try {
      await authFetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken },
        body: JSON.stringify({
          profil_id:   st.profil_id,
          titre:       st.recetteCourante.nom || st.recetteCourante.titre || '',
          moment:      st.recetteTypeRepas,
          ingredients: st.recetteCourante.ingredients || [],
          steps:       st.recetteCourante.instructions || [],
          tip:         (st.recetteCourante.astuces && st.recetteCourante.astuces[0]) || '',
        }),
      })
    } catch(e) {}
  }
  afficherToast('Recette sauvegardée ! 💚')
}

// ══════════════════════════════════════════════════════
// ONGLET À FAIRE — RECETTES SAUVEGARDÉES & FAVORIS
// ══════════════════════════════════════════════════════

export function afficherRecettesSauvegardees() {
  var container = document.getElementById('recettesSauvegardeesListe'); if (!container) return
  var activeQuery = (document.getElementById('recettes-search') || {}).value || ''
  var saved = []
  try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}

  if (!saved.length) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-light);font-size:13px;">Aucune recette sauvegardée</div>'
    return
  }

  container.innerHTML = saved.slice(0, 20).map(function(r, idx) {
    var nv    = r.valeurs_nutritionnelles || {}
    var cal   = nv.calories ? nv.calories + ' kcal' : ''
    var type  = r.type_repas || ''
    var date  = r.saved_at ? new Date(r.saved_at).toLocaleDateString('fr-FR', { day:'numeric', month:'short' }) : ''
    var stars = (r.note && r.note > 0) ? '★'.repeat(Math.min(r.note, 5)) : ''
    var prep  = r.temps_preparation || 0
    var cook  = r.temps_cuisson || 0
    var temps = (prep + cook) > 0 ? (prep + cook) + ' min' : ''
    var rid   = 'saved-r-' + idx

    var ingredients = Array.isArray(r.ingredients) ? r.ingredients.map(function(i) {
      var label = typeof i === 'string' ? i : ((i.nom || i.name || '') + (i.quantite ? ' ' + i.quantite + '\u202f' + (i.unite || 'g') : ''))
      return '<span style="display:inline-block;background:var(--cream);border-radius:8px;padding:3px 8px;font-size:12px;margin:2px;">' + label + '</span>'
    }).join('') : ''

    var steps = Array.isArray(r.instructions) && r.instructions.length ? r.instructions : (Array.isArray(r.steps) ? r.steps : [])
    var instructions = steps.map(function(step, si) {
      return '<div style="display:flex;gap:10px;margin-bottom:8px;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--terracotta);color:white;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">' + (si+1) + '</span><span style="font-size:13px;color:var(--deep-brown);line-height:1.5;">' + step + '</span></div>'
    }).join('')

    var astuces = Array.isArray(r.astuces) && r.astuces.length
      ? '<div style="margin-top:10px;background:rgba(122,158,126,0.1);border-radius:10px;padding:8px 12px;font-size:12px;color:var(--sage);">💡 ' + r.astuces[0] + '</div>' : ''

    var starsHtml = '<div id="saved-stars-' + idx + '" style="display:flex;gap:4px;margin-top:10px;">' +
      [1,2,3,4,5].map(function(n) {
        return '<span onclick="noterRecetteSauvegardee(' + idx + ',' + n + ');event.stopPropagation();" style="cursor:pointer;font-size:18px;color:' + (n <= (r.note || 0) ? 'var(--golden,#e8b84b)' : 'rgba(196,113,74,0.25)') + ';">★</span>'
      }).join('') + '</div>'

    var basePortions = r.portions || r.nb_personnes || 2
    st.savedServings[idx] = basePortions
    var portionsHtml = '<div style="display:flex;align-items:center;gap:8px;margin-top:10px;"><span style="font-size:12px;color:var(--text-light);">Portions</span>' +
      '<button onclick="changerPortionsSaved(' + idx + ',-1);event.stopPropagation();" style="width:24px;height:24px;border-radius:50%;border:1.5px solid rgba(196,113,74,0.3);background:var(--cream);color:var(--terracotta);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>' +
      '<span id="saved-portions-' + idx + '" style="font-size:13px;font-weight:600;color:var(--deep-brown);min-width:20px;text-align:center;">' + basePortions + '</span>' +
      '<button onclick="changerPortionsSaved(' + idx + ',1);event.stopPropagation();" style="width:24px;height:24px;border-radius:50%;border:1.5px solid rgba(196,113,74,0.3);background:var(--cream);color:var(--terracotta);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>' +
      '</div>'

    return '<div style="background:var(--warm-white);border-radius:16px;border:1px solid rgba(196,113,74,0.12);overflow:hidden;">' +
           '  <div onclick="toggleSavedRecette(\'' + rid + '\')" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
           '    <div style="flex:1;min-width:0;">' +
           '      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-light);font-weight:600;margin-bottom:3px;">' + type + (date ? ' · ' + date : '') + (temps ? ' · ' + temps : '') + '</div>' +
           '      <div style="font-family:\'Fraunces\',serif;font-size:15px;font-weight:600;color:var(--deep-brown);line-height:1.3;">' + (r.nom || r.titre || 'Recette') + '</div>' +
           (stars ? '      <div style="font-size:13px;color:var(--golden,#e8b84b);margin-top:4px;">' + stars + '</div>' : '') +
           '    </div>' +
           '    <span id="arrow-' + rid + '" style="font-size:14px;color:var(--text-light);transition:transform 0.2s;flex-shrink:0;">▼</span>' +
           '  </div>' +
           '  <div id="' + rid + '" style="display:none;padding:0 16px 14px;">' +
           '<div id="saved-photo-' + idx + '"></div>' +
           (ingredients ? '<div id="saved-ingredients-' + idx + '" data-portions="' + (r.portions || 2) + '" style="margin-bottom:12px;">' + ingredients + '</div>' : '') +
           instructions + astuces + starsHtml + portionsHtml +
           '    <div style="display:flex;gap:8px;margin-top:12px;">' +
           '      <button id="saved-photo-btn-' + idx + '" onclick="prendrePhotoSauvegardee(' + idx + ',\'saved\');event.stopPropagation();" style="background:rgba(196,113,74,0.06);border:1.5px solid rgba(196,113,74,0.2);border-radius:10px;padding:8px 12px;font-size:12px;color:var(--terracotta);cursor:pointer;">📸</button>' +
           '      <button onclick="toggleSelectSaved(' + idx + ');event.stopPropagation();" id="saved-select-btn-' + idx + '" style="flex:1;background:' + (st.savedSelected[idx] ? 'rgba(122,158,126,0.15)' : 'rgba(196,113,74,0.08)') + ';border:1.5px solid ' + (st.savedSelected[idx] ? 'var(--sage)' : 'rgba(196,113,74,0.25)') + ';border-radius:10px;padding:8px;font-size:12px;color:' + (st.savedSelected[idx] ? 'var(--sage)' : 'var(--terracotta)') + ';font-weight:600;cursor:pointer;">' + (st.savedSelected[idx] ? '✓ Dans la liste' : '🛒 Ajouter à la liste') + '</button>' +
           '      <button onclick="supprimerRecetteSauvegardee(' + idx + ');event.stopPropagation();" style="background:none;border:1px solid rgba(196,113,74,0.2);border-radius:10px;padding:8px 10px;font-size:12px;color:var(--text-light);cursor:pointer;">🗑</button>' +
           '    </div>' +
           '  </div>' +
           '</div>'
  }).join('')

  if (activeQuery) filtrerRecettesSauvegardees(activeQuery)

  // Chargement asynchrone des photos (propre puis communauté en fallback)
  saved.slice(0, 20).forEach(function(r, idx) {
    var titre = r.nom || r.titre || ''
    if (!titre) return
    if (r.photo_url) {
      afficherPhotoRecette('saved-photo-' + idx, r.photo_url, false)
    } else {
      chargerMeilleurePhoto(titre).then(function(res) {
        if (res) afficherPhotoRecette('saved-photo-' + idx, res.url, res.isCommunaute)
      })
    }
  })
}

export function filtrerRecettesSauvegardees(query) {
  var q = (query || '').trim().toLowerCase()
  var container = document.getElementById('recettesSauvegardeesListe'); if (!container) return
  if (!q) { afficherRecettesSauvegardees(); return }
  container.querySelectorAll(':scope > div').forEach(function(el) {
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none'
  })
}

export function afficherFavoris() {
  var container = document.getElementById('favorisListe'); if (!container) return
  var activeQuery = (document.getElementById('favoris-search') || {}).value || ''
  var favs = []
  try { favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]') } catch(e) {}
  if (!favs.length) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-light);font-size:13px;">Notez une recette ★★★★ ou ★★★★★ dans "À faire > Recettes" pour l\'ajouter ici</div>'
    return
  }
  container.innerHTML = favs.map(function(r, i) {
    var nv   = r.valeurs_nutritionnelles || {}
    var cal  = nv.calories ? nv.calories + ' kcal' : ''
    var type = r.type_repas || r.moment || ''
    var savedAt = r.saved_at || r.sauvegardee_le || ''
    var date = savedAt ? new Date(savedAt).toLocaleDateString('fr-FR', { day:'numeric', month:'short' }) : ''
    var stars = '★'.repeat(Math.min(r.note || 0, 5))
    var rid  = 'fav-r-' + i
    var prep = r.temps_preparation || 0
    var cook = r.temps_cuisson || 0

    var ingredients = Array.isArray(r.ingredients) ? r.ingredients.map(function(ing) {
      var label = typeof ing === 'string' ? ing : ((ing.nom || ing.name || '') + (ing.quantite ? ' ' + ing.quantite + '\u202f' + (ing.unite || 'g') : ''))
      return '<span style="display:inline-block;background:var(--cream);border-radius:8px;padding:3px 8px;font-size:12px;margin:2px;">' + label + '</span>'
    }).join('') : ''

    var favSteps = Array.isArray(r.instructions) && r.instructions.length ? r.instructions : (Array.isArray(r.steps) ? r.steps : [])
    var instructions = favSteps.map(function(step, si) {
      return '<div style="display:flex;gap:10px;margin-bottom:8px;"><span style="flex-shrink:0;width:20px;height:20px;background:var(--terracotta);color:white;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">' + (si+1) + '</span><span style="font-size:13px;color:var(--deep-brown);line-height:1.5;">' + step + '</span></div>'
    }).join('')

    var basePortions = r.portions || r.nb_personnes || 2
    st.favoriServings[i] = basePortions
    var portionsHtml = '<div style="display:flex;align-items:center;gap:8px;margin-top:10px;"><span style="font-size:12px;color:var(--text-light);">Portions</span>' +
      '<button onclick="changerPortionsFavori(' + i + ',-1);event.stopPropagation();" style="width:24px;height:24px;border-radius:50%;border:1.5px solid rgba(232,184,75,0.4);background:var(--cream);color:var(--mid-brown,#b8942a);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">−</button>' +
      '<span id="fav-portions-' + i + '" style="font-size:13px;font-weight:600;color:var(--deep-brown);min-width:20px;text-align:center;">' + basePortions + '</span>' +
      '<button onclick="changerPortionsFavori(' + i + ',1);event.stopPropagation();" style="width:24px;height:24px;border-radius:50%;border:1.5px solid rgba(232,184,75,0.4);background:var(--cream);color:var(--mid-brown,#b8942a);font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">+</button>' +
      '</div>'

    return '<div style="background:var(--warm-white);border-radius:16px;border:1.5px solid rgba(232,184,75,0.3);overflow:hidden;">' +
           '  <div onclick="toggleSavedRecette(\'' + rid + '\')" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
           '    <div style="flex:1;min-width:0;">' +
           '      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-light);font-weight:600;margin-bottom:3px;">' + type + (date ? ' · ' + date : '') + '</div>' +
           '      <div style="font-family:\'Fraunces\',serif;font-size:15px;font-weight:600;color:var(--deep-brown);line-height:1.3;">' + (r.nom || r.titre || 'Recette') + '</div>' +
           (stars ? '      <div style="font-size:13px;color:var(--golden,#e8b84b);margin-top:4px;">' + stars + '</div>' : '') +
           '    </div>' +
           '    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">' +
           (cal ? '<span style="font-size:12px;color:var(--text-light);">' + cal + '</span>' : '') +
           '      <span id="arrow-' + rid + '" style="font-size:14px;color:var(--text-light);transition:transform 0.2s;">▼</span>' +
           '    </div>' +
           '  </div>' +
           '  <div id="' + rid + '" style="display:none;padding:0 16px 14px;">' +
           '<div id="fav-photo-' + i + '"></div>' +
           ((prep > 0 || cook > 0) ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' +
             (prep > 0 ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(196,113,74,0.08);border:1px solid rgba(196,113,74,0.18);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--terracotta);font-weight:500;">⏱ ' + prep + ' min prép.</span>' : '') +
             (cook > 0 ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(232,184,75,0.1);border:1px solid rgba(232,184,75,0.25);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--mid-brown);font-weight:500;">🔥 ' + cook + ' min cuisson</span>' : '') +
           '</div>' : '') +
           (ingredients ? '<div id="fav-ingredients-' + i + '" data-portions="' + (r.portions || 2) + '" style="margin-bottom:12px;">' + ingredients + '</div>' : '') +
           instructions + portionsHtml +
           '    <div style="display:flex;gap:8px;margin-top:12px;">' +
           '      <button id="fav-photo-btn-' + i + '" onclick="prendrePhotoSauvegardee(' + i + ',\'fav\');event.stopPropagation();" style="background:rgba(232,184,75,0.1);border:1.5px solid rgba(232,184,75,0.3);border-radius:10px;padding:8px 12px;font-size:12px;color:var(--mid-brown,#b8942a);cursor:pointer;">📸</button>' +
           '      <button onclick="ajouterFavoriAuxCourses(' + i + ');event.stopPropagation();" style="flex:1;background:rgba(122,158,126,0.1);border:1.5px solid rgba(122,158,126,0.35);border-radius:10px;padding:8px;font-size:12px;color:var(--sage,#7a9e7e);font-weight:600;cursor:pointer;">🛒 Ajouter aux courses</button>' +
           '      <button onclick="supprimerFavori(' + i + ');event.stopPropagation();" style="background:none;border:1px solid rgba(196,113,74,0.2);border-radius:10px;padding:8px 10px;font-size:12px;color:var(--text-light);cursor:pointer;">🗑</button>' +
           '    </div>' +
           '  </div>' +
           '</div>'
  }).join('')
  if (activeQuery) filtrerFavoris(activeQuery)

  // Chargement asynchrone des photos (propre puis communauté en fallback)
  favs.forEach(function(r, i) {
    var titre = r.nom || r.titre || ''
    if (!titre) return
    if (r.photo_url) {
      afficherPhotoRecette('fav-photo-' + i, r.photo_url, false)
    } else {
      chargerMeilleurePhoto(titre).then(function(res) {
        if (res) afficherPhotoRecette('fav-photo-' + i, res.url, res.isCommunaute)
      })
    }
  })
}

export function filtrerFavoris(query) {
  var q = (query || '').trim().toLowerCase()
  var container = document.getElementById('favorisListe'); if (!container) return
  if (!q) { afficherFavoris(); return }
  container.querySelectorAll(':scope > div').forEach(function(el) {
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none'
  })
}

export async function supprimerFavori(idx) {
  if (!confirm('Retirer cette recette de vos favoris ?\n(La recette restera dans "À faire" si elle y est encore.)')) return
  var favs = []
  try { favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]') } catch(e) {}
  var r = favs[idx]; if (!r) return
  favs.splice(idx, 1)
  try { localStorage.setItem('vitalia_favoris', JSON.stringify(favs)) } catch(e) {}
  if (st.profil_id && st.profil_id !== 'new' && (r.titre || r.nom)) {
    try {
      await authFetch(SUPABASE_URL + '/rest/v1/recettes_favorites?profil_id=eq.' + st.profil_id + '&titre=eq.' + encodeURIComponent(r.titre || r.nom || ''), {
        method: 'DELETE', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken }
      })
    } catch(e) {}
  }
  afficherFavoris()
  afficherToast('Recette retirée des favoris')
}

export function ajouterFavoriAuxCourses(idx) {
  var favs = []
  try { favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]') } catch(e) {}
  var r = favs[idx]
  if (!r || !Array.isArray(r.ingredients) || !r.ingredients.length) { afficherToast('Pas d\'ingrédients à ajouter'); return }
  var basePortions = r.portions || r.nb_personnes || 2
  var portions = st.favoriServings[idx] || basePortions
  var ratio = portions / Math.max(basePortions, 1)
  var nouveaux = r.ingredients.map(function(ing) {
    if (typeof ing === 'string') return { nom: ing, quantite: null, unite: 'g' }
    var qty = ing.quantite ? Math.round(ing.quantite * ratio) : null
    return { nom: ing.nom || ing.name || ing, quantite: qty, unite: ing.unite || 'g' }
  }).filter(function(ing) { return ing.nom })
  var existing = null
  try { existing = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  var liste = (existing && Array.isArray(existing.ingredients)) ? existing.ingredients : []
  nouveaux.forEach(function(ing) {
    var key   = ing.nom.toLowerCase().trim()
    var found = liste.find(function(e) { return e.nom.toLowerCase().trim() === key })
    if (found) { if (ing.quantite && found.unite === ing.unite) found.quantite = Math.round((found.quantite || 0) + ing.quantite) }
    else liste.push({ nom: ing.nom, quantite: ing.quantite, unite: ing.unite })
  })
  var recettes    = (existing && existing.recettes) ? existing.recettes : []
  var nomRecette  = r.nom || r.titre || ''
  if (nomRecette && !recettes.find(function(x) { return (x.nom || '').toLowerCase() === nomRecette.toLowerCase() })) {
    recettes.push({ nom: nomRecette, type: 'favori', id: idx, portions: portions, basePortions: basePortions, ingredients: nouveaux })
  }
  try { localStorage.setItem('vitalia_liste_courses', JSON.stringify({ date: existing && existing.date ? existing.date : new Date().toISOString(), ingredients: liste, recettes: recettes })) } catch(e) {}
  sauvegarderListeCoursesSupabase()
  afficherListeCoursesProfile()
  mettreAJourDashboardCuisine()
  afficherToast('Ingrédients ajoutés à la liste de courses !')
}

export function toggleSavedRecette(id) {
  var el    = document.getElementById(id)
  var arrow = document.getElementById('arrow-' + id)
  if (!el) return
  var open  = el.style.display !== 'none'
  el.style.display = open ? 'none' : 'block'
  if (arrow) arrow.style.transform = open ? '' : 'rotate(180deg)'
}

export function supprimerRecetteSauvegardee(idx) {
  if (!confirm('Supprimer cette recette de "À faire" ?')) return
  var saved = []
  try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  var r = saved[idx]
  saved.splice(idx, 1)
  try { localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved)) } catch(e) {}
  if (r && st.profil_id && st.profil_id !== 'new' && (r.titre || r.nom)) {
    var titre = encodeURIComponent(r.titre || r.nom || '')
    fetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees?profil_id=eq.' + st.profil_id + '&titre=eq.' + titre, {
      method: 'DELETE', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken }
    }).catch(function() {})
  }
  afficherRecettesSauvegardees()
}

export async function noterRecetteSauvegardee(idx, note) {
  var saved = []
  try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  if (!saved[idx]) return
  saved[idx].note = note
  try { localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved)) } catch(e) {}

  var starsEl = document.getElementById('saved-stars-' + idx)
  if (starsEl) starsEl.querySelectorAll('span').forEach(function(s, i) {
    s.style.color = (i < note) ? 'var(--golden,#e8b84b)' : 'rgba(196,113,74,0.25)'
  })

  var r = saved[idx]
  try {
    var favs   = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]')
    var nomCle = (r.nom || r.titre || '').toLowerCase().trim()
    var favIdx = favs.findIndex(function(f) { return (f.nom || f.titre || '').toLowerCase().trim() === nomCle })
    if (note >= 4) {
      var entree = Object.assign({}, r, { note: note })
      if (favIdx >= 0) favs[favIdx] = entree; else favs.unshift(entree)
    } else { if (favIdx >= 0) favs.splice(favIdx, 1) }
    localStorage.setItem('vitalia_favoris', JSON.stringify(favs))
  } catch(e) {}

  afficherFavoris()

  if (st.profil_id && st.profil_id !== 'new' && (r.titre || r.nom)) {
    var titre = encodeURIComponent(r.titre || r.nom || '')
    try {
      await authFetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees?profil_id=eq.' + st.profil_id + '&titre=eq.' + titre, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ note: note })
      })
    } catch(e) {}
    var favEntry = { profil_id: st.profil_id, titre: r.titre || r.nom || '', moment: r.type_repas || '', ingredients: r.ingredients || [], steps: r.instructions || [], tip: (r.astuces && r.astuces[0]) || '', note: note }
    if (note >= 4) {
      try { await authFetch(SUPABASE_URL + '/rest/v1/recettes_favorites', { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken, 'Prefer': 'resolution=merge-duplicates' }, body: JSON.stringify(favEntry) }) } catch(e) {}
    } else {
      try { await authFetch(SUPABASE_URL + '/rest/v1/recettes_favorites?profil_id=eq.' + st.profil_id + '&titre=eq.' + encodeURIComponent(r.titre || r.nom || ''), { method: 'DELETE', headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken } }) } catch(e) {}
    }
  }
  afficherToast(note >= 4 ? 'Ajouté aux favoris ⭐' : 'Note enregistrée')
}

export function toggleSelectSaved(idx) {
  var saved = []
  try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  var r = saved[idx]
  if (!r || !Array.isArray(r.ingredients) || !r.ingredients.length) {
    afficherToast('Pas d\'ingrédients à ajouter')
    return
  }

  st.savedSelected[idx] = !st.savedSelected[idx]
  var isSelected = st.savedSelected[idx]
  var portions   = st.savedServings[idx] || r.portions || r.nb_personnes || 2

  var btn = document.getElementById('saved-select-btn-' + idx)

  if (isSelected) {
    // Ajouter immédiatement à la liste
    var existing = null
    try { existing = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    var liste    = (existing && Array.isArray(existing.ingredients)) ? existing.ingredients : []
    var recettes = (existing && existing.recettes) ? existing.recettes : []
    var basePortions = r.portions || r.nb_personnes || 2
    var ratio        = portions / Math.max(basePortions, 1)
    var nouveaux = r.ingredients.map(function(ing) {
      if (typeof ing === 'string') return { nom: ing, quantite: null, unite: 'g' }
      return { nom: ing.nom || ing.name || String(ing), quantite: ing.quantite ? Math.round(ing.quantite * ratio) : null, unite: ing.unite || 'g' }
    }).filter(function(ing) { return ing.nom })
    nouveaux.forEach(function(ing) {
      var key   = ing.nom.toLowerCase().trim()
      var found = liste.find(function(e) { return e.nom.toLowerCase().trim() === key })
      if (found) { if (ing.quantite && found.unite === ing.unite) found.quantite = Math.round((found.quantite || 0) + ing.quantite) }
      else liste.push({ nom: ing.nom, quantite: ing.quantite, unite: ing.unite })
    })
    var nomRecette = r.nom || r.titre || ''
    if (nomRecette && !recettes.find(function(x) { return (x.nom || '').toLowerCase() === nomRecette.toLowerCase() })) {
      recettes.push({ nom: nomRecette, type: 'saved', id: idx, portions: portions, basePortions: basePortions, ingredients: nouveaux })
    }
    localStorage.setItem('vitalia_liste_courses', JSON.stringify({ date: new Date().toISOString(), ingredients: liste, recettes: recettes }))
    sauvegarderListeCoursesSupabase()
    afficherListeCoursesProfile()
    mettreAJourDashboardCuisine()
    afficherToast('Ingrédients ajoutés à la liste !')
    if (btn) { btn.textContent = '✓ Dans la liste'; btn.style.background = 'rgba(122,158,126,0.15)'; btn.style.borderColor = 'var(--sage)'; btn.style.color = 'var(--sage)' }
  } else {
    // Retirer de la liste
    var existing2 = null
    try { existing2 = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    if (existing2 && existing2.recettes) {
      var nomR = (r.nom || r.titre || '').toLowerCase()
      existing2.recettes = existing2.recettes.filter(function(x) { return (x.nom || '').toLowerCase() !== nomR })
      import('./plan.js').then(function(m) {
        var manuels = (existing2.ingredients || []).filter(function(i) { return i.manuel })
        existing2.ingredients = m.reagregerDepuisRecettes(existing2.recettes).concat(manuels)
        existing2.date = new Date().toISOString()
        localStorage.setItem('vitalia_liste_courses', JSON.stringify(existing2))
        sauvegarderListeCoursesSupabase()
        afficherListeCoursesProfile()
        mettreAJourDashboardCuisine()
      })
    }
    afficherToast('Recette retirée de la liste')
    if (btn) { btn.textContent = '🛒 Ajouter à la liste'; btn.style.background = 'rgba(196,113,74,0.08)'; btn.style.borderColor = 'rgba(196,113,74,0.25)'; btn.style.color = 'var(--terracotta)' }
  }
}

export function changerPortionsSaved(idx, delta) {
  if (st.savedServings[idx] == null) {
    try {
      var _list = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]')
      var _r = _list[idx]
      st.savedServings[idx] = (_r && (_r.portions || _r.nb_personnes)) || 2
    } catch(e) { st.savedServings[idx] = 2 }
  }
  st.savedServings[idx] = Math.max(1, Math.min(8, st.savedServings[idx] + delta))
  var el = document.getElementById('saved-portions-' + idx)
  if (el) el.textContent = st.savedServings[idx]
  var ingContainer = document.getElementById('saved-ingredients-' + idx)
  if (ingContainer) {
    try {
      var savedList = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]')
      var r = savedList[idx]
      if (r && Array.isArray(r.ingredients)) {
        var basePortions = parseFloat(ingContainer.dataset.portions) || r.portions || 2
        var ratio        = st.savedServings[idx] / Math.max(basePortions, 1)
        ingContainer.innerHTML = r.ingredients.map(function(i) {
          var qty = i.quantite ? Math.round(i.quantite * ratio) : null
          return '<span style="display:inline-block;background:var(--cream);border-radius:8px;padding:3px 8px;font-size:12px;margin:2px;">' + i.nom + (qty ? ' ' + qty + '\u202f' + (i.unite || 'g') : '') + '</span>'
        }).join('')
      }
    } catch(e) {}
  }
  if (st.savedSelected[idx]) import('./plan.js').then(function(m) { m.afficherBoutonListeCourses && m.afficherBoutonListeCourses() })
}

export function changerPortionsFavori(idx, delta) {
  if (st.favoriServings[idx] == null) {
    try {
      var _list = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]')
      var _r = _list[idx]
      st.favoriServings[idx] = (_r && (_r.portions || _r.nb_personnes)) || 2
    } catch(e) { st.favoriServings[idx] = 2 }
  }
  st.favoriServings[idx] = Math.max(1, Math.min(8, st.favoriServings[idx] + delta))
  var el = document.getElementById('fav-portions-' + idx)
  if (el) el.textContent = st.favoriServings[idx]
  var ingContainer = document.getElementById('fav-ingredients-' + idx)
  if (ingContainer) {
    try {
      var favList = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]')
      var r = favList[idx]
      if (r && Array.isArray(r.ingredients)) {
        var basePortions = parseFloat(ingContainer.dataset.portions) || r.portions || 2
        var ratio        = st.favoriServings[idx] / Math.max(basePortions, 1)
        ingContainer.innerHTML = r.ingredients.map(function(i) {
          var qty = i.quantite ? Math.round(i.quantite * ratio) : null
          return '<span style="display:inline-block;background:var(--cream);border-radius:8px;padding:3px 8px;font-size:12px;margin:2px;">' + (i.nom || i.name || i) + (qty ? ' ' + qty + '\u202f' + (i.unite || 'g') : '') + '</span>'
        }).join('')
      }
    } catch(e) {}
  }
}

// ── Liste de courses dans l'onglet À faire ──
export function afficherListeCoursesProfile() {
  var container = document.getElementById('listeCoursesProfile'); if (!container) return
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}

  var addInputHTML = '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<input type="text" id="courses-add-input" placeholder="Ajouter un article manuellement…" ' +
    'style="flex:1;border:1.5px solid rgba(196,113,74,0.25);border-radius:12px;padding:9px 14px;font-size:13px;font-family:\'DM Sans\',sans-serif;background:var(--warm-white);color:var(--deep-brown);outline:none;" ' +
    'onkeydown="if(event.key===\'Enter\')ajouterArticleManuelCourses()">' +
    '<button onclick="ajouterArticleManuelCourses()" style="background:var(--terracotta);color:white;border:none;border-radius:12px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:\'DM Sans\',sans-serif;">+ Ajouter</button>' +
    '</div>'

  if (!raw || !raw.ingredients || !raw.ingredients.length) {
    container.innerHTML = addInputHTML + '<div style="text-align:center;padding:16px;color:var(--text-light);font-size:13px;">Sélectionnez des recettes ou ajoutez des articles manuellement</div>'
    return
  }

  var vu = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  var dateStr  = raw.date ? new Date(raw.date).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }) : ''
  var restants = raw.ingredients.filter(function(i) { return !vu[i.nom] }).length
  var total    = raw.ingredients.length

  var html = addInputHTML
  html += (dateStr ? '<div style="font-size:11px;color:var(--text-light);margin-bottom:8px;">Générée le ' + dateStr + '</div>' : '')
  html += '<div style="font-size:12px;color:var(--sage);font-weight:600;margin-bottom:10px;">' + restants + ' / ' + total + ' ingrédients restants</div>'
  html += '<div style="display:flex;flex-direction:column;gap:6px;">'
  raw.ingredients.forEach(function(ing, idx) {
    var qte  = ing.quantite ? (Math.round(ing.quantite) + '\u202f' + (ing.unite || 'g')) : ''
    var done = !!vu[ing.nom]
    var deleteBtn = ing.manuel
      ? '<button onclick="supprimerArticleManuelCourses(' + idx + ');event.stopPropagation();" style="width:22px;height:22px;border:none;background:rgba(196,113,74,0.12);border-radius:50%;color:var(--terracotta);font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">×</button>' : ''
    html += '<div onclick="toggleCoursesVuByIdx(' + idx + ')" style="cursor:pointer;background:' + (done ? 'rgba(122,158,126,0.08)' : 'var(--cream)') + ';border-radius:12px;padding:10px 14px;display:flex;align-items:center;gap:10px;border:1px solid ' + (done ? 'rgba(122,158,126,0.3)' : 'transparent') + ';transition:all 0.2s;" id="courses-profile-item-' + idx + '">' +
           '<span style="width:22px;height:22px;border-radius:50%;border:2px solid ' + (done ? 'var(--sage)' : 'rgba(196,113,74,0.3)') + ';background:' + (done ? 'var(--sage)' : 'transparent') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;color:white;">' + (done ? '✓' : '') + '</span>' +
           '<span style="flex:1;font-size:13px;font-weight:500;color:' + (done ? 'var(--text-light)' : 'var(--deep-brown)') + ';text-decoration:' + (done ? 'line-through' : 'none') + ';">' + ing.nom + (ing.manuel ? ' <span style="font-size:10px;color:var(--text-light);font-style:italic;">(manuel)</span>' : '') + '</span>' +
           (qte ? '<span style="font-size:12px;color:var(--text-light);flex-shrink:0;">' + qte + '</span>' : '') +
           deleteBtn + '</div>'
  })
  html += '</div>'
  html += '<div style="display:flex;gap:8px;margin-top:12px;">' +
    '<button onclick="localStorage.removeItem(\'vitalia_courses_vu\');afficherListeCoursesProfile()" style="flex:1;background:none;border:1px solid rgba(196,113,74,0.2);border-radius:10px;padding:9px;font-size:12px;color:var(--text-light);cursor:pointer;">↺ Réinitialiser</button>' +
    '<button onclick="if(confirm(\'Effacer la liste de courses ?\')){viderListeCourses()}" style="flex:1;background:none;border:1px solid rgba(196,113,74,0.2);border-radius:10px;padding:9px;font-size:12px;color:var(--text-light);cursor:pointer;">🗑 Effacer la liste</button>' +
    '</div>'

  var recettes = raw.recettes || []
  if (recettes.length > 0) {
    html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(196,113,74,0.15);">'
    html += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-light);font-weight:600;margin-bottom:10px;">Recettes dans la liste (' + recettes.length + ')</div>'
    recettes.forEach(function(r, ri) {
      var typeStr = r.type === 'semaine' ? '📅' : '📋'
      html += '<div style="background:var(--warm-white);border-radius:14px;padding:12px 14px;border:1px solid rgba(196,113,74,0.12);display:flex;align-items:center;gap:10px;margin-bottom:8px;">'
      html += '<span style="font-size:18px;flex-shrink:0;">' + typeStr + '</span>'
      html += '<span style="flex:1;font-size:13px;font-weight:500;color:var(--deep-brown);line-height:1.3;">' + (r.nom || 'Recette') + '</span>'
      html += '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">'
      html += '<button onclick="changerPortionsListeProfile(\'' + r.type + '\',' + JSON.stringify(r.id) + ',-1)" style="width:26px;height:26px;border-radius:50%;border:1.5px solid rgba(196,113,74,0.3);background:var(--cream);color:var(--terracotta);font-size:16px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;padding-bottom:1px;">−</button>'
      html += '<span id="liste-portions-' + ri + '" style="font-size:13px;font-weight:600;color:var(--deep-brown);min-width:24px;text-align:center;">' + r.portions + '</span>'
      html += '<button onclick="changerPortionsListeProfile(\'' + r.type + '\',' + JSON.stringify(r.id) + ',+1)" style="width:26px;height:26px;border-radius:50%;border:1.5px solid rgba(196,113,74,0.3);background:var(--cream);color:var(--terracotta);font-size:16px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;padding-bottom:1px;">+</button>'
      html += '<span style="font-size:11px;color:var(--text-light);margin-left:2px;">pers.</span>'
      html += '<button onclick="supprimerRecetteDeListeProfile(\'' + r.type + '\',' + JSON.stringify(r.id) + ')" title="Retirer de la liste" style="margin-left:6px;width:26px;height:26px;border-radius:50%;border:none;background:rgba(196,113,74,0.1);color:var(--terracotta);font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>'
      html += '</div></div>'
    })
    html += '</div>'
  }
  container.innerHTML = html
}

export function toggleCoursesVuByIdx(idx) {
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw || !raw.ingredients || !raw.ingredients[idx]) return
  var nom = raw.ingredients[idx].nom
  var vu  = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  if (vu[nom]) delete vu[nom]; else vu[nom] = true
  localStorage.setItem('vitalia_courses_vu', JSON.stringify(vu))
  afficherListeCoursesProfile()
  mettreAJourDashboardCuisine()
}

export function ajouterArticleManuelCourses() {
  var input = document.getElementById('courses-add-input'); if (!input) return
  var nom = input.value.trim(); if (!nom) return
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw) raw = { date: new Date().toISOString(), ingredients: [], recettes: [] }
  if (!raw.ingredients) raw.ingredients = []
  var exists = raw.ingredients.some(function(i) { return i.nom.toLowerCase() === nom.toLowerCase() })
  if (exists) { afficherToast('Cet article est déjà dans la liste'); input.value = ''; return }
  raw.ingredients.push({ nom: nom, quantite: null, unite: null, manuel: true })
  localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw))
  sauvegarderListeCoursesSupabase()
  input.value = ''
  afficherListeCoursesProfile()
  setTimeout(function() { var el = document.getElementById('courses-add-input'); if (el) el.focus() }, 50)
}

export function supprimerArticleManuelCourses(idx) {
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw || !raw.ingredients || !raw.ingredients[idx]) return
  var nom = raw.ingredients[idx].nom
  raw.ingredients.splice(idx, 1)
  var vu = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  delete vu[nom]
  localStorage.setItem('vitalia_courses_vu', JSON.stringify(vu))
  if (!raw.ingredients.length && (!raw.recettes || !raw.recettes.length)) localStorage.removeItem('vitalia_liste_courses')
  else localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw))
  afficherListeCoursesProfile()
}

export function toggleCoursesVu(encodedNom) {
  var nom = decodeURIComponent(encodedNom)
  var vu  = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  if (vu[nom]) delete vu[nom]; else vu[nom] = true
  localStorage.setItem('vitalia_courses_vu', JSON.stringify(vu))
  afficherListeCoursesProfile()
  mettreAJourDashboardCuisine()
}

export function supprimerRecetteDeListeProfile(type, id) {
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw || !raw.recettes) return
  raw.recettes = raw.recettes.filter(function(r) { return !(r.type === type && String(r.id) === String(id)) })
  if (type === 'semaine') {
    st.semaineSelected[id] = false
    var btn = document.getElementById('select-btn-' + id)
    if (btn) { btn.classList.remove('selected'); btn.textContent = '🛒 Sélectionner' }
  } else {
    var idx2 = parseInt(id)
    st.savedSelected[idx2] = false
    var btn2 = document.getElementById('saved-select-btn-' + idx2)
    if (btn2) { btn2.textContent = '🛒 Sélectionner pour la liste'; btn2.style.background = 'rgba(196,113,74,0.08)'; btn2.style.borderColor = 'rgba(196,113,74,0.25)'; btn2.style.color = 'var(--terracotta)' }
  }
  import('./plan.js').then(function(m) {
    var manuels = (raw.ingredients || []).filter(function(i) { return i.manuel })
    raw.ingredients = m.reagregerDepuisRecettes(raw.recettes).concat(manuels)
    if (!raw.recettes.length && !manuels.length) { localStorage.removeItem('vitalia_liste_courses'); localStorage.removeItem('vitalia_courses_vu') }
    else { raw.date = new Date().toISOString(); localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw)) }
    sauvegarderListeCoursesSupabase()
    afficherListeCoursesProfile()
  })
}

export function changerPortionsListeProfile(type, id, delta) {
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw || !raw.recettes) return
  var recette = raw.recettes.find(function(r) { return r.type === type && String(r.id) === String(id) })
  if (!recette) return
  recette.portions = Math.max(1, Math.min(8, (recette.portions || 2) + delta))
  if (type === 'semaine') {
    st.semaineServings[id] = recette.portions
    var portEl = document.getElementById('portions-' + id)
    if (portEl) portEl.textContent = recette.portions + ' pers.'
  } else {
    var idx2   = parseInt(id)
    st.savedServings[idx2] = recette.portions
    var portEl2 = document.getElementById('saved-portions-' + idx2)
    if (portEl2) portEl2.textContent = recette.portions
  }
  import('./plan.js').then(function(m) {
    var manuels = (raw.ingredients || []).filter(function(i) { return i.manuel })
    raw.ingredients = m.reagregerDepuisRecettes(raw.recettes).concat(manuels)
    localStorage.removeItem('vitalia_courses_vu')
    raw.date = new Date().toISOString()
    localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw))
    afficherListeCoursesProfile()
  })
}

// ── Dashboard "Ma cuisine" ──
export function mettreAJourDashboardCuisine() {
  // Stats liste de courses
  var elRecettes = document.getElementById('dash-courses-recettes')
  var elTotal    = document.getElementById('dash-courses-total')
  var elRestants = document.getElementById('dash-courses-restants')
  if (elRecettes || elTotal || elRestants) {
    var raw = null
    try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    var vu = {}
    try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
    var nbRecettes  = (raw && raw.recettes) ? raw.recettes.length : 0
    var nbTotal     = (raw && raw.ingredients) ? raw.ingredients.length : 0
    var nbRestants  = (raw && raw.ingredients) ? raw.ingredients.filter(function(i) { return !vu[i.nom] }).length : 0
    if (elRecettes) elRecettes.textContent = nbRecettes > 0 ? nbRecettes + ' recette' + (nbRecettes > 1 ? 's' : '') : 'Aucune recette'
    if (elTotal)    elTotal.textContent    = nbTotal > 0 ? nbTotal + ' ingrédient' + (nbTotal > 1 ? 's' : '') : 'Liste vide'
    if (elRestants) elRestants.textContent = nbTotal > 0 ? nbRestants + ' restant' + (nbRestants > 1 ? 's' : '') : ''
  }
  // Sous-texte recettes
  var sub2 = document.getElementById('dash-recettes-sub')
  if (sub2) {
    var saved = []
    try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
    var favs = []
    try { favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]') } catch(e) {}
    var nbSaved = Array.isArray(saved) ? saved.length : 0
    var nbFavs  = Array.isArray(favs)  ? favs.length  : 0
    sub2.textContent = nbSaved + ' à faire · ' + nbFavs + ' favoris'
  }
}

var _recettesViewCourante = 'saved'
export function switchRecettesView(view) {
  _recettesViewCourante = view
  var btnSaved = document.getElementById('btn-view-saved')
  var btnFavs  = document.getElementById('btn-view-fav')
  if (btnSaved) btnSaved.classList.toggle('active', view === 'saved')
  if (btnFavs)  btnFavs.classList.toggle('active', view === 'fav')
  var listSaved = document.getElementById('recettesSauvegardeesListe')
  var listFavs  = document.getElementById('favorisListe')
  if (listSaved) listSaved.style.display = view === 'saved' ? 'flex' : 'none'
  if (listFavs)  listFavs.style.display  = view === 'fav'  ? 'flex' : 'none'
  if (view === 'saved') afficherRecettesSauvegardees()
  if (view === 'fav')   afficherFavoris()
}

export function filtrerRecettesOuFavoris(query) {
  if (_recettesViewCourante === 'saved') filtrerRecettesSauvegardees(query)
  else filtrerFavoris(query)
}

// ── Effacer complètement la liste (localement + Supabase + sélections en mémoire) ──
export function viderListeCourses() {
  localStorage.removeItem('vitalia_liste_courses')
  localStorage.removeItem('vitalia_courses_vu')
  effacerListeCoursesSupabase()
  // Réinitialiser les sélections pour éviter la régénération automatique
  Object.keys(st.semaineSelected).forEach(function(k) { st.semaineSelected[k] = false })
  Object.keys(st.savedSelected).forEach(function(k) { st.savedSelected[k] = false })
  // Mettre à jour visuellement les boutons de sélection visibles
  document.querySelectorAll('[id^="select-btn-"]').forEach(function(btn) {
    btn.classList.remove('selected')
    btn.textContent = '🛒 Sélectionner'
  })
  document.querySelectorAll('[id^="saved-select-btn-"]').forEach(function(btn) {
    btn.classList.remove('selected')
    btn.textContent = '🛒 Ajouter à la liste'
  })
  afficherListeCoursesProfile()
  mettreAJourDashboardCuisine()
}
