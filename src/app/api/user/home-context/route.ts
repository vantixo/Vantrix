/**
 * GET /api/user/home-context
 *
 * Returns data needed to personalise the home page for returning users:
 *
 *   recentChats        — last 4 conversations (char info + last_message_at)
 *   pendingInitiatives — undelivered character_initiatives for this user (max 3)
 *   profile            — { tier, daily_messages_used, daily_messages_limit, tokens }
 *
 * Requires auth. Returns 200 with empty arrays for unauthenticated calls
 * so the home page can safely call this without auth-gating the UI.
 *
 * Cached privately for 30s — short enough that "Aria sent you a message"
 * appears quickly after the worker generates it.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

interface ConvRow {
  id:              string;
  character_id:    string;
  last_message_at: string;
  characters: {
    id:           string;
    name:         string;
    image_url:    string;
    is_live:      boolean;
    is_premium:   boolean;
    min_tier?:    string;
    opening_line: string | null;
    archetype:    string | null;
  } | null;
}

interface InitiativeRow {
  id:         string;
  type:       string;
  message:    string;
  urgency:    string;
  created_at: string;
  characters: {
    id:        string;
    name:      string;
    image_url: string;
  } | null;
}

interface MappedInitiative {
  id:        string;
  type:      string;
  message:   string;
  urgency:   string;
  createdAt: string;
  character: { id: string; name: string; image_url: string };
}

export async function GET(_req: NextRequest) {
  const { supabase, user } = await getAuthedUser();

  if (!user) {
    return NextResponse.json(
      { recentChats: [], pendingInitiatives: [], profile: null },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const [convRes, initiativesRes, profileRes] = await Promise.all([
      // Recent conversations joined to character info
      supabase
        .from("conversations")
        .select(`
          id,
          character_id,
          last_message_at,
          characters (
            id, name, image_url, is_live, is_premium, min_tier, opening_line, archetype
          )
        `)
        .eq("user_id", user.id)
        .order("last_message_at", { ascending: false })
        .limit(4),

      // Pending character initiatives (undelivered, not expired)
      // Note: urgency sort is done in JS below — alphabetical DB sort gives wrong order
      supabase
        .from("character_initiatives")
        .select(`
          id, type, message, urgency, created_at,
          characters (
            id, name, image_url
          )
        `)
        .eq("user_id", user.id)
        .eq("delivered", false)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(6),  // over-fetch so we can sort and slice to 3

      // Profile for usage counter
      supabase
        .from("profiles")
        .select("tier, daily_messages_used, daily_messages_limit, tokens")
        .eq("id", user.id)
        .single(),
    ]);

    const recentChats = (convRes.data as ConvRow[] ?? []).map((c) => ({
      conversationId: c.id,
      lastMessageAt:  c.last_message_at,
      character: {
        id:           c.characters?.id,
        name:         c.characters?.name,
        image_url:    c.characters?.image_url,
        is_live:      c.characters?.is_live,
        is_premium:   c.characters?.is_premium,
        min_tier:     c.characters?.min_tier,
        opening_line: c.characters?.opening_line,
        archetype:    c.characters?.archetype,
      },
    })).filter((c) => c.character.id);   // guard against orphaned convs

    const URGENCY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

    const pendingInitiatives = (initiativesRes.data as InitiativeRow[] ?? [])
      .map((i): MappedInitiative | null => {
        if (!i.characters?.id) return null;
        return {
          id:        i.id,
          type:      i.type,
          message:   i.message,
          urgency:   i.urgency,
          createdAt: i.created_at,
          character: {
            id:        i.characters.id,
            name:      i.characters.name,
            image_url: i.characters.image_url,
          },
        };
      })
      .filter((i): i is MappedInitiative => i !== null)
      .sort((a, b) => (URGENCY_RANK[a.urgency] ?? 1) - (URGENCY_RANK[b.urgency] ?? 1))
      .slice(0, 3);

    const profile = profileRes.data ? {
      tier:                 profileRes.data.tier ?? "free",
      daily_messages_used:  profileRes.data.daily_messages_used ?? 0,
      daily_messages_limit: profileRes.data.daily_messages_limit ?? 20,
      tokens:               profileRes.data.tokens ?? 0,
    } : null;

    return NextResponse.json(
      { recentChats, pendingInitiatives, profile },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } }
    );

  } catch (error) {
    logger.error("home-context error", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { recentChats: [], pendingInitiatives: [], profile: null },
      { status: 200 } // degrade gracefully — home page still renders
    );
  }
}
