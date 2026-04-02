import { SUPABASE_ANON_KEY, st } from './state.js'
import { _sb } from './auth.js'

// ── Constantes UI partagées ──
export const ALL_REGIMES_IDS = ['regimesChips','semaineRegimesChips','recetteRegimesChips','profilRegimesChips']
export const ALL_TEMPS_IDS   = ['configTempsChips','semaineTempsChips','recetteTempsChips','profilTempsCuisineChips']
export const ALL_BUDGET_IDS  = ['configBudgetChips','semaineBudgetChips','recetteBudgetChips','profilBudgetChips']

var _budgetMaxMap = { faible: 8, moyen: 15, eleve: 25 }

// ── Toast ──
var _toastTimer = null
export function afficherToast(msg) {
  var t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(_toastTimer)
  _toastTimer = setTimeout(function() { t.classList.remove('show') }, 3000)
}

// ── Overlay / panneaux ──
export function ouvrirConfig() {
  document.getElementById('configPanel').classList.add('open')
  document.getElementById('overlay').classList.add('active')
}
export function fermerConfig() {
  document.getElementById('configPanel').classList.remove('open')
  document.getElementById('overlay').classList.remove('active')
}
export function ouvrirProfilPanel() {
  chargerProfilUI()
  document.getElementById('profilPanel').classList.add('open')
  document.getElementById('overlay').classList.add('active')
}
export function fermerProfilPanel() {
  document.getElementById('profilPanel').classList.remove('open')
  document.getElementById('overlay').classList.remove('active')
}
export function fermerTout() {
  fermerConfig()
  fermerProfilPanel()
  var ally = document.getElementById('allyModal')
  if (ally) ally.style.display = 'none'
}

// ── Tab switching ──
export function switchTab(name) {
  if (st.currentTab === name) return
  st.currentTab = name

  document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active') })
  document.querySelectorAll('.tab-btn').forEach(function(el) { el.classList.remove('active') })

  var content = document.getElementById('tab-' + name)
  var btn     = document.getElementById('tab-btn-' + name)
  if (content) content.classList.add('active')
  if (btn)     btn.classList.add('active')

  // FAB uniquement sur l'onglet Aujourd'hui
  var fab = document.getElementById('generateFab')
  if (fab) fab.classList.toggle('visible', name === 'aujourdhui')

  window.scrollTo({ top: 0, behavior: 'instant' })
  syncAllPreferencesChips()

  if (name === 'semaine') {
    // Import dynamique pour éviter la circularité au chargement
    import('./plan.js').then(function(m) {
      m.syncSemaineChips()
      if (!st.semaineCheckedThisSession) {
        st.semaineCheckedThisSession = true
        m.genererSemaine(false)
      } else if (st.semainePlanData) {
        var JOURS_IDX = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi']
        var jourAujourdhui = JOURS_IDX[new Date().getDay()]
        var jourCible = (st.semainePlanData.semaine && st.semainePlanData.semaine[jourAujourdhui])
          ? jourAujourdhui : 'lundi'
        if (st.semaineJourOuvert !== jourCible) {
          st.semaineJourOuvert = jourCible
          m.toggleDay(jourCible)
        }
        setTimeout(function() {
          var el = document.getElementById('day-card-' + jourCible)
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 100)
      }
    })
  }

  if (name === 'atfaire') {
    import('./recipes.js').then(function(m) {
      m.afficherListeCoursesProfile()
      m.afficherRecettesSauvegardees()
      m.afficherFavoris()
    })
    import('./checkin.js').then(function(m) {
      m.afficherEvolution()
      m.afficherHistorique()
    })
  }

  fermerConfig()
}

export function switchAtfaireSection(name) {
  import('./recipes.js').then(function(m) {
    if (name === 'favoris')  m.afficherFavoris()
    if (name === 'recettes') m.afficherRecettesSauvegardees()
    if (name === 'liste')    m.afficherListeCoursesProfile()
  })
}

// ── setText helper ──
export function setText(id, val) {
  var e = document.getElementById(id); if (e) e.textContent = val
}

// ── Chip helpers — Symptômes ──
export function toggleSymptom(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!st.selectedSymptoms.includes(val)) st.selectedSymptoms.push(val)
  } else {
    st.selectedSymptoms = st.selectedSymptoms.filter(function(v) { return v !== val })
  }
  updateObjectifPrincipalBadge()
}

