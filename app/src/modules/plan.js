import { SUPABASE_URL, SUPABASE_ANON_KEY, st } from './state.js'
import { authFetch } from './auth.js'
import { afficherToast, setText, fermerConfig, updateObjectifPrincipalBadge, syncAllPreferencesChips } from './ui.js'
import { syncBesoinsVersProfil, sauvegarderListeCoursesSupabase } from './api.js'
import { afficherPhotoRecette, chargerMeilleurePhoto } from './photos.js'

// ── Étoiles (plan du jour) ──
export function afficherEtoiles(score) {
  var c = document.getElementById('starsContainer'); if (!c) return
  c.innerHTML = ''
  for (var i = 1; i <= 5; i++) {
    var s = document.createElement('span'); s.className = 'star'
    s.textContent = i <= Math.round(score / 2) ? '⭐' : '☆'
    c.appendChild(s)
  }
}

// ── Expand / collapse carte repas ──
export function toggleInstructions(moment, event) {
  if (event) {
    var t = event.target
    if (t.closest && (t.closest('.recipe-actions') || t.closest('.stepper-btn') || t.closest('.recipe-stars') || t.closest('.save-recipe-btn') || t.closest('.photo-btn') || t.closest('.recipe-photo-container'))) return
  }
  var el  = document.getElementById('instructions-' + moment)
  var btn = document.getElementById('btn-' + moment)
  if (!el) return
  var isOpen = el.classList.contains('open')
  el.classList.toggle('open', !isOpen)
  if (btn) btn.textContent = isOpen ? '▼' : '▲'
}

// ── Expand / collapse item routine ──
export function toggleRoutineItem(key) {
  var detail  = document.getElementById('detail-'  + key)
  var chevron = document.getElementById('chevron-' + key)
  if (!detail) return
  var isOpen = detail.classList.contains('open')
  detail.classList.toggle('open',  !isOpen)
  if (chevron) chevron.classList.toggle('open', !isOpen)
}

// ── Barre d'actions ingrédients/portions ──
export function buildActionsBar(m) {
  return '<div class="recipe-actions" onclick="event.stopPropagation()">' +
    '<div class="servings-stepper">' +
      '<span class="servings-label">Portions</span>' +
      '<button class="stepper-btn" onclick="changerPortions(\'' + m + '\',-1)">&#8722;</button>' +
      '<span class="stepper-count" id="count-' + m + '">' + st.defaultPortions + '</span>' +
      '<button class="stepper-btn" onclick="changerPortions(\'' + m + '\',1)">+</button>' +
    '</div>' +
    '<button class="photo-btn" id="photo-btn-' + m + '" onclick="prendrePhoto(\'' + m + '\')" title="Prendre une photo du plat">📸</button>' +
    '<button class="save-recipe-btn" id="save-btn-' + m + '" onclick="sauvegarderRecette(\'' + m + '\')">✅ À faire</button>' +
  '</div>'
}

