/**
 * GET  /api/universe/daily-choice — today's world choice, the user's vote
 *      (if cast), and the tally (only included once the user has voted, to
 *      avoid bandwagon effects).
 * POST /api/universe/daily-choice — cast a vote. Body: { choiceId, option }.
 *      Idempotent: voting twice returns the original vote, not an error.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthedUser } from "@/lib/auth/get-authed-user";
import { getActiveDailyChoice, getUserVote, getTally, castVote } from "@/lib/universe/daily-choice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const { user } = await getAuthedUser();

  const choice = await getActiveDailyChoice();
  if (!choice) {
    return NextResponse.json({ choice: null, userVote: null, tally: null });
  }

  const userVote = user ? await getUserVote(choice.id, user.id) : null;
  // Tally only revealed after voting (or if the choice has already resolved).
  const tally = (userVote || choice.resolved) ? await getTally(choice.id) : null;

  return NextResponse.json({ choice, userVote, tally });
}

const voteSchema = z.object({
  choiceId: z.string().uuid(),
  option: z.enum(["a", "b"]),
});

export async function POST(req: NextRequest) {
  const { user } = await getAuthedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = voteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const choice = await getActiveDailyChoice();
  if (!choice || choice.id !== parsed.data.choiceId || choice.resolved) {
    return NextResponse.json({ error: "This choice is no longer active" }, { status: 409 });
  }

  const result = await castVote(choice.id, user.id, parsed.data.option);
  if (result.status === "not_found") {
    return NextResponse.json({ error: "Vote could not be recorded" }, { status: 500 });
  }

  const tally = await getTally(choice.id);
  return NextResponse.json({
    status: result.status, // "recorded" | "already_voted"
    option: result.option,
    tally,
  });
}
