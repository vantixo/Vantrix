/**
 * Character Evolution Engine — Vantrix Legacy Systems
 *
 * "No character remains static." Implements the deep attribute layer from
 * the master prompt: characters become wealthy or lose wealth, gain or lose
 * confidence, develop or overcome addictions, gain skills, and have health
 * that fluctuates with their life circumstances.
 *
 * This is intentionally decoupled from life-engine.ts (which handles daily
 * activity/mood) — this engine runs less frequently and handles slower,
 * more consequential change. Both write into the same companion_offline_log
 * pipeline so they surface together in the feed and prompt context.
 */

import { supabaseAdmin }   from '@/lib/supabase/admin';
import { logger }          from '@/lib/logger';
import { narrate }         from './narrator';
import { logOfflineEntry } from './life-engine';
import type { CharacterAttributes } from '@/types/legacy-systems';

const ADDICTION_POOL = ['nicotine', 'gambling', 'a stimulant the doctors keep warning about', 'work itself', 'a particular nightlife scene'];
const SKILL_POOL = ['negotiation', 'combat', 'rhetoric', 'research', 'craftsmanship', 'leadership', 'deception', 'empathy', 'strategy', 'endurance'];

// ── Read ───────────────────────────────────────────────────────────────────────

export async function getCharacterAttributes(characterId: string): Promise<CharacterAttributes | null> {
  const { data, error } = await supabaseAdmin
    .from('character_attributes')
    .select('*')
    .eq('character_id', characterId)
    .maybeSingle();

  if (data) return data as CharacterAttributes;

  // A missing row (not a query error) means this character was never
  // provisioned into the universe simulation — historically true for every
  // canon character seeded before 20260806_connect_characters_to_universe
  // .sql, and still possible for any character created outside that
  // backfill. Rather than let every caller (gainSkill, developAddiction,
  // overcomeAddiction, formatAttributesForPrompt) silently no-op forever,
  // self-heal by provisioning sane defaults on first read. Race-safe via
  // upsert — a concurrent first-read from two requests won't duplicate.
  if (!error) {
    const { data: created, error: upsertErr } = await supabaseAdmin
      .from('character_attributes')
      .upsert(
        { character_id: characterId },
        { onConflict: 'character_id', ignoreDuplicates: false },
      )
      .select('*')
      .maybeSingle();

    if (upsertErr) {
      logger.error('character-evolution: failed to self-heal missing character_attributes row', {
        characterId, error: upsertErr.message,
      });
      return null;
    }
    return created as CharacterAttributes | null;
  }

  return null;
}

// ── Write — discrete life events (can be called from anywhere) ────────────────

export async function applyWealthChange(characterId: string, delta: number, reason?: string): Promise<void> {
  const { data: char } = await supabaseAdmin.from('characters').select('name').eq('id', characterId).single();
  await supabaseAdmin.rpc('adjust_net_worth', { p_character_id: characterId, p_delta: delta });

  await logOfflineEntry(
    characterId,
    'wealth_change',
    reason ?? narrate.wealthChange(delta, char?.name ?? 'They'),
    { emotionalTone: delta >= 0 ? 'positive' : 'negative' },
  );
}

export async function applyHealthChange(characterId: string, delta: number): Promise<void> {
  const { data: char } = await supabaseAdmin.from('characters').select('name').eq('id', characterId).single();
  await supabaseAdmin.rpc('adjust_character_attribute', { p_character_id: characterId, p_field: 'health', p_delta: delta });

  await logOfflineEntry(
    characterId,
    'health_change',
    narrate.healthChange(delta, char?.name ?? 'They'),
    { emotionalTone: delta >= 0 ? 'positive' : 'negative' },
  );
}

export async function applyConfidenceShift(characterId: string, delta: number): Promise<void> {
  const { data: char } = await supabaseAdmin.from('characters').select('name').eq('id', characterId).single();
  await supabaseAdmin.rpc('adjust_character_attribute', { p_character_id: characterId, p_field: 'confidence', p_delta: delta });

  await logOfflineEntry(
    characterId,
    'confidence_shift',
    narrate.confidenceShift(delta, char?.name ?? 'They'),
    { emotionalTone: delta >= 0 ? 'positive' : 'negative' },
  );
}

export async function gainSkill(characterId: string, skill: string, amount: number): Promise<void> {
  const attrs = await getCharacterAttributes(characterId);
  if (!attrs) return;

  const current = attrs.skills[skill] ?? 0;
  const updated = { ...attrs.skills, [skill]: Math.min(100, current + amount) };

  await supabaseAdmin.from('character_attributes').update({ skills: updated }).eq('character_id', characterId);

  if (current < 50 && updated[skill]! >= 50) {
    const { data: char } = await supabaseAdmin.from('characters').select('name').eq('id', characterId).single();
    await logOfflineEntry(
      characterId,
      'skill_gained',
      `${char?.name ?? 'They'} have become genuinely skilled at ${skill}. It didn't happen overnight.`,
      { emotionalTone: 'positive' },
    );
  }
}

