import { SUPABASE_URL, SUPABASE_ANON_KEY, st } from './state.js'
import { authFetch } from './auth.js'
import { afficherToast } from './ui.js'
import { sauvegarderListeCoursesSupabase } from './api.js'
import { afficherPhotoRecette, chargerMeilleurePhoto } from './photos.js'

var PAGE_SIZE    = 10
var _savedLimit  = PAGE_SIZE
var _favoriLimit = PAGE_SIZE

var _recettesViewCourante = 'saved'

export function afficherRecettesSauvegardees(reset) {
  var container = document.getElementById('recettesSauvegardeesListe'); if (!container) return
  var activeQuery = (document.getElementById('recettes-search') || {}).value || ''
  if (reset) _savedLimit = PAGE_SIZE
  var saved = []
  try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}

  if (!saved.length) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-light);font-size:13px;">Aucune recette sauvegardée</div>'
    return
  }

  var page    = saved.slice(0, _savedLimit)
  var restant = saved.length - _savedLimit

  container.innerHTML = page.map(function(r, idx) {
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

  if (restant > 0) {
    container.innerHTML += '<button onclick="voirPlusSaved()" style="width:100%;padding:12px;background:none;border:1.5px solid rgba(196,113,74,0.25);border-radius:14px;color:var(--terracotta);font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;">Voir plus (' + restant + ' restantes)</button>'
  }

  if (activeQuery) filtrerRecettesSauvegardees(activeQuery)

  page.forEach(function(r, idx) {
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

export function voirPlusSaved() {
  _savedLimit += PAGE_SIZE
  afficherRecettesSauvegardees()
}

export function afficherFavoris(reset) {
  var container = document.getElementById('favorisListe'); if (!container) return
  var activeQuery = (document.getElementById('favoris-search') || {}).value || ''
  if (reset) _favoriLimit = PAGE_SIZE
  var favs = []
  try { favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]') } catch(e) {}
  if (!favs.length) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-light);font-size:13px;">Notez une recette ★★★★ ou ★★★★★ dans "À faire > Recettes" pour l\'ajouter ici</div>'
    return
  }
  var page    = favs.slice(0, _favoriLimit)
  var restant = favs.length - _favoriLimit
  container.innerHTML = page.map(function(r, i) {
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

  if (restant > 0) {
    container.innerHTML += '<button onclick="voirPlusFavoris()" style="width:100%;padding:12px;background:none;border:1.5px solid rgba(232,184,75,0.35);border-radius:14px;color:var(--mid-brown,#b8942a);font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;">Voir plus (' + restant + ' restants)</button>'
  }

  if (activeQuery) filtrerFavoris(activeQuery)

  page.forEach(function(r, i) {
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

export function voirPlusFavoris() {
  _favoriLimit += PAGE_SIZE
  afficherFavoris()
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
  import('./courses-profile.js').then(function(m) {
    m.afficherListeCoursesProfile()
    m.mettreAJourDashboardCuisine()
  })
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
    import('./courses-profile.js').then(function(m) {
      m.afficherListeCoursesProfile()
      m.mettreAJourDashboardCuisine()
    })
    afficherToast('Ingrédients ajoutés à la liste !')
    if (btn) { btn.textContent = '✓ Dans la liste'; btn.style.background = 'rgba(122,158,126,0.15)'; btn.style.borderColor = 'var(--sage)'; btn.style.color = 'var(--sage)' }
  } else {
    var existing2 = null
    try { existing2 = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    if (existing2 && existing2.recettes) {
      var nomR = (r.nom || r.titre || '').toLowerCase()
      existing2.recettes = existing2.recettes.filter(function(x) { return (x.nom || '').toLowerCase() !== nomR })
      import('./plan-courses.js').then(function(m) {
        var manuels = (existing2.ingredients || []).filter(function(i) { return i.manuel })
        existing2.ingredients = m.reagregerDepuisRecettes(existing2.recettes).concat(manuels)
        var oldVu2 = {}
        try { oldVu2 = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
        var newVu2 = {}
        existing2.ingredients.forEach(function(ing) {
          var key = ing.nom.toLowerCase().trim()
          var match = Object.keys(oldVu2).find(function(k) { return k.toLowerCase().trim() === key })
          if (match && oldVu2[match]) newVu2[ing.nom] = true
        })
        localStorage.setItem('vitalia_courses_vu', JSON.stringify(newVu2))
        existing2.date = new Date().toISOString()
        localStorage.setItem('vitalia_liste_courses', JSON.stringify(existing2))
        sauvegarderListeCoursesSupabase()
        import('./courses-profile.js').then(function(cm) {
          cm.afficherListeCoursesProfile()
          cm.mettreAJourDashboardCuisine()
        })
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
  if (st.savedSelected[idx]) import('./plan-courses.js').then(function(m) { m.afficherBoutonListeCourses && m.afficherBoutonListeCourses() })
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
