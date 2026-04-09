import { SUPABASE_URL, SUPABASE_ANON_KEY, st } from './state.js'
import { authFetch } from './auth.js'
import { afficherToast } from './ui.js'
import { afficherPhotoRecette, chargerMeilleurePhoto } from './photos.js'

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
    var entry = Object.assign({}, st.recetteCourante, { id: 'recette_' + Date.now(), saved_at: new Date().toISOString(), note: 0, portions: st.recetteCourante.portions || st.recetteCourante.nb_personnes || st.defaultPortions || 2 })
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
