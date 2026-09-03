-- ═══════════════════════════════════════════════════════════════════════
-- Enforce Digital Person — every character gets a persistent brain
-- ═══════════════════════════════════════════════════════════════════════

alter table characters add column if not exists brain_initialized boolean not null default false;
alter table characters add column if not exists writing_style jsonb;
alter table characters add column if not exists voice_profile jsonb;

create index if not exists idx_characters_brain_initialized on characters(brain_initialized) where brain_initialized = false;
