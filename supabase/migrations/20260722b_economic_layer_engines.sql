-- Economic Layer Engines — market, inflation, banking, taxation, employment,
-- housing. Sits alongside location_economy (economy.ts, macro aggregate) and
-- resource_inventories (resource-engine.ts, raw goods) as the layer users
-- and characters actually feel: prices, wages, rent, taxes, interest.

-- ── market_goods ─────────────────────────────────────────────────────────
-- Retail/consumer pricing per location per good, distinct from
-- resource-engine.ts's raw wholesale inventories.
create table if not exists market_goods (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references world_locations(id) on delete cascade,
  good_type         text not null,
  base_price        numeric not null default 10,
  current_price     numeric not null default 10,
  demand_index      integer not null default 50 check (demand_index between 0 and 100),
  supply_index      integer not null default 50 check (supply_index between 0 and 100),
  last_ticked_at    timestamptz,
  updated_at        timestamptz not null default now(),
  unique (location_id, good_type)
);
create index if not exists idx_market_goods_location on market_goods(location_id);

-- ── price_index_history ─────────────────────────────────────────────────
-- Rolling CPI-style index per location, source of truth for inflation-engine.ts.
create table if not exists price_index_history (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references world_locations(id) on delete cascade,
  basket_price      numeric not null,
  cpi               numeric not null default 100,
  inflation_rate    numeric not null default 0.02,
  recorded_at       timestamptz not null default now()
);
create index if not exists idx_price_index_location on price_index_history(location_id, recorded_at desc);

-- ── banking ──────────────────────────────────────────────────────────────
create table if not exists bank_accounts (
  id                uuid primary key default gen_random_uuid(),
  character_id      uuid not null references characters(id) on delete cascade,
  location_id       uuid references world_locations(id) on delete set null,
  balance           numeric not null default 0,
  savings_rate      numeric not null default 0.02,
  last_interest_at  timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  unique (character_id)
);

create table if not exists loans (
  id                uuid primary key default gen_random_uuid(),
  character_id      uuid not null references characters(id) on delete cascade,
  principal         numeric not null,
  balance           numeric not null,
  interest_rate     numeric not null,
  status            text not null default 'active' check (status in ('active', 'paid_off', 'defaulted')),
  originated_at     timestamptz not null default now(),
  last_payment_at   timestamptz
);
create index if not exists idx_loans_character on loans(character_id, status);

create table if not exists central_bank_rates (
  location_id       uuid primary key references world_locations(id) on delete cascade,
  base_rate         numeric not null default 0.04,
  updated_at        timestamptz not null default now()
);

-- ── taxation ─────────────────────────────────────────────────────────────
create table if not exists tax_policies (
  location_id       uuid primary key references world_locations(id) on delete cascade,
  income_tax_rate   numeric not null default 0.18,
  sales_tax_rate    numeric not null default 0.07,
  treasury          numeric not null default 0,
  updated_at        timestamptz not null default now()
);

create table if not exists tax_records (
  id                uuid primary key default gen_random_uuid(),
  character_id      uuid references characters(id) on delete cascade,
  location_id       uuid not null references world_locations(id) on delete cascade,
  tax_type          text not null check (tax_type in ('income', 'sales')),
  amount            numeric not null,
  period            text not null, -- e.g. '2026-07'
  recorded_at       timestamptz not null default now()
);
create index if not exists idx_tax_records_character on tax_records(character_id, period);

-- ── employment ───────────────────────────────────────────────────────────
create table if not exists job_market (
  id                uuid primary key default gen_random_uuid(),
  location_id       uuid not null references world_locations(id) on delete cascade,
  industry          text not null,
  openings          integer not null default 0,
  avg_wage          numeric not null default 40000,
  wage_trend        numeric not null default 0,
  updated_at        timestamptz not null default now(),
  unique (location_id, industry)
);
create index if not exists idx_job_market_location on job_market(location_id);

-- ── housing ──────────────────────────────────────────────────────────────
create table if not exists housing_market (
  location_id       uuid primary key references world_locations(id) on delete cascade,
  price_index       numeric not null default 100,
  rent_index        numeric not null default 100,
  vacancy_rate      numeric not null default 0.06,
  updated_at        timestamptz not null default now()
);

create table if not exists character_housing (
  character_id      uuid primary key references characters(id) on delete cascade,
  location_id       uuid references world_locations(id) on delete set null,
  status            text not null default 'renting' check (status in ('renting', 'owns', 'unhoused')),
  monthly_cost      numeric not null default 0,
  updated_at        timestamptz not null default now()
);
