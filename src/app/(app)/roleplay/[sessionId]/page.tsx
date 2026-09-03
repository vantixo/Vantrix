import { notFound } from "next/navigation";
import {
  getSession,
  getScenarioById,
  getCharacterNameAndAvatar,
  getSessionMessages,
  getBeats,
} from "@/lib/frontend/roleplay";
import { RoleplayStage } from "@/components/roleplay/roleplay-stage";
import type { RoleplayFeedItem } from "@/types/roleplay";

export const dynamic = "force-dynamic";

/**
 * `sessionId` is a roleplay_sessions.id. RLS on that table already scopes
 * getSession() to the requesting user, so a not-mine or nonexistent id both
 * resolve to null here — same 404-not-403 posture as /chat/[id].
 */
export default async function RoleplaySessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  const session = await getSession(sessionId);
  if (!session) notFound();

  const [scenario, character, messages, beats] = await Promise.all([
    getScenarioById(session.scenario_id),
    getCharacterNameAndAvatar(session.character_id),
    getSessionMessages(session.conversation_id, session.started_at),
    getBeats(sessionId),
  ]);
  if (!scenario || !character) notFound();

  // Join messages (exact text) with beats (chapter/type/choices) on
  // message_id — see lib/frontend/roleplay.ts's getSessionMessages
  // docstring for why messages alone isn't enough (shared conversation
  // thread with freeform chat) and roleplay_beats alone isn't either (no
  // raw text for free-typed "say"/"do" actions).
  const beatsByMessageId = new Map(
    beats.filter((b) => b.message_id).map((b) => [b.message_id as string, b]),
  );

  const feed: RoleplayFeedItem[] = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      if (m.role === "assistant") {
        const beat = beatsByMessageId.get(m.id);
        return {
          id: m.id,
          role: "assistant" as const,
          content: m.content,
          chapter: beat?.chapter,
          beatType: beat?.beat_type,
          choices: beat?.choices ?? null,
        };
      }
      return { id: m.id, role: "user" as const, content: m.content };
    });

  const latestBeat = beats[beats.length - 1];
  const initialChoices = session.status === "active" ? (latestBeat?.choices ?? null) : null;

  return (
    <RoleplayStage
      sessionId={session.id}
      conversationId={session.conversation_id}
      scenarioTitle={scenario.title}
      scenarioSlug={scenario.slug}
      backdropUrl={scenario.cover_image_url}
      chapterCount={scenario.chapter_count}
      characterId={session.character_id}
      characterName={character.name}
      characterAvatar={character.avatarUrl}
      initialFeed={feed}
      initialChapter={session.current_chapter}
      initialStatus={session.status}
      initialChoices={initialChoices}
    />
  );
}
