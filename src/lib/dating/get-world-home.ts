/**
 * getDatingWorldHome — the actual "Your World" aggregation logic.
 *
 * ROOT-CAUSE FIX (2026-08-23): this used to live inline inside
 * app/api/dating/world/route.ts, which meant the ONLY way to get this data
 * — including from the server-rendered (app)/dating/page.tsx itself — was
 * an HTTP self-fetch through fetchInternal() (lib/frontend/api.ts ->
 * absoluteUrl()). That self-fetch is what was actually producing the
 * repeated `fetchInternal: /api/dating/world responded 404` failures: a
 * Server Component making a real network round-trip back to its own
 * `next dev` process is inherently fragile (base-URL/port drift, cookie
 * forwarding, and — the specific trigger here — next.config.js's
 * `experimental.cpus: 1` / `workerThreads: false` serializes the dev
 * compiler, so the outer page request and the inner self-fetch to an
 * on-demand-compiled API route can contend for the same single worker and
 * the self-fetch loses, surfacing as a 404 rather than a hang). Two earlier
 * revisions already patched absoluteUrl() itself (localhost->127.0.0.1,
 * trailing-slash) and the failure persisted, because the URL construction
 * was never the actual root cause — the self-fetch architecture was.
 *
 * Per FRONTEND_DIRECTIVE §10 ("call a lib/* function directly when the
 * route handler is a thin wrapper"): this file IS that lib/* function now.
 * `route.ts` calls it and wraps the result in NextResponse.json() (thin
 * wrapper, still a real HTTP endpoint for any client-side/external
 * caller). `(app)/dating/page.tsx` now calls it directly, in-process — no
 * HTTP hop, no absoluteUrl(), no cookie forwarding, nothing that can 404.
 *
 * Behavior is unchanged from the old route body: same queries, same NSFW/
 * gender gating, same once-a-day Tonight's Match pin, same fail-soft empty
 * defaults on error.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getRecommendations, type RecommendedCharacter } from '@/lib/recommendations/engine';
import { resolveNsfwDiscoveryAccess } from '@/lib/access/character-gate';
import { normalizeTier, resolveEffectiveTier } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { redis } from '@/lib/redis';
import type { DatingWorldHome } from '@/lib/frontend/dating';

function tonightKey(userId: string): string {
  const day = new Date().toISOString().slice(0, 10); // UTC yyyy-mm-dd
  return `vantrix:dating:tonight:${userId}:${day}`;
}
const TONIGHT_TTL = 60 * 60 * 26; // slightly over a day, covers TZ skew

interface RelationshipRow {
  id: string;
  bond_score: number;
  match_tier: string;
  streak_days: number;
  character_mood: string;
  last_interaction: string | null;
  character: {
    id: string; name: string; image_url: string | null; is_nsfw: boolean | null;
  } | null;
}

interface MomentRow {
  id: string;
  character_id: string;
  moment_type: string;
  title: string;
  created_at: string;
  character?: { name: string } | null;
}

interface DateSessionRow {
  id: string;
  match_id: string;
  character_id: string;
  date_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  character: { id: string; name: string; image_url: string | null; is_nsfw: boolean | null } | null;
}

const EMPTY_WORLD: DatingWorldHome = {
  relationships: [], recentMoments: [], tonightsMatch: null, unexpectedChemistry: null,
  recommended: [], dates: { active: [], recent: [] }, isPremium: false,
};

export async function getDatingWorldHome(userId: string): Promise<DatingWorldHome> {
  try {
    // PERF FIX (2026-08-23): this used to be three sequential network
    // stages — Promise.all([profile, nsfwEnabled]), THEN a standalone
    // await on dating_profiles, THEN a final Promise.all for
    // matches/moments/date_sessions/recommendations. Only
    // getRecommendations() actually needs tier/nsfwEnabled/genderFilter —
    // dating_profiles, dating_matches, secret_moments, and date_sessions
    // all only need userId, which is available immediately. Running
    // everything that has no such dependency in a single parallel batch
    // (below) and only sequencing getRecommendations() after it resolves
    // cuts the critical path from 3 round-trips to 2, with identical
    // output.
    const [
      { data: profile },
      nsfwEnabled,
      { data: datingProfile },
      relationshipsRes,
      momentsRes,
      dateSessionsRes,
    ] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        // role/is_admin added for isPremium (RETENTION-01: Tonight's Match
        // locked-teaser gate) — same ADMIN-FREE-TIER rule every other
        // premium gate in the app uses via resolveEffectiveTier(), so
        // staff accounts see the full card too, not just paying tier='premium'.
        .select('tier, role, is_admin')
        .eq('id', userId)
        .single(),
      resolveNsfwDiscoveryAccess(userId),
      supabaseAdmin
        .from('dating_profiles')
        .select('preferred_gender')
        .eq('user_id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('dating_matches')
        .select(`
          id, bond_score, match_tier, streak_days, character_mood, last_interaction,
          character:characters!dating_matches_character_id_fkey ( id, name, image_url, is_nsfw )
        `)
        .eq('user_id', userId)
        .gte('bond_score', 20)
        .order('bond_score', { ascending: false })
        .limit(12)
        .returns<RelationshipRow[]>(),
      supabaseAdmin
        .from('secret_moments')
        .select('id, character_id, moment_type, title, created_at, character:characters!secret_moments_character_id_fkey ( name )')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(6)
        .returns<MomentRow[]>(),
      supabaseAdmin
        .from('date_sessions')
        .select('id, match_id, character_id, date_type, status, created_at, completed_at, character:characters!date_sessions_character_id_fkey ( id, name, image_url, is_nsfw )')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5)
        .returns<DateSessionRow[]>(),
    ]);

    const tier = normalizeTier((profile?.tier as string) ?? 'free') as Parameters<typeof getRecommendations>[1];
    // RETENTION-01: Tonight's Match is a locked teaser (blurred photo/name,
    // "Unlock" CTA) for free users and a full reveal for premium — see
    // TonightMatchCard vs LockedTonightMatchCard in (app)/dating/page.tsx.
    // This is presentation/retention gating, not a data-secrecy boundary
    // (the same character's name/photo is already visible elsewhere on this
    // exact page, e.g. Recommended For You), so it's fine to compute once
    // here and let the page pick which card to render rather than redacting
    // fields in the response.
    const isPremium = resolveEffectiveTier(profile ?? {}) === 'premium';
    const rawGender = datingProfile?.preferred_gender ?? null;
    const genderFilter: 'male' | 'female' | 'non_binary' | null =
      rawGender === 'male' || rawGender === 'female' || rawGender === 'non_binary' ? rawGender : null;

    const recommendations = await getRecommendations(userId, tier, 30, null, nsfwEnabled, genderFilter);

    const relationships = (relationshipsRes.data ?? []).filter(
      r => nsfwEnabled || r.character?.is_nsfw !== true
    );
    const matchedCharacterIds = new Set(relationships.map(r => r.character?.id).filter(Boolean));

    const candidates = recommendations.filter(r => !matchedCharacterIds.has(r.id));

    let tonightsMatch: RecommendedCharacter | null = null;
    if (candidates.length > 0) {
      const key = tonightKey(userId);
      const pinnedId = await redis.get<string>(key).catch(() => null);
      tonightsMatch = (pinnedId && candidates.find(c => c.id === pinnedId)) || candidates[0]!;
      if (tonightsMatch.id !== pinnedId) {
        await redis.set(key, tonightsMatch.id, { ex: TONIGHT_TTL }).catch(() => {});
      }
    }

    const UNEXPECTED_MIN_SCORE = 55;
    const UNEXPECTED_MAX_PATTERN = 45;
    const UNEXPECTED_MIN_GAP = 20;

    let unexpected: RecommendedCharacter | null = null;
    let bestGap = -Infinity;
    for (const c of candidates) {
      if (c.id === tonightsMatch?.id) continue;
      if (c.score < UNEXPECTED_MIN_SCORE || c.patternScore > UNEXPECTED_MAX_PATTERN) continue;
      const gap = c.score - c.patternScore;
      if (gap >= UNEXPECTED_MIN_GAP && gap > bestGap) {
        bestGap = gap;
        unexpected = c;
      }
    }
    const unexpectedWithReason = unexpected && {
      ...unexpected,
      reason: `Outside your usual pattern — ${unexpected.reason.toLowerCase()}`,
    };

    const recommendedRest = candidates
      .filter(c => c.id !== tonightsMatch?.id && c.id !== unexpected?.id)
      .slice(0, 10);

    const dateSessions = (dateSessionsRes.data ?? []).filter(
      d => nsfwEnabled || d.character?.is_nsfw !== true
    );

    return {
      relationships,
      recentMoments: momentsRes.data ?? [],
      tonightsMatch,
      unexpectedChemistry: unexpectedWithReason,
      recommended: recommendedRest,
      dates: {
        active: dateSessions.filter(d => d.status === 'active'),
        recent: dateSessions.filter(d => d.status === 'completed').slice(0, 4),
      },
      isPremium,
    };
  } catch (error) {
    logger.error('dating-world:get-world-home-error', { error: String(error) });
    return EMPTY_WORLD;
  }
}