// ── Rendu des instructions dans une carte repas ──
export function renderInstructions(moment, recette) {
  var el = document.getElementById('instructions-' + moment); if (!el) return
  var ingHtml = '', stepsHtml = '', timingHtml = ''
  var instructions, ingredients, tempsPrep, tempsCuisson

  if (recette && recette.nom !== undefined) {
    instructions = recette.instructions    || []
    ingredients  = recette.ingredients    || []
    tempsPrep    = recette.temps_preparation
    tempsCuisson = recette.temps_cuisson
  } else {
    instructions = recette; ingredients = []
  }

  if (Array.isArray(ingredients) && ingredients.length) {
    var tags = ingredients.map(function(i) {
      var label = typeof i === 'string' ? i : ((i.nom || '') + (i.quantite ? ' ' + i.quantite + '\u202f' + (i.unite || 'g') : ''))
      return '<span class="ingredient-tag">' + label + '</span>'
    }).join('')
    ingHtml = '<div class="instructions-ingredients">' + tags + '</div>'
    st.recipeBaseIng[moment] = ingHtml
  }

  if ((tempsPrep || tempsCuisson)) {
    var chips = []
    if (tempsPrep)    chips.push('<span class="timing-chip timing-prep">⏱ ' + tempsPrep + ' min prép.</span>')
    if (tempsCuisson) chips.push('<span class="timing-chip timing-cook">🔥 ' + tempsCuisson + ' min cuisson</span>')
    timingHtml = '<div class="timing-chips">' + chips.join('') + '</div>'
  }

  if (Array.isArray(instructions) && instructions.length) {
    st.recipeBaseSteps[moment] = instructions.slice()
    stepsHtml = '<ol class="steps-list">' +
      instructions.map(function(s) { return '<li>' + s + '</li>' }).join('') + '</ol>'
  }
  el.innerHTML = timingHtml + ingHtml + stepsHtml + buildActionsBar(moment)

  // Photo du plat : propre d'abord, communauté en fallback
  var recetteNom = (recette && (recette.nom || recette.titre)) || null
  if (recette && recette.photo_url) {
    afficherPhotoRecette('instructions-' + moment, recette.photo_url, false)
  } else if (recetteNom) {
    chargerMeilleurePhoto(recetteNom).then(function(res) {
      if (res) afficherPhotoRecette('instructions-' + moment, res.url, res.isCommunaute)
    })
  }
}

// ── Rendu du panneau détail d'une routine ──
export function renderRoutineDetail(key, data) {
  var el = document.getElementById('detail-' + key); if (!el) return
  if (!data) { el.innerHTML = ''; return }
  var chips = ''
  if (data.duree)               chips += '<span class="routine-detail-chip">⏱ ' + data.duree + '</span>'
  if (data.timing)              chips += '<span class="routine-detail-chip">🕐 ' + data.timing + '</span>'
  else if (data.moment_optimal) chips += '<span class="routine-detail-chip">🕐 ' + data.moment_optimal + '</span>'
  if (data.dosage)              chips += '<span class="routine-detail-chip">💊 ' + data.dosage + '</span>'
  if (data.categorie)           chips += '<span class="routine-detail-chip">📂 ' + data.categorie + '</span>'
  if (Array.isArray(data.contre_indications)) {
    data.contre_indications.forEach(function(ci) {
      chips += '<span class="routine-detail-chip routine-detail-chip-warn">⚠️ ' + ci + '</span>'
    })
  }
  var raisonHtml    = data.raison ? '<div class="routine-detail-raison">' + data.raison + '</div>' : ''
  var protocoleHtml = ''
  if (data.protocole && typeof data.protocole === 'string') {
    var lignes = data.protocole
      .split(/\n|\.\s+(?=[A-ZÀÉÈÊÎÙÛÂÔŒ])|(?:\d+[.)]\s+)/)
      .map(function(l){return l.replace(/^\d+[.)]\s*/,'').trim()})
      .filter(function(l){return l.length > 8})
    protocoleHtml = lignes.length >= 2
      ? '<div class="routine-detail-steps">' + lignes.map(function(s,n){
          return '<div class="routine-detail-step"><div class="routine-detail-stepnum">'+(n+1)+'</div><span>'+s+'</span></div>'
        }).join('') + '</div>'
      : '<div class="routine-detail-protocole">' + data.protocole + '</div>'
  }
  el.innerHTML = '<div class="routine-detail-inner">' + raisonHtml + protocoleHtml +
    (chips ? '<div class="routine-detail-chips">' + chips + '</div>' : '') + '</div>'
}

