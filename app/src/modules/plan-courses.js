import { SUPABASE_URL, SUPABASE_ANON_KEY, st } from './state.js'
import { authFetch } from './auth.js'
import { afficherToast } from './ui.js'
import { sauvegarderListeCoursesSupabase } from './api.js'

export function reagregerDepuisRecettes(recettes) {
  var map = {}
  ;(recettes || []).forEach(function(r) {
    if (!r.ingredients || !r.ingredients.length) return
    var ratio = r.portions / Math.max(r.basePortions || 2, 1)
    r.ingredients.forEach(function(ing) {
      var key = ing.nom.toLowerCase().trim()
      if (map[key]) {
        if (map[key].unite === (ing.unite || 'g') && ing.quantite) map[key].quantite = Math.round((map[key].quantite || 0) + ing.quantite * ratio)
      } else {
        map[key] = { nom: ing.nom, quantite: ing.quantite ? Math.round(ing.quantite * ratio) : null, unite: ing.unite || 'g' }
      }
    })
  })
  return Object.values(map).sort(function(a, b) { return a.nom.localeCompare(b.nom) })
}

export function construireListeRecettes() {
  var result = []
  var MEAL_LABEL = { petit_dejeuner: 'Petit-déj.', dejeuner: 'Déjeuner', diner: 'Dîner', pause: 'Collation' }
  var JOUR_LABEL = { lundi:'Lun.', mardi:'Mar.', mercredi:'Mer.', jeudi:'Jeu.', vendredi:'Ven.', samedi:'Sam.', dimanche:'Dim.' }

  Object.keys(st.semaineSelected).forEach(function(id) {
    if (!st.semaineSelected[id]) return
    var parts   = id.split('_'), jour = parts[0], mealKey = parts.slice(1).join('_')
    var recette = st.semainePlanData && st.semainePlanData.semaine && st.semainePlanData.semaine[jour] && st.semainePlanData.semaine[jour][mealKey]
    if (!recette) return
    result.push({ type: 'semaine', id: id,
      nom: recette.nom || ((MEAL_LABEL[mealKey] || mealKey) + ' ' + (JOUR_LABEL[jour] || jour)),
      portions: st.semaineServings[id] || recette.portions || recette.nb_personnes || st.defaultPortions,
      basePortions: recette.portions || recette.nb_personnes || st.semaineBasePortions || st.defaultPortions || 2,
      ingredients: recette.ingredients || [] })
  })

  var savedList = []
  try { savedList = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  Object.keys(st.savedSelected).forEach(function(idx) {
    if (!st.savedSelected[idx]) return
    var recette = savedList[parseInt(idx)]; if (!recette) return
    result.push({ type: 'saved', id: parseInt(idx),
      nom: recette.nom || 'Recette sauvegardée',
      portions: st.savedServings[parseInt(idx)] || recette.portions || recette.nb_personnes || 2,
      basePortions: recette.portions || recette.nb_personnes || 2,
      ingredients: recette.ingredients || [] })
  })
  return result
}

export function aggregerIngredients() {
  var map = {}
  function ajouterIngredients(ingredients, ratio) {
    ingredients.forEach(function(ing) {
      var key = ing.nom.toLowerCase().trim()
      if (map[key]) {
        if (map[key].unite === (ing.unite || 'g') && ing.quantite) map[key].quantite = Math.round((map[key].quantite || 0) + ing.quantite * ratio)
      } else {
        map[key] = { nom: ing.nom, quantite: ing.quantite ? Math.round(ing.quantite * ratio) : null, unite: ing.unite || 'g' }
      }
    })
  }
  Object.keys(st.semaineSelected).forEach(function(id) {
    if (!st.semaineSelected[id]) return
    var parts   = id.split('_'), jour = parts[0], mealKey = parts.slice(1).join('_')
    var recette = st.semainePlanData && st.semainePlanData.semaine && st.semainePlanData.semaine[jour] && st.semainePlanData.semaine[jour][mealKey]
    if (!recette || !recette.ingredients) return
    var semaineBase = recette.portions || recette.nb_personnes || st.semaineBasePortions || st.defaultPortions || 2
    ajouterIngredients(recette.ingredients, (st.semaineServings[id] || recette.portions || recette.nb_personnes || st.defaultPortions) / Math.max(semaineBase, 1))
  })
  var savedList = []
  try { savedList = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  Object.keys(st.savedSelected).forEach(function(idx) {
    if (!st.savedSelected[idx]) return
    var recette = savedList[parseInt(idx)]; if (!recette || !recette.ingredients) return
    ajouterIngredients(recette.ingredients, (st.savedServings[parseInt(idx)] || recette.portions || recette.nb_personnes || 2) / Math.max(recette.portions || recette.nb_personnes || 2, 1))
  })
  return Object.values(map).sort(function(a, b) { return a.nom.localeCompare(b.nom) })
}

export function afficherListeCourses() {
  st.coursesChecked        = {}
  st._coursesIngredients   = aggregerIngredients()
  var ingredients          = st._coursesIngredients

  if (ingredients.length) {
    localStorage.setItem('vitalia_liste_courses', JSON.stringify({ date: new Date().toISOString(), ingredients: ingredients }))
    import('./courses-profile.js').then(function(m) { m.afficherListeCoursesProfile() })
  }

  try {
    var vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}')
    ingredients.forEach(function(ing, idx) { if (vu[ing.nom]) st.coursesChecked[idx] = true })
  } catch(e) {}

  var html = '<div class="courses-modal" id="coursesModal" onclick="if(event.target===this)fermerListeCourses()">'
  html += '<div class="courses-modal-inner">'
  html += '<div class="courses-modal-handle"></div>'
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">'
  html += '<div style="font-family:\'Fraunces\',serif;font-size:20px;font-weight:700;color:var(--deep-brown);">🛒 Liste de courses</div>'
  html += '<button onclick="fermerListeCourses()" style="background:var(--cream);border:none;border-radius:10px;padding:6px 12px;cursor:pointer;font-size:14px;color:var(--mid-brown);">✕</button>'
  html += '</div>'
  if (!ingredients.length) {
    html += '<p style="color:var(--text-light);text-align:center;padding:24px 0;">Aucun ingrédient sélectionné</p>'
  } else {
    html += '<div id="coursesModalList" style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">'
    ingredients.forEach(function(ing, idx) {
      var done = !!st.coursesChecked[idx]
      var qte  = ing.quantite ? (Math.round(ing.quantite) + '\u202f' + (ing.unite || 'g')) : ''
      html += '<div onclick="toggleCoursesModalItem(' + idx + ')" style="cursor:pointer;background:' + (done ? 'rgba(122,158,126,0.08)' : 'var(--cream)') + ';border-radius:12px;padding:10px 14px;display:flex;align-items:center;gap:10px;border:1px solid ' + (done ? 'rgba(122,158,126,0.3)' : 'transparent') + ';transition:all 0.2s;" id="courses-item-' + idx + '">' +
              '<span style="width:22px;height:22px;border-radius:50%;border:2px solid ' + (done ? 'var(--sage)' : 'rgba(196,113,74,0.3)') + ';background:' + (done ? 'var(--sage)' : 'transparent') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;color:white;">' + (done ? '✓' : '') + '</span>' +
              '<span style="flex:1;font-size:13px;font-weight:500;color:' + (done ? 'var(--text-light)' : 'var(--deep-brown)') + ';text-decoration:' + (done ? 'line-through' : 'none') + ';">' + ing.nom + '</span>' +
              (qte ? '<span style="font-size:12px;color:var(--text-light);flex-shrink:0;">' + qte + '</span>' : '') +
              '</div>'
    })
    html += '</div>'
    html += '<button onclick="sauvegarderListeCourses()" style="width:100%;background:linear-gradient(135deg,var(--terracotta),var(--dusty-rose));color:white;border:none;border-radius:16px;padding:14px;font-family:\'DM Sans\',sans-serif;font-size:15px;font-weight:600;cursor:pointer;">💾 Sauvegarder dans le profil</button>'
  }
  html += '</div></div>'
  var existing = document.getElementById('coursesModal')
  if (existing) existing.remove()
  document.body.insertAdjacentHTML('beforeend', html)
}

export function toggleCoursesModalItem(idx) {
  var ing = st._coursesIngredients[idx]; if (!ing) return
  st.coursesChecked[idx] = !st.coursesChecked[idx]
  var done = !!st.coursesChecked[idx]
  var el   = document.getElementById('courses-item-' + idx)
  if (el) {
    el.style.background  = done ? 'rgba(122,158,126,0.08)' : 'var(--cream)'
    el.style.borderColor = done ? 'rgba(122,158,126,0.3)'  : 'transparent'
    var spans = el.querySelectorAll('span')
    if (spans[0]) {
      spans[0].style.border     = '2px solid ' + (done ? 'var(--sage)' : 'rgba(196,113,74,0.3)')
      spans[0].style.background = done ? 'var(--sage)' : 'transparent'
      spans[0].textContent      = done ? '✓' : ''
    }
    if (spans[1]) {
      spans[1].style.color          = done ? 'var(--text-light)' : 'var(--deep-brown)'
      spans[1].style.textDecoration = done ? 'line-through' : 'none'
    }
  }
  var vu = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  vu[ing.nom] = done
  if (!done) delete vu[ing.nom]
  localStorage.setItem('vitalia_courses_vu', JSON.stringify(vu))
}

export function fermerListeCourses() {
  var modal = document.getElementById('coursesModal'); if (modal) modal.remove()
}

export function sauvegarderListeCourses() {
  var liste    = aggregerIngredients()
  var recettes = construireListeRecettes()
  var existingRaw = null
  try { existingRaw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  var manuels = existingRaw ? (existingRaw.ingredients || []).filter(function(i) { return i.manuel }) : []
  localStorage.setItem('vitalia_liste_courses', JSON.stringify({ date: new Date().toISOString(), ingredients: liste.concat(manuels), recettes: recettes }))
  afficherToast('Liste sauvegardée dans le profil !')
  fermerListeCourses()
  import('./courses-profile.js').then(function(m) { m.afficherListeCoursesProfile() })
}

export async function genererRecettePourRepas(jour, mealKey, typeRepas) {
  var id  = jour + '_' + mealKey
  var btn = document.getElementById('regen-btn-' + id)
  if (btn) { btn.disabled = true; btn.textContent = '⏳…' }
  try {
    var resp = await authFetch(SUPABASE_URL + '/functions/v1/generer-recette-unique', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + st.authToken, 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ profil_id:st.profil_id, type_repas:typeRepas, ingredients_frigo:[], symptomes:st.selectedSymptoms, nb_personnes:st.defaultPortions }),
    })
    if (!resp.ok) {
      if (resp.status !== 401) afficherToast('Erreur serveur ' + resp.status)
      if (btn) { btn.disabled = false; btn.textContent = '✨ Regénérer' }
      return
    }
    var data = await resp.json()
    if (data.success && data.recette && st.semainePlanData && st.semainePlanData.semaine && st.semainePlanData.semaine[jour]) {
      st.semainePlanData.semaine[jour][mealKey] = data.recette
      import('./plan-semaine.js').then(function(m) {
        m.afficherSemaine(st.semainePlanData)
        try { localStorage.setItem('vitalia_semaine_session', JSON.stringify(st.semainePlanData)) } catch(e) {}
        m.toggleDay(jour)
      })
      afficherToast('Recette améliorée !')
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Regénérer' }
      afficherToast('Erreur lors de la génération')
    }
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Regénérer' }
    afficherToast('Erreur réseau')
  }
}
