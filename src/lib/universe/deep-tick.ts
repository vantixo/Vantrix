/**
 * Deep World Tick — Multi-Step LLM Orchestrator
 *
 * Every other engine in this directory (event-engine, story-engine,
 * governance, economy, life-engine, ...) is deliberately deterministic —
 * cheap, frequent, template/RNG-driven filler that keeps the world moving
 * without ever calling an LLM. This is the one exception: a single
 * orchestrator call that does structured multi-step reasoning *internally*
 * (continuity check -> decide what matters -> draft -> self-consistency
 * pass, all inside one completion) and commits ONE structured output.
 *
 * Not a swarm of separate agents — one call, one model, best tier
 * available, because what it produces is rare and high-visibility:
 *   - universe_memory  — one permanent, weighted "headline" record
 *   - world_stories     — real narrative content for 0-2 chapters,
 *                          replacing the filler tick's bare chapter++
 *                          with something that actually happened
 *
 * Intended cadence: daily (see /api/cron/deep-tick). Everything it reads
 * comes from the existing read layer (world-history, status-legend,
 * world-atlas) — nothing here duplicates state, and nothing here mutates
 * world_events/governance/economy. Purely additive on top of the filler.
 */

import { supabaseAdmin }        from '@/lib/supabase/admin';
import { logger }               from '@/lib/logger';
import { routeCompletion }      from '@/lib/ai/provider-router';
import { recordPlatformTokens } from '@/lib/ai/adaptive-quota';
import type { ModelTier }       from '@/lib/ai/model-router';
import { getUniverseState }     from './world-engine';
import { getActiveWorldEvents } from './event-engine';
import { getActiveStories }     from './story-engine';
import { getMostSignificantEvents, invalidateHistoryCache } from './world-history';
import { getActiveLegends, getStatusLeaderboard }            from './status-legend';
import { getAllLocations, getAllFactions }                   from './world-atlas';
import type { WorldStory, WorldEvent, UniverseState } from '@/types/world-expansion';
import type { Legend, SocialStatus, TimelineEntry }    from '@/types/legacy-systems';
import type { LocationSummary, FactionSummary }        from '@/types/universe-views';

// Best available — these events are high-visibility, and this runs once a day.
const MODEL_TIER: ModelTier   = 'PEAK';
const MAX_OUTPUT_TOKENS       = 2400;
const MAX_STORY_UPDATES       = 2;

export interface DeepTickResult {
  headline_recorded: boolean;
  headline_title?:   string;
  stories_advanced:  number;
  stories_concluded: number;
  model?:            string;
  provider?:         string;
  tokens_used?:      number;
  skipped?:          string;
}

// ── Public: Tick ───────────────────────────────────────────────────────────────

