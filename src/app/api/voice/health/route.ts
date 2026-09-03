/**
 * GET /api/voice/health — Voice System Diagnostic (admin only)
 *
 * VOICE-FIX (2026-09-01): the premium ElevenLabs pipeline (per-character
 * voice, caching, circuit breaker) has existed in this codebase for a
 * while, but every failure mode in it degrades SILENTLY to the Web Speech
 * fallback — no error, no alert, just every character quietly sounding
 * the same. That silence is what made the underlying bug invisible.
 *
 * This endpoint makes every one of those failure modes observable in one
 * call instead of inferred from symptoms:
 *
 *   1. key        — is ELEVENLABS_API_KEY actually set (env.ts now hard-
 *                    requires this in production, but a stale deploy or
 *                    dev-mode placeholder can still slip through).
 *   2. account     — does that key actually authenticate against ElevenLabs
 *                    and is the account not out of quota.
 *   3. libraryIds  — do the 10 curated VOICE_LIBRARY ids in voice-library.ts
 *                    actually exist on THIS ElevenLabs account (premade-
 *                    voice-library ids can vary by plan/region — see that
 *                    file's own warning comment). A library id that 404s is
 *                    functionally identical to a missing key: silent
 *                    fallback for every character assigned that voice.
 *   4. migration   — what fraction of characters have a real, non-null
 *                    elevenlabs_voice_id (the backfill migration should
 *                    have brought this to 100%).
 *   5. circuit     — current breaker state for each voice id currently in
 *                    use; an OPEN breaker silently masks a working key.
 *
 * Run this after every deploy that touches voice, and whenever "voice
 * sounds the same for everyone" is reported — it will name the actual
 * cause instead of requiring another guess-and-check pass.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { requireAdmin } from '@/lib/auth/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { VOICE_LIBRARY, DEFAULT_ELEVENLABS_VOICE_IDS } from '@/lib/ai/voice-library';
import { logger } from '@/lib/logger';
import { toErrorBody, errorLogFields } from '@/lib/errors';
import { env } from '@/env';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface LibraryCheck {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
}

export async function GET(_req: NextRequest) {
  try {
    const { user } = await getAuthedUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }
    await requireAdmin(user.id); // throws ForbiddenError -> 403 via toErrorBody

    const report: Record<string, unknown> = {};
    const problems: string[] = [];

    // ── 1. Key presence ──────────────────────────────────────────────────
    const key = env.ELEVENLABS_API_KEY;
    const keyLooksReal = !!key && key !== 'placeholder-elevenlabs-key' && key.length > 8;
    report.key = { present: !!key, looksReal: keyLooksReal };
    if (!keyLooksReal) {
      problems.push('ELEVENLABS_API_KEY is missing or still a placeholder — every request will silently fall back to Web Speech.');
    }

    // ── 2 & 3. Live account check + per-voice validation ────────────────
    let accountVoiceIds = new Set<string>();
    if (keyLooksReal) {
      try {
        const res = await fetch('https://api.elevenlabs.io/v1/voices', {
          headers: { 'xi-api-key': key },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          report.account = { ok: false, status: res.status };
          problems.push(`ElevenLabs rejected the API key or account is unreachable (HTTP ${res.status}). Check billing/quota.`);
        } else {
          const body = (await res.json()) as { voices?: { voice_id: string }[] };
          accountVoiceIds = new Set((body.voices ?? []).map(v => v.voice_id));
          report.account = { ok: true, voiceCount: accountVoiceIds.size };
        }
      } catch (err) {
        report.account = { ok: false, error: String(err) };
        problems.push('Could not reach ElevenLabs to verify the account — check network/DNS from the deployment, not just the key.');
      }
    } else {
      report.account = { ok: false, skipped: true };
    }

    const libraryChecks: LibraryCheck[] = VOICE_LIBRARY.map(v => {
      if (!keyLooksReal || report.account === undefined || (report.account as { ok?: boolean }).ok === false) {
        return { id: v.id, name: v.name, ok: false, detail: 'unverified (no working key)' };
      }
      const ok = accountVoiceIds.has(v.id);
      return { id: v.id, name: v.name, ok, detail: ok ? 'exists on account' : 'NOT FOUND on this ElevenLabs account' };
    });
    const badLibraryIds = libraryChecks.filter(c => !c.ok && c.detail.startsWith('NOT FOUND'));
    report.libraryIds = libraryChecks;
    if (badLibraryIds.length > 0) {
      problems.push(
        `${badLibraryIds.length}/${VOICE_LIBRARY.length} curated voice IDs don't exist on this ElevenLabs account ` +
        `(${badLibraryIds.map(c => c.name).join(', ')}) — any character assigned one of these silently falls back to Web Speech.`
      );
    }

    // ── 4. Migration / backfill completeness ────────────────────────────
    const { count: totalCount } = await supabaseAdmin
      .from('characters').select('*', { count: 'exact', head: true });
    const { count: nullCount } = await supabaseAdmin
      .from('characters').select('*', { count: 'exact', head: true }).is('elevenlabs_voice_id', null);
    const total = totalCount ?? 0;
    const unmigrated = nullCount ?? 0;
    report.migration = {
      totalCharacters: total,
      missingVoiceId: unmigrated,
      pctComplete: total > 0 ? Math.round(((total - unmigrated) / total) * 100) : 100,
    };
    if (unmigrated > 0) {
      problems.push(
        `${unmigrated}/${total} characters have no elevenlabs_voice_id — they're falling back to the ` +
        `3-voice gender-bucket default (${Object.values(DEFAULT_ELEVENLABS_VOICE_IDS).join(', ')}), ` +
        `not a distinct voice. Run migration 20261033_character_elevenlabs_voice_id.sql against this database.`
      );
    }

    // ── 5. Circuit breaker state per voice currently assigned ───────────
    const { data: distinctVoices } = await supabaseAdmin
      .from('characters').select('elevenlabs_voice_id').not('elevenlabs_voice_id', 'is', null).limit(500);
    const uniqueIds = [...new Set((distinctVoices ?? []).map(r => r.elevenlabs_voice_id as string))];
    // Read the same Redis-backed state the breaker itself persists (see
    // circuit-breaker.ts persistToRedis/syncFromRedis) directly, rather than
    // going through a fresh in-process CircuitBreaker instance — a brand new
    // instance in this request's process starts CLOSED and only picks up
    // Redis's OPEN state on its next execute() call, which would make this
    // health check under-report open breakers from other instances.
    const breakerStates = await Promise.all(
      uniqueIds.map(async id => {
        const name = `voice:elevenlabs:${id}`;
        try {
          const raw = await redis.get<string>(`vantrix:cb:${name}`);
          if (!raw) return { voiceId: id, state: 'CLOSED' as const };
          const stored = JSON.parse(raw) as { state: string };
          return { voiceId: id, state: stored.state };
        } catch {
          return { voiceId: id, state: 'UNKNOWN' as const };
        }
      })
    );
    const openBreakers = breakerStates.filter(b => b.state === 'OPEN');
    report.circuitBreakers = { checked: breakerStates.length, open: openBreakers };
    if (openBreakers.length > 0) {
      problems.push(`${openBreakers.length} voice(s) have an OPEN circuit breaker right now — those voices are forced onto Web Speech until it resets.`);
    }

    const healthy = problems.length === 0;
    logger.info('voice:health-check', { userId: user.id, healthy, problemCount: problems.length });

    return NextResponse.json({
      healthy,
      problems,
      report,
      checkedAt: new Date().toISOString(),
    }, { status: healthy ? 200 : 503 });

  } catch (err) {
    logger.error('voice:health-error', errorLogFields(err));
    return NextResponse.json(toErrorBody(err), { status: 500 });
  }
}
