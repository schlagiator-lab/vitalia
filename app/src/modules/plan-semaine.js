import { SUPABASE_URL, SUPABASE_ANON_KEY, st, escapeHtml } from './state.js'
import { authFetch } from './auth.js'
import { afficherToast, updateObjectifPrincipalBadge } from './ui.js'
import { sauvegarderListeCoursesSupabase } from './api.js'
import { afficherPhotoRecette, chargerMeilleurePhoto } from './photos.js'
import { _fmtQty } from './plan-jour.js'
import { aggregerIngredients, construireListeRecettes } from './plan-courses.js'

// ── Sync des chips symptômes dans l'onglet semaine ──
export function syncSemaineChips() {
  document.querySelectorAll('#semaineSymptomChips .chip').forEach(function(el) {
    var val = el.dataset.val
    el.classList.toggle('selected', st.selectedSymptoms.includes(val))
  })
  updateObjectifPrincipalBadge()
}

export function toggleSemaineSymptom(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!st.selectedSymptoms.includes(val)) st.selectedSymptoms.push(val)
  } else {
    st.selectedSymptoms = st.selectedSymptoms.filter(function(v) { return v !== val })
  }
  document.querySelectorAll('#symptomsChips .chip').forEach(function(c) {
    var m = c.getAttribute('onclick') && c.getAttribute('onclick').match(/'(\w+)'\)/)
    if (m && m[1] === val) c.classList.toggle('selected', st.selectedSymptoms.includes(val))
  })
  updateObjectifPrincipalBadge()
}

export function toggleDay(jour) {
  var meals   = document.getElementById('day-meals-'   + jour)
  var chevron = document.getElementById('day-chevron-' + jour)
  if (!meals) return
  var isOpen = meals.classList.contains('open')
  meals.classList.toggle('open',   !isOpen)
  if (chevron) chevron.classList.toggle('open', !isOpen)
  if (!isOpen) st.semaineJourOuvert = jour
}

export function toggleDayMeal(jour, meal) {
  var id     = jour + '_' + meal
  var detail = document.getElementById('day-detail-' + id)
  if (!detail) return
  var wasOpen = detail.classList.contains('open')
  detail.classList.toggle('open')
  if (!wasOpen) {
    var recette = st.semainePlanData && st.semainePlanData.semaine &&
                  st.semainePlanData.semaine[jour] && st.semainePlanData.semaine[jour][meal]
    if (recette) {
      var cid = 'semaine-inner-' + id
      if (recette.photo_url) {
        afficherPhotoRecette(cid, recette.photo_url, false)
      } else {
        var titre = recette.nom || recette.titre
        if (titre) chargerMeilleurePhoto(titre).then(function(res) {
          if (res) afficherPhotoRecette(cid, res.url, res.isCommunaute)
        })
      }
    }
  }
}

