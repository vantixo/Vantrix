/**
 * PHASE3-01 — Character min_tier / is_premium consistency
 *
 * All 20 "Archive of Echoes" characters (20260821_archive_of_echoes_characters.sql)
 * were inserted with is_premium = true but no min_tier in the column list,
 * so they silently took the NOT NULL DEFAULT 'free' — a real value, not
 * NULL, which meant checkCharacterTierAccess()'s `characterMinTier ??
 * (is_premium ? 'spark' : 'free')` fallback never fired. Every one of them
 * has been free to chat with since 2026-08-21 despite being flagged and
 * marketed as premium.
 *
 * 20260919_fix_archive_of_echoes_min_tier.sql backfills the 20 by name,
 * sweeps up any other is_premium=true/min_tier='free' rows the same bug may
 * have produced elsewhere, and installs a trigger so future inserts/updates
 * can't reintroduce the drift even if a column list forgets min_tier again.
 * This test locks in the static properties of that fix; the trigger's
 * runtime behavior was verified against a real Postgres instance directly
 * (see delivery notes for that session), same posture as CODE-06.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const migration = readFileSync(
  join(__dirname, '..', '..', 'supabase', 'migrations', '20260919_fix_archive_of_echoes_min_tier.sql'),
  'utf-8',
);

const ARCHIVE_OF_ECHOES_NAMES = [
  'Aurelian', 'Seraphine Vale', 'Morrow Ash', 'Nyx', 'Cassian Rune',
  'Lyra Starborn', 'The Ferryman', 'Evelyn Thorn', 'Orion Black',
  'Vesper Quinn', 'The Archivist Child', 'Selene Dusk', 'Dr. Elias Voss',
  'Kael Ember', 'Mira Glass', 'The Clockmaker', 'Astra Nocturne',
  'Brother Corvin', 'Valeria Storm', 'The Nameless One',
];

describe('PHASE3-01 — Archive of Echoes min_tier backfill', () => {
  it('names all 20 Archive of Echoes characters in the backfill list', () => {
    for (const name of ARCHIVE_OF_ECHOES_NAMES) {
      expect(migration).toContain(`'${name}'`);
    }
  });

  it('backfills to spark, not premium/elite — matches the floor 20260721_character_tier_separation.sql used for "paid but not VIP" characters', () => {
    expect(migration).toMatch(/SET min_tier = 'spark'/);
  });

  it('includes a general sweep beyond the named list, not just the 20 known names', () => {
    expect(migration).toMatch(
      /UPDATE characters\s*SET min_tier = 'spark'\s*WHERE is_premium = true\s*AND min_tier = 'free';\s*$/m,
    );
  });

  it('installs a trigger to prevent the drift recurring, not just a one-time backfill', () => {
    expect(migration).toMatch(/CREATE TRIGGER trg_sync_character_tier_premium_flag/);
    expect(migration).toMatch(/BEFORE INSERT OR UPDATE OF is_premium, min_tier ON characters/);
  });

  it('trigger function bumps free+premium to spark and syncs is_premium the other direction', () => {
    expect(migration).toMatch(/NEW\.is_premium = true AND NEW\.min_tier = 'free'/);
    expect(migration).toMatch(/NEW\.min_tier := 'spark'/);
    expect(migration).toMatch(/NEW\.min_tier <> 'free' AND NEW\.is_premium = false/);
    expect(migration).toMatch(/NEW\.is_premium := true/);
  });
});