// ── Affichage du plan du jour ──
export function afficherPlan(plan) {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  st.currentPlan = plan
  plan.matin      = plan.petit_dejeuner || plan.matin
  plan.midi       = plan.dejeuner       || plan.midi
  plan.soir       = plan.diner          || plan.soir
  plan.apres_midi = plan.pause || plan.collation || plan.apres_midi

  setText('heroMessage', plan.message_motivation || plan.message_personnalise || 'Ton plan est prêt ! 🌿')
  var score = plan.score_nutritionnel || 7
  setText('scoreValue', score + '/10')
  afficherEtoiles(score)

  var heures = { matin: '7h30', midi: '12h30', soir: '19h30' }
  ;['matin', 'midi', 'soir'].forEach(function(m) {
    var d = plan[m]; if (!d) return
    setText(m + '-time',     heures[m])
    setText(m + '-titre',    d.nom || d.titre || '')
    var ings = d.ingredients || []
    var desc = d.description || ings.slice(0,3).map(function(i){ return typeof i==='string' ? i : (i.nom||'') }).join(', ')
    setText(m + '-desc',     desc)
    setText(m + '-motivant', (d.astuces && d.astuces[0]) || d.message_motivant || '')
    var cal = (d.valeurs_nutritionnelles && d.valeurs_nutritionnelles.calories) || d.calories_estimees
    setText(m + '-cal',      cal ? cal + ' kcal' : '—')
    renderInstructions(m, d)
    st.recipeServings[m] = st.defaultPortions
  })

  var pause = plan.pause || plan.collation || plan.apres_midi || null
  if (pause) {
    setText('apres_midi-time',     '15h30')
    setText('apres_midi-titre',    pause.nom || pause.titre || 'Pause Gourmande')
    var pIngs = pause.ingredients || []
    var pDesc = pause.description || pIngs.slice(0,3).map(function(i){ return typeof i==='string'?i:(i.nom||'') }).join(', ')
    setText('apres_midi-desc',     pDesc)
    setText('apres_midi-motivant', (pause.astuces && pause.astuces[0]) || pause.message_motivant || 'Prends ce moment rien que pour toi 🙏')
    var pCal = (pause.valeurs_nutritionnelles && pause.valeurs_nutritionnelles.calories) || pause.calories_estimees
    setText('apres_midi-cal',      pCal ? pCal + ' kcal' : '—')
    renderInstructions('apres_midi', pause)
    st.recipeServings['apres_midi'] = 1
  }

  var nutris   = plan.nutraceutiques || []
  var aromas   = plan.aromatherapie  || []
  var routines = plan.routines       || []
  var r        = plan.routine_du_jour || {}
  ;['matin','complement','aroma','soir-routine'].forEach(function(k) {
    var d = document.getElementById('detail-' + k);   if (d) d.classList.remove('open')
    var c = document.getElementById('chevron-' + k);  if (c) c.classList.remove('open')
  })
  setText('routine-matin',      r.matin       || (routines[0] ? routines[0].nom + (routines[0].duree ? ' — ' + routines[0].duree : '') : ''))
  renderRoutineDetail('matin',       routines[0] || null)
  setText('routine-complement', r.complement_phare || (nutris[0]   ? nutris[0].nom + ' — ' + (nutris[0].dosage || '')   : ''))
  renderRoutineDetail('complement',  nutris[0]   || null)
  setText('routine-aroma',      r.aromatherapie    || (aromas[0]   ? aromas[0].nom + ' — ' + (aromas[0].dosage || '')   : ''))
  renderRoutineDetail('aroma',       aromas[0]   || null)
  setText('routine-soir',       r.soir        || (routines[1] ? routines[1].nom + (routines[1].duree ? ' — ' + routines[1].duree : '') : ''))
  renderRoutineDetail('soir-routine', routines[1] || null)

  var conseil = plan.conseil_du_jour || (plan.conseils_generaux && plan.conseils_generaux[0]) || ''
  if (conseil) setText('conseilText', conseil)

  updateAlliesFromPlan(plan)

  var fb = document.getElementById('feedbackBar')
  if (fb) {
    fb.style.display = 'flex'
    document.querySelectorAll('.feedback-star').forEach(function(s){ s.classList.remove('lit') })
    var sent = document.getElementById('feedbackSent'); if (sent) sent.classList.remove('show')
    var fstars = document.getElementById('feedbackStars'); if (fstars) fstars.style.display = 'flex'
  }

  // Imports dynamiques pour éviter circularité
  import('./checkin.js').then(function(m) {
    m.afficherEvolution()
    m.afficherHistoriqueCompact()
  })
}

