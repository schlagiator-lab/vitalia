var SUPABASE_URL      = 'https://ptzmyuugxhsbrynjwlhp.supabase.co'
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0em15dXVneGhzYnJ5bmp3bGhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNDY1NjUsImV4cCI6MjA4NTYyMjU2NX0.Pel8am6iplwwFSqolEV7JOG6nxsOx4BxxJPLsObRC-4'

// ── Client Supabase (SDK avec auth automatique, partagé avec onboarding) ──
var _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Token d'auth : mis à jour uniquement sur token valide confirmé ──
var authToken = SUPABASE_ANON_KEY
var _deconnexionEnCours = false
var _sessionInitialisee = false  // true une fois init() confirmée avec token valide
_sb.auth.onAuthStateChange(function(event, session) {
  console.log('[onAuthStateChange]', event, session ? 'session=' + (session.access_token ? session.access_token.slice(0,20) + '...' : 'no_token') : 'null')
  if (session && session.access_token) {
    authToken = session.access_token
  } else {
    authToken = SUPABASE_ANON_KEY
    // SIGNED_OUT inattendu seulement APRÈS que la session soit confirmée (évite boucle redirect)
    if (event === 'SIGNED_OUT' && !_deconnexionEnCours && _sessionInitialisee) {
      console.warn('[auth] SIGNED_OUT inattendu → redirection reconnexion')
      setTimeout(function() {
        window.location.href = 'onboarding.html?reconnect=1' + (profil_id ? '&profil_id=' + profil_id : '')
      }, 500)
    }
  }
})

// Wrapper fetch : injecte le bon token et gère le 401 avec retry
async function authFetch(url, options) {
  // Les Edge Functions utilisent SERVICE_ROLE_KEY en interne et le profil_id du body :
  // elles n'ont pas besoin du user JWT. Le gateway Supabase accepte la clé anon (HS256)
  // mais peut rejeter les user tokens ES256 selon la version du runtime.
  var isFunctionUrl = url.includes('/functions/v1/')
  var tokenEffectif = isFunctionUrl ? SUPABASE_ANON_KEY : authToken

  var opts = Object.assign({}, options, {
    headers: Object.assign({}, options.headers, { 'Authorization': 'Bearer ' + tokenEffectif })
  })
  var resp = await fetch(url, opts)

  if (resp.status === 401) {
    if (isFunctionUrl) {
      // Edge Function : la clé anon devrait toujours fonctionner → log erreur persistante
      console.error('[authFetch] Edge Function 401 persistant avec clé anon :', url.split('/').pop())
      return resp
    }
    // REST API : tenter un refresh du token utilisateur
    console.warn('[authFetch] REST 401 → tentative refreshSession()')
    try {
      var refreshed = await _sb.auth.refreshSession()
      var newToken = refreshed && refreshed.data && refreshed.data.session && refreshed.data.session.access_token
      if (newToken) {
        authToken = newToken
        console.log('[authFetch] ✓ Refresh réussi, retry REST avec nouveau token')
        var retryHeaders = Object.assign({}, opts.headers, { 'Authorization': 'Bearer ' + newToken })
        return fetch(url, Object.assign({}, opts, { headers: retryHeaders }))
      }
    } catch(e) { console.warn('[authFetch] Refresh échoué:', e) }
    // Refresh impossible → session expirée
    if (!_deconnexionEnCours) {
      console.warn('[authFetch] Session REST expirée → redirection')
      afficherToast('Session expirée – reconnecte-toi')
      setTimeout(function() {
        window.location.href = 'onboarding.html?reconnect=1' + (profil_id ? '&profil_id=' + profil_id : '')
      }, 1500)
    }
  }
  return resp
}

// ── State ──
var currentTab        = 'aujourdhui'
var profil_id         = null
var profilUtilisateur = null
var currentPlan       = null
var semaineData       = null
var recetteGeneree    = null
var selectedSymptoms      = ['vitalite', 'serenite']
var selectedRegimes       = []
var selectedBudget        = 'moyen'
var semaineRepasInclus    = ['petit_dejeuner', 'dejeuner', 'diner', 'pause']
var recipeServings    = { matin: 1, midi: 1, apres_midi: 1, soir: 1 }
var recipeBaseIng     = {}
var savedRecipes      = []
var currentActiveAllies = []

// Tag arrays for profile
var ppAllergiesPresets   = []
var ppAllergiesCustom    = []
var ppPathologiesPresets = []
var ppPathologiesCustom  = []
var ppMedicaments        = []
var recetteFrigoTags     = []

// ── Tab switching ──
function switchTab(name) {
  if (currentTab === name) return
  currentTab = name

  document.querySelectorAll('.tab-content').forEach(function(el) {
    el.classList.remove('active')
  })
  document.querySelectorAll('.tab-btn').forEach(function(el) {
    el.classList.remove('active')
  })

  var content = document.getElementById('tab-' + name)
  var btn     = document.getElementById('tab-btn-' + name)
  if (content) content.classList.add('active')
  if (btn)     btn.classList.add('active')

  // FAB only visible on Aujourd'hui tab
  var fab = document.getElementById('generateFab')
  if (fab) fab.classList.toggle('visible', name === 'aujourdhui')

  // Scroll to top of new tab
  window.scrollTo({ top: 0, behavior: 'instant' })

  // Sync chips / UI on tab switch
  syncAllPreferencesChips()
  if (name === 'semaine') {
    syncSemaineChips()
    // Always check Supabase once per session for cross-device sync
    if (!semaineCheckedThisSession) {
      semaineCheckedThisSession = true
      genererSemaine(false)
    } else if (semainePlanData) {
      // Plan déjà chargé : ouvrir et scroller vers le jour courant
      var JOURS_IDX = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi']
      var jourAujourdhui = JOURS_IDX[new Date().getDay()]
      var jourCible = (semainePlanData.semaine && semainePlanData.semaine[jourAujourdhui]) ? jourAujourdhui : 'lundi'
      if (semaineJourOuvert !== jourCible) {
        semaineJourOuvert = jourCible
        toggleDay(jourCible)
      }
      setTimeout(function() {
        var el = document.getElementById('day-card-' + jourCible)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
    }
  }
  if (name === 'atfaire') {
    afficherListeCoursesProfile()
    afficherRecettesSauvegardees()
    afficherFavoris()
    afficherEvolution()
    afficherHistorique()
  }

  fermerConfig()
}

// ── Overlay / config panel ──
function ouvrirConfig() {
  document.getElementById('configPanel').classList.add('open')
  document.getElementById('overlay').classList.add('active')
}
function fermerConfig() {
  document.getElementById('configPanel').classList.remove('open')
  document.getElementById('overlay').classList.remove('active')
}

function ouvrirProfilPanel() {
  chargerProfilUI()
  document.getElementById('profilPanel').classList.add('open')
  document.getElementById('overlay').classList.add('active')
}
function fermerProfilPanel() {
  document.getElementById('profilPanel').classList.remove('open')
  document.getElementById('overlay').classList.remove('active')
}

function switchAtfaireSection(name) {
  if (name === 'favoris')  afficherFavoris()
  if (name === 'recettes') afficherRecettesSauvegardees()
  if (name === 'liste')    afficherListeCoursesProfile()
}
function fermerTout() {
  fermerConfig()
  fermerProfilPanel()
  var ally = document.getElementById('allyModal')
  if (ally) ally.style.display = 'none'
}

// ── Toast ──
var toastTimer = null
function afficherToast(msg) {
  var t = document.getElementById('toast')
  if (!t) return
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(function() { t.classList.remove('show') }, 3000)
}

// ── Chip helpers (config panel) ──
function toggleSymptom(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!selectedSymptoms.includes(val)) selectedSymptoms.push(val)
  } else {
    selectedSymptoms = selectedSymptoms.filter(function(v) { return v !== val })
  }
  updateObjectifPrincipalBadge()
}
// ── Shared chipset IDs ──
var ALL_REGIMES_IDS = ['regimesChips','semaineRegimesChips','recetteRegimesChips','profilRegimesChips']
var ALL_TEMPS_IDS   = ['configTempsChips','semaineTempsChips','recetteTempsChips','profilTempsCuisineChips']
var ALL_BUDGET_IDS  = ['configBudgetChips','semaineBudgetChips','recetteBudgetChips','profilBudgetChips']

function toggleSharedRegime(el, val) {
  if (el.classList.contains('selected')) {
    el.classList.remove('selected')
    selectedRegimes = selectedRegimes.filter(function(v) { return v !== val })
  } else {
    el.classList.add('selected')
    if (!selectedRegimes.includes(val)) selectedRegimes.push(val)
  }
  ALL_REGIMES_IDS.forEach(function(id) {
    var container = document.getElementById(id)
    if (!container) return
    container.querySelectorAll('.chip[data-val="' + val + '"]').forEach(function(c) {
      c.classList.toggle('selected', selectedRegimes.includes(val))
    })
  })
  autoSauvegarderPreferences()
}

function selectSharedTemps(el, val) {
  profilTempsCuisineCourant = val
  ALL_TEMPS_IDS.forEach(function(id) {
    var container = document.getElementById(id)
    if (!container) return
    container.querySelectorAll('.chip').forEach(function(c) {
      c.classList.toggle('selected', parseInt(c.dataset.val) === val)
    })
  })
  autoSauvegarderPreferences()
}

function selectSharedBudget(el, val) {
  selectedBudget = val
  ALL_BUDGET_IDS.forEach(function(id) {
    var container = document.getElementById(id)
    if (!container) return
    container.querySelectorAll('.chip').forEach(function(c) {
      c.classList.toggle('selected', c.dataset.val === val)
    })
  })
  autoSauvegarderPreferences()
}

var _prefTimer = null
var _profilTimer = null
var _budgetMaxMap = { faible: 8, moyen: 15, eleve: 25 }

function autoSauvegarderProfilComplet() {
  if (!profil_id || profil_id === 'new') return
  clearTimeout(_profilTimer)
  _profilTimer = setTimeout(async function() {
    await _sb.from('profils_utilisateurs').update({
      objectifs_generaux:   selectedSymptoms,
      allergies:            profilAllergiesCourantes,
      regimes_alimentaires: selectedRegimes,
      temps_cuisine_max:    profilTempsCuisineCourant,
      temps_max:            profilTempsCuisineCourant,
      budget_complements:   selectedBudget,
      budget_max:           _budgetMaxMap[selectedBudget] || 15,
    }).eq('id', profil_id)
  }, 1500)
}

function autoSauvegarderPreferences() {
  if (profilUtilisateur) {
    profilUtilisateur.regimes_alimentaires = selectedRegimes.slice()
    profilUtilisateur.temps_cuisine_max    = profilTempsCuisineCourant
    profilUtilisateur.budget_complements   = selectedBudget
    localStorage.setItem('vitalia_profil', JSON.stringify(profilUtilisateur))
  }
  clearTimeout(_prefTimer)
  _prefTimer = setTimeout(async function() {
    if (!profil_id || profil_id === 'new') return
    await _sb.from('profils_utilisateurs').update({
      regimes_alimentaires: selectedRegimes,
      temps_cuisine_max:    profilTempsCuisineCourant,
      temps_max:            profilTempsCuisineCourant,
      budget_complements:   selectedBudget,
      budget_max:           _budgetMaxMap[selectedBudget] || 15,
    }).eq('id', profil_id)
  }, 1500)
}

function syncAllPreferencesChips() {
  // Régimes (multi-select)
  ALL_REGIMES_IDS.forEach(function(id) {
    var container = document.getElementById(id)
    if (!container) return
    container.querySelectorAll('.chip[data-val]').forEach(function(c) {
      c.classList.toggle('selected', selectedRegimes.includes(c.dataset.val))
    })
  })
  // Temps (single-select)
  ALL_TEMPS_IDS.forEach(function(id) {
    var container = document.getElementById(id)
    if (!container) return
    container.querySelectorAll('.chip').forEach(function(c) {
      c.classList.toggle('selected', parseInt(c.dataset.val) === profilTempsCuisineCourant)
    })
  })
  // Budget (single-select)
  ALL_BUDGET_IDS.forEach(function(id) {
    var container = document.getElementById(id)
    if (!container) return
    container.querySelectorAll('.chip').forEach(function(c) {
      c.classList.toggle('selected', c.dataset.val === selectedBudget)
    })
  })
  updateProfilRecaps()
}

function updateProfilRecaps() {
  var tempsLabel = profilTempsCuisineCourant + ' min'
  var budgetMap  = { faible: 'Petit < 10chf', moyen: 'Moyen 10-20chf', eleve: 'Grand > 20chf' }
  var budgetLabel = budgetMap[selectedBudget] || selectedBudget
  var regimesEmojiMap = { omnivore:'🥩', sans_gluten:'🌾', vegan:'🌱', vegetarien:'🥗', sans_lactose:'🥛', keto:'🥑', halal:'☪️', casher:'✡️' }
  var regimesLabel = selectedRegimes.length
    ? selectedRegimes.map(function(r) { return (regimesEmojiMap[r] || '') + ' ' + r.replace(/_/g,' ') }).join(' · ')
    : '—'
  var text = '⏱ ' + tempsLabel + ' &nbsp;·&nbsp; 💰 ' + budgetLabel + '<br>' + regimesLabel
  ;['configProfilRecap','semaineProfilRecap','recetteProfilRecap'].forEach(function(id) {
    var el = document.getElementById(id)
    if (el) el.innerHTML = text
  })
}

// ── Ally modal (stub — data & logic added in Step 2) ──
function ouvrirAlly(name) {
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
  if (footer) footer.style.display = currentActiveAllies.includes(name) ? 'block' : 'none'
  document.getElementById('allyModal').style.display = 'flex'
  document.getElementById('overlay').classList.add('active')
}
function fermerAlly() {
  document.getElementById('allyModal').style.display = 'none'
  document.getElementById('overlay').classList.remove('active')
}

// ── Ally data ──
var ALLY_INFO = {
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

// ── Init ──
document.addEventListener('DOMContentLoaded', async function() {
  var urlParams  = new URLSearchParams(window.location.search)
  var idFromUrl  = urlParams.get('profil_id')
  profil_id      = idFromUrl || localStorage.getItem('vitalia_profil_id')

  if (!profil_id || profil_id === 'new') {
    document.getElementById('loadingText').textContent = 'Bienvenue sur Vitalia ! 🌿'
    setTimeout(function() { window.location.href = 'onboarding.html' }, 1200)
    return
  }

  // Initialiser le token d'auth AVANT tout appel réseau
  try {
    var sessionResult = await _sb.auth.getSession()
    var initSession = sessionResult && sessionResult.data && sessionResult.data.session
    // Vérifier que le token n'est pas expiré (expires_at est en secondes Unix)
    // getSession() retourne le token stocké même s'il est périmé — ne pas le faire confiance sans vérif
    var maintenant = Math.floor(Date.now() / 1000)
    var tokenFrais = initSession && initSession.access_token &&
                     initSession.expires_at && (initSession.expires_at - maintenant > 60)
    if (tokenFrais) {
      authToken = initSession.access_token
      console.log('[auth] Token valide initialisé depuis getSession() ✓')
    } else {
      // Token absent ou expiré → refresh explicite
      if (initSession) console.warn('[auth] Token expiré (exp=' + initSession.expires_at + ') → refreshSession()')
      var refreshResult = await _sb.auth.refreshSession()
      var refreshedSession = refreshResult && refreshResult.data && refreshResult.data.session
      if (refreshedSession && refreshedSession.access_token) {
        authToken = refreshedSession.access_token
        console.log('[auth] Token rafraîchi via refreshSession() ✓')
      } else if (!initSession) {
        // Aucune session en mémoire et refresh impossible → l'utilisateur doit se reconnecter
        console.warn('[auth] Aucune session → redirection reconnexion')
        window.location.href = 'onboarding.html?reconnect=1' + (profil_id ? '&profil_id=' + profil_id : '')
        return
      } else {
        // Token expiré et refresh échoué
        var refreshErr = refreshResult && refreshResult.error
        if (refreshErr && refreshErr.message) {
          // Refresh token invalide/révoqué côté serveur → reconnexion obligatoire
          console.warn('[auth] Refresh token invalide (' + refreshErr.message + ') → redirection reconnexion')
          window.location.href = 'onboarding.html?reconnect=1' + (profil_id ? '&profil_id=' + profil_id : '')
          return
        }
        // Pas de message d'erreur → probablement une perte réseau temporaire → on continue
        console.warn('[auth] Refresh sans réponse (réseau ?) → token expiré en cache, les appels API peuvent échouer')
      }
    }
  } catch(e) { console.warn('[auth] Session init error:', e) }

  // Marquer la session comme initialisée (active le SIGNED_OUT handler)
  _sessionInitialisee = true
  console.log('[auth] Session initialisée, authToken=', authToken === SUPABASE_ANON_KEY ? 'ANON_KEY' : 'user_token(' + authToken.slice(0,20) + '...)')

  localStorage.setItem('vitalia_profil_id', profil_id)

  // Load cached profile immediately
  var cached = localStorage.getItem('vitalia_profil')
  if (cached) {
    try { profilUtilisateur = JSON.parse(cached); appliquerProfil(profilUtilisateur) } catch(e) {}
  }

  // Fetch fresh profile from Supabase
  chargerProfilSupabase(profil_id)

  // Migrate and sync favorites + "À faire"
  migrerFavoris()
  chargerFavorisSupabase()
  chargerRecettesSauvegardeesSupabase()

  // Badge "Principal" sur le premier objectif sélectionné (appel initial garanti)
  updateObjectifPrincipalBadge()

  // Date badge
  var db = document.getElementById('dateBadge')
  if (db) db.textContent = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'short' })

  // Mini-calendar tab icon with current date
  ;(function() {
    var el = document.getElementById('semaineTabDay')
    if (el) el.textContent = new Date().getDate()
  })()

  // Try to restore cached plan, else generate
  var planSession = sessionStorage.getItem('vitalia_plan_session_home')
  var planValide  = false
  var today       = new Date().toISOString().slice(0, 10)  // 'YYYY-MM-DD'
  if (planSession) {
    try {
      var planRestaure = JSON.parse(planSession)
      // Only restore if plan is from today (stale = new Supabase cache may exist)
      var planDate = planRestaure && planRestaure._date
      if (planRestaure && (planRestaure.matin || planRestaure.petit_dejeuner) && planDate === today) {
        planValide = true
        setTimeout(function() {
          var ls = document.getElementById('loadingScreen')
          var ap = document.getElementById('app')
          if (ls) ls.classList.add('hidden')
          if (ap) ap.style.opacity = '1'
          document.getElementById('generateFab').classList.add('visible')
          afficherPlan(planRestaure)
          verifierCheckinDuJour()
        }, 600)
      }
    } catch(e) { sessionStorage.removeItem('vitalia_plan_session_home') }
  }
  if (!planValide) {
    sessionStorage.removeItem('vitalia_plan_session_home')
    setTimeout(function() { genererPlan(false) }, 400)
  }

  // Restore week plan from localStorage
  var semaineSession = localStorage.getItem('vitalia_semaine_session')
  if (semaineSession) {
    try {
      var semaineData = JSON.parse(semaineSession)
      if (semaineData && semaineData.semaine) {
        semainePlanData = semaineData
        afficherSemaine(semaineData)
      }
    } catch(e) { localStorage.removeItem('vitalia_semaine_session') }
  }

  // Pre-load shopping list for À faire > Courses section
  chargerListeCoursesSupabase()  // sync multi-appareils avant affichage
  afficherListeCoursesProfile()

  // Close courses modal on Escape key (PC UX)
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { fermerListeCourses() }
  })

  // Restore on-demand recipe from localStorage
  var recetteSession = localStorage.getItem('vitalia_recette_session')
  if (recetteSession) {
    try {
      var recetteData = JSON.parse(recetteSession)
      if (recetteData && recetteData.recette) {
        recetteCourante = recetteData.recette
        recetteTypeRepas = recetteData.type || 'dejeuner'
        afficherRecetteUnique(recetteData.recette)
        var btnText = document.getElementById('recetteBtnText')
        if (btnText) btnText.textContent = '🔄 Nouvelle recette'
        // Sync type chip
        document.querySelectorAll('#recetteTypeChips .chip').forEach(function(c) {
          c.classList.toggle('selected', c.dataset.val === recetteTypeRepas)
        })
      }
    } catch(e) { localStorage.removeItem('vitalia_recette_session') }
  }
})

