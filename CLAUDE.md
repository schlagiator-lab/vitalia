# CLAUDE.md — Vitalia

Vitalia is a French-language holistic wellness app for Swiss users (nutrition, nutraceuticals,
aromatherapy, wellness routines). Solo project. All user-facing text is in French (warm,
encouraging, "tu" form, never alarming, never a substitute for medical advice).

## Architecture (do not break it)

Three-tier hybrid engine. The order is a safety guarantee, not a style choice:

1. **Level 1 — Safety filtering** (`niveau1-securite.ts`): excludes contraindications
   (pregnancy, allergies, drug interactions, diets). Runs BEFORE anything else.
2. **Level 2 — Selection** (`niveau2-selection.ts`): contextual scoring, weighted random
   sampling, anti-repetition rotation, feedback bonus.
3. **Level 3 — LLM generation** (`niveau3-llm.ts`, other `generer-*` functions): creative
   recipes, plans, messages via the Anthropic API.

Rules:
- The LLM must NEVER receive ingredients/products that have not passed Level 1.
- Never move, bypass or "simplify away" a safety filter, even to fix a bug elsewhere.
- Red flags / serious symptoms must always point the user to a health professional.

## Stack

- Backend: Supabase Edge Functions (Deno / TypeScript), PostgreSQL, Auth, RLS
- Frontend: plain HTML/JS (`index.html`, `home.html`, `onboarding.html`), no framework
- LLM: Anthropic API, model routing via constants:
  - `MODEL_RECETTE` = Claude Sonnet 5 (recipes, plans)
  - `MODEL_LEGER` = Claude Haiku 4.5 (motivation messages, tips, snacks)
- Data pipeline: Google Sheets → N8N enrichment → Supabase (Apps Script batch upsert)
- Dev environment: GitHub Codespaces, Supabase CLI in `~/.local/bin`

## Working rules (always)

1. **Read before writing.** Open and read every file you are about to modify, and the files
   it imports, before proposing changes.
2. **Surgical changes only.** Touch only what the task requires. Do not reformat, rename,
   reorganise or "improve" adjacent code. If you notice dead code or an unrelated problem,
   mention it in your summary — do not fix it unasked.
3. **Minimum code.** No new abstractions, helpers or files for single-use logic. No new
   dependencies without asking.
4. **State assumptions.** If the task is ambiguous or you must guess about data shape,
   table columns or behaviour, say so explicitly before coding (or ask).
5. **Work in phases.** For multi-step tasks: plan → implement one phase → verify → next.
   End with a short summary: files changed, what changed, what to test.
6. **Success criteria.** Define how to verify the change (a curl call, a log line, a SQL
   query) and run it when possible.

## Must be preserved in every change

- **CORS headers** on every Edge Function response, including errors and the `OPTIONS`
  preflight (`Access-Control-Allow-Origin`, `-Methods`, `-Headers: Content-Type,
  Authorization, apikey`).
- **Fallback logic** (cache fallbacks, default values when the LLM or a query fails).
  Never remove a fallback to make an error "go away".
- **Anti-repetition mechanisms**: weighted random sampling, rotation penalties,
  `historique_items_vus`, community recipe cache with per-profile re-proposal delay.
  Never replace weighted sampling with a deterministic `.slice(0, N)` of top scores.
- **Daily quota guard** (`[GUARD]`, max 5 generations/day per `profil_id`) and its
  exemption logic.
- Existing logging (`console.log` with tags) — keep it, extend it, don't delete it.

## Anthropic API — known pitfalls

- **Sonnet 5 does not accept `temperature`.** Never pass it in `MODEL_RECETTE` calls.
- Prefer structured output via `tool_use` (as in `generer-recette-unique`) over regex
  parsing of free text.
- Sonnet 5 is slower than Haiku: never shorten timeouts, and remember the frontend may
  stop waiting before the backend finishes.
- Never hardcode API keys. Use `Deno.env.get('ANTHROPIC_API_KEY')`.

## Supabase — known pitfalls

- Upserts need a real primary key (composite PKs where relevant), otherwise
  `merge-duplicates` silently inserts duplicates.
- The `service_role` key is server-side only (Edge Functions, Apps Script). It must never
  appear in frontend HTML/JS or in logs. Frontend uses the anon key only.
- Any new table needs RLS considered explicitly — say whether it needs policies.
- Schema changes: propose SQL and wait for confirmation before assuming columns exist.

## Deployment

```bash
supabase functions deploy <function-name> --project-ref ptzmyuugxhsbrynjwlhp
```

Never deploy, run migrations or modify production data without an explicit instruction
in the current prompt.

## Data conventions

- IDs: `ALI_XXX`, `NUT_XXX`, `ARO_XXX`, `ROU_XXX`, `REC_XXX`, `SYMP_XXX`, `SRC_XXX` —
  always 3 digits with leading zeros.
- Google Sheets is the source of truth for reference data; Supabase is production.
- Sheets → Supabase sync: batches of 20 with 1-second pauses (rate limits).

## Current open issues (update as they are fixed)

- Frontend timeout cuts off Sonnet 5 responses (backend saves correctly). Planned fix:
  lazy loading / decoupling generation from the UI wait.
- Routing loop between `home.html` and the top-level route.
- `PROFILS_EXEMPTES` hardcoded Set → to be replaced by a `premium` boolean on profiles.
