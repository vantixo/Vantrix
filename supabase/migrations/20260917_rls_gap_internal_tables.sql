-- RLS gap fix: 20 tables were created without `ENABLE ROW LEVEL SECURITY`.
--
-- Every one of them is written/read exclusively via supabaseAdmin
-- (service_role) in application code — see banking-engine.ts,
-- employment-engine.ts, housing-engine.ts, taxation-engine.ts,
-- daily-journal.ts, independent-thoughts.ts, character-social-engine.ts,
-- companion-awareness.ts, market-value.ts, etc. None of them are ever
-- queried with the anon/authenticated (publishable) key from app code.
--
-- BUT: Supabase grants `anon` and `authenticated` broad default privileges
-- on every table in the `public` schema at project provisioning time, and
-- auto-exposes every public-schema table through the PostgREST REST API.
-- Without RLS enabled, that means anyone holding the publishable anon key
-- (which ships in every client bundle) could call
-- `GET/POST/PATCH/DELETE https://<project>.supabase.co/rest/v1/<table>`
-- directly and read or write these tables' full contents — completely
-- bypassing the app's server-only access pattern. service_role (used by
-- supabaseAdmin) bypasses RLS regardless, so this fix cannot break any
-- existing application code path.
--
-- Fix: enable RLS with NO policies on each table. Postgres RLS defaults
-- to deny-all once enabled unless a policy explicitly grants access — so
-- this closes the anon/authenticated exposure while leaving service_role
-- access fully intact. If a future feature needs direct client-side
-- access to any of these, add a scoped policy at that time rather than
-- reverting this migration.

ALTER TABLE bank_accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE central_bank_rates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_decisions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_goals           ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_housing         ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_journal         ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_knowledge       ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_long_term_plan  ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_open_threads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_thoughts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE companion_relationships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE housing_market            ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_market                ENABLE ROW LEVEL SECURITY;
ALTER TABLE loans                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_goods              ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_index_history       ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationship_milestones   ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_exemplars           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_policies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_records               ENABLE ROW LEVEL SECURITY;
