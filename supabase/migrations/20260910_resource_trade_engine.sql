-- Resource Trade Engine — Trade Ledger
--
-- trade-engine.ts's own header comment cites this migration by name
-- ("supabase/migrations/20260910_resource_trade_engine.sql") but it was
-- never actually written — executeTrade() inserts into resource_trades
-- on every settled trade, and that table did not exist anywhere in the
-- schema. This migration completes that gap.
--
-- No country/nation table: trade-engine.ts unifies location <-> location,
-- location <-> company, and company <-> company trades through the same
-- ResourceHolder shape (see resource-engine.ts), so a single ledger with
-- a from_type/to_type discriminator covers every pairing.

-- ── Resource Inventories ─────────────────────────────────────────────────────
-- Backs resource-engine.ts's getInventory/adjustQuantity/bootstrapInventory —
-- referenced via tableFor()/idColumnFor() but never migrated.

create table if not exists location_resources (
  id             uuid primary key default gen_random_uuid(),
  location_id    uuid not null references world_locations(id) on delete cascade,
  resource_type  text not null check (resource_type in ('iron', 'food', 'water', 'energy', 'technology')),
  quantity       numeric not null default 0 check (quantity >= 0),
  updated_at     timestamptz not null default now(),
  constraint location_resources_unique unique (location_id, resource_type)
);

create index if not exists idx_location_resources_location on location_resources(location_id);

create table if not exists company_resources (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  resource_type  text not null check (resource_type in ('iron', 'food', 'water', 'energy', 'technology')),
  quantity       numeric not null default 0 check (quantity >= 0),
  updated_at     timestamptz not null default now(),
  constraint company_resources_unique unique (company_id, resource_type)
);

create index if not exists idx_company_resources_company on company_resources(company_id);

alter table location_resources enable row level security;
alter table company_resources  enable row level security;
create policy "public read location_resources" on location_resources for select using (true);
create policy "public read company_resources"  on company_resources  for select using (true);

create table if not exists resource_trades (
  id             uuid primary key default gen_random_uuid(),
  from_type      text    not null check (from_type in ('location', 'company')),
  from_id        uuid    not null,
  to_type        text    not null check (to_type in ('location', 'company')),
  to_id          uuid    not null,
  resource_type  text    not null,
  quantity       numeric not null check (quantity > 0),
  unit_price     numeric not null default 0,
  total_value    numeric not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_resource_trades_from on resource_trades(from_type, from_id);
create index if not exists idx_resource_trades_to   on resource_trades(to_type, to_id);
create index if not exists idx_resource_trades_created_at on resource_trades(created_at desc);

alter table resource_trades enable row level security;
create policy "public read resource_trades" on resource_trades for select using (true);