// ── Sync données Supabase quand l'onglet redevient visible (cross-device) ──
var _lastVisibilitySync = 0
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState !== 'visible') return
  if (!profil_id || profil_id === 'new') return
  var now = Date.now()
  if (now - _lastVisibilitySync < 5 * 60 * 1000) return  // cooldown 5 min
  _lastVisibilitySync = now
  chargerProfilSupabase(profil_id)
  chargerFavorisSupabase()
  chargerRecettesSauvegardeesSupabase()
  chargerListeCoursesSupabase()
})

// ── Load profile from Supabase ──
async function chargerProfilSupabase(id) {
  try {
    var r = await authFetch(
      SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + id + '&limit=1',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken } }
    )
    if (r.ok) {
      var d = await r.json()
      if (d && d[0]) {
        profilUtilisateur = d[0]
        appliquerProfil(d[0])
        localStorage.setItem('vitalia_profil', JSON.stringify(d[0]))
      }
    }
  } catch(e) { console.warn('Profile load error:', e) }
}

// ── Migrate old favorites (note>=4 in vitalia_recettes_sauvegardees → vitalia_favoris) ──
function migrerFavoris() {
  try {
    var favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]')
    if (favs.length > 0) return  // already migrated
    var saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]')
    var migrated = saved.filter(function(r) { return r.note && r.note >= 4 })
    if (migrated.length > 0) {
      localStorage.setItem('vitalia_favoris', JSON.stringify(migrated))
    }
  } catch(e) {}
}

// ── Load "À faire" recipes from Supabase recettes_sauvegardees ──
async function chargerRecettesSauvegardeesSupabase() {
  if (!profil_id || profil_id === 'new') return
  try {
    var r = await authFetch(
      SUPABASE_URL + '/rest/v1/recettes_sauvegardees?profil_id=eq.' + profil_id + '&order=date_sauvegarde.desc&limit=50',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken } }
    )
    if (!r.ok) return
    var rows = await r.json()
    if (!Array.isArray(rows) || !rows.length) return
    var saved = []
    try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
    // Merge: add from Supabase any that aren't already in localStorage
    rows.forEach(function(row) {
      var nom = (row.titre || row.nom || '').toLowerCase().trim()
      if (!nom) return
      var exists = saved.some(function(s) { return (s.nom || s.titre || '').toLowerCase().trim() === nom })
      if (!exists) saved.push({
        nom: row.titre || row.nom,
        titre: row.titre || row.nom,
        ingredients: row.ingredients || [],
        instructions: row.instructions || row.steps || [],
        astuces: row.tip ? [row.tip] : [],
        type_repas: row.moment || '',
        saved_at: row.date_sauvegarde,
        note: row.note || 0
      })
    })
    localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved.slice(0, 50)))
  } catch(e) {}
}

// ── Sync liste de courses vers Supabase (multi-appareils) ──
var _coursesDebounceTimer = null
function _patchListeCoursesSupabase(raw) {
  if (!profil_id || profil_id === 'new') return
  try {
    authFetch(
      SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + profil_id,
      { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + authToken, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ liste_courses: raw }) }
    ).catch(function() {})
  } catch(e) {}
}
function sauvegarderListeCoursesSupabase() {
  if (!profil_id || profil_id === 'new') return
  clearTimeout(_coursesDebounceTimer)
  _coursesDebounceTimer = setTimeout(function() {
    var raw = null
    try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    _patchListeCoursesSupabase(raw)
  }, 1500) // debounce 1.5s pour grouper les sauvegardes rapides
}
function effacerListeCoursesSupabase() {
  if (!profil_id || profil_id === 'new') return
  clearTimeout(_coursesDebounceTimer)
  _patchListeCoursesSupabase(null)
}

async function chargerListeCoursesSupabase() {
  if (!profil_id || profil_id === 'new') return
  try {
    var r = await authFetch(
      SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + profil_id + '&select=liste_courses&limit=1',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken } }
    )
    if (!r.ok) return
    var rows = await r.json()
    var remote = rows && rows[0] && rows[0].liste_courses
    if (!remote) return
    // Merge : garder les articles manuels locaux, écraser le reste par Supabase
    var local = null
    try { local = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    var manuels = local ? (local.ingredients || []).filter(function(i) { return i.manuel }) : []
    var merged = {
      date: remote.date || new Date().toISOString(),
      ingredients: (remote.ingredients || []).concat(manuels.filter(function(m) {
        return !(remote.ingredients || []).some(function(r) { return r.nom === m.nom })
      })),
      recettes: remote.recettes || []
    }
    localStorage.setItem('vitalia_liste_courses', JSON.stringify(merged))
    afficherListeCoursesProfile()
  } catch(e) {}
}

// ── Load favorites from Supabase recettes_favorites ──
async function chargerFavorisSupabase() {
  if (!profil_id || profil_id === 'new') return
  try {
    var r = await authFetch(
      SUPABASE_URL + '/rest/v1/recettes_favorites?profil_id=eq.' + profil_id + '&order=sauvegardee_le.desc&limit=50',
      { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken } }
    )
    if (!r.ok) return
    var rows = await r.json()
    if (!Array.isArray(rows) || !rows.length) return
    var favs = []
    try { favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]') } catch(e) {}
    // Merge: add from Supabase any that aren't already in localStorage
    rows.forEach(function(row) {
      var nom = (row.titre || row.nom || '').toLowerCase().trim()
      if (!nom) return
      var exists = favs.some(function(f) { return (f.nom || f.titre || '').toLowerCase().trim() === nom })
      if (!exists) favs.push({
        nom: row.titre || row.nom,
        titre: row.titre || row.nom,
        ingredients: row.ingredients || [],
        instructions: row.instructions || row.steps || [],
        astuces: row.tip ? [row.tip] : [],
        type_repas: row.moment || '',
        saved_at: row.sauvegardee_le || row.saved_at,
        note: row.note || 0
      })
    })
    localStorage.setItem('vitalia_favoris', JSON.stringify(favs))
  } catch(e) {}
}

// ── Apply profile to UI ──
function appliquerProfil(p) {
  if (!p) return
  // Sync symptoms
  if (p.objectifs_generaux && p.objectifs_generaux.length) {
    selectedSymptoms = p.objectifs_generaux
    document.querySelectorAll('#symptomsChips .chip').forEach(function(el) {
      var m = el.getAttribute('onclick').match(/'([^']+)'/)
      if (m) el.classList.toggle('selected', selectedSymptoms.includes(m[1]))
    })
    updateObjectifPrincipalBadge()
  }
  // Sync regimes
  if (p.regimes_alimentaires && p.regimes_alimentaires.length) {
    selectedRegimes = p.regimes_alimentaires
  }
  // Sync budget
  if (p.budget_complements) selectedBudget = p.budget_complements
  // Sync temps cuisine
  if (p.temps_cuisine_max) profilTempsCuisineCourant = p.temps_cuisine_max
  // Sync all chips
  syncAllPreferencesChips()
  // Update profile badges (Aujourd'hui + Semaine + Recette)
  var initial = p.prenom ? p.prenom.charAt(0).toUpperCase() : '?'
  var prenom  = p.prenom || 'Profil'
  ;['profileAvatar','profileAvatarSemaine','profileAvatarRecette'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.textContent = initial
  })
  ;['profileNameBadge','profileNameBadgeSemaine','profileNameBadgeRecette'].forEach(function(id) {
    var el = document.getElementById(id); if (el) el.textContent = prenom
  })
  // Refresh Profil panel data
  chargerProfilUI()
}

// ════════════════════════════════════════════
//  TAB 1 — AUJOURD'HUI
// ════════════════════════════════════════════

// ── Stars display ──
function afficherEtoiles(score) {
  var c = document.getElementById('starsContainer'); if (!c) return
  c.innerHTML = ''
  for (var i = 1; i <= 5; i++) {
    var s = document.createElement('span'); s.className = 'star'
    s.textContent = i <= Math.round(score / 2) ? '⭐' : '☆'
    c.appendChild(s)
  }
}

// ── Toggle meal card expand ──
function toggleInstructions(moment, event) {
  if (event) {
    var t = event.target
    if (t.closest && (t.closest('.recipe-actions') || t.closest('.stepper-btn') || t.closest('.recipe-stars') || t.closest('.save-recipe-btn'))) return
  }
  var el  = document.getElementById('instructions-' + moment)
  var btn = document.getElementById('btn-' + moment)
  if (!el) return
  var isOpen = el.classList.contains('open')
  el.classList.toggle('open', !isOpen)
  if (btn) btn.textContent = isOpen ? '▼' : '▲'
}

// ── Toggle routine item expand ──
function toggleRoutineItem(key) {
  var detail  = document.getElementById('detail-'   + key)
  var chevron = document.getElementById('chevron-'  + key)
  if (!detail) return
  var isOpen = detail.classList.contains('open')
  detail.classList.toggle('open',  !isOpen)
  if (chevron) chevron.classList.toggle('open', !isOpen)
}

// ── setText helper ──
function setText(id, val) { var e = document.getElementById(id); if (e) e.textContent = val }

// ── Build recipe actions bar HTML ──
function buildActionsBar(m) {
  return '<div class="recipe-actions" onclick="event.stopPropagation()">' +
    '<div class="servings-stepper">' +
      '<span class="servings-label">Portions</span>' +
      '<button class="stepper-btn" onclick="changerPortions(\'' + m + '\',-1)">&#8722;</button>' +
      '<span class="stepper-count" id="count-' + m + '">1</span>' +
      '<button class="stepper-btn" onclick="changerPortions(\'' + m + '\',1)">+</button>' +
    '</div>' +
    '<button class="save-recipe-btn" id="save-btn-' + m + '" onclick="sauvegarderRecette(\'' + m + '\')">✅ À faire</button>' +
  '</div>'
}

// ── Render instructions into a moment card ──
function renderInstructions(moment, recette) {
  var el = document.getElementById('instructions-' + moment); if (!el) return
  var ingHtml = '', stepsHtml = '', tipHtml = '', timingHtml = ''
  var instructions, ingredients, astuces, tempsPrep, tempsCuisson

  if (recette && recette.nom !== undefined) {
    instructions = recette.instructions    || []
    ingredients  = recette.ingredients    || []
    astuces      = recette.astuces        || []
    tempsPrep    = recette.temps_preparation
    tempsCuisson = recette.temps_cuisson
  } else {
    instructions = recette; ingredients = []; astuces = []
  }

  // Ingredients
  if (Array.isArray(ingredients) && ingredients.length) {
    var tags = ingredients.map(function(i) {
      if (typeof i === 'string') return '<span class="ingredient-tag">' + i + '</span>'
      var label = (i.quantite ? i.quantite + (i.unite ? i.unite + ' ' : ' ') : '') + (i.nom || '')
      return '<span class="ingredient-tag">' + label.trim() + '</span>'
    }).join('')
    ingHtml = '<div class="instructions-section-label">Ingrédients</div>' +
              '<div class="instructions-ingredients" id="ing-' + moment + '">' + tags + '</div>'
  }

  // Steps
  if (Array.isArray(instructions) && instructions.length) {
    stepsHtml = '<div class="instructions-section-label">Préparation</div><div class="instructions-steps">' +
      instructions.map(function(s, n) {
        return '<div class="instruction-step"><div class="step-num">' + (n+1) + '</div><div class="step-text">' + s + '</div></div>'
      }).join('') + '</div>'
  } else if (instructions && typeof instructions === 'object' && !Array.isArray(instructions) && instructions.steps) {
    // Legacy {steps, ingredients, tip} format
    if (instructions.ingredients && instructions.ingredients.length) {
      ingHtml = '<div class="instructions-section-label">Ingrédients</div>' +
                '<div class="instructions-ingredients" id="ing-' + moment + '">' +
                instructions.ingredients.map(function(i){return '<span class="ingredient-tag">'+i+'</span>'}).join('') + '</div>'
    }
    stepsHtml = '<div class="instructions-section-label">Préparation</div><div class="instructions-steps">' +
      instructions.steps.map(function(s,n){
        return '<div class="instruction-step"><div class="step-num">'+(n+1)+'</div><div class="step-text">'+s+'</div></div>'
      }).join('') + '</div>'
    if (instructions.tip) tipHtml = '<div class="instructions-tip"><strong>Astuce :</strong> ' + instructions.tip + '</div>'
  } else if (typeof instructions === 'string' && instructions.trim()) {
    var t = instructions.trim()
    var lines = t.indexOf('\n') >= 0 ? t.split('\n') : t.split('. ').map(function(s,i,a){return i<a.length-1?s+'.':s})
    var steps = lines.map(function(l){return l.replace(/^\d+[.)]\s*/,'').trim()}).filter(function(l){return l.length>10})
    stepsHtml = '<div class="instructions-section-label">Préparation</div><div class="instructions-steps">' +
      (steps.length >= 2 ? steps : [t]).map(function(s,n){
        return '<div class="instruction-step"><div class="step-num">'+(n+1)+'</div><div class="step-text">'+s+'</div></div>'
      }).join('') + '</div>'
  }

  // Tip from astuces array
  if (!tipHtml && Array.isArray(astuces) && astuces.length) {
    tipHtml = '<div class="instructions-tip"><strong>Astuce :</strong> ' + astuces[0] + '</div>'
  }

  // Timing chips
  if (tempsPrep || tempsCuisson) {
    var chips = ''
    if (tempsPrep)                   chips += '<span class="recipe-timing-chip">⏱ ' + tempsPrep + ' min prep</span>'
    if (tempsCuisson && tempsCuisson > 0) chips += '<span class="recipe-timing-chip">🔥 ' + tempsCuisson + ' min cuisson</span>'
    if (chips) timingHtml = '<div class="recipe-timing">' + chips + '</div>'
  }

  el.innerHTML = '<div class="instructions-content">' + ingHtml + timingHtml + stepsHtml + tipHtml + '</div>'
  var content = el.querySelector('.instructions-content')
  if (content) { var bar = document.createElement('div'); bar.innerHTML = buildActionsBar(moment); content.appendChild(bar.firstChild) }
  var ingEl = el.querySelector('.instructions-ingredients')
  if (ingEl) recipeBaseIng[moment] = ingEl.innerHTML
}

// ── Render routine detail panel ──
function renderRoutineDetail(key, data) {
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
  var raisonHtml = data.raison ? '<div class="routine-detail-raison">' + data.raison + '</div>' : ''
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

// ── Display plan ──
function afficherPlan(plan) {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  currentPlan = plan
  // Normalize keys (edge function may use different names)
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
    recipeServings[m] = 1
  })

  // Pause / après-midi card
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
    recipeServings['apres_midi'] = 1
  }

  // Routine section
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

  // Conseil
  var conseil = plan.conseil_du_jour || (plan.conseils_generaux && plan.conseils_generaux[0]) || ''
  if (conseil) setText('conseilText', conseil)

  // Allies highlight
  updateAlliesFromPlan(plan)

  // Feedback bar
  var fb = document.getElementById('feedbackBar')
  if (fb) {
    fb.style.display = 'flex'
    document.querySelectorAll('.feedback-star').forEach(function(s){ s.classList.remove('lit') })
    var sent = document.getElementById('feedbackSent'); if (sent) sent.classList.remove('show')
    var fstars = document.getElementById('feedbackStars'); if (fstars) fstars.style.display = 'flex'
  }

  afficherEvolution()
  afficherHistoriqueCompact()
}