// ── Chips partagés : Régimes ──
export function toggleSharedRegime(el, val) {
  if (el.classList.contains('selected')) {
    el.classList.remove('selected')
    st.selectedRegimes = st.selectedRegimes.filter(function(v) { return v !== val })
  } else {
    el.classList.add('selected')
    if (!st.selectedRegimes.includes(val)) st.selectedRegimes.push(val)
  }
  ALL_REGIMES_IDS.forEach(function(id) {
    var container = document.getElementById(id); if (!container) return
    container.querySelectorAll('.chip[data-val="' + val + '"]').forEach(function(c) {
      c.classList.toggle('selected', st.selectedRegimes.includes(val))
    })
  })
  autoSauvegarderPreferences()
}

// ── Chips partagés : Temps cuisine ──
export function selectSharedTemps(el, val) {
  st.profilTempsCuisineCourant = val
  ALL_TEMPS_IDS.forEach(function(id) {
    var container = document.getElementById(id); if (!container) return
    container.querySelectorAll('.chip').forEach(function(c) {
      c.classList.toggle('selected', parseInt(c.dataset.val) === val)
    })
  })
  autoSauvegarderPreferences()
}

// ── Chips partagés : Budget ──
export function selectSharedBudget(el, val) {
  st.selectedBudget = val
  ALL_BUDGET_IDS.forEach(function(id) {
    var container = document.getElementById(id); if (!container) return
    container.querySelectorAll('.chip').forEach(function(c) {
      c.classList.toggle('selected', c.dataset.val === val)
    })
  })
  autoSauvegarderPreferences()
}

// ── Auto-sauvegarde préférences ──
var _prefTimer   = null
var _profilTimer = null

export function autoSauvegarderPreferences() {
  if (st.profilUtilisateur) {
    st.profilUtilisateur.regimes_alimentaires = st.selectedRegimes.slice()
    st.profilUtilisateur.temps_cuisine_max    = st.profilTempsCuisineCourant
    st.profilUtilisateur.budget_complements   = st.selectedBudget
    localStorage.setItem('vitalia_profil', JSON.stringify(st.profilUtilisateur))
  }
  clearTimeout(_prefTimer)
  _prefTimer = setTimeout(async function() {
    if (!st.profil_id || st.profil_id === 'new') return
    await _sb.from('profils_utilisateurs').update({
      regimes_alimentaires: st.selectedRegimes,
      temps_cuisine_max:    st.profilTempsCuisineCourant,
      temps_max:            st.profilTempsCuisineCourant,
      budget_complements:   st.selectedBudget,
      budget_max:           _budgetMaxMap[st.selectedBudget] || 15,
    }).eq('id', st.profil_id)
  }, 1500)
}

export function autoSauvegarderProfilComplet() {
  if (!st.profil_id || st.profil_id === 'new') return
  clearTimeout(_profilTimer)
  _profilTimer = setTimeout(async function() {
    await _sb.from('profils_utilisateurs').update({
      objectifs_generaux:   st.selectedSymptoms,
      allergies:            st.profilAllergiesCourantes,
      regimes_alimentaires: st.selectedRegimes,
      temps_cuisine_max:    st.profilTempsCuisineCourant,
      temps_max:            st.profilTempsCuisineCourant,
      budget_complements:   st.selectedBudget,
      budget_max:           _budgetMaxMap[st.selectedBudget] || 15,
    }).eq('id', st.profil_id)
  }, 1500)
}