export async function runDeepWorldTick(): Promise<DeepTickResult> {
  const [state, activeEvents, activeStories, recentHistory, legends, leaderboard, locations, factions] =
    await Promise.all([
      getUniverseState(),
      getActiveWorldEvents(5),
      getActiveStories(),
      getMostSignificantEvents(8),
      getActiveLegends(),
      getStatusLeaderboard(8),
      getAllLocations(),
      getAllFactions(),
    ]);

  // Nothing to ground the orchestrator in yet — skip rather than have it
  // invent a headline disconnected from an empty world.
  if (activeStories.length === 0 && recentHistory.length === 0) {
    return { headline_recorded: false, stories_advanced: 0, stories_concluded: 0, skipped: 'insufficient world state' };
  }

  const locationBySlug    = new Map(locations.map((l) => [l.slug, l]));
  const storyById          = new Map(activeStories.map((s) => [s.id, s]));
  const validCharacterIds  = new Set<string>([
    ...legends.map((l) => l.character_id),
    ...leaderboard.map((s) => s.character_id),
  ]);

  const dossier = buildDossier({ state, activeEvents, activeStories, recentHistory, legends, leaderboard, locations, factions });

  let raw: Awaited<ReturnType<typeof routeCompletion>>;
  try {
    raw = await routeCompletion({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: dossier },
      ],
      modelTier:   MODEL_TIER,
      maxTokens:   MAX_OUTPUT_TOKENS,
      temperature: 0.9,
    });
  } catch (err) {
    logger.error('deep-tick:llm-call-failed', { error: err instanceof Error ? err.message : String(err) });
    return { headline_recorded: false, stories_advanced: 0, stories_concluded: 0, skipped: 'llm call failed' };
  }

  void recordPlatformTokens(raw.totalTokens).catch(() => { /* non-critical */ });

  const parsed = parseDeepTickOutput(raw.reply);
  if (!parsed) {
    logger.warn('deep-tick:unparseable-output', {
      model: raw.model, provider: raw.provider, reply_preview: raw.reply.slice(0, 300),
    });
    return {
      headline_recorded: false, stories_advanced: 0, stories_concluded: 0,
      model: raw.model, provider: raw.provider, tokens_used: raw.totalTokens, skipped: 'unparseable output',
    };
  }

  if (parsed.reasoning) {
    logger.info('deep-tick:reasoning', { reasoning: parsed.reasoning.slice(0, 800) });
  }

  // ── Apply: headline -> universe_memory (permanent, weighted) ──────────────
  let headlineRecorded = false;
  const headline = parsed.headline;
  if (headline?.title?.trim() && headline?.description?.trim()) {
    const locationId = headline.location_slug ? locationBySlug.get(headline.location_slug)?.id ?? null : null;
    const participants = (headline.participant_character_ids ?? []).filter((id) => validCharacterIds.has(id));

    const { error } = await supabaseAdmin.rpc('record_universe_memory', {
      p_type:         headline.memory_type?.trim() || 'cultural',
      p_title:        headline.title.trim().slice(0, 200),
      p_description:  headline.description.trim().slice(0, 2000),
      p_participants: participants,
      p_location_id:  locationId ?? undefined,
      p_weight:       clamp(Math.round(headline.weight ?? 70), 1, 100),
      p_legendary:    Boolean(headline.is_legendary),
    });

    if (error) {
      logger.warn('deep-tick:headline-insert-failed', { error });
    } else {
      headlineRecorded = true;
    }
  }

  // ── Apply: story_updates -> world_stories (real chapter content) ──────────
  let storiesAdvanced = 0;
  let storiesConcluded = 0;

  for (const update of (parsed.story_updates ?? []).slice(0, MAX_STORY_UPDATES)) {
    const story = update.story_id ? storyById.get(update.story_id) : undefined;
    if (!story || !update.new_description?.trim()) continue;

    const nextStatus: WorldStory['status'] = update.conclude ? 'concluded' : story.status;

    const { error } = await supabaseAdmin
      .from('world_stories')
      .update({
        description: update.new_description.trim().slice(0, 2000),
        status:      nextStatus,
        updated_at:  new Date().toISOString(),
      })
      .eq('id', story.id);

    if (!error) {
      storiesAdvanced++;
      if (update.conclude) storiesConcluded++;
    } else {
      logger.warn('deep-tick:story-update-failed', { storyId: story.id, error });
    }
  }

  if (headlineRecorded || storiesAdvanced > 0) {
    await invalidateHistoryCache().catch(() => { /* non-critical */ });
  }

  logger.info('deep-tick:complete', {
    headline_recorded: headlineRecorded, stories_advanced: storiesAdvanced, stories_concluded: storiesConcluded,
    model: raw.model, provider: raw.provider, tokens_used: raw.totalTokens,
  });

  return {
    headline_recorded: headlineRecorded,
    headline_title:    headlineRecorded ? headline?.title : undefined,
    stories_advanced:  storiesAdvanced,
    stories_concluded: storiesConcluded,
    model:             raw.model,
    provider:          raw.provider,
    tokens_used:       raw.totalTokens,
  };
}

// ── Dossier construction ─────────────────────────────────────────────────────