// ── Highlight allies present in plan ──
function updateAlliesFromPlan(plan) {
  currentActiveAllies = []
  var keywords = {
    goji:'goji', curcuma:'curcuma', gingembre:'gingembre', myrtille:'myrtille',
    avocat:'avocat', banane:'banane', miel:'miel', amandes:'amande'
  }
  var allyNames = {
    goji:'Goji', curcuma:'Curcuma', gingembre:'Gingembre', myrtille:'Myrtille',
    avocat:'Avocat', banane:'Banane', miel:'Miel', amandes:'Amandes'
  }
  // Collect ingredient names from all meals including pause/collation
  var ingredientNames = []
  var mealKeys = ['matin', 'petit_dejeuner', 'midi', 'dejeuner', 'soir', 'diner', 'pause', 'collation', 'apres_midi']
  mealKeys.forEach(function(key) {
    var meal = plan[key]
    if (!meal) return
    var ings = meal.ingredients || []
    ings.forEach(function(ing) {
      var nom = (typeof ing === 'string' ? ing : (ing.nom || '')).toLowerCase()
      if (nom) ingredientNames.push(nom)
    })
  })
  // Strict word match: keyword must appear as an exact word in the ingredient name
  // Handles plurals (amande → amandes, épinard → épinards)
  // Multi-word keywords (patate douce) use substring match since they're unambiguous
  function matchesIngredient(nom, kw) {
    if (kw.includes(' ')) return nom.includes(kw)
    var words = nom.split(/[\s,\-()+]+/)
    return words.some(function(w) { return w === kw || w === kw + 's' || w === kw + 'x' })
  }
  var matched = Object.keys(keywords).filter(function(ally) {
    return ingredientNames.some(function(nom) { return matchesIngredient(nom, keywords[ally]) })
  })

  var isDefault = matched.length === 0
  // Only real matches count for modal "présent dans ton plan" badge
  currentActiveAllies = matched.slice()
  // If nothing matches → show 3 default allies with "hors plan" indicator
  var activeSet = isDefault ? ['goji', 'curcuma', 'gingembre'] : matched

  Object.keys(keywords).forEach(function(ally) {
    var el = document.getElementById('ally-' + ally)
    if (!el) return
    var chip = el.parentElement
    var inActive = activeSet.includes(ally)
    // Show only allies present in plan (or the 3 defaults when nothing matches)
    if (chip) chip.style.display = inActive ? '' : 'none'
    // Highlight only if truly present in the plan (not a default fallback)
    el.classList.toggle('active', matched.includes(ally))
    // Update chip label: add "hors plan" note on default allies
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

// ── Portions stepper ──
function changerPortions(m, delta) {
  recipeServings[m] = Math.max(1, Math.min(8, (recipeServings[m] || 1) + delta))
  var c = document.getElementById('count-' + m); if (c) c.textContent = recipeServings[m]
  var ingEl = document.querySelector('#instructions-' + m + ' .instructions-ingredients')
  if (ingEl && recipeBaseIng[m]) {
    var tmp = document.createElement('div'); tmp.innerHTML = recipeBaseIng[m]
    tmp.querySelectorAll('.ingredient-tag').forEach(function(tag) {
      tag.textContent = ajusterQuantite(tag.textContent, recipeServings[m])
    })
    ingEl.innerHTML = tmp.innerHTML
  }
}

function ajusterQuantite(text, portions) {
  return text.replace(/(\d+(?:[.,]\d+)?)\s*(g|kg|ml|cl|l|c\.a\.s|c\.a\.c|tbsp|tsp)/gi, function(_, num, unit) {
    return (Math.round(parseFloat(num.replace(',', '.')) * portions * 10) / 10) + ' ' + unit
  })
}

// ── Rate recipe stars ──
function noterRecette(m, note) {
  var c = document.getElementById('stars-' + m); if (!c) return
  c.querySelectorAll('.recipe-star').forEach(function(s, i) { s.classList.toggle('lit', i < note) })
  afficherToast('Note sauvegardée !')
}

// ── Save recipe locally + Supabase ──
function sauvegarderRecette(m) {
  if (!currentPlan || !currentPlan[m]) { afficherToast('Génère un plan d\'abord !'); return }
  var r     = currentPlan[m]
  var titre = r.nom || r.titre || ''
  if (savedRecipes.some(function(s){ return s.titre === titre && s.moment === m })) {
    afficherToast('Déjà sauvegardée !'); return
  }
  savedRecipes.push({ id: Date.now(), titre: titre, moment: m,
    ingredients: r.ingredients, steps: r.instructions,
    tip: r.astuces && r.astuces[0], note: 0 })
  localStorage.setItem('vitalia_saved_home', JSON.stringify(savedRecipes))
  var btn = document.getElementById('save-btn-' + m)
  if (btn) { btn.textContent = '✓ Ajoutée'; btn.classList.add('saved') }
  afficherToast('Recette ajoutée à faire ! ✅')
  sauvegarderRecetteSupabase(r, m)
}

async function sauvegarderRecetteSupabase(r, m) {
  if (!profil_id || profil_id === 'new') return
  try {
    await authFetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
                 'Authorization': 'Bearer ' + authToken, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ profil_id: profil_id, titre: r.nom || r.titre, moment: m,
        ingredients: r.ingredients, steps: r.instructions, tip: r.astuces && r.astuces[0] })
    })
  } catch(e) {}
}

// ── Rate entire plan ──
function noterPlan(note) {
  document.querySelectorAll('.feedback-star').forEach(function(s, i) { s.classList.toggle('lit', i < note) })
  var fstars = document.getElementById('feedbackStars'); if (fstars) fstars.style.display = 'none'
  var sent   = document.getElementById('feedbackSent');  if (sent)   sent.classList.add('show')
  // Sauvegarder la note en base
  if (profil_id && profil_id !== 'new') {
    authFetch(
      SUPABASE_URL + '/rest/v1/plans_generes_cache?profil_id=eq.' + profil_id + '&source=eq.journalier',
      { method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + authToken, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ note_satisfaction: note, feedback_le: new Date().toISOString() }) }
    ).catch(function() {})
  }
}

// ── Generate daily plan ──
async function genererPlan(forcer) {
  fermerConfig()
  if (forcer) {
    sessionStorage.removeItem('vitalia_plan_session_home')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  if (!profil_id || profil_id === 'new') { window.location.href = 'onboarding.html'; return }

  var ls = document.getElementById('loadingScreen')
  var ap = document.getElementById('app')
  if (ls) { ls.classList.remove('hidden'); ls.style.opacity = '1' }
  if (ap) ap.style.opacity = '0'

  try {
    var budgetMap = { faible: 8, moyen: 15, eleve: 25 }
    var body = {
      profil_id: profil_id,
      symptomes: selectedSymptoms,
      preferences_moment: {
        temps_max:  profilTempsCuisineCourant,
        budget_max: budgetMap[selectedBudget] || 25
      },
      force_regeneration: forcer === true,
      meme_theme: (document.getElementById('memeThemeToggle') || {}).checked || false
    }
    var res  = await authFetch(SUPABASE_URL + '/functions/v1/generer-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw new Error('Erreur serveur ' + res.status)
    var data = await res.json()
    if (data.success && data.plan) {
      afficherPlan(data.plan)
      verifierCheckinDuJour()
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
// SEMAINE TAB
// ══════════════════════════════════════════════════════

var semainePlanData = null
var semaineCheckedThisSession = false  // Ensure Supabase is checked once per session for cross-device sync

// Sync semaine chip UI from shared selectedSymptoms
function syncSemaineChips() {
  document.querySelectorAll('#semaineSymptomChips .chip').forEach(function(el) {
    var val = el.dataset.val
    el.classList.toggle('selected', selectedSymptoms.includes(val))
  })
  updateObjectifPrincipalBadge()
}

// Toggle symptom from Semaine tab (mirrors config panel)
function toggleSemaineSymptom(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!selectedSymptoms.includes(val)) selectedSymptoms.push(val)
  } else {
    selectedSymptoms = selectedSymptoms.filter(function(v) { return v !== val })
  }
  // Keep config panel chips in sync
  document.querySelectorAll('#symptomsChips .chip').forEach(function(c) {
    var m = c.getAttribute('onclick') && c.getAttribute('onclick').match(/'(\w+)'\)/)
    if (m && m[1] === val) c.classList.toggle('selected', selectedSymptoms.includes(val))
  })
  updateObjectifPrincipalBadge()
}

// Toggle a day card open/close
function toggleDay(jour) {
  var meals   = document.getElementById('day-meals-'   + jour)
  var chevron = document.getElementById('day-chevron-' + jour)
  if (!meals) return
  var isOpen = meals.classList.contains('open')
  meals.classList.toggle('open',   !isOpen)
  if (chevron) chevron.classList.toggle('open', !isOpen)
  if (!isOpen) semaineJourOuvert = jour
}

// Toggle an individual meal's detail
function toggleDayMeal(jour, meal) {
  var detail = document.getElementById('day-detail-' + jour + '_' + meal)
  if (detail) detail.classList.toggle('open')
}

// Generate 7-day plan
async function genererSemaine(forcer) {
  if (!profil_id) { afficherToast('Profil non trouvé'); return }
  if (forcer) window.scrollTo({ top: 0, behavior: 'smooth' })
  // Silent mode = background refresh when data already displayed (for cross-device sync)
  var silentMode   = !forcer && semainePlanData !== null
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

  // Afficher et animer la barre de progression (sauf en mode silencieux)
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
    if (progressFill) { progressFill.style.width = '0%' }
    if (progressText) { progressText.textContent = 'Analyse du profil…' }
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
    setTimeout(function() {
      if (progressCont) progressCont.style.display = 'none'
    }, 800)
  }
  function cacherProgressErreur() {
    if (silentMode) return
    progressTimers.forEach(clearTimeout)
    if (progressCont) progressCont.style.display = 'none'
  }

  try {
    var resp = await authFetch(SUPABASE_URL + '/functions/v1/generer-plan-semaine', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ profil_id: profil_id, symptomes: selectedSymptoms, force_refresh: forcer === true, repas_inclus: semaineRepasInclus }),
    })
    var data = await resp.json()
    if (data.success && data.semaine) {
      semainePlanData = data
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


// State for semaine meal interactions
var semaineServings  = {}
var semaineBaseIng   = {}
var semaineRatings   = {}
var semaineSelected  = {}
var semaineJourOuvert = 'lundi'  // track which day is currently open

// State for saved recipes selection (shopping list)
var savedSelected = {}   // { idx: true/false }
var savedServings = {}   // { idx: number }
var coursesChecked    = {}  // { idx: true/false } — état checkboxes modale courses
var _coursesIngredients = []  // référence des ingrédients courants de la modale

// Render 7-day accordion (with portions, rating, save, shopping list, wellness)
function afficherSemaine(data) {
  var JOURS  = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche']
  var LABELS = { lundi:'Lundi', mardi:'Mardi', mercredi:'Mercredi', jeudi:'Jeudi',
                 vendredi:'Vendredi', samedi:'Samedi', dimanche:'Dimanche' }
  var MEALS  = [
    { key:'petit_dejeuner', label:'Petit-déjeuner', emoji:'🌅' },
    { key:'dejeuner',       label:'Déjeuner',       emoji:'☀️' },
    { key:'pause',          label:'Collation',      emoji:'🍎' },
    { key:'diner',          label:'Dîner',          emoji:'🌙' },
  ]

  // Reset interaction state
  semaineServings = {}; semaineBaseIng = {}; semaineRatings = {}; semaineSelected = {}

  // Motivation banner (message seulement — conseil affiché en bas)
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
      var recette = day[m.key]
      if (!recette) return
      var id         = jour + '_' + m.key
      var nv         = recette.valeurs_nutritionnelles || {}
      var cal        = nv.calories ? nv.calories + ' kcal' : ''
      var isFallback = recette.genere_par_llm === false

      // Store base state
      semaineServings[id] = 2
      semaineBaseIng[id]  = (recette.ingredients || []).map(function(i) { return Object.assign({}, i) })
      semaineRatings[id]  = 0

      html += '<div class="day-meal">'

      // Header — click expands detail
      html += '<div class="day-meal-header" onclick="toggleDayMeal(\'' + jour + '\',\'' + m.key + '\')" style="cursor:pointer;">'
      html += '  <div style="flex:1;min-width:0;">'
      var dotColor = m.key === 'petit_dejeuner' ? '#F5A623' : m.key === 'dejeuner' ? '#7A9E7E' : m.key === 'diner' ? 'rgba(45,31,20,0.7)' : '#A8C5AC'
      html += '    <div class="day-meal-type"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dotColor + ';margin-right:5px;vertical-align:middle;flex-shrink:0;"></span>' + m.emoji + ' ' + m.label + '</div>'
      html += '    <div class="day-meal-name" id="meal-name-' + id + '">' + (recette.nom || '—') + (isFallback ? ' <span style="font-size:11px;opacity:0.5;">⏳</span>' : '') + '</div>'
      html += '  </div>'
      if (cal) html += '  <div class="day-meal-cal">' + cal + '</div>'
      html += '</div>'

      // Collapsible detail
      html += '<div class="day-meal-detail" id="day-detail-' + id + '" onclick="event.stopPropagation()">'
      html += '<div class="day-meal-inner">'

      // (fallback warning removed — auto-regen triggered after render)

      // Timing chips
      var tPrep = recette.temps_preparation || 0
      var tCook = recette.temps_cuisson || 0
      if (tPrep > 0 || tCook > 0) {
        html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">'
        if (tPrep > 0) html += '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(196,113,74,0.08);border:1px solid rgba(196,113,74,0.18);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--terracotta);font-weight:500;">⏱ ' + tPrep + ' min prép.</span>'
        if (tCook > 0) html += '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(232,184,75,0.1);border:1px solid rgba(232,184,75,0.25);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--mid-brown);font-weight:500;">🔥 ' + tCook + ' min cuisson</span>'
        html += '</div>'
      }

      // Ingredients (scaled dynamically)
      if (recette.ingredients && recette.ingredients.length) {
        html += '<div class="day-meal-ingredients" id="ing-' + id + '">'
        recette.ingredients.forEach(function(ing) {
          var lbl = ing.nom + (ing.quantite ? ' ' + ing.quantite + '\u202f' + (ing.unite || 'g') : '')
          html += '<span class="day-meal-tag">' + lbl + '</span>'
        })
        html += '</div>'
      }

      // Steps — lazy-loaded on demand
      var stepsId = 'steps-' + id
      if (recette.instructions && recette.instructions.length) {
        // Fallback recipes already have hardcoded steps — show directly
        html += '<div class="day-meal-steps" id="' + stepsId + '" style="margin-top:10px;">'
        recette.instructions.forEach(function(step, i) {
          html += '<div class="day-meal-step"><div class="day-meal-stepnum">' + (i+1) + '</div><div>' + step + '</div></div>'
        })
        html += '</div>'
      } else {
        // LLM-generated recipes: load steps on demand
        html += '<div id="' + stepsId + '" style="margin-top:10px;"></div>'
        html += '<button id="steps-btn-' + id + '" class="steps-load-btn" onclick="chargerEtapesRecette(\'' + jour + '\',\'' + m.key + '\',\'' + id + '\');event.stopPropagation();">📖 Voir les étapes de préparation</button>'
      }

      // Tip
      var tip = recette.astuces && recette.astuces[0]
      if (tip) html += '<div class="day-meal-tip" style="margin-top:8px;">💡 ' + tip + '</div>'

      // Action bar
      html += '<div class="semaine-meal-actions">'

      // Portions stepper (not for snack)
      if (m.key !== 'pause') {
        html += '<div class="stepper-mini">'
        html += '<button onclick="changerPortionsSemaine(\'' + id + '\',-1);event.stopPropagation();">−</button>'
        html += '<span id="portions-' + id + '">2 pers.</span>'
        html += '<button onclick="changerPortionsSemaine(\'' + id + '\',1);event.stopPropagation();">+</button>'
        html += '</div>'
      }

      // Save
      html += '<button class="save-mini" onclick="sauvegarderRecetteSemaine(\'' + id + '\');event.stopPropagation();">✅ À faire</button>'

      html += '</div>'  // semaine-meal-actions
      html += '</div></div>'  // day-meal-inner + day-meal-detail
      html += '</div>'  // day-meal
    })

    html += '</div></div>'  // day-meals + day-card
  })

  var cards = document.getElementById('dayCards')
  var empty = document.getElementById('semaineEmpty')
  if (cards) { cards.innerHTML = html; cards.style.display = 'flex' }
  if (empty) empty.style.display = 'none'

  // Render conseil de la semaine
  var conseilEl = document.getElementById('semaineConseil')
  if (conseilEl) {
    var conseil = data.conseil_du_jour || (data.semaine && Object.values(data.semaine)[0] && Object.values(data.semaine)[0].conseil)
    if (conseil) {
      conseilEl.style.display = 'block'
      conseilEl.innerHTML = '<div class="conseil-card">' +
        '<div class="conseil-title">💡 Conseil de la semaine</div>' +
        '<div class="conseil-text">' + conseil + '</div>' +
        '</div>'
    } else {
      conseilEl.style.display = 'none'
    }
  }

  // Render wellness section
  renderWellnessSemaine(data)

  // Reset courses bar
  afficherBoutonListeCourses()

  // Jour courant de la semaine
  var JOURS_IDX = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi']
  var jourAujourdhui = JOURS_IDX[new Date().getDay()]
  // Vérifier que le jour existe dans le plan (peut être absent si plan partiel)
  var jourCible = (data.semaine && data.semaine[jourAujourdhui]) ? jourAujourdhui : 'lundi'

  // Auto-open (only on first render, not on regen refresh)
  if (!data._regenRefresh) {
    semaineJourOuvert = jourCible
    toggleDay(jourCible)
    // Auto-regenerate fallback recipes silently
    autoRegenFallbacks(data)
  } else {
    toggleDay(semaineJourOuvert)
  }

  // Si on est déjà sur l'onglet semaine, scroller vers le jour courant
  if (currentTab === 'semaine' && !data._regenRefresh) {
    setTimeout(function() {
      var el = document.getElementById('day-card-' + jourCible)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 200)
  }
}