// ── Sync toutes les chips de préférences partagées ──
export function syncAllPreferencesChips() {
  ALL_REGIMES_IDS.forEach(function(id) {
    var container = document.getElementById(id); if (!container) return
    container.querySelectorAll('.chip[data-val]').forEach(function(c) {
      c.classList.toggle('selected', st.selectedRegimes.includes(c.dataset.val))
    })
  })
  ALL_TEMPS_IDS.forEach(function(id) {
    var container = document.getElementById(id); if (!container) return
    container.querySelectorAll('.chip').forEach(function(c) {
      c.classList.toggle('selected', parseInt(c.dataset.val) === st.profilTempsCuisineCourant)
    })
  })
  ALL_BUDGET_IDS.forEach(function(id) {
    var container = document.getElementById(id); if (!container) return
    container.querySelectorAll('.chip').forEach(function(c) {
      c.classList.toggle('selected', c.dataset.val === st.selectedBudget)
    })
  })
  updateProfilRecaps()
}

export function updateProfilRecaps() {
  var tempsLabel  = st.profilTempsCuisineCourant + ' min'
  var budgetMap   = { faible: 'Petit < 10chf', moyen: 'Moyen 10-20chf', eleve: 'Grand > 20chf' }
  var budgetLabel = budgetMap[st.selectedBudget] || st.selectedBudget
  var regimesEmojiMap = { omnivore:'🥩', sans_gluten:'🌾', vegan:'🌱', vegetarien:'🥗', sans_lactose:'🥛', keto:'🥑', halal:'☪️', casher:'✡️' }
  var regimesLabel = st.selectedRegimes.length
    ? st.selectedRegimes.map(function(r) { return (regimesEmojiMap[r] || '') + ' ' + r.replace(/_/g,' ') }).join(' · ')
    : '—'
  var text = '⏱ ' + tempsLabel + ' &nbsp;·&nbsp; 💰 ' + budgetLabel + '<br>' + regimesLabel
  ;['configProfilRecap','semaineProfilRecap','recetteProfilRecap'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.innerHTML = text
  })
}

// ── Badge "Principal" sur le premier objectif sélectionné ──
export function updateObjectifPrincipalBadge() {
  var principal = st.selectedSymptoms.length > 0 ? st.selectedSymptoms[0] : null
  var selectors = [
    { container: '#symptomsChips .chip',        getVal: function(el) { var m = (el.getAttribute('onclick')||'').match(/'(\w+)'\)/); return m && m[1] } },
    { container: '#semaineSymptomChips .chip',  getVal: function(el) { var m = (el.getAttribute('onclick')||'').match(/'(\w+)'\)/); return m && m[1] } },
    { container: '#profilObjectifsChips .chip', getVal: function(el) { return el.dataset.val } }
  ]
  selectors.forEach(function(s) {
    document.querySelectorAll(s.container).forEach(function(el) {
      var val = s.getVal(el)
      var badge = el.querySelector('.badge-principal')
      if (!badge && val === principal) {
        badge = document.createElement('span')
        badge.className = 'badge-principal'
        badge.textContent = 'Principal'
        el.appendChild(badge)
      } else if (badge && val !== principal) {
        badge.remove()
      }
    })
  })
}

// ── Appliquer le profil Supabase à l'UI ──
export function appliquerProfil(p) {
  if (!p) return
  if (p.objectifs_generaux && p.objectifs_generaux.length) {
    st.selectedSymptoms = p.objectifs_generaux
    document.querySelectorAll('#symptomsChips .chip').forEach(function(el) {
      var m = el.getAttribute('onclick').match(/'([^']+)'/)
      if (m) el.classList.toggle('selected', st.selectedSymptoms.includes(m[1]))
    })
    updateObjectifPrincipalBadge()
  }
  if (p.regimes_alimentaires && p.regimes_alimentaires.length) st.selectedRegimes = p.regimes_alimentaires
  if (p.budget_complements)  st.selectedBudget = p.budget_complements
  if (p.temps_cuisine_max)   st.profilTempsCuisineCourant = p.temps_cuisine_max
  syncAllPreferencesChips()

  var initial = p.prenom ? p.prenom.charAt(0).toUpperCase() : '?'
  var prenom  = p.prenom || 'Profil'
  ;['profileAvatar','profileAvatarSemaine','profileAvatarRecette'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.textContent = initial
  })
  ;['profileNameBadge','profileNameBadgeSemaine','profileNameBadgeRecette'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.textContent = prenom
  })
  chargerProfilUI()
}