export async function genererSemaine(forcer) {
  if (!st.profil_id) { afficherToast('Profil non trouvé'); return }
  if (forcer) window.scrollTo({ top: 0, behavior: 'smooth' })
  var silentMode   = !forcer && st.semainePlanData !== null
  var btn          = document.getElementById('semaineBtnGenerate')
  var btnText      = document.getElementById('semaineBtnText')
  var empty        = document.getElementById('semaineEmpty')
  var cards        = document.getElementById('dayCards')
  var progressCont = document.getElementById('semaineProgressContainer')
  var progressFill = document.getElementById('semaineProgressFill')
  var progressText = document.getElementById('semaineProgressText')

  if (!silentMode) {
    if (btn)    { btn.disabled = true; btn.style.opacity = '0.7' }
    if (btnText) btnText.textContent = '⏳ Génération en cours…'
    if (cards)   cards.style.display = 'none'
    if (empty)   empty.style.display = 'flex'
  }

  if (!silentMode && progressCont) progressCont.style.display = 'block'
  var progressTimers = []
  var etapes = [
    { pct: 15, label: 'Sélection des aliments…',           delai: 1000,  stage: 1 },
    { pct: 35, label: 'Génération des recettes en cours…', delai: 3000,  stage: 2 },
    { pct: 70, label: 'Création des plats…',               delai: 15000, stage: 3 },
    { pct: 90, label: 'Finalisation…',                     delai: 30000, stage: 3 },
  ]
  function switchProgStage(stage) {
    var stages = ['prog-stage-0','prog-stage-1','prog-stage-2','prog-stage-3','prog-stage-done']
    stages.forEach(function(id, i) {
      var el = document.getElementById(id)
      if (el) el.style.display = (i === stage) ? 'flex' : 'none'
    })
  }
  if (!silentMode) {
    if (progressFill) progressFill.style.width = '0%'
    if (progressText) progressText.textContent = 'Analyse du profil…'
    switchProgStage(0)
    etapes.forEach(function(e) {
      progressTimers.push(setTimeout(function() {
        if (progressFill) progressFill.style.width = e.pct + '%'
        if (progressText) progressText.textContent = e.label
        switchProgStage(e.stage)
      }, e.delai))
    })
  }

  function cacherProgress() {
    if (silentMode) return
    progressTimers.forEach(clearTimeout)
    if (progressFill) progressFill.style.width = '100%'
    if (progressText) progressText.textContent = 'Votre semaine est prête !'
    switchProgStage(4)
    setTimeout(function() { if (progressCont) progressCont.style.display = 'none' }, 800)
  }
  function cacherProgressErreur() {
    if (silentMode) return
    progressTimers.forEach(clearTimeout)
    if (progressCont) progressCont.style.display = 'none'
  }

  try {
    var resp = await authFetch(SUPABASE_URL + '/functions/v1/generer-plan-semaine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + st.authToken, 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ profil_id: st.profil_id, symptomes: st.selectedSymptoms, force_refresh: forcer === true, repas_inclus: st.semaineRepasInclus, nb_personnes: st.defaultPortions, budget_max: ({ faible: 8, moyen: 15, eleve: 25 })[st.selectedBudget] || 15 }),
    })
    var data = await resp.json()
    if (data.success && data.semaine) {
      st.semainePlanData = data
      cacherProgress()
      afficherSemaine(data)
      try { localStorage.setItem('vitalia_semaine_session', JSON.stringify(data)) } catch(e) {}
    } else {
      cacherProgressErreur()
      afficherToast('Erreur lors de la génération de la semaine')
    }
  } catch(err) {
    cacherProgressErreur()
    afficherToast('Erreur réseau : ' + err.message)
  } finally {
    if (!silentMode) {
      if (btn)    { btn.disabled = false; btn.style.opacity = '1' }
      if (btnText) btnText.textContent = '🔄 Regénérer la semaine'
    }
  }
}