// ── Mise en évidence des alliés présents dans le plan ──
export function updateAlliesFromPlan(plan) {
  st.currentActiveAllies = []
  var keywords = {
    goji:'goji', curcuma:'curcuma', gingembre:'gingembre', myrtille:'myrtille',
    avocat:'avocat', banane:'banane', miel:'miel', amandes:'amande'
  }
  var allyNames = {
    goji:'Goji', curcuma:'Curcuma', gingembre:'Gingembre', myrtille:'Myrtille',
    avocat:'Avocat', banane:'Banane', miel:'Miel', amandes:'Amandes'
  }
  var ingredientNames = []
  var mealKeys = ['matin','petit_dejeuner','midi','dejeuner','soir','diner','pause','collation','apres_midi']
  mealKeys.forEach(function(key) {
    var meal = plan[key]; if (!meal) return
    ;(meal.ingredients || []).forEach(function(ing) {
      var nom = (typeof ing === 'string' ? ing : (ing.nom || '')).toLowerCase()
      if (nom) ingredientNames.push(nom)
    })
  })
  function matchesIngredient(nom, kw) {
    if (kw.includes(' ')) return nom.includes(kw)
    var words = nom.split(/[\s,\-()+]+/)
    return words.some(function(w) { return w === kw || w === kw + 's' || w === kw + 'x' })
  }
  var matched   = Object.keys(keywords).filter(function(ally) {
    return ingredientNames.some(function(nom) { return matchesIngredient(nom, keywords[ally]) })
  })
  var isDefault = matched.length === 0
  st.currentActiveAllies = matched.slice()
  var activeSet = isDefault ? ['goji', 'curcuma', 'gingembre'] : matched

  Object.keys(keywords).forEach(function(ally) {
    var el = document.getElementById('ally-' + ally); if (!el) return
    var chip = el.parentElement
    var inActive = activeSet.includes(ally)
    if (chip) chip.style.display = inActive ? '' : 'none'
    el.classList.toggle('active', matched.includes(ally))
    if (chip) {
      var nameEl = chip.querySelector('.companion-name')
      if (nameEl) {
        if (isDefault && inActive) {
          nameEl.innerHTML = allyNames[ally] + '<br><span style="font-size:9px;color:var(--text-light);font-style:italic;line-height:1;">hors plan</span>'
        } else {
          nameEl.textContent = allyNames[ally]
        }
      }
    }
  })
}

// ── Helpers quantités ──
var _QTY_UNITS = 'g|kg|ml|cl|dl|l|c\\.a\\.s|c\\.a\\.c|càs|càc|tbsp|tsp' +
  '|pièce[sx]?|tranche[sx]?|oeuf[sx]?|œuf[sx]?|gousse[sx]?|feuille[sx]?' +
  '|bouquet[sx]?|brin[sx]?|cube[sx]?|filet[sx]?|portion[sx]?|escalope[sx]?' +
  '|steak[sx]?|sachet[sx]?|bo[iî]te[sx]?'

function _fmtQty(val, unit) {
  var isPiece = /pièce|tranche|oeuf|œuf|gousse|feuille|bouquet|brin|cube|filet|portion|escalope|steak|sachet|boite|boîte/i.test(unit)
  if (isPiece) {
    var r = Math.round(val * 2) / 2
    return String(r < 0.5 ? 0.5 : r)
  }
  return String(Math.round(val * 10) / 10)
}

export function ajusterQuantite(text, ratio) {
  // Fractions en premier : "1/2 c.a.s", "3/4 pièces"
  text = text.replace(
    new RegExp('(\\d+)\\/(\\d+)[\\s\\u202f]*(' + _QTY_UNITS + ')', 'gi'),
    function(_, n, d, unit) { return _fmtQty(parseInt(n) / parseInt(d) * ratio, unit) + '\u202f' + unit }
  )
  // Entiers et décimaux : "150 g", "2 œufs", "30\u202fml"
  text = text.replace(
    new RegExp('(\\d+(?:[.,]\\d+)?)[\\s\\u202f]*(' + _QTY_UNITS + ')', 'gi'),
    function(_, num, unit) { return _fmtQty(parseFloat(num.replace(',', '.')) * ratio, unit) + '\u202f' + unit }
  )
  return text
}