// ── Lazy-load recipe steps from generer-recette-details ──
async function chargerEtapesRecette(jour, mealKey, id) {
  var btn = document.getElementById('steps-btn-' + id)
  var stepsDiv = document.getElementById('steps-' + id)
  if (!stepsDiv) return

  // Show loading state
  if (btn) btn.style.display = 'none'
  stepsDiv.innerHTML = '<div class="steps-loading">⏳ Génération des étapes...</div>'

  // Get recipe data from semainePlanData
  var recette = semainePlanData && semainePlanData.semaine && semainePlanData.semaine[jour] && semainePlanData.semaine[jour][mealKey]
  if (!recette) {
    stepsDiv.innerHTML = ''
    if (btn) btn.style.display = ''
    return
  }

  var typeRepas = { petit_dejeuner:'petit-dejeuner', dejeuner:'dejeuner', diner:'diner', pause:'collation' }[mealKey] || mealKey

  try {
    var resp = await authFetch(SUPABASE_URL + '/functions/v1/generer-recette-details', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + authToken },
      body: JSON.stringify({
        recette_nom: recette.nom || recette.titre,
        ingredients: recette.ingredients || [],
        type_repas:  typeRepas,
        macros:      recette.macros,
        symptomes:   selectedSymptoms || [],
      })
    })
    var data = await resp.json()
    if (data.success && Array.isArray(data.instructions) && data.instructions.length) {
      // Cache steps back into semainePlanData
      recette.instructions = data.instructions
      if (data.astuces) recette.astuces = data.astuces
      try { localStorage.setItem('vitalia_semaine_session', JSON.stringify(semainePlanData)) } catch(e) {}
      // Sync steps to Supabase so other devices get them without regenerating
      if (profil_id && profil_id !== 'new') {
        fetch(SUPABASE_URL + '/rest/v1/plans_generes_cache?profil_id=eq.' + profil_id + '&source=eq.semaine', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
                     'Authorization': 'Bearer ' + authToken, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ plan_json: semainePlanData })
        }).catch(function() {})
      }

      // Render steps
      var html = '<div class="day-meal-steps">'
      data.instructions.forEach(function(step, i) {
        html += '<div class="day-meal-step"><div class="day-meal-stepnum">' + (i+1) + '</div><div>' + step + '</div></div>'
      })
      html += '</div>'
      if (data.astuces && data.astuces[0]) {
        html += '<div class="day-meal-tip" style="margin-top:8px;">💡 ' + data.astuces[0] + '</div>'
      }
      stepsDiv.innerHTML = html
    } else {
      stepsDiv.innerHTML = ''
      if (btn) { btn.style.display = ''; btn.textContent = '⚠️ Réessayer les étapes' }
    }
  } catch(e) {
    stepsDiv.innerHTML = ''
    if (btn) { btn.style.display = ''; btn.textContent = '⚠️ Réessayer les étapes' }
  }
}

// Auto-regenerate all fallback recipes silently after first render
async function autoRegenFallbacks(data) {
  var JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche']
  var MEAL_TYPES = {
    petit_dejeuner: 'petit-dejeuner',
    dejeuner:       'dejeuner',
    diner:          'diner',
    // pause exclue : collation statique, étapes chargées à la demande
  }

  // Collect all fallback slots
  var fallbacks = []
  JOURS.forEach(function(jour) {
    Object.keys(MEAL_TYPES).forEach(function(mealKey) {
      var r = data.semaine && data.semaine[jour] && data.semaine[jour][mealKey]
      if (r && r.genere_par_llm === false) {
        fallbacks.push({ jour: jour, mealKey: mealKey, typeRepas: MEAL_TYPES[mealKey] })
      }
    })
  })

  if (!fallbacks.length) return

  // Process in batches of 3 to avoid rate limiting
  for (var bi = 0; bi < fallbacks.length; bi += 3) {
    var batch = fallbacks.slice(bi, bi + 3)
    await Promise.all(batch.map(async function(f) {
      try {
        var resp = await authFetch(SUPABASE_URL + '/functions/v1/generer-recette-unique', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + authToken, 'apikey': SUPABASE_ANON_KEY },
          body: JSON.stringify({ profil_id: profil_id, type_repas: f.typeRepas, ingredients_frigo: [], symptomes: selectedSymptoms }),
        })
        var d = await resp.json()
        if (d.success && d.recette && semainePlanData && semainePlanData.semaine && semainePlanData.semaine[f.jour]) {
          semainePlanData.semaine[f.jour][f.mealKey] = d.recette
        }
      } catch(e) {}
    }))
    // Small pause between batches
    if (bi + 3 < fallbacks.length) await new Promise(function(r) { setTimeout(r, 500) })
  }

  // Persist updated plan so fallback replacements survive page reload
  try { localStorage.setItem('vitalia_semaine_session', JSON.stringify(semainePlanData)) } catch(e) {}
  if (profil_id && profil_id !== 'new') {
    fetch(SUPABASE_URL + '/rest/v1/plans_generes_cache?profil_id=eq.' + profil_id + '&source=eq.semaine', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
                 'Authorization': 'Bearer ' + authToken, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ plan_json: semainePlanData })
    }).catch(function() {})
  }

  // Re-render once all done, restoring the open day
  semainePlanData._regenRefresh = true
  afficherSemaine(semainePlanData)
  semainePlanData._regenRefresh = false
}

// Render nutraceutique + routine at bottom of weekly plan
function renderWellnessSemaine(data) {
  var container = document.getElementById('semaineWellness')
  if (!container) return
  var html = ''

  // Motivation section label
  html += '<div style="font-family:\'Fraunces\',serif;font-size:17px;font-weight:700;color:var(--deep-brown);padding:0 0 4px;">Conseils de la semaine</div>'

  // Nutraceutique
  var nutra = data.nutraceutiques && data.nutraceutiques[0]
  if (nutra) {
    html += '<div class="wellness-card">'
    html += '<div class="wellness-card-type">💊 Nutraceutique de la semaine</div>'
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

  // Aromathérapie
  var aroma = data.aromatherapie && data.aromatherapie[0]
  if (aroma) {
    html += '<div class="wellness-card">'
    html += '<div class="wellness-card-type">🌸 Aromathérapie de la semaine</div>'
    html += '<div class="wellness-card-name">' + (aroma.nom || aroma.name || 'Huile essentielle') + '</div>'
    var aromaDesc = aroma.description || aroma.bienfaits || ''
    if (aromaDesc) html += '<div class="wellness-card-body">' + String(aromaDesc).substring(0, 200) + '</div>'
    var aromaTip = Array.isArray(aroma.astuces) ? aroma.astuces[0] : (aroma.tip || aroma.utilisation || '')
    if (aromaTip) html += '<div class="wellness-card-tip">💡 ' + aromaTip + '</div>'
    html += '</div>'
  }

  // Routine
  var routine = data.routines && data.routines[0]
  if (routine) {
    html += '<div class="wellness-card">'
    html += '<div class="wellness-card-type">🧘 Routine de la semaine</div>'
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

// ── Semaine: portions scaling ──
function changerPortionsSemaine(id, delta) {
  var p = Math.max(1, Math.min(8, (semaineServings[id] || 2) + delta))
  semaineServings[id] = p
  var ratio = p / 2
  var ingEl = document.getElementById('ing-' + id)
  if (ingEl && semaineBaseIng[id]) {
    ingEl.innerHTML = semaineBaseIng[id].map(function(ing) {
      var q   = ing.quantite ? Math.round(ing.quantite * ratio) : null
      var lbl = ing.nom + (q ? ' ' + q + '\u202f' + (ing.unite || 'g') : '')
      return '<span class="day-meal-tag">' + lbl + '</span>'
    }).join('')
  }
  var pEl = document.getElementById('portions-' + id)
  if (pEl) pEl.textContent = p + ' pers.'
}

// ── Semaine: star rating ──
function noterRecetteSemaine(id, note) {
  semaineRatings[id] = note
  var starsEl = document.getElementById('stars-' + id)
  if (starsEl) {
    Array.from(starsEl.children).forEach(function(s, i) { s.textContent = i < note ? '⭐' : '☆' })
  }
}

// ── Semaine: save recipe ──
function sauvegarderRecetteSemaine(id) {
  var parts   = id.split('_')
  var jour    = parts[0]
  var mealKey = parts.slice(1).join('_')
  var recette = semainePlanData && semainePlanData.semaine && semainePlanData.semaine[jour] && semainePlanData.semaine[jour][mealKey]
  if (!recette) return
  var entry = Object.assign({}, recette, { id:'recette_' + Date.now(), saved_at: new Date().toISOString(), note: semaineRatings[id] || 0 })
  try {
    var saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]')
    saved.unshift(entry)
    localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved.slice(0,50)))
  } catch(e) {}
  if (profil_id && profil_id !== 'new') {
    fetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'apikey':SUPABASE_ANON_KEY, 'Authorization':'Bearer ' + authToken },
      body: JSON.stringify({ profil_id:profil_id, titre:recette.nom||recette.titre, moment:mealKey,
      ingredients:recette.ingredients||[], steps:recette.instructions||[], tip:(recette.astuces&&recette.astuces[0])||'',
      ...(semaineRatings[id] ? { note: semaineRatings[id] } : {}) }),
    }).catch(function() {})
  }
  afficherToast('Recette sauvegardée ! 💚')
}

// ── Semaine: shopping list selection ──
function toggleSelectRecetteSemaine(id) {
  semaineSelected[id] = !semaineSelected[id]
  var btn = document.getElementById('select-btn-' + id)
  if (btn) {
    btn.classList.toggle('selected', !!semaineSelected[id])
    btn.textContent = semaineSelected[id] ? '✓ Sélectionné' : '🛒 Sélectionner'
  }
  afficherBoutonListeCourses()
}