export function afficherSemaine(data) {
  var JOURS  = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche']
  var LABELS = { lundi:'Lundi', mardi:'Mardi', mercredi:'Mercredi', jeudi:'Jeudi',
                 vendredi:'Vendredi', samedi:'Samedi', dimanche:'Dimanche' }
  var MEALS  = [
    { key:'petit_dejeuner', label:'Petit-déjeuner', emoji:'🌅' },
    { key:'dejeuner',       label:'Déjeuner',       emoji:'☀️' },
    { key:'pause',          label:'Collation',      emoji:'🍎' },
    { key:'diner',          label:'Dîner',          emoji:'🌙' },
  ]

  st.semaineServings = {}; st.semaineBaseIng = {}; st.semaineRatings = {}; st.semaineSelected = {}

  var html = ''
  if (data.message_motivation) {
    html += '<div class="motivation-card" style="margin:0 24px 16px;">'
    html += '<div class="motivation-text">"' + data.message_motivation + '"</div>'
    html += '</div>'
  }

  JOURS.forEach(function(jour) {
    var day     = data.semaine[jour] || {}
    var names   = MEALS.map(function(m) { return day[m.key] && day[m.key].nom ? day[m.key].nom : null }).filter(Boolean)
    var summary = names.slice(0,2).join(' · ')

    html += '<div class="day-card day-card-' + jour + '" id="day-card-' + jour + '">'
    html += '<div class="day-card-header" onclick="toggleDay(\'' + jour + '\')">'
    html += '  <div><div class="day-name">' + LABELS[jour] + '</div>'
    if (summary) html += '<div class="day-summary">' + summary + '</div>'
    html += '  </div>'
    html += '  <div class="day-chevron" id="day-chevron-' + jour + '">▼</div>'
    html += '</div>'
    html += '<div class="day-meals" id="day-meals-' + jour + '">'

    MEALS.forEach(function(m) {
      var recette = day[m.key]; if (!recette) return
      var id         = jour + '_' + m.key
      var nv         = recette.valeurs_nutritionnelles || {}
      var cal        = nv.calories ? nv.calories + ' kcal' : ''
      var isFallback = recette.genere_par_llm === false

      st.semaineServings[id] = st.defaultPortions
      st.semaineBaseIng[id]  = (recette.ingredients || []).map(function(i) { return Object.assign({}, i) })
      st.semaineRatings[id]  = 0

      html += '<div class="day-meal">'
      html += '<div class="day-meal-header" onclick="toggleDayMeal(\'' + jour + '\',\'' + m.key + '\')" style="cursor:pointer;">'
      html += '  <div style="flex:1;min-width:0;">'
      var dotColor = m.key === 'petit_dejeuner' ? '#F5A623' : m.key === 'dejeuner' ? '#7A9E7E' : m.key === 'diner' ? 'rgba(45,31,20,0.7)' : '#A8C5AC'
      html += '    <div class="day-meal-type"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dotColor + ';margin-right:5px;vertical-align:middle;flex-shrink:0;"></span>' + m.emoji + ' ' + m.label + '</div>'
      html += '    <div class="day-meal-name" id="meal-name-' + id + '">' + (recette.nom || '—') + (isFallback ? ' <span style="font-size:11px;opacity:0.5;">⏳</span>' : '') + '</div>'
      html += '  </div>'
      if (cal) html += '  <div class="day-meal-cal">' + cal + '</div>'
      html += '</div>'
      html += '<div class="day-meal-detail" id="day-detail-' + id + '" onclick="event.stopPropagation()">'
      html += '<div class="day-meal-inner" id="semaine-inner-' + id + '">'

      var tPrep = recette.temps_preparation || 0
      var tCook = recette.temps_cuisson || 0
      if (tPrep > 0 || tCook > 0) {
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">'
        if (tPrep > 0) html += '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(196,113,74,0.08);border:1px solid rgba(196,113,74,0.18);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--terracotta);font-weight:500;">⏱ ' + tPrep + ' min prép.</span>'
        if (tCook > 0) html += '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(232,184,75,0.1);border:1px solid rgba(232,184,75,0.25);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--mid-brown);font-weight:500;">🔥 ' + tCook + ' min cuisson</span>'
        html += '</div>'
      }

      if (recette.ingredients && recette.ingredients.length) {
        html += '<div class="day-meal-ingredients" id="ing-' + id + '">'
        recette.ingredients.forEach(function(ing) {
          var lbl = ing.nom + (ing.quantite ? ' ' + ing.quantite + '\u202f' + (ing.unite || 'g') : '')
          html += '<span class="day-meal-tag">' + lbl + '</span>'
        })
        html += '</div>'
      }

      var stepsId = 'steps-' + id
      if (recette.instructions && recette.instructions.length) {
        html += '<div class="day-meal-steps" id="' + stepsId + '" style="margin-top:10px;">'
        recette.instructions.forEach(function(step, i) {
          html += '<div class="day-meal-step"><div class="day-meal-stepnum">' + (i+1) + '</div><div>' + step + '</div></div>'
        })
        html += '</div>'
      } else {
        html += '<div id="' + stepsId + '" style="margin-top:10px;"></div>'
        html += '<button id="steps-btn-' + id + '" class="steps-load-btn" onclick="chargerEtapesRecette(\'' + jour + '\',\'' + m.key + '\',\'' + id + '\');event.stopPropagation();">📖 Voir les étapes de préparation</button>'
      }

      var tip = recette.astuces && recette.astuces[0]
      if (tip) html += '<div class="day-meal-tip" style="margin-top:8px;">💡 ' + escapeHtml(tip) + '</div>'

      html += '<div class="semaine-meal-actions">'
      if (m.key !== 'pause') {
        html += '<div class="stepper-mini">'
        html += '<button onclick="changerPortionsSemaine(\'' + id + '\',-1);event.stopPropagation();">−</button>'
        html += '<span id="portions-' + id + '">' + st.defaultPortions + ' pers.</span>'
        html += '<button onclick="changerPortionsSemaine(\'' + id + '\',1);event.stopPropagation();">+</button>'
        html += '</div>'
      }
      html += '<button class="photo-btn" id="photo-semaine-btn-' + id + '" onclick="prendrePhotoSemaine(\'' + id + '\');event.stopPropagation();" title="Prendre une photo du plat">📸</button>'
      html += '<button class="save-mini" onclick="sauvegarderRecetteSemaine(\'' + id + '\');event.stopPropagation();">✅ À faire</button>'
      html += '</div>'
      html += '</div></div></div>'
    })

    html += '</div></div>'
  })

  var cards = document.getElementById('dayCards')
  var empty = document.getElementById('semaineEmpty')
  st.semaineBasePortions = st.defaultPortions || 1
  if (cards) { cards.innerHTML = html; cards.style.display = 'flex' }
  if (empty) empty.style.display = 'none'

  var conseilEl = document.getElementById('semaineConseil')
  if (conseilEl) {
    var conseil = data.conseil_du_jour || (data.semaine && Object.values(data.semaine)[0] && Object.values(data.semaine)[0].conseil)
    if (conseil) {
      conseilEl.style.display = 'block'
      conseilEl.innerHTML = '<div class="conseil-card"><div class="conseil-title">💡 Conseil de la semaine</div><div class="conseil-text">' + escapeHtml(conseil) + '</div></div>'
    } else { conseilEl.style.display = 'none' }
  }

  renderWellnessSemaine(data)
  afficherBoutonListeCourses()

  var JOURS_IDX    = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi']
  var jourAujourdhui = JOURS_IDX[new Date().getDay()]
  var jourCible    = (data.semaine && data.semaine[jourAujourdhui]) ? jourAujourdhui : 'lundi'

  if (!data._regenRefresh) {
    st.semaineJourOuvert = jourCible
    toggleDay(jourCible)
    autoRegenFallbacks(data)
  } else {
    toggleDay(st.semaineJourOuvert)
  }

  if (st.currentTab === 'semaine' && !data._regenRefresh) {
    setTimeout(function() {
      var el = document.getElementById('day-card-' + jourCible)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 200)
  }
}

// ── Chargement à la demande des étapes d'une recette ──
export async function chargerEtapesRecette(jour, mealKey, id) {
  var btn      = document.getElementById('steps-btn-' + id)
  var stepsDiv = document.getElementById('steps-' + id)
  if (!stepsDiv) return
  if (btn) btn.style.display = 'none'
  stepsDiv.innerHTML = '<div class="steps-loading">⏳ Génération des étapes...</div>'

  var recette = st.semainePlanData && st.semainePlanData.semaine && st.semainePlanData.semaine[jour] && st.semainePlanData.semaine[jour][mealKey]
  if (!recette) { stepsDiv.innerHTML = ''; if (btn) btn.style.display = ''; return }

  var typeRepas = { petit_dejeuner:'petit-dejeuner', dejeuner:'dejeuner', diner:'diner', pause:'collation' }[mealKey] || mealKey

  try {
    var resp = await authFetch(SUPABASE_URL + '/functions/v1/generer-recette-details', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + st.authToken },
      body: JSON.stringify({
        recette_nom:  recette.nom || recette.titre,
        ingredients:  recette.ingredients || [],
        type_repas:   typeRepas,
        macros:       recette.macros,
        symptomes:    st.selectedSymptoms || [],
        nb_personnes: st.defaultPortions,
      })
    })
    var data = await resp.json()
    if (data.success && Array.isArray(data.instructions) && data.instructions.length) {
      recette.instructions = data.instructions
      if (data.astuces) recette.astuces = data.astuces
      try { localStorage.setItem('vitalia_semaine_session', JSON.stringify(st.semainePlanData)) } catch(e) {}
      if (st.profil_id && st.profil_id !== 'new') {
        fetch(SUPABASE_URL + '/rest/v1/plans_generes_cache?profil_id=eq.' + st.profil_id + '&source=eq.semaine', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ plan_json: st.semainePlanData })
        }).catch(function() {})
      }
      var html = '<div class="day-meal-steps">'
      data.instructions.forEach(function(step, i) {
        html += '<div class="day-meal-step"><div class="day-meal-stepnum">' + (i+1) + '</div><div>' + escapeHtml(step) + '</div></div>'
      })
      html += '</div>'
      if (data.astuces && data.astuces[0]) html += '<div class="day-meal-tip" style="margin-top:8px;">💡 ' + escapeHtml(data.astuces[0]) + '</div>'
      stepsDiv.innerHTML = html
    } else {
      stepsDiv.innerHTML = ''; if (btn) { btn.style.display = ''; btn.textContent = '⚠️ Réessayer les étapes' }
    }
  } catch(e) {
    stepsDiv.innerHTML = ''; if (btn) { btn.style.display = ''; btn.textContent = '⚠️ Réessayer les étapes' }
  }
}

