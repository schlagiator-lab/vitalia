import { SUPABASE_URL, SUPABASE_ANON_KEY, st } from './state.js'
import { authFetch } from './auth.js'
import { afficherToast } from './ui.js'

// ── Check-in quotidien symptômes ──
export var SYMPTOM_LABELS_CHECKIN = {
  vitalite: 'Vitalité & Énergie',
  serenite: 'Sérénité',
  digestion: 'Digestion',
  sommeil: 'Sommeil',
  mobilite: 'Mobilité',
  hormones: 'Équilibre hormonal'
}

var SYMPTOM_ICONS = {
  vitalite: '⚡', serenite: '🧘', digestion: '🌿',
  sommeil: '🌙', mobilite: '💪', hormones: '⚖️'
}

export async function afficherCheckinModal() {
  // Afficher tous les objectifs santé disponibles à chaque check-in
  var symptomes = Object.keys(SYMPTOM_LABELS_CHECKIN)
  if (!symptomes.length) return
  if (document.getElementById('checkinModal')) return

  // Charger l'historique récent pour le contexte (7 derniers jours)
  var moyennesParSymptome = {}
  var hierParSymptome = {}

  if (st.profil_id && st.profil_id !== 'new') {
    try {
      var since = new Date()
      since.setDate(since.getDate() - 7)
      var resp = await authFetch(
        SUPABASE_URL + '/rest/v1/checkin_symptomes' +
        '?profil_id=eq.' + st.profil_id +
        '&date=gte.' + since.toISOString().split('T')[0] +
        '&order=date.asc&limit=200',
        { method: 'GET',
          headers: { 'Content-Type': 'application/json',
                     'apikey': SUPABASE_ANON_KEY,
                     'Authorization': 'Bearer ' + st.authToken } }
      )
      var rows = await resp.json()
      if (Array.isArray(rows)) {
        var bySymptom = {}
        rows.forEach(function(r) {
          if (!bySymptom[r.symptome_key]) bySymptom[r.symptome_key] = []
          bySymptom[r.symptome_key].push({ date: r.date, score: r.score })
        })
        var yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        var yDate = yesterday.toISOString().split('T')[0]
        Object.keys(bySymptom).forEach(function(key) {
          var data = bySymptom[key]
          moyennesParSymptome[key] = Math.round(
            data.reduce(function(s, d) { return s + d.score }, 0) / data.length * 10
          ) / 10
          var hierData = data.filter(function(d) { return d.date === yDate })
          if (hierData.length) {
            hierParSymptome[key] = Math.round(
              hierData.reduce(function(s, d) { return s + d.score }, 0) / hierData.length
            )
          }
        })
      }
    } catch(e) {}
  }

  // Trouver le besoin prioritaire (moyenne la plus basse sur 7j)
  var prioriteKey = null
  var minMoy = 11
  symptomes.forEach(function(key) {
    if (moyennesParSymptome[key] !== undefined && moyennesParSymptome[key] < minMoy) {
      minMoy = moyennesParSymptome[key]
      prioriteKey = key
    }
  })

  // Bannière besoin prioritaire
  var prioriteHtml = ''
  if (prioriteKey) {
    prioriteHtml =
      '<div class="checkin-priority">' +
        '<div class="checkin-priority-label">🎯 Besoin à cibler</div>' +
        '<div class="checkin-priority-name">' +
          SYMPTOM_ICONS[prioriteKey] + ' ' + SYMPTOM_LABELS_CHECKIN[prioriteKey] +
        '</div>' +
        '<div class="checkin-priority-avg">Moyenne 7 jours · ' + minMoy + '/10</div>' +
      '</div>'
  }

  // Sliders — pré-remplis avec les valeurs d'hier (ou 5 par défaut)
  var slidersHtml = symptomes.map(function(key) {
    var label     = SYMPTOM_LABELS_CHECKIN[key] || key
    var icon      = SYMPTOM_ICONS[key] || ''
    var hierScore = hierParSymptome[key]
    var initVal   = hierScore !== undefined ? hierScore : 5
    var isPriority = key === prioriteKey
    return '<div class="checkin-slider-row' + (isPriority ? ' checkin-priority-item' : '') + '">' +
      '<div class="checkin-slider-label">' +
        '<span class="checkin-slider-name">' + icon + ' ' + label + '</span>' +
        '<span class="checkin-slider-val" id="checkin-val-' + key + '">' + initVal + '</span>' +
      '</div>' +
      '<input type="range" class="checkin-slider" min="1" max="10" value="' + initVal + '" ' +
        'id="checkin-slider-' + key + '" ' +
        'oninput="document.getElementById(\'checkin-val-' + key + '\').textContent=this.value">' +
    '</div>'
  }).join('')

  var html = '<div class="checkin-modal" id="checkinModal">' +
    '<div class="checkin-sheet">' +
      '<div class="checkin-handle"></div>' +
      '<div style="font-family:\'Fraunces\',serif;font-size:18px;font-weight:700;' +
           'color:var(--deep-brown);margin-bottom:2px;">Comment tu te sens ?</div>' +
      '<div style="font-size:12px;color:var(--text-light);margin-bottom:10px;' +
           'display:flex;justify-content:space-between;">' +
           '<span>Glisse horizontalement pour noter</span>' +
           '<span style="color:var(--terracotta);">😔 1 · · · 10 😊</span>' +
      '</div>' +
      prioriteHtml +
      slidersHtml +
      '<button onclick="sauvegarderCheckin()" ' +
        'style="width:100%;background:var(--terracotta);color:white;border:none;' +
        'border-radius:16px;padding:13px;font-size:15px;font-weight:600;' +
        'cursor:pointer;font-family:\'DM Sans\',sans-serif;margin-top:10px;">' +
        'Enregistrer mon ressenti</button>' +
      '<button onclick="fermerCheckinModal(false)" ' +
        'style="width:100%;background:none;border:none;color:var(--text-light);' +
        'font-size:13px;cursor:pointer;margin-top:6px;padding:4px;">' +
        'Pas maintenant</button>' +
    '</div>' +
  '</div>'

  document.body.insertAdjacentHTML('beforeend', html)

  // Fix 2 — bloquer les glissements verticaux qui modifient accidentellement les sliders
  document.querySelectorAll('#checkinModal .checkin-slider').forEach(function(slider) {
    var startX, startY, startVal
    slider.addEventListener('touchstart', function(e) {
      startX   = e.touches[0].clientX
      startY   = e.touches[0].clientY
      startVal = parseFloat(slider.value)
    }, { passive: true })
    slider.addEventListener('touchmove', function(e) {
      var dx = Math.abs(e.touches[0].clientX - startX)
      var dy = Math.abs(e.touches[0].clientY - startY)
      if (dy > dx) {
        // mouvement principalement vertical → annuler le changement de valeur
        slider.value = startVal
        var key = slider.id.replace('checkin-slider-', '')
        var valEl = document.getElementById('checkin-val-' + key)
        if (valEl) valEl.textContent = startVal
      }
    }, { passive: true })
  })
}