function afficherBoutonListeCourses() {
  var countSemaine = Object.values(semaineSelected).filter(Boolean).length
  var countSaved   = Object.values(savedSelected).filter(Boolean).length
  var count = countSemaine + countSaved
  // Auto-save list so À faire > Courses reflects current selection
  if (count > 0) {
    var liste    = aggregerIngredients()
    var recettes = construireListeRecettes()
    // Preserve manually added items
    var existingRaw = null
    try { existingRaw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
    var manuels = existingRaw ? (existingRaw.ingredients || []).filter(function(i) { return i.manuel }) : []
    try { localStorage.setItem('vitalia_liste_courses', JSON.stringify({ date: new Date().toISOString(), ingredients: liste.concat(manuels), recettes: recettes })) } catch(e) {}
    sauvegarderListeCoursesSupabase()
  }
  // Refresh profil tab shopping list in real-time if it is visible
  afficherListeCoursesProfile()
}

// Build the array of selected recipes with their base ingredients (used for portions recalculation)
function construireListeRecettes() {
  var result = []
  var MEAL_LABEL = { petit_dejeuner: 'Petit-déj.', dejeuner: 'Déjeuner', diner: 'Dîner', pause: 'Collation' }
  var JOUR_LABEL = { lundi:'Lun.', mardi:'Mar.', mercredi:'Mer.', jeudi:'Jeu.', vendredi:'Ven.', samedi:'Sam.', dimanche:'Dim.' }

  Object.keys(semaineSelected).forEach(function(id) {
    if (!semaineSelected[id]) return
    var parts   = id.split('_'), jour = parts[0], mealKey = parts.slice(1).join('_')
    var recette = semainePlanData && semainePlanData.semaine && semainePlanData.semaine[jour] && semainePlanData.semaine[jour][mealKey]
    if (!recette) return
    result.push({
      type: 'semaine', id: id,
      nom: recette.nom || ((MEAL_LABEL[mealKey] || mealKey) + ' ' + (JOUR_LABEL[jour] || jour)),
      portions: semaineServings[id] || 2,
      basePortions: 2,
      ingredients: recette.ingredients || []
    })
  })

  var savedList = []
  try { savedList = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  Object.keys(savedSelected).forEach(function(idx) {
    if (!savedSelected[idx]) return
    var recette = savedList[parseInt(idx)]
    if (!recette) return
    result.push({
      type: 'saved', id: parseInt(idx),
      nom: recette.nom || 'Recette sauvegardée',
      portions: savedServings[parseInt(idx)] || 2,
      basePortions: recette.portions || 2,
      ingredients: recette.ingredients || []
    })
  })
  return result
}

// Re-aggregate ingredients from stored recipe list (works without in-memory plan data)
function reagregerDepuisRecettes(recettes) {
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

// Aggregate ingredients from selected recipes (semaine + saved)
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

  // Recettes du plan semaine
  Object.keys(semaineSelected).forEach(function(id) {
    if (!semaineSelected[id]) return
    var parts   = id.split('_'), jour = parts[0], mealKey = parts.slice(1).join('_')
    var recette = semainePlanData && semainePlanData.semaine && semainePlanData.semaine[jour] && semainePlanData.semaine[jour][mealKey]
    if (!recette || !recette.ingredients) return
    var ratio = (semaineServings[id] || 2) / 2
    ajouterIngredients(recette.ingredients, ratio)
  })

  // Recettes sauvegardées sélectionnées
  var savedList = []
  try { savedList = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  Object.keys(savedSelected).forEach(function(idx) {
    if (!savedSelected[idx]) return
    var recette = savedList[parseInt(idx)]
    if (!recette || !recette.ingredients) return
    var portions = recette.portions || 2
    var ratio = (savedServings[parseInt(idx)] || 2) / Math.max(portions, 1)
    ajouterIngredients(recette.ingredients, ratio)
  })

  return Object.values(map).sort(function(a, b) { return a.nom.localeCompare(b.nom) })
}

function afficherListeCourses() {
  coursesChecked    = {}
  _coursesIngredients = aggregerIngredients()
  var ingredients   = _coursesIngredients

  // Auto-save the list to localStorage so it persists in À faire > Courses
  if (ingredients.length) {
    localStorage.setItem('vitalia_liste_courses', JSON.stringify({ date: new Date().toISOString(), ingredients: ingredients }))
    afficherListeCoursesProfile()
  }

  // Restore checked state from localStorage (shared with the profile list)
  try { var vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}')
    ingredients.forEach(function(ing, idx) { if (vu[ing.nom]) coursesChecked[idx] = true })
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
      var done = !!coursesChecked[idx]
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

function toggleCoursesModalItem(idx) {
  var ing = _coursesIngredients[idx]
  if (!ing) return
  coursesChecked[idx] = !coursesChecked[idx]
  var done = !!coursesChecked[idx]

  var el = document.getElementById('courses-item-' + idx)
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

  // Persist checked state to localStorage (shared with profile list)
  var vu = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  vu[ing.nom] = done
  if (!done) delete vu[ing.nom]
  localStorage.setItem('vitalia_courses_vu', JSON.stringify(vu))
}

function fermerListeCourses() {
  var modal = document.getElementById('coursesModal')
  if (modal) modal.remove()
}

function sauvegarderListeCourses() {
  var liste    = aggregerIngredients()
  var recettes = construireListeRecettes()
  // Preserve manually added items
  var existingRaw = null
  try { existingRaw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  var manuels = existingRaw ? (existingRaw.ingredients || []).filter(function(i) { return i.manuel }) : []
  localStorage.setItem('vitalia_liste_courses', JSON.stringify({ date: new Date().toISOString(), ingredients: liste.concat(manuels), recettes: recettes }))
  afficherToast('Liste sauvegardée dans le profil !')
  fermerListeCourses()
  afficherListeCoursesProfile()
}

// Regenerate a fallback recipe for a specific slot
async function genererRecettePourRepas(jour, mealKey, typeRepas) {
  var id  = jour + '_' + mealKey
  var btn = document.getElementById('regen-btn-' + id)
  if (btn) { btn.disabled = true; btn.textContent = '⏳…' }
  try {
    var resp = await authFetch(SUPABASE_URL + '/functions/v1/generer-recette-unique', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + authToken, 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ profil_id:profil_id, type_repas:typeRepas, ingredients_frigo:[], symptomes:selectedSymptoms }),
    })
    if (!resp.ok) {
      if (resp.status !== 401) afficherToast('Erreur serveur ' + resp.status)
      if (btn) { btn.disabled = false; btn.textContent = '✨ Regénérer' }
      return
    }
    var data = await resp.json()
    if (data.success && data.recette && semainePlanData && semainePlanData.semaine && semainePlanData.semaine[jour]) {
      semainePlanData.semaine[jour][mealKey] = data.recette
      afficherSemaine(semainePlanData)
      try { localStorage.setItem('vitalia_semaine_session', JSON.stringify(semainePlanData)) } catch(e) {}
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

// ══════════════════════════════════════════════════════
// RECETTE TAB
// ══════════════════════════════════════════════════════

var recetteIngredientsFrigo  = []
var recetteTypeRepas         = 'dejeuner'
function toggleRepasInclus(el, val) {
  if (semaineRepasInclus.includes(val)) {
    // Ne pas désélectionner si c'est le dernier
    if (semaineRepasInclus.length <= 1) { afficherToast('Sélectionne au moins un repas.'); return }
    semaineRepasInclus = semaineRepasInclus.filter(function(v) { return v !== val })
    el.classList.remove('selected')
  } else {
    semaineRepasInclus.push(val)
    el.classList.add('selected')
  }
}

var recetteSelectedSymptoms  = ['vitalite', 'serenite']
var recetteCourante          = null

function selectTypeRepas(el, val) {
  recetteTypeRepas = val
  document.querySelectorAll('#recetteTypeChips .chip').forEach(function(c) { c.classList.remove('selected') })
  el.classList.add('selected')
}

function toggleRecetteSymptom(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!recetteSelectedSymptoms.includes(val)) recetteSelectedSymptoms.push(val)
  } else {
    recetteSelectedSymptoms = recetteSelectedSymptoms.filter(function(v) { return v !== val })
  }
}

function ajouterIngredientFrigo() {
  var input = document.getElementById('frigoInput')
  if (!input) return
  var val = input.value.trim()
  if (!val || recetteIngredientsFrigo.includes(val)) { input.value = ''; return }
  recetteIngredientsFrigo.push(val)
  input.value = ''
  renderFrigoChips()
}

function supprimerIngredientFrigo(ing) {
  recetteIngredientsFrigo = recetteIngredientsFrigo.filter(function(v) { return v !== ing })
  renderFrigoChips()
}

function renderFrigoChips() {
  var container = document.getElementById('frigoChips')
  if (!container) return
  container.innerHTML = recetteIngredientsFrigo.map(function(ing) {
    var safeIng = ing.replace(/\\/g,'\\\\').replace(/'/g,"\\'")
    return '<span class="chip selected" style="cursor:default;">' + ing +
           ' <button onclick="supprimerIngredientFrigo(\'' + safeIng + '\')"' +
           ' style="background:none;border:none;color:white;cursor:pointer;font-size:14px;margin-left:4px;padding:0;line-height:1;vertical-align:middle;">×</button></span>'
  }).join('')
}

async function genererRecetteUnique() {
  if (!profil_id) { afficherToast('Profil non trouvé'); return }
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + authToken,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        profil_id:          profil_id,
        type_repas:         recetteTypeRepas,
        ingredients_frigo:  recetteIngredientsFrigo,
        symptomes:          recetteSelectedSymptoms,
        directive_chef:     (document.getElementById('directiveChefInput') || {}).value || '',
      }),
    })
    if (!resp.ok) {
      var errData = {}
      try { errData = await resp.json() } catch(_) {}
      console.error('[genererRecetteUnique]', resp.status, errData)
      if (resp.status !== 401) afficherToast('Erreur serveur ' + resp.status + ' – réessaie dans un instant')
      return
    }
    var data = await resp.json()
    if (data.success && data.recette) {
      recetteCourante = data.recette
      afficherRecetteUnique(data.recette)
      try { localStorage.setItem('vitalia_recette_session', JSON.stringify({ recette: data.recette, type: recetteTypeRepas })) } catch(e) {}
    } else {
      afficherToast('Erreur lors de la génération')
    }
  } catch(err) {
    afficherToast('Erreur réseau : ' + err.message)
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

function afficherRecetteUnique(recette) {
  var typeLabels = {
    'petit-dejeuner':  'Petit-déjeuner',
    'dejeuner':        'Déjeuner',
    'collation':       'Collation',
    'diner':           'Dîner',
    'patisserie':      'Pâtisserie',
  }
  var typeLabel = typeLabels[recetteTypeRepas] || recetteTypeRepas
  var nv = recette.valeurs_nutritionnelles || {}

  var html = '<div class="recette-card">'

  // Illustrated SVG header
  html += '<div class="recette-card-header" style="position:relative;height:160px;overflow:hidden;">'
  html += getMealIllustration(recetteTypeRepas)
  html += '<div style="position:absolute;bottom:0;left:0;right:0;padding:14px 18px 12px;background:linear-gradient(to top,rgba(30,15,5,0.65) 0%,transparent 100%);">'
  html += '  <div class="recette-card-type">' + typeLabel + '</div>'
  html += '  <div class="recette-card-name">' + (recette.nom || 'Recette') + '</div>'
  html += '  <div class="recette-card-meta">'
  if (recette.temps_preparation) html += '<span class="recette-meta-chip">⏱ ' + recette.temps_preparation + ' min</span>'
  if (recette.temps_cuisson > 0) html += '<span class="recette-meta-chip">🔥 ' + recette.temps_cuisson + ' min cuisson</span>'
  if (recette.portions)          html += '<span class="recette-meta-chip">🍽 ' + recette.portions + ' pers.</span>'
  html += '  </div>'
  html += '</div>'
  html += '</div>'

  html += '<div class="recette-card-body">'

  // Nutrition
  if (nv.calories) {
    html += '<div><div class="recette-section-label">Valeurs nutritionnelles</div>'
    html += '<div class="recette-nutrition">'
    html += '<div class="recette-nutri-box"><div class="recette-nutri-val">' + (nv.calories||'—') + '</div><div class="recette-nutri-lbl">kcal</div></div>'
    html += '<div class="recette-nutri-box"><div class="recette-nutri-val">' + (nv.proteines||'—') + 'g</div><div class="recette-nutri-lbl">Protéines</div></div>'
    html += '<div class="recette-nutri-box"><div class="recette-nutri-val">' + (nv.glucides||'—') + 'g</div><div class="recette-nutri-lbl">Glucides</div></div>'
    html += '<div class="recette-nutri-box"><div class="recette-nutri-val">' + (nv.lipides||'—') + 'g</div><div class="recette-nutri-lbl">Lipides</div></div>'
    html += '</div></div>'
  }

  // Ingredients
  if (recette.ingredients && recette.ingredients.length) {
    html += '<div><div class="recette-section-label">Ingrédients</div>'
    html += '<div class="recette-ingredients">'
    recette.ingredients.forEach(function(ing) {
      var lbl = ing.nom + (ing.quantite ? ' · ' + ing.quantite + '\u202f' + (ing.unite || 'g') : '')
      html += '<span class="recette-ing-tag">' + lbl + '</span>'
    })
    html += '</div></div>'
  }

  // Instructions
  if (recette.instructions && recette.instructions.length) {
    html += '<div><div class="recette-section-label">Préparation</div>'
    html += '<div class="recette-steps">'
    recette.instructions.forEach(function(step, i) {
      html += '<div class="recette-step">'
      html += '  <div class="recette-stepnum">' + (i+1) + '</div>'
      html += '  <div class="recette-step-text">' + step + '</div>'
      html += '</div>'
    })
    html += '</div></div>'
  }

  // Tip
  var tip = recette.astuces && recette.astuces[0]
  if (tip) html += '<div class="recette-tip">💡 ' + tip + '</div>'

  // Variantes
  if (recette.variantes && recette.variantes.length) {
    html += '<div><div class="recette-section-label">Variantes</div>'
    html += '<div class="recette-variantes">'
    recette.variantes.forEach(function(v) { html += '<div class="recette-variante">' + v + '</div>' })
    html += '</div></div>'
  }

  // Save button
  html += '<button onclick="sauvegarderRecetteUnique()"'
  html += ' style="width:100%;background:var(--sage);color:white;border:none;border-radius:16px;padding:14px;'
  html += ' font-family:\'DM Sans\',sans-serif;font-size:15px;font-weight:600;cursor:pointer;margin-top:4px;">'
  html += '✅ Ajouter à faire</button>'

  html += '</div></div>'  // card-body + card

  var resultEl = document.getElementById('recetteResult')
  var emptyEl  = document.getElementById('recetteEmpty')
  if (resultEl) { resultEl.innerHTML = html; resultEl.style.display = 'block' }
  if (emptyEl)  emptyEl.style.display = 'none'
}

async function sauvegarderRecetteUnique() {
  if (!recetteCourante) return
  // localStorage
  try {
    var saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]')
    var entry = Object.assign({}, recetteCourante, {
      id: 'recette_' + Date.now(),
      saved_at: new Date().toISOString(),
      note: 0,
    })
    saved.unshift(entry)
    localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved.slice(0,50)))
  } catch(e) {}
  // Supabase
  if (profil_id && profil_id !== 'new') {
    try {
      await authFetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + authToken,
        },
        body: JSON.stringify({
          profil_id:   profil_id,
          titre:       recetteCourante.nom || recetteCourante.titre || '',
          moment:      recetteTypeRepas,
          ingredients: recetteCourante.ingredients || [],
          steps:       recetteCourante.instructions || [],
          tip:         (recetteCourante.astuces && recetteCourante.astuces[0]) || '',
        }),
      })
    } catch(e) {}
  }
  afficherToast('Recette sauvegardée ! 💚')
}

// ══════════════════════════════════════════════════════
// PROFIL TAB
// ══════════════════════════════════════════════════════

var profilAllergiesCourantes    = []
var profilTempsCuisineCourant   = 30

// Populate all Profil tab elements from profilUtilisateur
function chargerProfilUI() {
  var p = profilUtilisateur
  if (!p) return

  var initial = p.prenom ? p.prenom.charAt(0).toUpperCase() : '?'
  var lgEl   = document.getElementById('profilAvatarLg')
  var cardEl = document.getElementById('profilAvatarCard')
  if (lgEl)   lgEl.textContent   = initial
  if (cardEl) cardEl.textContent = initial

  var nomEl = document.getElementById('profilNom')
  if (nomEl) nomEl.textContent = p.prenom || 'Mon Profil'

  // Meta badges (age + sexe)
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

  // Objectifs
  var objectifs = (p.objectifs_generaux && p.objectifs_generaux.length) ? p.objectifs_generaux : selectedSymptoms
  document.querySelectorAll('#profilObjectifsChips .chip').forEach(function(el) {
    el.classList.toggle('selected', objectifs.includes(el.dataset.val))
  })
  updateObjectifPrincipalBadge()

  // Allergènes
  profilAllergiesCourantes = (p.allergies || []).slice()
  document.querySelectorAll('#profilAllergiesChips .chip').forEach(function(el) {
    el.classList.toggle('selected', profilAllergiesCourantes.includes(el.dataset.val))
  })

  // Sync all shared chips (régimes, temps, budget)
  syncAllPreferencesChips()

  // Email digest toggle
  initialiserEmailDigestToggle(p)
}

// Met à jour le badge "Principal" sur le premier objectif sélectionné
// Couvre les trois conteneurs : page d'accueil, semaine et profil
function updateObjectifPrincipalBadge() {
  var principal = selectedSymptoms.length > 0 ? selectedSymptoms[0] : null
  var selectors = [
    { container: '#symptomsChips .chip',       getVal: function(el) { var m = (el.getAttribute('onclick')||'').match(/'(\w+)'\)/); return m && m[1] } },
    { container: '#semaineSymptomChips .chip', getVal: function(el) { var m = (el.getAttribute('onclick')||'').match(/'(\w+)'\)/); return m && m[1] } },
    { container: '#profilObjectifsChips .chip', getVal: function(el) { return el.dataset.val } }
  ]
  selectors.forEach(function(s) {
    document.querySelectorAll(s.container).forEach(function(el) {
      var badge = el.querySelector('.chip-principal-badge')
      var val   = s.getVal(el)
      var isPrincipal = principal && val === principal && el.classList.contains('selected')
      if (isPrincipal) {
        if (!badge) {
          badge = document.createElement('span')
          badge.className = 'chip-principal-badge'
          badge.textContent = 'Principal'
          el.appendChild(badge)
        }
      } else if (badge) {
        badge.remove()
      }
    })
  })
}

// Toggle objectif (mirrors selectedSymptoms + config panel)
function toggleProfilObjectif(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!selectedSymptoms.includes(val)) selectedSymptoms.push(val)
  } else {
    selectedSymptoms = selectedSymptoms.filter(function(v) { return v !== val })
  }
  document.querySelectorAll('#symptomsChips .chip, #semaineSymptomChips .chip').forEach(function(c) {
    var m = c.getAttribute('onclick') && c.getAttribute('onclick').match(/'(\w+)'\)/)
    if (m && m[1] === val) c.classList.toggle('selected', selectedSymptoms.includes(val))
  })
  updateObjectifPrincipalBadge()
  if (profilUtilisateur) {
    profilUtilisateur.objectifs_generaux = selectedSymptoms.slice()
    localStorage.setItem('vitalia_profil', JSON.stringify(profilUtilisateur))
  }
  autoSauvegarderProfilComplet()
}

// Toggle régime — delegates to shared master function
function toggleProfilRegime(el, val) {
  toggleSharedRegime(el, val)
}

// Toggle allergène (independent list)
function toggleProfilAllergie(el, val) {
  el.classList.toggle('selected')
  if (el.classList.contains('selected')) {
    if (!profilAllergiesCourantes.includes(val)) profilAllergiesCourantes.push(val)
  } else {
    profilAllergiesCourantes = profilAllergiesCourantes.filter(function(v) { return v !== val })
  }
  if (profilUtilisateur) {
    profilUtilisateur.allergies = profilAllergiesCourantes.slice()
    localStorage.setItem('vitalia_profil', JSON.stringify(profilUtilisateur))
  }
  autoSauvegarderProfilComplet()
}

// Select cooking time — delegates to shared master function
function selectProfilTempsCuisine(el, val) {
  selectSharedTemps(el, val)
}

// Save profile preferences to Supabase
async function sauvegarderProfil() {
  var btn = document.getElementById('profilSaveBtn')
  if (btn) { btn.disabled = true; btn.style.opacity = '0.7' }

  if (profilUtilisateur) {
    profilUtilisateur.objectifs_generaux   = selectedSymptoms.slice()
    profilUtilisateur.regimes_alimentaires = selectedRegimes.slice()
    profilUtilisateur.allergies            = profilAllergiesCourantes.slice()
    profilUtilisateur.temps_cuisine_max    = profilTempsCuisineCourant
    profilUtilisateur.budget_complements   = selectedBudget
    localStorage.setItem('vitalia_profil', JSON.stringify(profilUtilisateur))
  }

  if (profil_id && profil_id !== 'new') {
    var result = await _sb.from('profils_utilisateurs').update({
      objectifs_generaux:   selectedSymptoms,
      regimes_alimentaires: selectedRegimes,
      allergies:            profilAllergiesCourantes,
      temps_cuisine_max:    profilTempsCuisineCourant,
      temps_max:            profilTempsCuisineCourant,
      budget_complements:   selectedBudget,
      budget_max:           _budgetMaxMap[selectedBudget] || 15,
    }).eq('id', profil_id)
    if (result.error) {
      afficherToast('Erreur sauvegarde : ' + result.error.message)
      if (btn) { btn.disabled = false; btn.style.opacity = '1' }
      return
    }
  }

  afficherToast('Préférences sauvegardées ✓')
  if (btn) { btn.disabled = false; btn.style.opacity = '1' }
}

