import { SUPABASE_URL, SUPABASE_ANON_KEY, st, escapeHtml } from './state.js'
import { authFetch } from './auth.js'
import { afficherToast, setText, fermerConfig, updateObjectifPrincipalBadge } from './ui.js'
import { syncBesoinsVersProfil } from './api.js'
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
  var score = plan.score_nutritionnel
  if (score == null || score === undefined) {
    var repas = [plan.matin, plan.midi, plan.soir, plan.apres_midi].filter(Boolean)
    var ingUniques = new Set()
    repas.forEach(function(m) {
      ;(m.ingredients || []).forEach(function(i) {
        var k = (typeof i === 'string' ? i : (i.nom || '')).toLowerCase().slice(0, 15)
        if (k) ingUniques.add(k)
      })
    })
    var nbUniques = ingUniques.size
    var nbRepas = Math.min(repas.length, 3)
    var nbNutri = repas.slice(0, 3).filter(function(m) {
      var nv = m.valeurs_nutritionnelles; return nv && nv.calories && nv.proteines
    }).length
    var s = 5
    s += nbRepas * 0.5
    s += nbNutri * 0.3
    if (repas.length > 3)                              s += 0.4
    if ((plan.nutraceutiques || []).length >= 2)       s += 0.6
    else if ((plan.nutraceutiques || []).length === 1) s += 0.3
    if ((plan.aromatherapie  || []).length > 0)        s += 0.4
    s += Math.min(nbUniques / 20, 0.7)
    score = Math.min(parseFloat(s.toFixed(1)), 10)
  }
  if (score != null) {
    setText('scoreValue', score + '/10')
    afficherEtoiles(score)
  } else {
    setText('scoreValue', '—')
  }

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

  import('./checkin.js').then(function(m) { m.afficherEvolution() })
}

// ── Mise en évidence des alliés présents dans le plan ──
export function updateAlliesFromPlan(plan) {
  st.currentActiveAllies = []
  var keywords = {
    goji:'goji', curcuma:'curcuma', gingembre:'gingembre', myrtille:'myrtille',
    avocat:'avocat', banane:'banane', miel:'miel', amandes:'amande',
    patate:'patate douce', epinards:'épinard', cannelle:'cannelle'
  }
  var allyNames = {
    goji:'Goji', curcuma:'Curcuma', gingembre:'Gingembre', myrtille:'Myrtille',
    avocat:'Avocat', banane:'Banane', miel:'Miel', amandes:'Amandes',
    patate:'Patate douce', epinards:'Épinards', cannelle:'Cannelle Ceylan'
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

export function _fmtQty(val, unit) {
  var isPiece = /pièce|tranche|oeuf|œuf|gousse|feuille|bouquet|brin|cube|filet|portion|escalope|steak|sachet|boite|boîte/i.test(unit)
  if (isPiece) {
    var r = Math.round(val * 2) / 2
    return String(r < 0.5 ? 0.5 : r)
  }
  return String(Math.round(val * 10) / 10)
}

export function ajusterQuantite(text, ratio) {
  text = text.replace(
    new RegExp('(\\d+)\\/(\\d+)[\\s\\u202f]*(' + _QTY_UNITS + ')', 'gi'),
    function(_, n, d, unit) { return _fmtQty(parseInt(n) / parseInt(d) * ratio, unit) + '\u202f' + unit }
  )
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
  var entry = Object.assign({}, r, { id: 'recette_' + Date.now(), saved_at: new Date().toISOString(), note: 0, portions: st.recipeServings[m] || r.portions || r.nb_personnes || 2 })
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
