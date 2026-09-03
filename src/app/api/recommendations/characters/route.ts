/**
 * POST /api/recommendations/characters
 *
 * Public endpoint (no auth required — same D-03 reasoning as
 * /api/characters: discovery must work for logged-out visitors). Takes a
 * free-text description of what the user wants and returns ranked
 * character candidates from recommendCharacters().
 *
 * NSFW gating mirrors /api/characters/route.ts exactly: logged-out,
 * unverified, or nsfw_enabled=false users never receive NSFW candidates,
 * regardless of what they type. See resolveNsfwDiscoveryAccess() in
 * @/lib/access/character-gate for the shared age+preference check.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { resolveNsfwDiscoveryAccess } from '@/lib/access/character-gate';
import { checkActionLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/network/get-client-ip';
import { recommendCharacters } from '@/lib/recommendations/character-recommender';
import { toErrorBody } from '@/lib/errors';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  query:    z.string().max(400).default(''),
  gender:   z.enum(['female', 'male', 'anime', 'other']).optional(),
  category: z.string().max(50).optional(),
  limit:    z.number().int().min(1).max(25).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = requestSchema.parse(await req.json().catch(() => ({})));

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Rate-limit key: real user id when authed, IP when guest — same
    // guest-friendly shape as other public endpoints in this app that
    // still need abuse protection without requiring a session.
    const rateLimitKey = user?.id ?? `ip:${getClientIp(req) ?? 'unknown'}`;
    const { allowed, reset } = await checkActionLimit(rateLimitKey, 'ai_recommend');
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again shortly.', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))) } },
      );
    }

    const allowNsfw = await resolveNsfwDiscoveryAccess(user?.id ?? null);

    const results = await recommendCharacters(body.query, {
      gender: body.gender,
      category: body.category,
      allowNsfw,
      limit: body.limit,
    });

    return NextResponse.json({
      results: results.map((r) => ({
        character: r.character,
        reason: r.reason,
      })),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request', code: 'VALIDATION_ERROR', details: err.flatten() }, { status: 400 });
    }
    logger.error('recommendations/characters failed', { error: err instanceof Error ? err.message : String(err) });
    const body = toErrorBody(err);
    return NextResponse.json(body, { status: 500 });
  }
}
