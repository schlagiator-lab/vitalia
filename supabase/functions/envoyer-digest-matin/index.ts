// supabase/functions/envoyer-digest-matin/index.ts
// Envoie un email récapitulatif quotidien aux utilisateurs ayant activé email_digest.
// Appelée par pg_cron (6h UTC) ou manuellement.
//
// DEPLOYMENT:
// 1. supabase secrets set RESEND_API_KEY=your_key_here
// 2. supabase functions deploy envoyer-digest-matin
// 3. In Supabase SQL editor, run the pg_cron schedule below
// 4. For testing: send a POST to the function URL manually
//
// pg_cron SETUP — run in Supabase SQL editor after deploying:
// -- select cron.schedule(
// --   'digest-matin-quotidien',
// --   '0 6 * * *',  -- 6h UTC = 7h CET (hiver) / 8h CEST (été)
// --   $$
// --   select net.http_post(
// --     url := 'https://ptzmyuugxhsbrynjwlhp.supabase.co/functions/v1/envoyer-digest-matin',
// --     headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR_ANON_KEY"}'::jsonb,
// --     body := '{}'::jsonb
// --   )
// --   $$
// -- );

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY') || ''

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
}

// ─── Email HTML builder ────────────────────────────────────────────────────

function buildEmailHtml(params: {
  prenom: string
  matin:  string | null
  midi:   string | null
  soir:   string | null
  nutra:  string | null
}): string {
  const { prenom, matin, midi, soir, nutra } = params

  const greeting = prenom ? `Bonjour ${prenom} ☀️` : 'Bonjour ☀️'

  const mealsHtml = [
    { emoji: '🌅', label: 'Petit-déjeuner', nom: matin },
    { emoji: '☀️',  label: 'Déjeuner',       nom: midi  },
    { emoji: '🌙', label: 'Dîner',           nom: soir  },
  ]
    .filter(m => m.nom)
    .map(m => `
      <tr>
        <td style="padding:6px 0;width:130px;color:#9E8070;font-size:13px;">
          ${m.emoji} ${m.label}
        </td>
        <td style="padding:6px 0;font-size:13px;font-weight:600;color:#3D2B1F;">
          ${m.nom}
        </td>
      </tr>`)
    .join('')

  const mealsSection = mealsHtml
    ? `<p style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;
                 color:#C4714A;font-weight:700;margin:20px 0 8px;">Tes repas</p>
       <table style="width:100%;border-collapse:collapse;">${mealsHtml}</table>`
    : `<p style="color:#9E8070;font-size:13px;font-style:italic;">
         Génère ton plan dans Vitalia pour voir tes repas ici.</p>`

  const nutraSection = nutra
    ? `<div style="background:#F8F2E8;border-radius:12px;padding:14px 16px;margin-top:20px;">
         <p style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;
                   color:#C4714A;font-weight:700;margin:0 0 6px;">Ton allie du jour</p>
         <p style="font-size:13px;font-weight:600;color:#3D2B1F;margin:0;">${nutra}</p>
       </div>`
    : ''

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2E9DC;font-family:Georgia,'Times New Roman',serif;">
  <table width="100%" cellpadding="0" cellspacing="0"
         style="background:#F2E9DC;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0"
             style="max-width:480px;background:white;border-radius:16px;
                    padding:28px;font-family:'DM Sans',Arial,sans-serif;">
        <tr><td>

          <!-- Header -->
          <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:700;
                     color:#3D2B1F;margin:0 0 4px;">${greeting}</h1>
          <p style="font-size:14px;color:#9E8070;margin:0 0 24px;">
            Ton plan bien-être du jour</p>

          <!-- Meals -->
          ${mealsSection}

          <!-- Nutra -->
          ${nutraSection}

          <!-- CTA -->
          <div style="text-align:center;margin-top:28px;">
            <a href="https://vitalia.app"
               style="display:inline-block;background:#C4714A;color:white;
                      text-decoration:none;border-radius:12px;padding:12px 28px;
                      font-size:14px;font-weight:600;">Ouvrir Vitalia</a>
          </div>

          <!-- Footer -->
          <p style="font-size:11px;color:#B0A090;text-align:center;margin-top:28px;
                    border-top:1px solid #F2E9DC;padding-top:16px;">
            Tu recois cet email car tu as active le digest dans Vitalia.<br>
            <a href="mailto:support@vitalia.app?subject=Se+desabonner+digest"
               style="color:#B0A090;">Me desabonner</a>
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

// ─── Handler principal ─────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  if (!RESEND_API_KEY) {
    console.log('[digest] RESEND_API_KEY non configuree -- arret')
    return new Response(
      JSON.stringify({ skipped: true, reason: 'no_api_key' }),
      { status: 200, headers: CORS_HEADERS }
    )
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Fetch opted-in profiles with their auth email (limit 50 per run)
  const { data: profiles, error: profilesError } = await supabase
    .from('profils_utilisateurs')
    .select('id, prenom, email_digest')
    .eq('email_digest', true)
    .limit(50)

  if (profilesError) {
    console.log('[digest] Erreur chargement profils:', profilesError.message)
    return new Response(
      JSON.stringify({ success: true, sent: 0, errors: 0 }),
      { status: 200, headers: CORS_HEADERS }
    )
  }

  if (!profiles || profiles.length === 0) {
    console.log('[digest] Aucun profil avec email_digest=true')
    return new Response(
      JSON.stringify({ success: true, sent: 0, errors: 0 }),
      { status: 200, headers: CORS_HEADERS }
    )
  }

  let sent   = 0
  let errors = 0

  for (const profile of profiles) {
    try {
      // Fetch auth email via admin API
      const { data: userData, error: userError } = await supabase
        .auth.admin.getUserById(profile.id)

      if (userError || !userData?.user?.email) {
        console.log('[digest] Email introuvable pour profil', profile.id)
        errors++
        continue
      }

      const email = userData.user.email

      // Fetch most recent journalier plan
      const { data: plans } = await supabase
        .from('plans_generes_cache')
        .select('plan_data, created_at')
        .eq('profil_id', profile.id)
        .eq('source', 'journalier')
        .order('created_at', { ascending: false })
        .limit(1)

      const planData = plans?.[0]?.plan_data || null

      // Normalize keys: matin/midi/soir OR petit_dejeuner/dejeuner/diner
      const matonObj = planData?.matin       || planData?.petit_dejeuner || null
      const midiObj  = planData?.midi        || planData?.dejeuner       || null
      const soirObj  = planData?.soir        || planData?.diner          || null
      const nutraArr = planData?.nutraceutiques || planData?.supplements   || []

      const emailHtml = buildEmailHtml({
        prenom: profile.prenom || '',
        matin:  matonObj?.nom || null,
        midi:   midiObj?.nom  || null,
        soir:   soirObj?.nom  || null,
        nutra:  nutraArr?.[0]?.nom || null,
      })

      // Send via Resend
      const resendResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from:    'Vitalia <onboarding@resend.dev>',
          to:      [email],
          subject: 'Ton plan bien-etre du jour',
          html:    emailHtml,
        }),
      })

      if (resendResp.ok) {
        console.log('[digest] Envoi profil ' + profile.id + ' -> ' + email + ': OK')
        sent++
      } else {
        const errBody = await resendResp.text()
        console.log('[digest] Envoi profil ' + profile.id + ' -> ' + email + ': ERREUR ' + resendResp.status + ' ' + errBody)
        errors++
      }

    } catch (e: any) {
      console.log('[digest] Envoi profil ' + profile.id + ': ERREUR ' + (e?.message || 'inconnue'))
      errors++
    }
  }

  return new Response(
    JSON.stringify({ success: true, sent, errors }),
    { status: 200, headers: CORS_HEADERS }
  )
})
