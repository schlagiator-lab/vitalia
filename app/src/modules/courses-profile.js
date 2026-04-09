import { st } from './state.js'
import { afficherToast } from './ui.js'
import { sauvegarderListeCoursesSupabase, effacerListeCoursesSupabase } from './api.js'

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
  import('./plan-courses.js').then(function(m) {
    var manuels = (raw.ingredients || []).filter(function(i) { return i.manuel })
    raw.ingredients = m.reagregerDepuisRecettes(raw.recettes).concat(manuels)
    if (!raw.recettes.length && !manuels.length) { localStorage.removeItem('vitalia_liste_courses'); localStorage.removeItem('vitalia_courses_vu') }
    else {
      var oldVu = {}
      try { oldVu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
      var newVu = {}
      raw.ingredients.forEach(function(ing) {
        var key = ing.nom.toLowerCase().trim()
        var match = Object.keys(oldVu).find(function(k) { return k.toLowerCase().trim() === key })
        if (match && oldVu[match]) newVu[ing.nom] = true
      })
      localStorage.setItem('vitalia_courses_vu', JSON.stringify(newVu))
      raw.date = new Date().toISOString()
      localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw))
    }
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
  import('./plan-courses.js').then(function(m) {
    var manuels = (raw.ingredients || []).filter(function(i) { return i.manuel })
    raw.ingredients = m.reagregerDepuisRecettes(raw.recettes).concat(manuels)
    localStorage.removeItem('vitalia_courses_vu')
    raw.date = new Date().toISOString()
    localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw))
    afficherListeCoursesProfile()
  })
}

export function mettreAJourDashboardCuisine() {
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

export function viderListeCourses() {
  localStorage.removeItem('vitalia_liste_courses')
  localStorage.removeItem('vitalia_courses_vu')
  effacerListeCoursesSupabase()
  Object.keys(st.semaineSelected).forEach(function(k) { st.semaineSelected[k] = false })
  Object.keys(st.savedSelected).forEach(function(k) { st.savedSelected[k] = false })
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