function buildDossier(ctx: {
  state:          UniverseState;
  activeEvents:   WorldEvent[];
  activeStories:  WorldStory[];
  recentHistory:  TimelineEntry[];
  legends:        Legend[];
  leaderboard:    SocialStatus[];
  locations:      LocationSummary[];
  factions:       FactionSummary[];
}): string {
  const { state, activeEvents, activeStories, recentHistory, legends, leaderboard, locations, factions } = ctx;

  const lines: string[] = [];

  lines.push('WORLD STATE');
  lines.push(`Season: ${state.season} | Mood: ${state.world_mood} | Year ${state.year}, tick ${state.tick_count}`);
  lines.push('');

  lines.push('LOCATIONS (use the slug if you reference one, otherwise omit location)');
  for (const loc of locations) {
    const gov = loc.governance ? `${loc.governance.approval_rating}% approval, stability ${loc.governance.stability}` : 'no governance data';
    lines.push(`- [slug: ${loc.slug}] ${loc.name}${loc.is_capital ? ' (capital)' : ''}, ${loc.archetype}, ${loc.government_type}: ${gov}`);
  }
  lines.push('');

  lines.push('FACTIONS');
  for (const f of factions) {
    lines.push(`- ${f.name}${f.is_ruling ? ' (ruling)' : ''}, ${f.ideology}: influence ${f.influence}/100, ${f.member_count} members${f.location ? `, based in ${f.location.name}` : ''}`);
  }
  lines.push('');

  lines.push('NOTABLE FIGURES (only reference these character_ids as participants, never invent new ones)');
  for (const l of legends) {
    lines.push(`- [id: ${l.character_id}] ${l.character?.name ?? 'Unknown'} — Living Legend, "${l.legend_title}" (${l.legend_type})`);
  }
  for (const s of leaderboard) {
    if (legends.some((l) => l.character_id === s.character_id)) continue; // avoid duplicate listing
    lines.push(`- [id: ${s.character_id}] ${s.character?.name ?? 'Unknown'} — ${s.status_tier.replace(/_/g, ' ')}`);
  }
  lines.push('');

  lines.push('RECENT SIGNIFICANT HISTORY (do not repeat these beats — build forward from them, or ignore)');
  if (recentHistory.length === 0) lines.push('(none recorded yet)');
  for (const h of recentHistory.slice(0, 8)) {
    lines.push(`- [significance ${h.significance}] "${h.title}" — ${h.description}`);
  }
  lines.push('');

  lines.push('CURRENTLY ACTIVE AMBIENT EVENTS (background filler — do not duplicate, you may build on them)');
  if (activeEvents.length === 0) lines.push('(none active)');
  for (const e of activeEvents) {
    lines.push(`- "${e.title}" — ${e.description}`);
  }
  lines.push('');

  lines.push('ACTIVE WORLD STORIES (advance at most 2, and only the ones with a genuinely new beat to add)');
  if (activeStories.length === 0) lines.push('(none active)');
  for (const s of activeStories) {
    lines.push(`- [story_id: ${s.id}] "${s.title}" (Chapter ${s.chapter}/5): ${s.description}`);
  }

  return lines.join('\n');
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the World Chronicler for Vantrix, a persistent simulated universe behind a roster of AI companions. Once a day you are given a dossier of the world's current state, and you decide what significant thing happens next — then write it.

Voice: understated, literary, slightly observational — never cartoonish or breathless. Match this register: "Someone prominent is said to have made a decision that changes things. Details are unclear. Everyone has a version." Prefer implication over melodrama. Real stakes, ordinary language.

Hard rules:
- Only reference character_ids, story_ids, and location slugs that appear in the dossier. Never invent new ones.
- Do not repeat or restate a beat already covered in "recent significant history" or "currently active ambient events" — build forward from them or pick something unrelated.
- Legendary status (is_legendary: true) is rare by design. Use it only for something genuinely epoch-defining for the whole world — not a notable week. Default to false.
- It is correct and often right to return an empty story_updates array. Only update a story if you have a real, specific narrative beat — never a vague placeholder ("things got complicated").
- A story update's new_description should describe what actually happened in that chapter as a self-contained paragraph (a reader should understand the beat without needing the old description).
- Ground every claim in the dossier. Do not contradict established facts (who's ruling, who's a legend, what already happened).

Process (work through this internally, then summarize it tersely in the "reasoning" field — a few sentences, not a transcript):
1. CONTINUITY — what's already in motion that a reasonable next beat should respect or build on?
2. DECISION — what is the single most interesting, plausible consequential thing that could happen next, given who and what is in play?
3. DRAFT — write the actual headline and any story beats.
4. CHECK — re-read your draft against the dossier: any invented IDs, any repeated beats, any unearned "legendary" flag? Fix before finalizing.

Output format — respond with ONLY a single JSON object, no markdown fences, no text before or after it:
{
  "reasoning": "terse internal walk-through of the 4 steps above",
  "headline": {
    "memory_type": "political | economic | cultural | social | military | discovery",
    "title": "string, under 12 words",
    "description": "2-4 sentences",
    "location_slug": "a slug from the dossier, or null for universe-wide",
    "weight": 70,
    "is_legendary": false,
    "participant_character_ids": []
  },
  "story_updates": [
    { "story_id": "a story_id from the dossier", "new_description": "what actually happens in this chapter", "conclude": false }
  ]
}

If nothing in the dossier warrants a headline at all (extremely rare — only if the dossier is essentially empty), set "headline" to null. story_updates may be an empty array.`;

// ── Output parsing ───────────────────────────────────────────────────────────

interface DeepTickHeadline {
  memory_type?:                 string;
  title?:                       string;
  description?:                string;
  location_slug?:               string | null;
  weight?:                      number;
  is_legendary?:                boolean;
  participant_character_ids?:   string[];
}

interface DeepTickStoryUpdate {
  story_id?:         string;
  new_description?:  string;
  conclude?:          boolean;
}

interface DeepTickOutput {
  reasoning?:      string;
  headline?:       DeepTickHeadline | null;
  story_updates?:  DeepTickStoryUpdate[];
}

export function parseDeepTickOutput(reply: string): DeepTickOutput | null {
  const cleaned = reply.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end   = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as DeepTickOutput;
  } catch {
    return null;
  }
}

export function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