// ── Régénération automatique des recettes de secours ──
async function autoRegenFallbacks(data) {
  var JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche']
  var MEAL_TYPES = { petit_dejeuner:'petit-dejeuner', dejeuner:'dejeuner', diner:'diner' }
  var fallbacks = []
  JOURS.forEach(function(jour) {
    Object.keys(MEAL_TYPES).forEach(function(mealKey) {
      var r = data.semaine && data.semaine[jour] && data.semaine[jour][mealKey]
      if (r && r.genere_par_llm === false) fallbacks.push({ jour: jour, mealKey: mealKey, typeRepas: MEAL_TYPES[mealKey] })
    })
  })
  if (!fallbacks.length) return

  for (var bi = 0; bi < fallbacks.length; bi += 3) {
    var batch = fallbacks.slice(bi, bi + 3)
    await Promise.all(batch.map(async function(f) {
      try {
        var resp = await authFetch(SUPABASE_URL + '/functions/v1/generer-recette-unique', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + st.authToken, 'apikey': SUPABASE_ANON_KEY },
          body: JSON.stringify({ profil_id: st.profil_id, type_repas: f.typeRepas, ingredients_frigo: [], symptomes: st.selectedSymptoms, nb_personnes: st.defaultPortions }),
        })
        var d = await resp.json()
        if (d.success && d.recette && st.semainePlanData && st.semainePlanData.semaine && st.semainePlanData.semaine[f.jour]) {
          st.semainePlanData.semaine[f.jour][f.mealKey] = d.recette
        }
      } catch(e) {}
    }))
    if (bi + 3 < fallbacks.length) await new Promise(function(r) { setTimeout(r, 500) })
  }

  try { localStorage.setItem('vitalia_semaine_session', JSON.stringify(st.semainePlanData)) } catch(e) {}
  if (st.profil_id && st.profil_id !== 'new') {
    fetch(SUPABASE_URL + '/rest/v1/plans_generes_cache?profil_id=eq.' + st.profil_id + '&source=eq.semaine', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ plan_json: st.semainePlanData })
    }).catch(function() {})
  }

  st.semainePlanData._regenRefresh = true
  afficherSemaine(st.semainePlanData)
  st.semainePlanData._regenRefresh = false
}