// ── Panel Profil UI ──
export function chargerProfilUI() {
  var p = st.profilUtilisateur; if (!p) return

  var lgEl   = document.getElementById('profilAvatarLg')
  var cardEl = document.getElementById('profilAvatarCard')
  var initial = p.prenom ? p.prenom.charAt(0).toUpperCase() : '?'
  if (lgEl)   lgEl.textContent   = initial
  if (cardEl) cardEl.textContent = initial

  var nomEl = document.getElementById('profilNom')
  if (nomEl) nomEl.textContent = p.prenom || 'Mon Profil'

  var sexeLabels = { femme:'Femme', homme:'Homme', 'non-binaire':'Non-binaire' }
  var badges = []
  if (p.age_tranche) badges.push(p.age_tranche)
  if (p.sexe)        badges.push(sexeLabels[p.sexe] || p.sexe)
  var metaEl = document.getElementById('profilMetaBadges')
  if (metaEl) {
    metaEl.innerHTML = badges.map(function(b) {
      return '<span style="background:var(--cream);border:1px solid rgba(196,113,74,0.15);border-radius:20px;padding:3px 10px;font-size:12px;color:var(--mid-brown);">' + b + '</span>'
    }).join('')
  }

  var objectifs = (p.objectifs_generaux && p.objectifs_generaux.length) ? p.objectifs_generaux : st.selectedSymptoms
  document.querySelectorAll('#profilObjectifsChips .chip').forEach(function(el) {
    el.classList.toggle('selected', objectifs.includes(el.dataset.val))
  })
  updateObjectifPrincipalBadge()

  st.profilAllergiesCourantes = (p.allergies || []).slice()
  document.querySelectorAll('#profilAllergiesChips .chip').forEach(function(el) {
    el.classList.toggle('selected', st.profilAllergiesCourantes.includes(el.dataset.val))
  })

  syncAllPreferencesChips()
  initialiserEmailDigestToggle(p)
}

export function toggleProfilObjectif(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!st.selectedSymptoms.includes(val)) st.selectedSymptoms.push(val)
  } else {
    st.selectedSymptoms = st.selectedSymptoms.filter(function(v) { return v !== val })
  }
  updateObjectifPrincipalBadge()
  autoSauvegarderProfilComplet()
}

export function toggleProfilRegime(el, val) {
  toggleSharedRegime(el, val)
}

export function toggleProfilAllergie(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!st.profilAllergiesCourantes.includes(val)) st.profilAllergiesCourantes.push(val)
  } else {
    st.profilAllergiesCourantes = st.profilAllergiesCourantes.filter(function(v) { return v !== val })
  }
  autoSauvegarderProfilComplet()
}

export function selectProfilTempsCuisine(el, val) {
  selectSharedTemps(el, val)
}

export function modifierProfilComplet() {
  window.location.href = 'onboarding.html?edit=true' + (st.profil_id ? '&profil_id=' + st.profil_id : '')
}

// ── Email digest toggle ──
export async function toggleEmailDigest(enabled) {
  var track = document.getElementById('emailDigestTrack')
  var thumb = document.getElementById('emailDigestThumb')
  if (track) track.style.background = enabled ? 'var(--terracotta)' : 'rgba(196,113,74,0.2)'
  if (thumb) thumb.style.transform  = enabled ? 'translateX(20px)' : 'translateX(0)'
  if (!st.profil_id || st.profil_id === 'new') return
  try {
    const { authFetch } = await import('./auth.js')
    const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('./state.js')
    await authFetch(
      SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + st.profil_id,
      { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + st.authToken },
        body: JSON.stringify({ email_digest: enabled }) }
    )
    afficherToast(enabled ? 'Digest activé — à demain matin ! 🌅' : 'Digest désactivé')
  } catch(e) { afficherToast('Erreur lors de la mise à jour') }
}