// Load and display saved recipes from localStorage
function afficherRecettesSauvegardees() {
  var container = document.getElementById('recettesSauvegardeesListe')
  if (!container) return
  // Réappliquer le filtre actif après refresh
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
      return '<div style="display:flex;gap:10px;margin-bottom:8px;">' +
             '<span style="flex-shrink:0;width:20px;height:20px;background:var(--terracotta);color:white;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">' + (si+1) + '</span>' +
             '<span style="font-size:13px;color:var(--deep-brown);line-height:1.5;">' + step + '</span>' +
             '</div>'
    }).join('')

    var astuces = Array.isArray(r.astuces) && r.astuces.length
      ? '<div style="margin-top:10px;background:rgba(122,158,126,0.1);border-radius:10px;padding:8px 12px;font-size:12px;color:var(--sage);">💡 ' + r.astuces[0] + '</div>'
      : ''

    // Stepper portions + bouton sélection panier
    var portionsStepper =
      '<div style="display:flex;align-items:center;gap:8px;margin-top:12px;">' +
      '  <span style="font-size:12px;color:var(--text-light);flex:1;">Portions :</span>' +
      '  <button onclick="changerPortionsSaved(' + idx + ',-1);event.stopPropagation();" class="stepper-btn">&#8722;</button>' +
      '  <span id="saved-portions-' + idx + '" style="font-size:13px;font-weight:600;color:var(--deep-brown);min-width:20px;text-align:center;">' + (savedServings[idx] || 2) + '</span>' +
      '  <button onclick="changerPortionsSaved(' + idx + ',1);event.stopPropagation();" class="stepper-btn">+</button>' +
      '</div>'

    var selectBtn =
      '<button id="saved-select-btn-' + idx + '" onclick="toggleSelectSaved(' + idx + ');event.stopPropagation();" ' +
      'style="margin-top:8px;width:100%;background:rgba(196,113,74,0.08);border:1.5px solid rgba(196,113,74,0.25);border-radius:10px;padding:9px;font-size:13px;font-weight:600;color:var(--terracotta);cursor:pointer;transition:all 0.2s;">🛒 Sélectionner pour la liste</button>'

    return '<div style="background:var(--warm-white);border-radius:16px;border:1.5px solid rgba(196,113,74,0.1);overflow:hidden;">' +
           '  <div onclick="toggleSavedRecette(\'' + rid + '\')" style="padding:14px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
           '    <div style="flex:1;min-width:0;">' +
           '      <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-light);font-weight:600;margin-bottom:3px;">' + type + (date ? ' · ' + date : '') + (temps ? ' · ' + temps : '') + '</div>' +
           '      <div style="font-family:\'Fraunces\',serif;font-size:15px;font-weight:600;color:var(--deep-brown);line-height:1.3;">' + (r.nom || r.titre || 'Recette') + '</div>' +
           (stars ? '      <div style="font-size:13px;color:var(--golden);margin-top:4px;">' + stars + '</div>' : '') +
           '    </div>' +
           '    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">' +
           (cal ? '<span style="font-size:12px;color:var(--text-light);">' + cal + '</span>' : '') +
           '      <span id="arrow-' + rid + '" style="font-size:14px;color:var(--text-light);transition:transform 0.2s;">▼</span>' +
           '    </div>' +
           '  </div>' +
           '  <div id="' + rid + '" style="display:none;padding:0 16px 14px;">' +
           ((prep > 0 || cook > 0) ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' +
             (prep > 0 ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(196,113,74,0.08);border:1px solid rgba(196,113,74,0.18);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--terracotta);font-weight:500;">⏱ ' + prep + ' min prép.</span>' : '') +
             (cook > 0 ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(232,184,75,0.1);border:1px solid rgba(232,184,75,0.25);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--mid-brown);font-weight:500;">🔥 ' + cook + ' min cuisson</span>' : '') +
             (cal ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(122,158,126,0.1);border:1px solid rgba(122,158,126,0.2);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--sage);font-weight:500;">🔋 ' + cal + '</span>' : '') +
           '</div>' : '') +
           (ingredients ? '<div id="saved-ingredients-' + idx + '" style="margin-bottom:12px;" data-portions="' + (r.portions || 2) + '">' + ingredients + '</div>' : '') +
           instructions +
           astuces +
           portionsStepper +
           selectBtn +
           '    <div style="margin-top:12px;">' +
           '      <div style="font-size:11px;color:var(--text-light);margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:1px;">Ma note</div>' +
           '      <div style="display:flex;gap:6px;" id="saved-stars-' + idx + '">' +
           [1,2,3,4,5].map(function(n) {
             var lit = r.note && n <= r.note
             return '<span onclick="noterRecetteSauvegardee(' + idx + ',' + n + ');event.stopPropagation();" ' +
                    'style="font-size:22px;cursor:pointer;color:' + (lit ? 'var(--golden,#e8b84b)' : 'rgba(196,113,74,0.25)') + ';transition:color 0.15s;">★</span>'
           }).join('') +
           '      </div>' +
           '    </div>' +
           '    <button onclick="supprimerRecetteSauvegardee(' + idx + ');event.stopPropagation();" style="margin-top:8px;width:100%;background:none;border:1px solid rgba(196,113,74,0.2);border-radius:10px;padding:8px;font-size:12px;color:var(--text-light);cursor:pointer;">🗑 Supprimer cette recette</button>' +
           '  </div>' +
           '</div>'
  }).join('')

  // Réappliquer filtre si actif
  if (activeQuery) filtrerRecettesSauvegardees(activeQuery)

  // Restore visual state of already-selected buttons
  Object.keys(savedSelected).forEach(function(idx) {
    if (!savedSelected[idx]) return
    var btn = document.getElementById('saved-select-btn-' + idx)
    if (btn) {
      btn.textContent = '✓ Sélectionné'
      btn.style.background = 'rgba(122,158,126,0.15)'
      btn.style.borderColor = 'var(--sage)'
      btn.style.color = 'var(--sage)'
    }
    var portEl = document.getElementById('saved-portions-' + idx)
    if (portEl) portEl.textContent = savedServings[parseInt(idx)] || 2
  })
}

// ── Filtrer recettes sauvegardées ──
function filtrerRecettesSauvegardees(query) {
  var q = (query || '').trim().toLowerCase()
  var container = document.getElementById('recettesSauvegardeesListe')
  if (!container) return
  if (!q) { afficherRecettesSauvegardees(); return }
  container.querySelectorAll(':scope > div').forEach(function(el) {
    var text = el.textContent.toLowerCase()
    el.style.display = text.includes(q) ? '' : 'none'
  })
}

// ── Filtrer favoris ──
function filtrerFavoris(query) {
  var q = (query || '').trim().toLowerCase()
  var container = document.getElementById('favorisListe')
  if (!container) return
  if (!q) { afficherFavoris(); return }
  container.querySelectorAll(':scope > div').forEach(function(el) {
    var text = el.textContent.toLowerCase()
    el.style.display = text.includes(q) ? '' : 'none'
  })
}

async function afficherEvolution() {
  var container = document.getElementById('evolutionCharts')
  if (!container) return
  if (!profil_id || profil_id === 'new') {
    container.innerHTML = '<div style="text-align:center;padding:16px;' +
      'color:var(--text-light);font-size:13px;">Connecte-toi pour voir ton évolution</div>'
    return
  }

  try {
    var since = new Date()
    since.setDate(since.getDate() - 14)
    var sinceStr = since.toISOString().split('T')[0]

    var resp = await authFetch(
      SUPABASE_URL + '/rest/v1/checkin_symptomes' +
      '?profil_id=eq.' + profil_id +
      '&date=gte.' + sinceStr +
      '&order=date.asc&limit=200',
      { method: 'GET',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + authToken } }
    )
    var rows = await resp.json()
    if (!Array.isArray(rows)) rows = []

    // Group by symptome_key
    var bySymptom = {}
    rows.forEach(function(r) {
      if (!bySymptom[r.symptome_key]) bySymptom[r.symptome_key] = []
      bySymptom[r.symptome_key].push({ date: r.date, score: r.score })
    })

    var symptomKeys = Object.keys(bySymptom)
    if (!symptomKeys.length) {
      container.innerHTML = '<div style="background:rgba(196,113,74,0.04);' +
        'border:1px dashed rgba(196,113,74,0.2);border-radius:14px;padding:20px;' +
        'text-align:center;">' +
        '<div style="font-size:14px;color:var(--deep-brown);margin-bottom:6px;">' +
        'Ton évolution se construit</div>' +
        '<div style="font-size:12px;color:var(--text-light);line-height:1.5;">' +
        'Fais ton check-in quotidien pendant quelques jours<br>pour voir tes tendances apparaître ici</div>' +
        '</div>'
      return
    }

    var LABELS = {
      vitalite:'Vitalité & Énergie', serenite:'Sérénité',
      digestion:'Digestion', sommeil:'Sommeil',
      mobilite:'Mobilité', hormones:'Équilibre hormonal'
    }

    var avg = function(arr) {
      return arr.length ? arr.reduce(function(s,d){return s+d.score},0)/arr.length : null
    }

    var html = ''
    symptomKeys.forEach(function(key) {
      var data   = bySymptom[key]
      var label  = LABELS[key] || key
      var today  = new Date()

      var week1 = data.filter(function(d) {
        return Math.floor((today - new Date(d.date)) / 86400000) <= 7
      })
      var week2 = data.filter(function(d) {
        var daysAgo = Math.floor((today - new Date(d.date)) / 86400000)
        return daysAgo > 7 && daysAgo <= 14
      })

      var avg1 = avg(week1)
      var avg2 = avg(week2)

      var trendHtml = ''
      var lineColor = '#7A5C4A'
      if (avg1 !== null && avg2 !== null && avg2 > 0) {
        var delta = Math.round(((avg1 - avg2) / avg2) * 100)
        if (delta > 0) {
          trendHtml = '<span style="font-size:12px;font-weight:700;color:#7A9E7E;">+' + delta + '%</span>'
          lineColor = '#7A9E7E'
        } else if (delta < 0) {
          trendHtml = '<span style="font-size:12px;font-weight:700;color:#C4714A;">' + delta + '%</span>'
          lineColor = '#C4714A'
        } else {
          trendHtml = '<span style="font-size:12px;color:var(--text-light);">Stable</span>'
        }
      } else if (data.length < 3) {
        trendHtml = '<span style="font-size:11px;color:var(--text-light);">En cours...</span>'
      }

      // Sparkline SVG
      var scores = data.map(function(d){return d.score})
      var minS   = Math.min.apply(null, scores)
      var maxS   = Math.max.apply(null, scores)
      var range  = Math.max(maxS - minS, 1)
      var W = 260; var H = 36; var pad = 4

      var sparkSvg
      if (scores.length === 1) {
        // Single dot — no line
        var cx = (W / 2).toFixed(1)
        var cy = (H / 2).toFixed(1)
        sparkSvg = '<svg viewBox="0 0 ' + W + ' ' + H + '" ' +
          'style="width:100%;height:40px;display:block;">' +
          '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="' + lineColor + '"/>' +
          '</svg>'
      } else {
        var points = scores.map(function(s, i) {
          var x = pad + (i / Math.max(scores.length - 1, 1)) * (W - pad * 2)
          var y = pad + (1 - (s - minS) / range) * (H - pad * 2)
          return x.toFixed(1) + ',' + y.toFixed(1)
        }).join(' ')

        var lastIdx = scores.length - 1
        var lastX   = pad + (lastIdx / Math.max(scores.length - 1, 1)) * (W - pad * 2)
        var lastY   = pad + (1 - (scores[lastIdx] - minS) / range) * (H - pad * 2)

        sparkSvg = '<svg viewBox="0 0 ' + W + ' ' + H + '" ' +
          'style="width:100%;height:40px;display:block;">' +
          '<polyline points="' + points + '" fill="none" stroke="' + lineColor + '" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.8"/>' +
          '<circle cx="' + lastX.toFixed(1) + '" cy="' + lastY.toFixed(1) + '" r="3" ' +
            'fill="' + lineColor + '"/>' +
          '</svg>'
      }

      var latestScore = scores[scores.length - 1]
      var latestLabel = latestScore <= 3 ? 'Difficile'
                      : latestScore <= 5 ? 'Moyen'
                      : latestScore <= 7 ? 'Bien'
                      : 'Excellent'

      html += '<div style="background:var(--card-bg);border-radius:16px;' +
        'border:1px solid var(--card-border);padding:14px 16px;box-shadow:var(--card-shadow);">'
      html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
      html += '<span style="font-size:13px;font-weight:600;color:var(--deep-brown);">' + label + '</span>'
      html += '<div style="display:flex;align-items:center;gap:8px;">' + trendHtml +
              '<span style="font-size:12px;color:var(--text-light);">' +
              latestScore + '/10 — ' + latestLabel + '</span></div>'
      html += '</div>'
      html += sparkSvg
      html += '<div style="display:flex;justify-content:space-between;margin-top:4px;">'
      html += '<span style="font-size:10px;color:var(--text-light);">Il y a 14j</span>'
      html += '<span style="font-size:10px;color:var(--text-light);">Aujourd\'hui</span>'
      html += '</div>'
      html += '</div>'
    })

    container.innerHTML = html

    // Also populate Aujourd'hui evolution section using CSS classes
    var evoSection  = document.getElementById('evolutionSection')
    var evoContent  = document.getElementById('evolutionContent')
    if (evoSection && evoContent && symptomKeys.length) {
      var htmlAujourd = ''
      symptomKeys.forEach(function(key, idx) {
        var data   = bySymptom[key]
        var label  = LABELS[key] || key
        var today2 = new Date()

        var week1b = data.filter(function(d) {
          return Math.floor((today2 - new Date(d.date)) / 86400000) <= 7
        })
        var week2b = data.filter(function(d) {
          var n = Math.floor((today2 - new Date(d.date)) / 86400000)
          return n > 7 && n <= 14
        })
        var avg1b = avg(week1b)
        var avg2b = avg(week2b)

        var badgeHtml = ''
        var lineColor = '#9E8070'
        if (avg1b !== null && avg2b !== null && avg2b > 0) {
          var delta2 = Math.round(((avg1b - avg2b) / avg2b) * 100)
          if (delta2 > 2) {
            badgeHtml = '<span class="evolution-badge-pos">+' + delta2 + '%</span>'
            lineColor = '#7A9E7E'
          } else if (delta2 < -2) {
            badgeHtml = '<span class="evolution-badge-neg">' + delta2 + '%</span>'
            lineColor = '#C4714A'
          } else {
            badgeHtml = '<span class="evolution-badge-neu">Stable</span>'
          }
        } else {
          badgeHtml = '<span class="evolution-badge-neu">En cours...</span>'
        }

        var scores2   = data.map(function(d) { return d.score })
        var latestS   = scores2[scores2.length - 1]
        var latestLbl = latestS <= 3 ? 'Difficile' : latestS <= 5 ? 'Moyen'
                      : latestS <= 7 ? 'Bien' : 'Excellent'
        var minS2 = Math.min.apply(null, scores2)
        var maxS2 = Math.max.apply(null, scores2)
        var range2 = Math.max(maxS2 - minS2, 1)
        var W2 = 260; var H2 = 36; var pad2 = 4

        var sparkHtml2
        if (scores2.length === 1) {
          sparkHtml2 = '<svg viewBox="0 0 ' + W2 + ' ' + H2 + '" ' +
            'style="width:100%;height:40px;display:block;" xmlns="http://www.w3.org/2000/svg">' +
            '<circle cx="' + (W2/2).toFixed(1) + '" cy="' + (H2/2).toFixed(1) + '" ' +
            'r="3.5" fill="' + lineColor + '"/></svg>'
        } else {
          var pts2 = scores2.map(function(s, i) {
            var x = pad2 + (i / Math.max(scores2.length - 1, 1)) * (W2 - pad2 * 2)
            var y = pad2 + (1 - (s - minS2) / range2) * (H2 - pad2 * 2)
            return x.toFixed(1) + ',' + y.toFixed(1)
          }).join(' ')
          var li2 = scores2.length - 1
          var lx2 = (pad2 + (li2 / Math.max(scores2.length - 1, 1)) * (W2 - pad2 * 2)).toFixed(1)
          var ly2 = (pad2 + (1 - (scores2[li2] - minS2) / range2) * (H2 - pad2 * 2)).toFixed(1)
          sparkHtml2 = '<svg viewBox="0 0 ' + W2 + ' ' + H2 + '" ' +
            'style="width:100%;height:40px;display:block;" xmlns="http://www.w3.org/2000/svg" ' +
            'preserveAspectRatio="none">' +
            '<polyline points="' + pts2 + '" fill="none" stroke="' + lineColor + '" ' +
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>' +
            '<circle cx="' + lx2 + '" cy="' + ly2 + '" r="3.5" fill="' + lineColor + '"/>' +
            '</svg>'
        }

        if (idx > 0) htmlAujourd += '<div class="evolution-divider"></div>'
        htmlAujourd += '<div class="evolution-symptom">'
        htmlAujourd += '<div class="evolution-symptom-header">'
        htmlAujourd += '<span class="evolution-symptom-name">' + label + '</span>'
        htmlAujourd += '<div style="display:flex;align-items:center;gap:8px;">' + badgeHtml +
          '<span class="evolution-score">' + latestS + '/10 · ' + latestLbl + '</span></div>'
        htmlAujourd += '</div>'
        htmlAujourd += sparkHtml2
        htmlAujourd += '<div style="display:flex;justify-content:space-between;margin-top:2px;">'
        htmlAujourd += '<span style="font-size:9px;color:var(--text-light);">Il y a 14j</span>'
        htmlAujourd += '<span style="font-size:9px;color:var(--text-light);">Aujourd\'hui</span>'
        htmlAujourd += '</div>'
        htmlAujourd += '</div>'
      })
      evoContent.innerHTML = htmlAujourd
      evoSection.style.display = ''
    }

  } catch(e) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-light);' +
      'font-size:13px;">Impossible de charger l\'évolution</div>'
  }
}

async function afficherHistoriqueCompact() {
  var section = document.getElementById('historiqueCompactSection')
  var content = document.getElementById('historiqueCompactContent')
  if (!section || !content) return
  if (!profil_id || profil_id === 'new') return

  try {
    var resp = await authFetch(
      SUPABASE_URL + '/rest/v1/plans_generes_cache' +
      '?profil_id=eq.' + profil_id +
      '&source=eq.journalier' +
      '&order=created_at.desc&limit=4',
      { method: 'GET',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + authToken } }
    )
    var plans = await resp.json()
    if (!Array.isArray(plans) || !plans.length) return

    var JOURS_COURT = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam']
    var html = ''

    plans.forEach(function(row) {
      var plan    = row.plan_json || {}
      var matin   = plan.matin || plan.petit_dejeuner
      var midi    = plan.midi  || plan.dejeuner
      var soir    = plan.soir  || plan.diner
      var dateObj = new Date(row.created_at || row.updated_at)
      var diffD   = Math.floor((new Date() - dateObj) / 86400000)
      var dateLabel = diffD === 1 ? 'Hier' : diffD === 0 ? 'Auj.' : JOURS_COURT[dateObj.getDay()]
      var dateStr = dateObj.toISOString().split('T')[0]

      html += '<div class="histo-compact-row" data-date="' + dateStr + '">'
      html += '<span class="histo-compact-date">' + dateLabel + '</span>'
      html += '<div class="histo-compact-meals">'
      if (matin && matin.nom) html += '<span class="histo-compact-pill">' + matin.nom + '</span>'
      if (midi  && midi.nom)  html += '<span class="histo-compact-pill">' + midi.nom  + '</span>'
      if (soir  && soir.nom)  html += '<span class="histo-compact-pill">' + soir.nom  + '</span>'
      html += '</div>'
      html += '<span class="histo-compact-score" id="histo-score-' + dateStr +
              '" style="color:var(--text-light);">—</span>'
      html += '</div>'
    })

    content.innerHTML = html
    section.style.display = ''

    injecterScoresHistorique(plans)

  } catch(e) {
    // Silent fail
  }
}