// ── Section wellness semaine ──
function renderWellnessSemaine(data) {
  var container = document.getElementById('semaineWellness'); if (!container) return
  var html = ''
  html += '<div style="font-family:\'Fraunces\',serif;font-size:17px;font-weight:700;color:var(--deep-brown);padding:0 0 4px;">Conseils de la semaine</div>'

  var nutra = data.nutraceutiques && data.nutraceutiques[0]
  if (nutra) {
    html += '<div class="wellness-card"><div class="wellness-card-type">💊 Nutraceutique de la semaine</div>'
    html += '<div class="wellness-card-name">' + escapeHtml(nutra.nom || nutra.name || 'Supplément') + '</div>'
    var desc = nutra.description || (Array.isArray(nutra.bienfaits) ? nutra.bienfaits.slice(0,2).join('. ') : (nutra.bienfaits || ''))
    if (desc) html += '<div class="wellness-card-body">' + escapeHtml(String(desc).substring(0, 250)) + '</div>'
    var badges = []
    if (nutra.dosage)         badges.push('💊 ' + escapeHtml(nutra.dosage))
    if (nutra.moment_optimal) badges.push('⏰ ' + escapeHtml(nutra.moment_optimal))
    if (badges.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">'
      badges.forEach(function(b) { html += '<span class="wellness-badge">' + b + '</span>' })
      html += '</div>'
    }
    var tip = Array.isArray(nutra.astuces) ? nutra.astuces[0] : (nutra.tip || nutra.conseil || '')
    if (tip) html += '<div class="wellness-card-tip">💡 ' + escapeHtml(tip) + '</div>'
    html += '</div>'
  }

  var aroma = data.aromatherapie && data.aromatherapie[0]
  if (aroma) {
    html += '<div class="wellness-card"><div class="wellness-card-type">🌸 Aromathérapie de la semaine</div>'
    html += '<div class="wellness-card-name">' + escapeHtml(aroma.nom || aroma.name || 'Huile essentielle') + '</div>'
    var aromaDesc = aroma.description || aroma.bienfaits || ''
    if (aromaDesc) html += '<div class="wellness-card-body">' + escapeHtml(String(aromaDesc).substring(0, 200)) + '</div>'
    var aromaTip = Array.isArray(aroma.astuces) ? aroma.astuces[0] : (aroma.tip || aroma.utilisation || '')
    if (aromaTip) html += '<div class="wellness-card-tip">💡 ' + escapeHtml(aromaTip) + '</div>'
    html += '</div>'
  }

  var routine = data.routines && data.routines[0]
  if (routine) {
    html += '<div class="wellness-card"><div class="wellness-card-type">🧘 Routine de la semaine</div>'
    html += '<div class="wellness-card-name">' + escapeHtml(routine.nom || routine.name || 'Routine bien-être') + '</div>'
    if (routine.description) html += '<div class="wellness-card-body">' + escapeHtml(String(routine.description).substring(0, 250)) + '</div>'
    var rBadges = []
    if (routine.duree)          rBadges.push('⏱ ' + escapeHtml(routine.duree))
    if (routine.moment_optimal) rBadges.push('⏰ ' + escapeHtml(routine.moment_optimal))
    if (routine.frequence)      rBadges.push('🔄 ' + escapeHtml(routine.frequence))
    if (rBadges.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">'
      rBadges.forEach(function(b) { html += '<span class="wellness-badge">' + b + '</span>' })
      html += '</div>'
    }
    html += '</div>'
  }

  if (html) { container.innerHTML = html; container.style.display = 'flex' }
  else       { container.style.display = 'none' }
}