// ── Stepper de portions (plan du jour) ──
export function changerPortions(m, delta) {
  st.recipeServings[m] = Math.max(1, Math.min(8, (st.recipeServings[m] || 1) + delta))
  var c = document.getElementById('count-' + m); if (c) c.textContent = st.recipeServings[m]
  var ratio = st.recipeServings[m] / (st.defaultPortions || 1)

  var ingEl = document.querySelector('#instructions-' + m + ' .instructions-ingredients')
  if (ingEl && st.recipeBaseIng[m]) {
    var tmp = document.createElement('div'); tmp.innerHTML = st.recipeBaseIng[m]
    tmp.querySelectorAll('.ingredient-tag').forEach(function(tag) {
      tag.textContent = ajusterQuantite(tag.textContent, ratio)
    })
    ingEl.innerHTML = tmp.innerHTML
  }

  var stepsEl = document.querySelector('#instructions-' + m + ' .steps-list')
  if (stepsEl && st.recipeBaseSteps[m]) {
    stepsEl.innerHTML = st.recipeBaseSteps[m].map(function(s) {
      return '<li>' + ajusterQuantite(s, ratio) + '</li>'
    }).join('')
  }
}

// ── Note d'une recette ──
export function noterRecette(m, note) {
  var c = document.getElementById('stars-' + m); if (!c) return
  c.querySelectorAll('.recipe-star').forEach(function(s, i) { s.classList.toggle('lit', i < note) })
  afficherToast('Note sauvegardée !')
}

// ── Sauvegarde recette (plan du jour) ──
export function sauvegarderRecette(m) {
  if (!st.currentPlan || !st.currentPlan[m]) { afficherToast('Génère un plan d\'abord !'); return }
  var r     = st.currentPlan[m]
  var titre = r.nom || r.titre || ''
  var saved = []
  try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  if (saved.some(function(s){ return s.titre === titre })) { afficherToast('Déjà sauvegardée !'); return }
  var entry = Object.assign({}, r, { id: 'recette_' + Date.now(), saved_at: new Date().toISOString(), note: 0 })
  saved.unshift(entry)
  try { localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved.slice(0, 50))) } catch(e) {}
  var btn = document.getElementById('save-btn-' + m)
  if (btn) { btn.textContent = '✓ Ajoutée'; btn.classList.add('saved') }
  afficherToast('Recette ajoutée à faire ! ✅')
  _sauvegarderRecetteSupabase(r, m)
}

async function _sauvegarderRecetteSupabase(r, m) {
  if (!st.profil_id || st.profil_id === 'new') return
  try {
    await authFetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
                 'Authorization': 'Bearer ' + st.authToken, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ profil_id: st.profil_id, titre: r.nom || r.titre, moment: m,
        ingredients: r.ingredients, steps: r.instructions, tip: r.astuces && r.astuces[0] })
    })
  } catch(e) {}
}

// ── Note du plan entier ──
export function noterPlan(note) {
  document.querySelectorAll('.feedback-star').forEach(function(s, i) { s.classList.toggle('lit', i < note) })
  var fstars = document.getElementById('feedbackStars'); if (fstars) fstars.style.display = 'none'
  var sent   = document.getElementById('feedbackSent');  if (sent)   sent.classList.add('show')
  if (st.profil_id && st.profil_id !== 'new') {
    authFetch(
      SUPABASE_URL + '/rest/v1/plans_generes_cache?profil_id=eq.' + st.profil_id + '&source=eq.journalier',
      { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + st.authToken, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ note_satisfaction: note, feedback_le: new Date().toISOString() }) }
    ).catch(function() {})
  }
}