export function fermerCheckinModal(skipToday) {
  var modal = document.getElementById('checkinModal')
  if (modal) modal.remove()
  if (skipToday) {
    var today = new Date().toISOString().split('T')[0]
    localStorage.setItem('vitalia_checkin_date', today)
    var banner = document.getElementById('checkinBanner')
    if (banner) banner.style.display = 'none'
  }
}

export async function sauvegarderCheckin() {
  var symptomes = Object.keys(SYMPTOM_LABELS_CHECKIN)
  if (!symptomes.length) { fermerCheckinModal(true); return }
  if (!st.profil_id || st.profil_id === 'new') { fermerCheckinModal(true); return }

  var today = new Date().toISOString().split('T')[0]
  var rows = symptomes.map(function(key) {
    var slider = document.getElementById('checkin-slider-' + key)
    var score  = slider ? parseInt(slider.value) : 5
    return { profil_id: st.profil_id, date: today, symptome_key: key, score: score }
  })

  try {
    await authFetch(
      SUPABASE_URL + '/rest/v1/checkin_symptomes',
      { method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + st.authToken,
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

export function verifierCheckinDuJour() {
  var today = new Date().toISOString().split('T')[0]
  var dernierCheckin = localStorage.getItem('vitalia_checkin_date')
  if (dernierCheckin === today) return
  if (!st.profil_id || st.profil_id === 'new') return
  var symptomes = (st.selectedSymptoms || []).filter(function(s) {
    return SYMPTOM_LABELS_CHECKIN[s]
  })
  if (!symptomes.length) return
  var banner = document.getElementById('checkinBanner')
  if (banner) banner.style.display = 'flex'
}

// ── Évolution (sparklines) ──
export async function afficherEvolution() {
  var container = document.getElementById('evolutionCharts')
  if (!container) return
  if (!st.profil_id || st.profil_id === 'new') {
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
      '?profil_id=eq.' + st.profil_id +
      '&date=gte.' + sinceStr +
      '&order=date.asc&limit=200',
      { method: 'GET',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + st.authToken } }
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
    var ICONS = { vitalite:'⚡', serenite:'🧘', digestion:'🌿', sommeil:'🌙', mobilite:'💪', hormones:'⚖️' }

    var avg = function(arr) {
      return arr.length ? arr.reduce(function(s,d){return s+d.score},0)/arr.length : null
    }

    // ── Rose radar globale ──
    var radarKeys = Object.keys(LABELS)
    var radarScores = radarKeys.map(function(k) {
      var d = bySymptom[k]
      return d && d.length ? Math.round(avg(d.slice(-7)) * 10) / 10 : null
    })
    var hasRadarData = radarScores.some(function(s) { return s !== null })
    var radarHtml = ''
    if (hasRadarData) {
      var cx = 110; var cy = 110; var maxR = 90; var n = radarKeys.length
      function radarPt(idx, val) {
        var angle = (idx / n) * 2 * Math.PI - Math.PI / 2
        var r = (val / 10) * maxR
        return [(cx + r * Math.cos(angle)).toFixed(1), (cy + r * Math.sin(angle)).toFixed(1)]
      }
      // Grilles
      var gridSvg = ''
      ;[2, 4, 6, 8, 10].forEach(function(g) {
        var gPts = radarKeys.map(function(_, i) {
          var p = radarPt(i, g); return p[0] + ',' + p[1]
        }).join(' ')
        gridSvg += '<polygon points="' + gPts + '" fill="none" stroke="rgba(196,113,74,0.12)" stroke-width="1"/>'
      })
      // Axes
      var axesSvg = radarKeys.map(function(k, i) {
        var p = radarPt(i, 10)
        return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0] + '" y2="' + p[1] + '" stroke="rgba(196,113,74,0.15)" stroke-width="1"/>'
      }).join('')
      // Polygone scores
      var scorePts = radarKeys.map(function(k, i) {
        var s = radarScores[i] !== null ? radarScores[i] : 0
        var p = radarPt(i, s); return p[0] + ',' + p[1]
      }).join(' ')
      // Labels + points
      var labelsSvg = radarKeys.map(function(k, i) {
        var angle = (i / n) * 2 * Math.PI - Math.PI / 2
        var lx = (cx + (maxR + 18) * Math.cos(angle)).toFixed(1)
        var ly = (cy + (maxR + 18) * Math.sin(angle)).toFixed(1)
        var anchor = Math.cos(angle) > 0.1 ? 'start' : Math.cos(angle) < -0.1 ? 'end' : 'middle'
        var s = radarScores[i]
        var p = radarPt(i, s !== null ? s : 0)
        return '<text x="' + lx + '" y="' + ly + '" text-anchor="' + anchor + '" ' +
          'font-family="DM Sans,sans-serif" font-size="11" fill="var(--deep-brown)" dominant-baseline="middle">' +
          ICONS[k] + ' ' + (LABELS[k] || k).split(' ')[0] + (s !== null ? ' · ' + s : '') + '</text>' +
          '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="4" fill="var(--terracotta)"/>'
      }).join('')

      radarHtml = '<div style="background:var(--card-bg);border-radius:16px;border:1px solid var(--card-border);' +
        'padding:16px;box-shadow:var(--card-shadow);margin-bottom:14px;">' +
        '<div style="font-size:13px;font-weight:600;color:var(--deep-brown);margin-bottom:12px;">🌸 Vue globale · 7 derniers jours</div>' +
        '<div style="display:flex;justify-content:center;">' +
        '<svg viewBox="-80 -10 380 240" style="width:100%;height:auto;">' +
        gridSvg + axesSvg +
        '<polygon points="' + scorePts + '" fill="rgba(196,113,74,0.18)" stroke="var(--terracotta)" stroke-width="2" stroke-linejoin="round"/>' +
        labelsSvg +
        '</svg></div></div>'
    }

    var html = radarHtml
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

    // ── Aujourd'hui : rose radar + besoin à cibler ──
    var evoSection = document.getElementById('evolutionSection')
    var evoContent = document.getElementById('evolutionContent')
    if (evoSection && evoContent && symptomKeys.length) {
      // Radar 7 derniers jours
      var radarKeys2 = Object.keys(LABELS)
      var radarScores2 = radarKeys2.map(function(k) {
        var d = bySymptom[k]
        return d && d.length ? Math.round(avg(d.filter(function(x) {
          return Math.floor((new Date() - new Date(x.date)) / 86400000) <= 7
        }).concat(d.length ? [d[d.length-1]] : []).slice(0,7)) * 10) / 10 : null
      })
      // Recalcul propre : moyenne 7j par symptôme
      radarScores2 = radarKeys2.map(function(k) {
        var d = bySymptom[k]; if (!d || !d.length) return null
        var recent = d.filter(function(x) { return Math.floor((new Date() - new Date(x.date)) / 86400000) <= 7 })
        return recent.length ? Math.round(avg(recent) * 10) / 10 : Math.round(d[d.length-1].score * 10) / 10
      })

      var cx2 = 110; var cy2 = 110; var maxR2 = 84; var n2 = radarKeys2.length
      function rpt(i, v) {
        var a = (i / n2) * 2 * Math.PI - Math.PI / 2
        return [(cx2 + v * maxR2 / 10 * Math.cos(a)).toFixed(1), (cy2 + v * maxR2 / 10 * Math.sin(a)).toFixed(1)]
      }
      var gridSvg2 = ''
      ;[2,4,6,8,10].forEach(function(g) {
        gridSvg2 += '<polygon points="' + radarKeys2.map(function(_, i) { var p=rpt(i,g); return p[0]+','+p[1] }).join(' ') + '" fill="none" stroke="rgba(196,113,74,0.12)" stroke-width="1"/>'
      })
      var axesSvg2 = radarKeys2.map(function(_, i) { var p=rpt(i,10); return '<line x1="'+cx2+'" y1="'+cy2+'" x2="'+p[0]+'" y2="'+p[1]+'" stroke="rgba(196,113,74,0.15)" stroke-width="1"/>' }).join('')
      var scorePts2 = radarKeys2.map(function(k, i) { var s=radarScores2[i]!==null?radarScores2[i]:0; var p=rpt(i,s); return p[0]+','+p[1] }).join(' ')
      var labelsSvg2 = radarKeys2.map(function(k, i) {
        var a = (i / n2) * 2 * Math.PI - Math.PI / 2
        var lx = (cx2 + (maxR2 + 20) * Math.cos(a)).toFixed(1)
        var ly = (cy2 + (maxR2 + 20) * Math.sin(a)).toFixed(1)
        var anchor = Math.cos(a) > 0.1 ? 'start' : Math.cos(a) < -0.1 ? 'end' : 'middle'
        var s = radarScores2[i]; var p = rpt(i, s !== null ? s : 0)
        return '<text x="'+lx+'" y="'+ly+'" text-anchor="'+anchor+'" font-family="DM Sans,sans-serif" font-size="11" fill="var(--deep-brown)" dominant-baseline="middle">'+ICONS[k]+' '+(LABELS[k]||k).split(' ')[0]+(s!==null?' · '+s:'')+'</text>'+
               '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="4" fill="var(--terracotta)"/>'
      }).join('')

      // Besoin prioritaire (moyenne 7j la plus basse)
      var prioKey2 = null; var prioMin2 = 11
      radarKeys2.forEach(function(k, i) {
        var s = radarScores2[i]; if (s !== null && s < prioMin2) { prioMin2 = s; prioKey2 = k }
      })
      var prioHtml2 = ''
      if (prioKey2) {
        prioHtml2 = '<div style="background:linear-gradient(135deg,rgba(196,113,74,0.08),rgba(232,184,75,0.06));' +
          'border:1px solid rgba(196,113,74,0.2);border-radius:14px;padding:12px 14px;margin-top:12px;">' +
          '<div style="font-size:11px;font-weight:700;color:var(--terracotta);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">🎯 Besoin à cibler</div>' +
          '<div style="font-size:15px;font-weight:700;color:var(--deep-brown);">' + ICONS[prioKey2] + ' ' + LABELS[prioKey2] + '</div>' +
          '<div style="font-size:12px;color:var(--text-light);margin-top:2px;">Moyenne 7 jours · ' + prioMin2 + '/10</div>' +
          '</div>'
      }

      evoContent.innerHTML =
        '<div style="display:flex;justify-content:center;">' +
        '<svg viewBox="-80 -10 380 240" style="width:100%;height:auto;">' +
        gridSvg2 + axesSvg2 +
        '<polygon points="' + scorePts2 + '" fill="rgba(196,113,74,0.18)" stroke="var(--terracotta)" stroke-width="2" stroke-linejoin="round"/>' +
        labelsSvg2 + '</svg></div>' +
        prioHtml2 +
        '<div style="text-align:center;margin-top:10px;">' +
        '<button onclick="ouvrirSheet(\'evolution\')" style="background:none;border:1px solid rgba(196,113,74,0.2);border-radius:10px;padding:7px 16px;font-size:12px;color:var(--mid-brown);cursor:pointer;font-family:\'DM Sans\',sans-serif;">Voir toutes les courbes →</button>' +
        '</div>'
      evoSection.style.display = ''
    }

  } catch(e) {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-light);' +
      'font-size:13px;">Impossible de charger l\'évolution</div>'
  }
}

// ── Historique compact (Aujourd'hui tab) ──
export async function afficherHistoriqueCompact() {
  var section = document.getElementById('historiqueCompactSection')
  var content = document.getElementById('historiqueCompactContent')
  if (!section || !content) return
  if (!st.profil_id || st.profil_id === 'new') return

  try {
    var resp = await authFetch(
      SUPABASE_URL + '/rest/v1/plans_generes_cache' +
      '?profil_id=eq.' + st.profil_id +
      '&source=eq.journalier' +
      '&order=created_at.desc&limit=4',
      { method: 'GET',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + st.authToken } }
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

// ── Injection scores dans l'historique ──
export async function injecterScoresHistorique(plans) {
  if (!st.profil_id || st.profil_id === 'new') return
  var dates = plans.map(function(r) {
    return new Date(r.created_at || r.updated_at).toISOString().split('T')[0]
  })
  var minDate = dates[dates.length - 1]
  try {
    var resp = await authFetch(
      SUPABASE_URL + '/rest/v1/checkin_symptomes' +
      '?profil_id=eq.' + st.profil_id +
      '&date=gte.' + minDate +
      '&select=date,score',
      { method: 'GET',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + st.authToken } }
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

// ── Historique complet (À faire tab) ──
export async function afficherHistorique() {
  var container = document.getElementById('historiqueListe')
  if (!container) return
  if (!st.profil_id || st.profil_id === 'new') {
    container.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-light);font-size:13px;">Connecte-toi pour voir ton historique</div>'
    return
  }

  var MEAL_LABELS = { matin: 'Petit-déj', midi: 'Déjeuner', soir: 'Dîner' }
  var MEAL_EMOJIS = { matin: '🌅', midi: '☀️', soir: '🌙' }

  try {
    var resp = await authFetch(
      SUPABASE_URL + '/rest/v1/plans_generes_cache' +
      '?profil_id=eq.' + st.profil_id +
      '&source=eq.journalier' +
      '&order=created_at.desc&limit=7',
      { method: 'GET',
        headers: { 'Content-Type': 'application/json',
                   'apikey': SUPABASE_ANON_KEY,
                   'Authorization': 'Bearer ' + st.authToken } }
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