export async function developAddiction(characterId: string, substance: string): Promise<void> {
  const attrs = await getCharacterAttributes(characterId);
  if (!attrs || attrs.addictions.includes(substance)) return;

  await supabaseAdmin.from('character_attributes')
    .update({ addictions: [...attrs.addictions, substance] })
    .eq('character_id', characterId);

  const { data: char } = await supabaseAdmin.from('characters').select('name').eq('id', characterId).single();
  await logOfflineEntry(
    characterId,
    'addiction_developed',
    narrate.addictionDeveloped(char?.name ?? 'They', substance),
    { emotionalTone: 'concerning' },
  );
}

export async function overcomeAddiction(characterId: string, substance: string): Promise<void> {
  const attrs = await getCharacterAttributes(characterId);
  if (!attrs || !attrs.addictions.includes(substance)) return;

  await supabaseAdmin.from('character_attributes').update({
    addictions:           attrs.addictions.filter(a => a !== substance),
    overcome_addictions:  [...attrs.overcome_addictions, substance],
  }).eq('character_id', characterId);

  const { data: char } = await supabaseAdmin.from('characters').select('name').eq('id', characterId).single();
  await logOfflineEntry(
    characterId,
    'addiction_overcome',
    narrate.addictionOvercome(char?.name ?? 'They', substance),
    { emotionalTone: 'triumphant' },
  );
}

// ── Tick: slow probabilistic life drift ────────────────────────────────────────
// Runs alongside status_tick. Much lower frequency / probability than
// life-engine's daily activity ticks — these are the "big" changes.

export async function tickCharacterEvolution(): Promise<{ evaluated: number; events: number }> {
  const { data: characters } = await supabaseAdmin
    .from('character_attributes')
    .select('character_id, health, confidence, net_worth, addictions, skills')
    .limit(200);

  if (!characters?.length) return { evaluated: 0, events: 0 };

  let events = 0;

  for (const c of characters) {
    const roll = Math.random();

    // Wealth drift (occupation salary contributes via companion-jobs payroll separately;
    // this models windfalls, losses, investments, gifts)
    if (roll < 0.08) {
      const delta = randInt(-15000, 25000);
      if (Math.abs(delta) > 2000) { await applyWealthChange(c.character_id, delta); events++; }
    }

    // Health drift
    if (roll > 0.08 && roll < 0.14) {
      const delta = randInt(-12, 10);
      if (Math.abs(delta) >= 6) { await applyHealthChange(c.character_id, delta); events++; }
    }

    // Confidence drift
    if (roll > 0.14 && roll < 0.20) {
      const delta = randInt(-15, 15);
      if (Math.abs(delta) >= 8) { await applyConfidenceShift(c.character_id, delta); events++; }
    }

    // Skill gain (low chance, ties to whatever they're already doing per life-engine)
    if (roll > 0.20 && roll < 0.30) {
      const skill = SKILL_POOL[Math.floor(Math.random() * SKILL_POOL.length)]!;
      await gainSkill(c.character_id, skill, randInt(2, 8));
    }

    // Addiction development — rare, tied to low confidence/health
    if (c.confidence < 25 && c.addictions.length < 2 && Math.random() < 0.03) {
      const substance = ADDICTION_POOL[Math.floor(Math.random() * ADDICTION_POOL.length)]!;
      if (!c.addictions.includes(substance)) { await developAddiction(c.character_id, substance); events++; }
    }

    // Addiction recovery — rare, tied to high confidence/health
    if (c.confidence > 70 && c.health > 70 && c.addictions.length > 0 && Math.random() < 0.05) {
      await overcomeAddiction(c.character_id, c.addictions[0]!);
      events++;
    }
  }

  return { evaluated: characters.length, events };
}

// ── Prompt context ─────────────────────────────────────────────────────────────

export async function formatAttributesForPrompt(characterId: string): Promise<string> {
  const attrs = await getCharacterAttributes(characterId);
  if (!attrs) return '';

  const lines: string[] = [];
  if (attrs.health < 40) lines.push(`Your health has not been good lately.`);
  if (attrs.confidence < 30) lines.push(`Your confidence has taken a hit recently.`);
  if (attrs.confidence > 80) lines.push(`You feel unusually sure of yourself right now.`);
  if (attrs.addictions.length) lines.push(`You are currently dealing with a dependency on ${attrs.addictions.join(', ')}.`);
  if (attrs.wealth_tier === 'magnate' || attrs.wealth_tier === 'rich') lines.push(`Money is not something you worry about.`);
  if (attrs.wealth_tier === 'destitute' || attrs.wealth_tier === 'struggling') lines.push(`Money is a real, present concern for you right now.`);

  const topSkills = Object.entries(attrs.skills).sort((a, b) => b[1] - a[1]).slice(0, 2);
  if (topSkills.length) lines.push(`You're particularly skilled at: ${topSkills.map(([s]) => s).join(', ')}.`);

  if (!lines.length) return '';
  return `[YOUR CONDITION] ${lines.join(' ')}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