// ── Génération du plan du jour ──
export async function genererPlan(forcer) {
  fermerConfig()
  if (forcer) {
    sessionStorage.removeItem('vitalia_plan_session_home')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  if (!st.profil_id || st.profil_id === 'new') { window.location.href = 'onboarding.html'; return }

  var ls = document.getElementById('loadingScreen')
  var ap = document.getElementById('app')
  if (ls) { ls.classList.remove('hidden'); ls.style.opacity = '1' }
  if (ap) ap.style.opacity = '0'

  try {
    var budgetMap = { faible: 8, moyen: 15, eleve: 25 }
    var body = {
      profil_id: st.profil_id,
      symptomes: st.selectedSymptoms,
      preferences_moment: { temps_max: st.profilTempsCuisineCourant, budget_max: budgetMap[st.selectedBudget] || 25 },
      force_regeneration: forcer === true,
      meme_theme: (document.getElementById('memeThemeToggle') || {}).checked || false,
      nb_personnes: st.defaultPortions,
    }
    var res = await authFetch(SUPABASE_URL + '/functions/v1/generer-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error('Erreur serveur ' + res.status)
    var data = await res.json()
    if (data.success && data.plan) {
      afficherPlan(data.plan)
      // verifierCheckinDuJour via import dynamique
      import('./checkin.js').then(function(m) { m.verifierCheckinDuJour() })
      var planAvecDate = Object.assign({}, data.plan, { _date: new Date().toISOString().slice(0, 10) })
      sessionStorage.setItem('vitalia_plan_session_home', JSON.stringify(planAvecDate))
      syncBesoinsVersProfil()
    } else {
      throw new Error(data.error || 'Plan invalide')
    }
  } catch(err) {
    console.error(err)
    afficherToast('Erreur : ' + err.message)
  } finally {
    if (ls) { ls.style.opacity = '0'; setTimeout(function(){ ls.classList.add('hidden') }, 400) }
    if (ap) ap.style.opacity = '1'
    document.getElementById('generateFab').classList.add('visible')
  }
}

// ══════════════════════════════════════════════════════
// SEMAINE
// ══════════════════════════════════════════════════════

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
      body: JSON.stringify({ profil_id: st.profil_id, symptomes: st.selectedSymptoms, force_refresh: forcer === true, repas_inclus: st.semaineRepasInclus, nb_personnes: st.defaultPortions }),
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
      if (tip) html += '<div class="day-meal-tip" style="margin-top:8px;">💡 ' + tip + '</div>'

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
      conseilEl.innerHTML = '<div class="conseil-card"><div class="conseil-title">💡 Conseil de la semaine</div><div class="conseil-text">' + conseil + '</div></div>'
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
        html += '<div class="day-meal-step"><div class="day-meal-stepnum">' + (i+1) + '</div><div>' + step + '</div></div>'
      })
      html += '</div>'
      if (data.astuces && data.astuces[0]) html += '<div class="day-meal-tip" style="margin-top:8px;">💡 ' + data.astuces[0] + '</div>'
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
    html += '<div class="wellness-card-name">' + (nutra.nom || nutra.name || 'Supplément') + '</div>'
    var desc = nutra.description || (Array.isArray(nutra.bienfaits) ? nutra.bienfaits.slice(0,2).join('. ') : (nutra.bienfaits || ''))
    if (desc) html += '<div class="wellness-card-body">' + String(desc).substring(0, 250) + '</div>'
    var badges = []
    if (nutra.dosage)         badges.push('💊 ' + nutra.dosage)
    if (nutra.moment_optimal) badges.push('⏰ ' + nutra.moment_optimal)
    if (badges.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">'
      badges.forEach(function(b) { html += '<span class="wellness-badge">' + b + '</span>' })
      html += '</div>'
    }
    var tip = Array.isArray(nutra.astuces) ? nutra.astuces[0] : (nutra.tip || nutra.conseil || '')
    if (tip) html += '<div class="wellness-card-tip">💡 ' + tip + '</div>'
    html += '</div>'
  }

  var aroma = data.aromatherapie && data.aromatherapie[0]
  if (aroma) {
    html += '<div class="wellness-card"><div class="wellness-card-type">🌸 Aromathérapie de la semaine</div>'
    html += '<div class="wellness-card-name">' + (aroma.nom || aroma.name || 'Huile essentielle') + '</div>'
    var aromaDesc = aroma.description || aroma.bienfaits || ''
    if (aromaDesc) html += '<div class="wellness-card-body">' + String(aromaDesc).substring(0, 200) + '</div>'
    var aromaTip = Array.isArray(aroma.astuces) ? aroma.astuces[0] : (aroma.tip || aroma.utilisation || '')
    if (aromaTip) html += '<div class="wellness-card-tip">💡 ' + aromaTip + '</div>'
    html += '</div>'
  }

  var routine = data.routines && data.routines[0]
  if (routine) {
    html += '<div class="wellness-card"><div class="wellness-card-type">🧘 Routine de la semaine</div>'
    html += '<div class="wellness-card-name">' + (routine.nom || routine.name || 'Routine bien-être') + '</div>'
    if (routine.description) html += '<div class="wellness-card-body">' + String(routine.description).substring(0, 250) + '</div>'
    var rBadges = []
    if (routine.duree)          rBadges.push('⏱ ' + routine.duree)
    if (routine.moment_optimal) rBadges.push('⏰ ' + routine.moment_optimal)
    if (routine.frequence)      rBadges.push('🔄 ' + routine.frequence)
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
  var entry = Object.assign({}, recette, { id:'recette_' + Date.now(), saved_at: new Date().toISOString(), note: st.semaineRatings[id] || 0 })
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

function afficherBoutonListeCourses() {
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
  import('./recipes.js').then(function(m) { m.afficherListeCoursesProfile() })
}

function construireListeRecettes() {
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
      portions: st.semaineServings[id] || st.defaultPortions, basePortions: st.semaineBasePortions || st.defaultPortions || 1, ingredients: recette.ingredients || [] })
  })

  var savedList = []
  try { savedList = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  Object.keys(st.savedSelected).forEach(function(idx) {
    if (!st.savedSelected[idx]) return
    var recette = savedList[parseInt(idx)]; if (!recette) return
    result.push({ type: 'saved', id: parseInt(idx),
      nom: recette.nom || 'Recette sauvegardée',
      portions: st.savedServings[parseInt(idx)] || 2, basePortions: recette.portions || 2, ingredients: recette.ingredients || [] })
  })
  return result
}

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

