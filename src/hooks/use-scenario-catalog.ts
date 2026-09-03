"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoleplayScenario, RoleplayScenarioVote } from "@/types/roleplay";

export type ScenarioWithLock = RoleplayScenario & { locked: boolean; myVote: RoleplayScenarioVote };

export function useScenarioCatalog(characterId: string) {
  const [scenarios, setScenarios] = useState<ScenarioWithLock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [votingId, setVotingId] = useState<string | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/roleplay/scenarios?characterId=${encodeURIComponent(characterId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setError(body?.error ?? `Could not load stories (${res.status})`);
        return;
      }
      setScenarios(body.scenarios as ScenarioWithLock[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load stories");
    } finally {
      setIsLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    load();
  }, [load]);

  // Casts/switches/clears the caller's like or dislike on a scenario.
  // Applies the server's returned counts (not an optimistic +1/-1) since the
  // toggle is 3-state (none/like/dislike) and the server is the source of
  // truth for exactly what changed.
  const castVote = useCallback(async (scenarioId: string, voteType: "like" | "dislike") => {
    setVotingId(scenarioId);
    setVoteError(null);
    try {
      const res = await fetch(`/api/roleplay/scenarios/${encodeURIComponent(scenarioId)}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voteType }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setVoteError(body?.error ?? `Could not register your vote (${res.status})`);
        return;
      }
      setScenarios(prev =>
        prev.map(s =>
          s.id === scenarioId
            ? { ...s, myVote: body.vote, like_count: body.like_count, dislike_count: body.dislike_count }
            : s,
        ),
      );
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : "Could not register your vote");
    } finally {
      setVotingId(null);
    }
  }, []);

  return { scenarios, isLoading, error, reload: load, castVote, votingId, voteError };
}