// ── Bouton liste de courses (agrégation auto à chaque changement de sélection) ──
export function afficherBoutonListeCourses() {
  var countSemaine = Object.values(st.semaineSelected).filter(Boolean).length
  var countSaved   = Object.values(st.savedSelected).filter(Boolean).length
  var count        = countSemaine + countSaved
  if (count > 0) {
    var liste    = aggregerIngredients()
    var recettes = construireListeRecettes()
    var existingRaw = null
    try { existingRaw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    var manuels = existingRaw ? (existingRaw.ingredients || []).filter(function(i) { return i.manuel }) : []
    try { localStorage.setItem('vitalia_liste_courses', JSON.stringify({ date: new Date().toISOString(), ingredients: liste.concat(manuels), recettes: recettes })) } catch(e) {}
    sauvegarderListeCoursesSupabase()
  }
  import('./courses-profile.js').then(function(m) { m.afficherListeCoursesProfile() })
}

// ── Portions semaine ──
export function changerPortionsSemaine(id, delta) {
  var p = Math.max(1, Math.min(8, (st.semaineServings[id] || st.defaultPortions) + delta))
  st.semaineServings[id] = p
  var ratio = p / (st.semaineBasePortions || 2)
  var ingEl = document.getElementById('ing-' + id)
  if (ingEl && st.semaineBaseIng[id]) {
    ingEl.innerHTML = st.semaineBaseIng[id].map(function(ing) {
      var q = ing.quantite ? _fmtQty(ing.quantite * ratio, ing.unite || 'g') : null
      var lbl = ing.nom + (q ? ' ' + q + '\u202f' + (ing.unite || 'g') : '')
      return '<span class="day-meal-tag">' + lbl + '</span>'
    }).join('')
  }
  var pEl = document.getElementById('portions-' + id)
  if (pEl) pEl.textContent = p + ' pers.'
}

export function noterRecetteSemaine(id, note) {
  st.semaineRatings[id] = note
  var starsEl = document.getElementById('stars-' + id)
  if (starsEl) Array.from(starsEl.children).forEach(function(s, i) { s.textContent = i < note ? '⭐' : '☆' })
}

export function sauvegarderRecetteSemaine(id) {
  var parts   = id.split('_')
  var jour    = parts[0]
  var mealKey = parts.slice(1).join('_')
  var recette = st.semainePlanData && st.semainePlanData.semaine && st.semainePlanData.semaine[jour] && st.semainePlanData.semaine[jour][mealKey]
  if (!recette) return
  var entry = Object.assign({}, recette, { id:'recette_' + Date.now(), saved_at: new Date().toISOString(), note: st.semaineRatings[id] || 0, portions: st.semaineServings[id] || recette.portions || recette.nb_personnes || st.semaineBasePortions || 2 })
  try {
    var saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]')
    saved.unshift(entry)
    localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved.slice(0,50)))
  } catch(e) {}
  if (st.profil_id && st.profil_id !== 'new') {
    fetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey':SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + st.authToken },
      body: JSON.stringify({ profil_id:st.profil_id, titre:recette.nom||recette.titre, moment:mealKey,
        ingredients:recette.ingredients||[], steps:recette.instructions||[], tip:(recette.astuces&&recette.astuces[0])||'',
        ...(st.semaineRatings[id] ? { note: st.semaineRatings[id] } : {}) }),
    }).catch(function() {})
  }
  afficherToast('Recette sauvegardée ! 💚')
}

export function toggleSelectRecetteSemaine(id) {
  st.semaineSelected[id] = !st.semaineSelected[id]
  var btn = document.getElementById('select-btn-' + id)
  if (btn) {
    btn.classList.toggle('selected', !!st.semaineSelected[id])
    btn.textContent = st.semaineSelected[id] ? '✓ Sélectionné' : '🛒 Sélectionner'
  }
  afficherBoutonListeCourses()
}