function aggregerIngredients() {
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
    ajouterIngredients(recette.ingredients, (st.semaineServings[id] || st.defaultPortions) / (st.semaineBasePortions || st.defaultPortions || 1))
  })
  var savedList = []
  try { savedList = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  Object.keys(st.savedSelected).forEach(function(idx) {
    if (!st.savedSelected[idx]) return
    var recette = savedList[parseInt(idx)]; if (!recette || !recette.ingredients) return
    ajouterIngredients(recette.ingredients, (st.savedServings[parseInt(idx)] || 2) / Math.max(recette.portions || 2, 1))
  })
  return Object.values(map).sort(function(a, b) { return a.nom.localeCompare(b.nom) })
}

export function afficherListeCourses() {
  st.coursesChecked        = {}
  st._coursesIngredients   = aggregerIngredients()
  var ingredients          = st._coursesIngredients

  if (ingredients.length) {
    localStorage.setItem('vitalia_liste_courses', JSON.stringify({ date: new Date().toISOString(), ingredients: ingredients }))
    import('./recipes.js').then(function(m) { m.afficherListeCoursesProfile() })
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
  import('./recipes.js').then(function(m) { m.afficherListeCoursesProfile() })
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
      afficherSemaine(st.semainePlanData)
      try { localStorage.setItem('vitalia_semaine_session', JSON.stringify(st.semainePlanData)) } catch(e) {}
      toggleDay(jour)
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