async function injecterScoresHistorique(plans) {
  if (!profil_id || profil_id === 'new') return
  var dates = plans.map(function(r) {
    return new Date(r.created_at || r.updated_at).toISOString().split('T')[0]
  })
  var minDate = dates[dates.length - 1]
  try {
    var resp = await authFetch(
      SUPABASE_URL + '/rest/v1/checkin_symptomes' +
      '?profil_id=eq.' + profil_id +
      '&date=gte.' + minDate +
      '&select=date,score',
      { method: 'GET',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + authToken } }
    )
    var rows = await resp.json()
    if (!Array.isArray(rows)) return

    var byDate = {}
    rows.forEach(function(r) {
      if (!byDate[r.date]) byDate[r.date] = []
      byDate[r.date].push(r.score)
    })

    Object.keys(byDate).forEach(function(date) {
      var scores = byDate[date]
      var avg = Math.round(scores.reduce(function(s, v) { return s + v }, 0) / scores.length)
      var el  = document.getElementById('histo-score-' + date)
      if (!el) return
      el.textContent = avg + '/10'
      el.style.color = avg >= 7 ? '#7A9E7E' : avg >= 5 ? 'var(--mid-brown)' : 'var(--terracotta)'
    })
  } catch(e) {}
}

async function afficherHistorique() {
  var container = document.getElementById('historiqueListe')
  if (!container) return
  if (!profil_id || profil_id === 'new') {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-light);font-size:13px;">Connecte-toi pour voir ton historique</div>'
    return
  }

  var MEAL_LABELS = { matin: 'Petit-déj', midi: 'Déjeuner', soir: 'Dîner' }
  var MEAL_EMOJIS = { matin: '🌅', midi: '☀️', soir: '🌙' }

  try {
    var resp = await authFetch(
      SUPABASE_URL + '/rest/v1/plans_generes_cache' +
      '?profil_id=eq.' + profil_id +
      '&source=eq.journalier' +
      '&order=created_at.desc&limit=7',
      { method: 'GET',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + authToken } }
    )
    var plans = await resp.json()

    if (!Array.isArray(plans) || !plans.length) {
      container.innerHTML = '<div style="text-align:center;padding:24px;' +
        'color:var(--text-light);font-size:13px;border:1px dashed rgba(196,113,74,0.2);' +
        'border-radius:12px;">Génère ton premier plan pour voir ton historique ici</div>'
      return
    }

    var html = ''
    plans.forEach(function(row) {
      var plan = row.plan_json || {}
      var matin = plan.matin || plan.petit_dejeuner || null
      var midi  = plan.midi  || plan.dejeuner      || null
      var soir  = plan.soir  || plan.diner         || null

      var dateObj   = new Date(row.created_at || row.updated_at)
      var today     = new Date()
      var diffDays  = Math.floor((today - dateObj) / 86400000)
      var dateLabel = diffDays === 0 ? "Aujourd'hui"
                    : diffDays === 1 ? 'Hier'
                    : dateObj.toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'short' })

      html += '<div style="background:var(--card-bg);border-radius:16px;' +
              'border:1px solid var(--card-border);padding:14px 16px;' +
              'box-shadow:var(--card-shadow);">'
      html += '<div style="font-family:\'Fraunces\',serif;font-size:14px;font-weight:700;' +
              'color:var(--deep-brown);margin-bottom:10px;text-transform:capitalize;">' +
              dateLabel + '</div>'
      html += '<div style="display:flex;flex-direction:column;gap:5px;">'
      ;[[matin,'matin'],[midi,'midi'],[soir,'soir']].forEach(function(pair) {
        var meal = pair[0]; var key = pair[1]
        if (!meal || !meal.nom) return
        html += '<div style="display:flex;align-items:center;gap:8px;">'
        html += '<span style="font-size:11px;color:var(--text-light);width:52px;flex-shrink:0;">' +
                MEAL_EMOJIS[key] + ' ' + MEAL_LABELS[key] + '</span>'
        html += '<span style="font-size:12px;font-weight:500;color:var(--mid-brown);' +
                'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;">' +
                (meal.nom || '') + '</span>'
        html += '</div>'
      })
      html += '</div>'
      html += '</div>'
    })
    container.innerHTML = html

  } catch(e) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-light);' +
      'font-size:13px;">Impossible de charger l\'historique</div>'
  }
}

function afficherFavoris() {
  var container = document.getElementById('favorisListe')
  if (!container) return
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
      return '<div style="display:flex;gap:10px;margin-bottom:8px;">' +
             '<span style="flex-shrink:0;width:20px;height:20px;background:var(--terracotta);color:white;border-radius:50%;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">' + (si+1) + '</span>' +
             '<span style="font-size:13px;color:var(--deep-brown);line-height:1.5;">' + step + '</span></div>'
    }).join('')

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
           ((prep > 0 || cook > 0) ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">' +
             (prep > 0 ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(196,113,74,0.08);border:1px solid rgba(196,113,74,0.18);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--terracotta);font-weight:500;">⏱ ' + prep + ' min prép.</span>' : '') +
             (cook > 0 ? '<span style="display:inline-flex;align-items:center;gap:3px;background:rgba(232,184,75,0.1);border:1px solid rgba(232,184,75,0.25);border-radius:20px;padding:3px 10px;font-size:11px;color:var(--mid-brown);font-weight:500;">🔥 ' + cook + ' min cuisson</span>' : '') +
           '</div>' : '') +
           (ingredients ? '<div style="margin-bottom:12px;">' + ingredients + '</div>' : '') +
           instructions +
           '    <div style="display:flex;gap:8px;margin-top:12px;">' +
           '      <button onclick="ajouterFavoriAuxCourses(' + i + ');event.stopPropagation();" style="flex:1;background:rgba(122,158,126,0.1);border:1.5px solid rgba(122,158,126,0.35);border-radius:10px;padding:8px;font-size:12px;color:var(--sage,#7a9e7e);font-weight:600;cursor:pointer;">🛒 Ajouter aux courses</button>' +
           '      <button onclick="supprimerFavori(' + i + ');event.stopPropagation();" style="flex:1;background:none;border:1px solid rgba(196,113,74,0.2);border-radius:10px;padding:8px;font-size:12px;color:var(--text-light);cursor:pointer;">🗑 Retirer des favoris</button>' +
           '    </div>' +
           '  </div>' +
           '</div>'
  }).join('')
  // Réappliquer filtre si actif
  if (activeQuery) filtrerFavoris(activeQuery)
}

async function supprimerFavori(idx) {
  if (!confirm('Retirer cette recette de vos favoris ?\n(La recette restera dans "À faire" si elle y est encore.)')) return
  var favs = []
  try { favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]') } catch(e) {}
  var r = favs[idx]
  if (!r) return
  favs.splice(idx, 1)
  try { localStorage.setItem('vitalia_favoris', JSON.stringify(favs)) } catch(e) {}
  if (profil_id && profil_id !== 'new' && (r.titre || r.nom)) {
    try {
      await authFetch(SUPABASE_URL + '/rest/v1/recettes_favorites?profil_id=eq.' + profil_id + '&titre=eq.' + encodeURIComponent(r.titre || r.nom || ''), {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken }
      })
    } catch(e) {}
  }
  afficherFavoris()
  afficherToast('Recette retirée des favoris')
}

function ajouterFavoriAuxCourses(idx) {
  var favs = []
  try { favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]') } catch(e) {}
  var r = favs[idx]
  if (!r || !Array.isArray(r.ingredients) || !r.ingredients.length) {
    afficherToast('Pas d\'ingrédients à ajouter')
    return
  }

  // Normaliser les ingrédients (string ou objet)
  var nouveaux = r.ingredients.map(function(ing) {
    if (typeof ing === 'string') return { nom: ing, quantite: null, unite: 'g' }
    return { nom: ing.nom || ing.name || ing, quantite: ing.quantite || null, unite: ing.unite || 'g' }
  }).filter(function(ing) { return ing.nom })

  // Charger la liste existante
  var existing = null
  try { existing = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  var liste = (existing && Array.isArray(existing.ingredients)) ? existing.ingredients : []

  // Fusionner : si l'ingrédient existe déjà avec la même unité, additionner les quantités
  nouveaux.forEach(function(ing) {
    var key = ing.nom.toLowerCase().trim()
    var found = liste.find(function(e) { return e.nom.toLowerCase().trim() === key })
    if (found) {
      if (ing.quantite && found.unite === ing.unite) found.quantite = Math.round((found.quantite || 0) + ing.quantite)
    } else {
      liste.push({ nom: ing.nom, quantite: ing.quantite, unite: ing.unite })
    }
  })

  // Sauvegarder
  var recettes = (existing && existing.recettes) ? existing.recettes : []
  // Ajouter la recette dans la section "Recettes dans la liste" si pas déjà présente
  var nomRecette = r.nom || r.titre || ''
  if (nomRecette && !recettes.find(function(x) { return (x.nom || '').toLowerCase() === nomRecette.toLowerCase() })) {
    recettes.push({ nom: nomRecette, type: 'favori', id: idx, portions: 2, basePortions: 2, ingredients: nouveaux })
  }
  try {
    localStorage.setItem('vitalia_liste_courses', JSON.stringify({
      date: existing && existing.date ? existing.date : new Date().toISOString(),
      ingredients: liste,
      recettes: recettes
    }))
  } catch(e) {}

  sauvegarderListeCoursesSupabase()
  afficherListeCoursesProfile()
  afficherToast('Ingrédients ajoutés à la liste de courses !')
}

function toggleSavedRecette(id) {
  var el    = document.getElementById(id)
  var arrow = document.getElementById('arrow-' + id)
  if (!el) return
  var open  = el.style.display !== 'none'
  el.style.display = open ? 'none' : 'block'
  if (arrow) arrow.style.transform = open ? '' : 'rotate(180deg)'
}

function supprimerRecetteSauvegardee(idx) {
  if (!confirm('Supprimer cette recette de "À faire" ?')) return
  var saved = []
  try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  var r = saved[idx]
  saved.splice(idx, 1)
  try { localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved)) } catch(e) {}
  // Sync deletion to Supabase
  if (r && profil_id && profil_id !== 'new' && (r.titre || r.nom)) {
    var titre = encodeURIComponent(r.titre || r.nom || '')
    fetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees?profil_id=eq.' + profil_id + '&titre=eq.' + titre, {
      method: 'DELETE',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken }
    }).catch(function() {})
  }
  afficherRecettesSauvegardees()
}

async function noterRecetteSauvegardee(idx, note) {
  var saved = []
  try { saved = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]') } catch(e) {}
  if (!saved[idx]) return
  saved[idx].note = note
  try { localStorage.setItem('vitalia_recettes_sauvegardees', JSON.stringify(saved)) } catch(e) {}

  // Update stars UI
  var starsEl = document.getElementById('saved-stars-' + idx)
  if (starsEl) {
    starsEl.querySelectorAll('span').forEach(function(s, i) {
      s.style.color = (i < note) ? 'var(--golden,#e8b84b)' : 'rgba(196,113,74,0.25)'
    })
  }

  // Gérer favoris localStorage séparés
  var r = saved[idx]
  try {
    var favs = JSON.parse(localStorage.getItem('vitalia_favoris') || '[]')
    var nomCle = (r.nom || r.titre || '').toLowerCase().trim()
    var favIdx = favs.findIndex(function(f) { return (f.nom || f.titre || '').toLowerCase().trim() === nomCle })
    if (note >= 4) {
      var entree = Object.assign({}, r, { note: note })
      if (favIdx >= 0) favs[favIdx] = entree
      else favs.unshift(entree)
    } else {
      if (favIdx >= 0) favs.splice(favIdx, 1)
    }
    localStorage.setItem('vitalia_favoris', JSON.stringify(favs))
  } catch(e) {}

  afficherFavoris()

  // Supabase PATCH note sur recettes_sauvegardees
  if (profil_id && profil_id !== 'new' && (r.titre || r.nom)) {
    var titre = encodeURIComponent(r.titre || r.nom || '')
    try {
      await authFetch(SUPABASE_URL + '/rest/v1/recettes_sauvegardees?profil_id=eq.' + profil_id + '&titre=eq.' + titre, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ note: note })
      })
    } catch(e) {}

    // Gérer recettes_favorites Supabase
    var favEntry = {
      profil_id: profil_id,
      titre: r.titre || r.nom || '',
      moment: r.type_repas || '',
      ingredients: r.ingredients || [],
      steps: r.instructions || [],
      tip: (r.astuces && r.astuces[0]) || '',
      note: note
    }
    if (note >= 4) {
      try {
        await authFetch(SUPABASE_URL + '/rest/v1/recettes_favorites', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken, 'Prefer': 'resolution=merge-duplicates' },
          body: JSON.stringify(favEntry)
        })
      } catch(e) {}
    } else {
      try {
        await authFetch(SUPABASE_URL + '/rest/v1/recettes_favorites?profil_id=eq.' + profil_id + '&titre=eq.' + encodeURIComponent(r.titre || r.nom || ''), {
          method: 'DELETE',
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + authToken }
        })
      } catch(e) {}
    }
  }

  afficherToast(note >= 4 ? 'Ajouté aux favoris ⭐' : 'Note enregistrée')
}

// Toggle selection of a saved recipe for the shopping list
function toggleSelectSaved(idx) {
  savedSelected[idx] = !savedSelected[idx]
  if (!savedServings[idx]) savedServings[idx] = 2
  var btn = document.getElementById('saved-select-btn-' + idx)
  if (btn) {
    if (savedSelected[idx]) {
      btn.textContent = '✓ Sélectionné'
      btn.style.background = 'rgba(122,158,126,0.15)'
      btn.style.borderColor = 'var(--sage)'
      btn.style.color = 'var(--sage)'
    } else {
      btn.textContent = '🛒 Sélectionner pour la liste'
      btn.style.background = 'rgba(196,113,74,0.08)'
      btn.style.borderColor = 'rgba(196,113,74,0.25)'
      btn.style.color = 'var(--terracotta)'
    }
  }
  afficherBoutonListeCourses()
}

// Change portions for a saved recipe
function changerPortionsSaved(idx, delta) {
  savedServings[idx] = Math.max(1, Math.min(8, (savedServings[idx] || 2) + delta))
  var el = document.getElementById('saved-portions-' + idx)
  if (el) el.textContent = savedServings[idx]
  // Re-render ingredient quantities
  var ingContainer = document.getElementById('saved-ingredients-' + idx)
  if (ingContainer) {
    try {
      var savedList = JSON.parse(localStorage.getItem('vitalia_recettes_sauvegardees') || '[]')
      var r = savedList[idx]
      if (r && Array.isArray(r.ingredients)) {
        var basePortions = parseFloat(ingContainer.dataset.portions) || r.portions || 2
        var ratio = savedServings[idx] / Math.max(basePortions, 1)
        ingContainer.innerHTML = r.ingredients.map(function(i) {
          var qty = i.quantite ? Math.round(i.quantite * ratio) : null
          return '<span style="display:inline-block;background:var(--cream);border-radius:8px;padding:3px 8px;font-size:12px;margin:2px;">' +
                 i.nom + (qty ? ' ' + qty + '\u202f' + (i.unite || 'g') : '') + '</span>'
        }).join('')
      }
    } catch(e) {}
  }
  // Update shopping list if this recipe is selected
  if (savedSelected[idx]) afficherBoutonListeCourses()
}

