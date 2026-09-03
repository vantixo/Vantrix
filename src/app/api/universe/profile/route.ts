/**
 * GET /api/universe/profile?characterId=...
 *
 * Combined "Living World" profile for a single character — status, legend,
 * attributes, reputation, occupation, social links, held artifacts, and a
 * recent biography excerpt. Powers the World Profile page and the chat
 * insights panel's "World Standing" section (client-side fetch — the panel
 * is a Client Component and can't import the supabaseAdmin-backed lib
 * functions directly).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthedUser } from '@/lib/auth/get-authed-user';
import { getCharacterWorldProfile }  from '@/lib/universe/world-atlas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const characterId = new URL(req.url).searchParams.get('characterId');
  if (!characterId) {
    return NextResponse.json({ error: 'characterId is required' }, { status: 400 });
  }

  const profile = await getCharacterWorldProfile(characterId);
  return NextResponse.json({ profile });
}