export function initialiserEmailDigestToggle(profil) {
  var enabled  = profil && profil.email_digest === true
  var checkbox = document.getElementById('emailDigestToggle')
  var track    = document.getElementById('emailDigestTrack')
  var thumb    = document.getElementById('emailDigestThumb')
  if (checkbox) checkbox.checked       = enabled
  if (track)    track.style.background = enabled ? 'var(--terracotta)' : 'rgba(196,113,74,0.2)'
  if (thumb)    thumb.style.transform  = enabled ? 'translateX(20px)' : 'translateX(0)'
}

// ── Ally modal ──
export var ALLY_INFO = {
  goji:      { name:'Baies de Goji',   subtitle:'La superfruta de la vitalité',       bg:'linear-gradient(135deg,#FEE2E2,#FECACA)', benefits:['Source exceptionnelle d\'antioxydants (zéaxanthine)','Boostent l\'énergie et réduisent la fatigue','Soutiennent le système immunitaire et la vue'], detail:'Les baies de Goji contiennent 18 acides aminés essentiels et 21 minéraux dont zinc et fer. Leurs polysaccharides (LBP) stimulent la production d\'énergie cellulaire et protègent les cellules des radicaux libres.', tip:'💡 Consommer 15-30g par jour, idéalement le matin. Excellentes en infusion (10 min dans de l\'eau chaude) pour un effet vitaminant durable.' },
  curcuma:   { name:'Curcuma',         subtitle:'L\'or anti-inflammatoire',            bg:'linear-gradient(135deg,#FEF3C7,#FDE68A)', benefits:['Puissant anti-inflammatoire naturel (curcumine)','Soutient la mobilité et le confort articulaire','Protège le foie et favorise la digestion'], detail:'La curcumine inhibe les enzymes pro-inflammatoires COX-2 et NF-κB. Son absorption est multipliée par 20 en présence de pipérine (poivre noir) et de matières grasses.', tip:'💡 Toujours associer avec une pincée de poivre noir et une matière grasse pour maximiser l\'absorption de la curcumine.' },
  gingembre: { name:'Gingembre',       subtitle:'La racine digestive & tonifiante',   bg:'linear-gradient(135deg,#FFF7ED,#FED7AA)', benefits:['Stimule les enzymes digestives naturellement','Anti-nauséeux et anti-spasmodique reconnu','Propriétés anti-inflammatoires et réchauffantes'], detail:'Les gingérols et shogaols du gingembre stimulent la production d\'enzymes digestives et accélèrent la vidange gastrique. Des méta-analyses montrent une réduction des nausées de 40%.', tip:'💡 En infusion fraîche : 3-4 tranches dans 250ml d\'eau chaude, 10 min. Ajouter du citron et du miel pour décupler les bienfaits.' },
  myrtille:  { name:'Myrtille',        subtitle:'La baie de la clarté mentale',       bg:'linear-gradient(135deg,#EDE9FE,#DDD6FE)', benefits:['Protège le cerveau et améliore la mémoire','Régule la glycémie et le stress oxydatif','Riche en anthocyanes aux effets anti-âge'], detail:'Les anthocyanes des myrtilles traversent la barrière hémato-encéphalique et protègent les neurones du stress oxydatif. Une amélioration de la mémoire à court terme de 5% après 12 semaines.', tip:'💡 Fraîches ou surgelées, leur valeur nutritive est identique. 80-100g par jour suffisent.' },
  avocat:    { name:'Avocat',          subtitle:'Le fruit des hormones équilibrées',  bg:'linear-gradient(135deg,#DCFCE7,#BBF7D0)', benefits:['Riche en acides gras mono-insaturés (oméga-9)','Multiplie l\'absorption des vitamines liposolubles (A,D,E,K)','Soutient l\'équilibre hormonal naturellement'], detail:'L\'avocat facilite l\'absorption des vitamines A, D, E, K des autres aliments — multipliant leur biodisponibilité par 4. Ses phytostérols contribuent à l\'équilibre des hormones.', tip:'💡 Ne pas jeter la couche verte sous la peau : c\'est là que se concentrent la plupart des polyphénols.' },
  banane:    { name:'Banane',          subtitle:'Le carburant de l\'énergie durable', bg:'linear-gradient(135deg,#FEF9C3,#FDE047)', benefits:['Source idéale de potassium pour les muscles','Libère l\'énergie progressivement','Riche en vitamine B6, précurseur de la sérotonine'], detail:'La banane contient du potassium, du magnésium et des glucides complexes. Sa vitamine B6 participe à la synthèse de sérotonine et dopamine, favorisant la bonne humeur.', tip:'💡 Une banane légèrement verte a un index glycémique plus bas. Attends qu\'elle soit jaune pour un maximum de vitamines.' },
  patate:    { name:'Patate douce',    subtitle:'L\'alliée du sommeil & de l\'énergie',bg:'linear-gradient(135deg,#FED7AA,#FB923C)', benefits:['Riche en tryptophane, précurseur de la mélatonine','Béta-carotène puissant antioxydant','Index glycémique modéré — énergie longue durée'], detail:'Son tryptophane se convertit en sérotonine puis en mélatonine. Sa richesse en béta-carotène protège les cellules et sa peau contient des fibres prébiotiques précieuses.', tip:'💡 Cuire avec la peau pour préserver les fibres. Associée à la vitamine C, elle multiplie l\'absorption du fer.' },
  miel:      { name:'Miel',            subtitle:'L\'or liquide apaisant & antibactérien',bg:'linear-gradient(135deg,#FEF3C7,#FCD34D)',benefits:['Antibactérien naturel','Adoucit la gorge et calme les voies respiratoires','Soutient le sommeil grâce au fructose'], detail:'Le miel brut contient des flavonoïdes et du méthylglyoxal aux propriétés antibactériennes prouvées. Une cuillère de miel le soir favorise le sommeil.', tip:'💡 Ne jamais chauffer au-delà de 40°C. Ajouter dans des boissons tièdes, jamais bouillantes.' },
  epinards:  { name:'Épinards',        subtitle:'Le bouclier vert en fer & magnésium',bg:'linear-gradient(135deg,#DCFCE7,#86EFAC)', benefits:['Excellente source de fer non-héminique et de magnésium','Riches en lutéine pour la santé oculaire','Nitrates naturels qui améliorent l\'oxygénation musculaire'], detail:'Les épinards contiennent du fer, du magnésium, du calcium et des vitamines K et B9. Leurs nitrates naturels améliorent la circulation sanguine.', tip:'💡 Associer avec du citron pour tripler l\'absorption du fer. Cuits à la vapeur, ils concentrent leurs nutriments.' },
  amandes:   { name:'Amandes',         subtitle:'La noix du magnésium & des bons gras',bg:'linear-gradient(135deg,#FEF3C7,#FDE68A)',benefits:['1ère source végétale de vitamine E antioxydante','Riches en magnésium — anti-stress et anti-crampes','Acides gras qui soutiennent le cœur'], detail:'30g d\'amandes apportent 75mg de magnésium, 7,3mg de vitamine E et 6g de protéines végétales. Des études montrent qu\'une poignée/jour réduit le LDL-cholestérol de 4 à 5%.', tip:'💡 Tremper les amandes une nuit dans l\'eau froide améliore leur digestibilité.' }
}

export function ouvrirAlly(name) {
  var info = ALLY_INFO[name]; if (!info) return
  document.getElementById('allyModalAvatar').style.background = info.bg
  document.getElementById('allyModalSvg').setAttribute('href', '#mascot-' + name)
  document.getElementById('allyModalName').textContent = info.name
  document.getElementById('allyModalSubtitle').textContent = info.subtitle
  document.getElementById('allyModalBenefits').innerHTML =
    info.benefits.map(function(b) { return '<li>' + b + '</li>' }).join('')
  document.getElementById('allyModalDetail').textContent = info.detail
  document.getElementById('allyModalTip').textContent = info.tip
  var footer = document.getElementById('allyModalFooter')
  if (footer) footer.style.display = st.currentActiveAllies.includes(name) ? 'block' : 'none'
  document.getElementById('allyModal').style.display = 'flex'
  document.getElementById('overlay').classList.add('active')
}
export function fermerAlly() {
  document.getElementById('allyModal').style.display = 'none'
  document.getElementById('overlay').classList.remove('active')
}