// Display saved shopping list in the "À faire > Courses" tab
function afficherListeCoursesProfile() {
  var container = document.getElementById('listeCoursesProfile')
  if (!container) return

  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}

  var addInputHTML = '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
    '<input type="text" id="courses-add-input" placeholder="Ajouter un article manuellement…" ' +
    'style="flex:1;border:1.5px solid rgba(196,113,74,0.25);border-radius:12px;padding:9px 14px;font-size:13px;font-family:\'DM Sans\',sans-serif;background:var(--warm-white);color:var(--deep-brown);outline:none;" ' +
    'onkeydown="if(event.key===\'Enter\')ajouterArticleManuelCourses()">' +
    '<button onclick="ajouterArticleManuelCourses()" ' +
    'style="background:var(--terracotta);color:white;border:none;border-radius:12px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;font-family:\'DM Sans\',sans-serif;">+ Ajouter</button>' +
    '</div>'

  if (!raw || !raw.ingredients || !raw.ingredients.length) {
    container.innerHTML = addInputHTML +
      '<div style="text-align:center;padding:16px;color:var(--text-light);font-size:13px;">Sélectionnez des recettes ou ajoutez des articles manuellement</div>'
    return
  }

  var vu = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  var dateStr  = raw.date ? new Date(raw.date).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }) : ''
  var restants = raw.ingredients.filter(function(i) { return !vu[i.nom] }).length
  var total    = raw.ingredients.length

  // ── Ingredient list ──
  var html = addInputHTML
  html += (dateStr ? '<div style="font-size:11px;color:var(--text-light);margin-bottom:8px;">Générée le ' + dateStr + '</div>' : '')
  html += '<div style="font-size:12px;color:var(--sage);font-weight:600;margin-bottom:10px;">' + restants + ' / ' + total + ' ingrédients restants</div>'
  html += '<div style="display:flex;flex-direction:column;gap:6px;">'
  raw.ingredients.forEach(function(ing, idx) {
    var qte  = ing.quantite ? (Math.round(ing.quantite) + '\u202f' + (ing.unite || 'g')) : ''
    var done = !!vu[ing.nom]
    var deleteBtn = ing.manuel
      ? '<button onclick="supprimerArticleManuelCourses(' + idx + ');event.stopPropagation();" ' +
        'style="width:22px;height:22px;border:none;background:rgba(196,113,74,0.12);border-radius:50%;color:var(--terracotta);font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">×</button>'
      : ''
    html += '<div onclick="toggleCoursesVuByIdx(' + idx + ')" style="cursor:pointer;background:' + (done ? 'rgba(122,158,126,0.08)' : 'var(--cream)') + ';border-radius:12px;padding:10px 14px;display:flex;align-items:center;gap:10px;border:1px solid ' + (done ? 'rgba(122,158,126,0.3)' : 'transparent') + ';transition:all 0.2s;" id="courses-profile-item-' + idx + '">' +
           '<span style="width:22px;height:22px;border-radius:50%;border:2px solid ' + (done ? 'var(--sage)' : 'rgba(196,113,74,0.3)') + ';background:' + (done ? 'var(--sage)' : 'transparent') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;color:white;">' + (done ? '✓' : '') + '</span>' +
           '<span style="flex:1;font-size:13px;font-weight:500;color:' + (done ? 'var(--text-light)' : 'var(--deep-brown)') + ';text-decoration:' + (done ? 'line-through' : 'none') + ';">' + ing.nom + (ing.manuel ? ' <span style="font-size:10px;color:var(--text-light);font-style:italic;">(manuel)</span>' : '') + '</span>' +
           (qte ? '<span style="font-size:12px;color:var(--text-light);flex-shrink:0;">' + qte + '</span>' : '') +
           deleteBtn +
           '</div>'
  })
  html += '</div>'

  // ── Action buttons ──
  html += '<div style="display:flex;gap:8px;margin-top:12px;">' +
    '<button onclick="localStorage.removeItem(\'vitalia_courses_vu\');afficherListeCoursesProfile()" style="flex:1;background:none;border:1px solid rgba(196,113,74,0.2);border-radius:10px;padding:9px;font-size:12px;color:var(--text-light);cursor:pointer;">↺ Réinitialiser</button>' +
    '<button onclick="if(confirm(\'Effacer la liste de courses ?\')){localStorage.removeItem(\'vitalia_liste_courses\');localStorage.removeItem(\'vitalia_courses_vu\');effacerListeCoursesSupabase();afficherListeCoursesProfile()}" style="flex:1;background:none;border:1px solid rgba(196,113,74,0.2);border-radius:10px;padding:9px;font-size:12px;color:var(--text-light);cursor:pointer;">🗑 Effacer la liste</button>' +
    '</div>'

  // ── Recipes section ──
  var recettes = raw.recettes || []
  if (recettes.length > 0) {
    html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(196,113,74,0.15);">'
    html += '<div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:var(--text-light);font-weight:600;margin-bottom:10px;">Recettes dans la liste (' + recettes.length + ')</div>'
    recettes.forEach(function(r, ri) {
      var typeStr = r.type === 'semaine' ? '📅' : '📋'
      html += '<div style="background:var(--warm-white);border-radius:14px;padding:12px 14px;border:1px solid rgba(196,113,74,0.12);display:flex;align-items:center;gap:10px;margin-bottom:8px;">'
      html += '<span style="font-size:18px;flex-shrink:0;">' + typeStr + '</span>'
      html += '<span style="flex:1;font-size:13px;font-weight:500;color:var(--deep-brown);line-height:1.3;">' + (r.nom || 'Recette') + '</span>'
      // Portions stepper
      html += '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">'
      html += '<button onclick="changerPortionsListeProfile(\'' + r.type + '\',' + JSON.stringify(r.id) + ',-1)" style="width:26px;height:26px;border-radius:50%;border:1.5px solid rgba(196,113,74,0.3);background:var(--cream);color:var(--terracotta);font-size:16px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;padding-bottom:1px;">−</button>'
      html += '<span id="liste-portions-' + ri + '" style="font-size:13px;font-weight:600;color:var(--deep-brown);min-width:24px;text-align:center;">' + r.portions + '</span>'
      html += '<button onclick="changerPortionsListeProfile(\'' + r.type + '\',' + JSON.stringify(r.id) + ',+1)" style="width:26px;height:26px;border-radius:50%;border:1.5px solid rgba(196,113,74,0.3);background:var(--cream);color:var(--terracotta);font-size:16px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;padding-bottom:1px;">+</button>'
      html += '<span style="font-size:11px;color:var(--text-light);margin-left:2px;">pers.</span>'
      // Delete button
      html += '<button onclick="supprimerRecetteDeListeProfile(\'' + r.type + '\',' + JSON.stringify(r.id) + ')" title="Retirer de la liste" style="margin-left:6px;width:26px;height:26px;border-radius:50%;border:none;background:rgba(196,113,74,0.1);color:var(--terracotta);font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>'
      html += '</div></div>'
    })
    html += '</div>'
  }

  container.innerHTML = html
}

// Toggle a shopping list item checked/unchecked (index-based, no encoding issues)
function toggleCoursesVuByIdx(idx) {
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw || !raw.ingredients || !raw.ingredients[idx]) return
  var nom = raw.ingredients[idx].nom
  var vu = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  if (vu[nom]) delete vu[nom]; else vu[nom] = true
  localStorage.setItem('vitalia_courses_vu', JSON.stringify(vu))
  afficherListeCoursesProfile()
}

// Add a manual article to the shopping list
function ajouterArticleManuelCourses() {
  var input = document.getElementById('courses-add-input')
  if (!input) return
  var nom = input.value.trim()
  if (!nom) return

  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw) raw = { date: new Date().toISOString(), ingredients: [], recettes: [] }
  if (!raw.ingredients) raw.ingredients = []

  // Avoid exact duplicate
  var exists = raw.ingredients.some(function(i) { return i.nom.toLowerCase() === nom.toLowerCase() })
  if (exists) { afficherToast('Cet article est déjà dans la liste'); input.value = ''; return }

  raw.ingredients.push({ nom: nom, quantite: null, unite: null, manuel: true })
  localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw))
  sauvegarderListeCoursesSupabase()
  input.value = ''
  afficherListeCoursesProfile()
  // Re-focus the input for fast multi-add
  setTimeout(function() { var el = document.getElementById('courses-add-input'); if (el) el.focus() }, 50)
}

// Remove a manually-added article from the shopping list
function supprimerArticleManuelCourses(idx) {
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw || !raw.ingredients || !raw.ingredients[idx]) return
  var nom = raw.ingredients[idx].nom
  raw.ingredients.splice(idx, 1)
  // Clean up "vu" state for that item
  var vu = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  delete vu[nom]
  localStorage.setItem('vitalia_courses_vu', JSON.stringify(vu))
  if (!raw.ingredients.length && (!raw.recettes || !raw.recettes.length)) {
    localStorage.removeItem('vitalia_liste_courses')
  } else {
    localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw))
  }
  afficherListeCoursesProfile()
}

// Keep for backward compatibility with the floating modal
function toggleCoursesVu(encodedNom) {
  var nom = decodeURIComponent(encodedNom)
  var vu = {}
  try { vu = JSON.parse(localStorage.getItem('vitalia_courses_vu') || '{}') } catch(e) {}
  if (vu[nom]) delete vu[nom]; else vu[nom] = true
  localStorage.setItem('vitalia_courses_vu', JSON.stringify(vu))
  afficherListeCoursesProfile()
}

// Remove a recipe from the shopping list
function supprimerRecetteDeListeProfile(type, id) {
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw || !raw.recettes) return

  // Remove from stored recipe list
  raw.recettes = raw.recettes.filter(function(r) { return !(r.type === type && String(r.id) === String(id)) })

  // Update in-memory selection state (for when plan is still loaded)
  if (type === 'semaine') {
    semaineSelected[id] = false
    var btn = document.getElementById('select-btn-' + id)
    if (btn) { btn.classList.remove('selected'); btn.textContent = '🛒 Sélectionner' }
  } else {
    var idx = parseInt(id)
    savedSelected[idx] = false
    var btn2 = document.getElementById('saved-select-btn-' + idx)
    if (btn2) { btn2.textContent = '🛒 Sélectionner pour la liste'; btn2.style.background = 'rgba(196,113,74,0.08)'; btn2.style.borderColor = 'rgba(196,113,74,0.25)'; btn2.style.color = 'var(--terracotta)' }
  }

  // Recompute ingredients from remaining recipes, preserving manual items
  var manuels = (raw.ingredients || []).filter(function(i) { return i.manuel })
  raw.ingredients = reagregerDepuisRecettes(raw.recettes).concat(manuels)

  if (!raw.recettes.length && !manuels.length) {
    localStorage.removeItem('vitalia_liste_courses')
    localStorage.removeItem('vitalia_courses_vu')
  } else {
    raw.date = new Date().toISOString()
    localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw))
  }
  sauvegarderListeCoursesSupabase()
  afficherListeCoursesProfile()
}

// Change portions for a recipe in the stored list and recompute ingredients
function changerPortionsListeProfile(type, id, delta) {
  var raw = null
  try { raw = JSON.parse(localStorage.getItem('vitalia_liste_courses') || 'null') } catch(e) {}
  if (!raw || !raw.recettes) return

  var recette = raw.recettes.find(function(r) { return r.type === type && String(r.id) === String(id) })
  if (!recette) return

  recette.portions = Math.max(1, Math.min(8, (recette.portions || 2) + delta))

  // Sync in-memory state too
  if (type === 'semaine') {
    semaineServings[id] = recette.portions
    var portEl = document.getElementById('portions-' + id)
    if (portEl) portEl.textContent = recette.portions + ' pers.'
  } else {
    var idx = parseInt(id)
    savedServings[idx] = recette.portions
    var portEl2 = document.getElementById('saved-portions-' + idx)
    if (portEl2) portEl2.textContent = recette.portions
  }

  // Recompute ingredient list from all recipes, preserving manual items
  var manuels = (raw.ingredients || []).filter(function(i) { return i.manuel })
  raw.ingredients = reagregerDepuisRecettes(raw.recettes).concat(manuels)
  // Clear checked items since quantities changed
  localStorage.removeItem('vitalia_courses_vu')
  raw.date = new Date().toISOString()
  localStorage.setItem('vitalia_liste_courses', JSON.stringify(raw))
  afficherListeCoursesProfile()
}

// Redirect to full onboarding edit
function modifierProfilComplet() {
  window.location.href = 'onboarding.html?edit=true' + (profil_id ? '&profil_id=' + profil_id : '')
}

// Clear session and redirect to onboarding
async function deconnexion() {
  if (!confirm('Changer de compte ? Vos données locales seront effacées.')) return
  _deconnexionEnCours = true
  // Déconnecter la session Supabase Auth (invalide le refresh token côté serveur)
  try { await _sb.auth.signOut() } catch(e) {}
  // Effacer toutes les données locales y compris le token Supabase
  var keysToRemove = [
    'vitalia_user_id','vitalia_email','vitalia_profil_id','vitalia_profil',
    'vitalia_profil_complet','vitalia_plan_session_home','vitalia_recettes_sauvegardees',
    'vitalia_favoris','vitalia_liste_courses','vitalia_courses_vu',
    'vitalia_semaine_session','vitalia_recette_session',
    'sb-ptzmyuugxhsbrynjwlhp-auth-token'
  ]
  keysToRemove.forEach(function(k) { localStorage.removeItem(k); sessionStorage.removeItem(k) })
  window.location.href = 'onboarding.html'
}

// ── Sync selected besoins back to Supabase profile ──
async function syncBesoinsVersProfil() {
  if (profilUtilisateur) {
    profilUtilisateur.objectifs_generaux   = selectedSymptoms.slice()
    profilUtilisateur.regimes_alimentaires = selectedRegimes.slice()
    localStorage.setItem('vitalia_profil', JSON.stringify(profilUtilisateur))
  }
  if (!profil_id || profil_id === 'new') return
  try {
    await authFetch(SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + profil_id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY,
                 'Authorization': 'Bearer ' + authToken },
      body: JSON.stringify({ objectifs_generaux: selectedSymptoms, regimes_alimentaires: selectedRegimes })
    })
  } catch(e) {}
}

// ── Check-in quotidien symptômes ──
var SYMPTOM_LABELS_CHECKIN = {
  vitalite: 'Vitalité & Énergie',
  serenite: 'Sérénité',
  digestion: 'Digestion',
  sommeil: 'Sommeil',
  mobilite: 'Mobilité',
  hormones: 'Équilibre hormonal'
}

function afficherCheckinModal() {
  var symptomes = (selectedSymptoms || []).filter(function(s) {
    return SYMPTOM_LABELS_CHECKIN[s]
  })
  if (!symptomes.length) return
  if (document.getElementById('checkinModal')) return

  var slidersHtml = symptomes.map(function(key) {
    var label = SYMPTOM_LABELS_CHECKIN[key] || key
    return '<div class="checkin-slider-row">' +
      '<div class="checkin-slider-label">' +
        '<span class="checkin-slider-name">' + label + '</span>' +
        '<span class="checkin-slider-val" id="checkin-val-' + key + '">5</span>' +
      '</div>' +
      '<input type="range" class="checkin-slider" min="1" max="10" value="5" ' +
        'id="checkin-slider-' + key + '" ' +
        'oninput="document.getElementById(\'checkin-val-' + key + '\').textContent=this.value">' +
      '<div class="checkin-emoji-row"><span>😔 Difficile</span><span>😊 Excellent</span></div>' +
    '</div>'
  }).join('')

  var html = '<div class="checkin-modal" id="checkinModal">' +
    '<div class="checkin-sheet">' +
      '<div class="checkin-handle"></div>' +
      '<div style="font-family:\'Fraunces\',serif;font-size:20px;font-weight:700;' +
           'color:var(--deep-brown);margin-bottom:4px;">Comment tu te sens ?</div>' +
      '<div style="font-size:13px;color:var(--text-light);margin-bottom:24px;">' +
           'Un rapide état des lieux pour affiner tes recommandations</div>' +
      slidersHtml +
      '<button onclick="sauvegarderCheckin()" ' +
        'style="width:100%;background:var(--terracotta);color:white;border:none;' +
        'border-radius:16px;padding:14px;font-size:15px;font-weight:600;' +
        'cursor:pointer;font-family:\'DM Sans\',sans-serif;margin-top:8px;">' +
        'Enregistrer mon ressenti</button>' +
      '<button onclick="fermerCheckinModal(true)" ' +
        'style="width:100%;background:none;border:none;color:var(--text-light);' +
        'font-size:13px;cursor:pointer;margin-top:10px;padding:6px;">' +
        'Pas maintenant</button>' +
    '</div>' +
  '</div>'

  document.body.insertAdjacentHTML('beforeend', html)
}

function fermerCheckinModal(skipToday) {
  var modal = document.getElementById('checkinModal')
  if (modal) modal.remove()
  if (skipToday) {
    var today = new Date().toISOString().split('T')[0]
    localStorage.setItem('vitalia_checkin_date', today)
    var banner = document.getElementById('checkinBanner')
    if (banner) banner.style.display = 'none'
  }
}

async function sauvegarderCheckin() {
  var symptomes = (selectedSymptoms || []).filter(function(s) {
    return SYMPTOM_LABELS_CHECKIN[s]
  })
  if (!symptomes.length) { fermerCheckinModal(true); return }
  if (!profil_id || profil_id === 'new') { fermerCheckinModal(true); return }

  var today = new Date().toISOString().split('T')[0]
  var rows = symptomes.map(function(key) {
    var slider = document.getElementById('checkin-slider-' + key)
    var score  = slider ? parseInt(slider.value) : 5
    return { profil_id: profil_id, date: today, symptome_key: key, score: score }
  })

  try {
    await authFetch(
      SUPABASE_URL + '/rest/v1/checkin_symptomes',
      { method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + authToken,
                   'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(rows) }
    )
    localStorage.setItem('vitalia_checkin_date', today)
    fermerCheckinModal(false)
    var banner = document.getElementById('checkinBanner')
    if (banner) banner.style.display = 'none'
    afficherToast('Ressenti enregistré ! Merci')
    afficherEvolution()
  } catch(e) {
    afficherToast('Erreur lors de l\'enregistrement')
    fermerCheckinModal(true)
  }
}

function verifierCheckinDuJour() {
  var today = new Date().toISOString().split('T')[0]
  var dernierCheckin = localStorage.getItem('vitalia_checkin_date')
  if (dernierCheckin === today) return
  if (!profil_id || profil_id === 'new') return
  var symptomes = (selectedSymptoms || []).filter(function(s) {
    return SYMPTOM_LABELS_CHECKIN[s]
  })
  if (!symptomes.length) return
  var banner = document.getElementById('checkinBanner')
  if (banner) banner.style.display = 'flex'
}

// ── Email digest toggle ──
async function toggleEmailDigest(enabled) {
  var track = document.getElementById('emailDigestTrack')
  var thumb = document.getElementById('emailDigestThumb')
  if (track) track.style.background = enabled ? 'var(--terracotta)' : 'rgba(196,113,74,0.2)'
  if (thumb) thumb.style.transform  = enabled ? 'translateX(20px)' : 'translateX(0)'

  if (!profil_id || profil_id === 'new') return
  try {
    await authFetch(
      SUPABASE_URL + '/rest/v1/profils_utilisateurs?id=eq.' + profil_id,
      { method: 'PATCH',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + authToken },
        body: JSON.stringify({ email_digest: enabled }) }
    )
    afficherToast(enabled ? 'Digest activé — à demain matin ! 🌅' : 'Digest désactivé')
  } catch(e) {
    afficherToast('Erreur lors de la mise à jour')
  }
}

function initialiserEmailDigestToggle(profil) {
  var enabled  = profil && profil.email_digest === true
  var checkbox = document.getElementById('emailDigestToggle')
  var track    = document.getElementById('emailDigestTrack')
  var thumb    = document.getElementById('emailDigestThumb')
  if (checkbox) checkbox.checked       = enabled
  if (track)    track.style.background = enabled ? 'var(--terracotta)' : 'rgba(196,113,74,0.2)'
  if (thumb)    thumb.style.transform  = enabled ? 'translateX(20px)' : 'translateX(0)'
}
