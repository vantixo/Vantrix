-- Company Engine — Character-Founded Businesses
--
-- Fills the gap between companion_occupations.employer (a free-text string
-- with no identity of its own) and location_economy (a city-level GDP/
-- unemployment aggregate with no notion of individual firms): an actual
-- company entity a character can found, staff with other characters, and
-- compete against rival companies in the same industry/location for
-- market share. See src/lib/universe/company-engine.ts for the tick logic.
--
-- Employment at a founded company is layered onto the EXISTING
-- companion_occupations table via a new nullable company_id column, rather
-- than a parallel employment table — companion_occupations already owns
-- the "one active job per character" invariant (companion_occupations_
-- unique) and the salary/location columns a company job needs. Characters
-- whose employer was never founded on-screen (a hospital, a government
-- office, "Independent") are completely unaffected: company_id stays null
-- and the free-text employer field keeps working exactly as before.

-- ── Companies ─────────────────────────────────────────────────────────────────

create table if not exists companies (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  founder_character_id uuid not null references characters(id) on delete cascade,
  location_id          uuid not null references world_locations(id) on delete cascade,
  industry             text not null default 'services',
  -- Starting cash on hand. Bootstrapped from the founder's occupation
  -- prestige/salary at founding time — see foundCompany() in
  -- company-engine.ts — then drifts with hiring, competition, and bankruptcy.
  capital              bigint not null default 10000 check (capital >= 0),
  -- Share of its (location_id, industry) bucket, zero-sum against every
  -- other active company in the same bucket. Starts modest; competition
  -- ticks move it. Not a share of location_economy.gdp directly — that
  -- stays a city-wide aggregate the company engine reads but never writes.
  market_share         numeric not null default 5 check (market_share between 0 and 100),
  reputation           integer not null default 50 check (reputation between 0 and 100),
  employee_count       integer not null default 0 check (employee_count >= 0),
  status               text not null default 'active'
                          check (status in ('active', 'struggling', 'bankrupt', 'acquired')),
  founded_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_companies_founder  on companies(founder_character_id);
create index if not exists idx_companies_location on companies(location_id);
-- The bucket every competition/hiring pass groups by.
create index if not exists idx_companies_industry_bucket on companies(location_id, industry, status);
create index if not exists idx_companies_status   on companies(status);

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'companies_updated_at') then
    create trigger companies_updated_at
      before update on companies for each row execute function touch_updated_at();
  end if;
end $$;

-- ── Employment link (additive) ───────────────────────────────────────────────

alter table companion_occupations
  add column if not exists company_id uuid references companies(id) on delete set null;

create index if not exists idx_companion_occupations_company on companion_occupations(company_id);

-- ── Founder convenience view ─────────────────────────────────────────────────
-- Read-only helper for the admin/UI layer — not used by company-engine.ts
-- itself, which queries the base tables directly for tick logic.

create or replace view company_roster as
select
  co.company_id,
  co.character_id,
  c.name as character_name,
  co.salary,
  co.started_at,
  (co.character_id = comp.founder_character_id) as is_founder
from companion_occupations co
join characters c on c.id = co.character_id
join companies comp on comp.id = co.company_id
where co.company_id is not null;

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table companies enable row level security;
create policy "public read companies" on companies for select using (true);
