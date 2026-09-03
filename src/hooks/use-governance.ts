"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * FRONTEND_DIRECTIVE §10 domain hook for world/governance (elections.ts,
 * laws.ts backed routes). governance-panel.tsx previously ran its own
 * Promise.all of 4 fetches in a useEffect with no shared shape; this
 * follows the standard `{ data, isLoading, error }` read pattern since,
 * unlike dating's swipe deck, nothing here needs optimistic-removal
 * semantics for the *list* itself — only individual vote/retract actions
 * do, so those stay as imperative functions the caller applies to its own
 * local card state (see ElectionCard/LawCard in governance-panel.tsx).
 */

export interface Candidate {
  id: string;
  platform: string | null;
  polling: number;
  character: { id: string; name: string; image_url: string | null } | null;
}

export interface Election {
  id: string;
  status: "campaigning" | "voting" | "concluded";
  location: { id: string; name: string } | null;
  candidates: Candidate[];
  my_vote: string | null;
}

export interface ElectionResult {
  id: string;
  location: { id: string; name: string } | null;
  winner: { id: string; name: string; image_url: string | null } | null;
  my_candidate_id: string | null;
}

export interface LawProposal {
  id: string;
  title: string;
  description: string;
  category: string;
  support: number;
  location: { id: string; name: string } | null;
  my_vote: "support" | "oppose" | null;
}

export interface LawResult {
  id: string;
  title: string;
  status: "passed" | "rejected";
  location: { id: string; name: string } | null;
  my_position: "support" | "oppose" | null;
}

interface GovernanceData {
  elections: Election[];
  electionResults: ElectionResult[];
  laws: LawProposal[];
  lawResults: LawResult[];
}

export function useGovernance() {
  const [data, setData] = useState<GovernanceData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    Promise.all([
      fetch("/api/elections/active").then((r) => r.json()),
      fetch("/api/elections/results").then((r) => r.json()),
      fetch("/api/laws/active").then((r) => r.json()),
      fetch("/api/laws/results").then((r) => r.json()),
    ])
      .then(([e, er, l, lr]) => {
        if (cancelled) return;
        setData({
          elections: e.elections ?? [],
          electionResults: er.results ?? [],
          laws: l.laws ?? [],
          lawResults: lr.results ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load governance data.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const voteElection = useCallback(async (electionId: string, candidateId: string) => {
    const res = await fetch(`/api/elections/${electionId}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateId }),
    });
    return res.ok;
  }, []);

  const retractElectionVote = useCallback(async (electionId: string) => {
    const res = await fetch(`/api/elections/${electionId}/vote`, { method: "DELETE" });
    return res.ok;
  }, []);

  const voteLaw = useCallback(async (lawId: string, position: "support" | "oppose") => {
    const res = await fetch(`/api/laws/${lawId}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ position }),
    });
    return res.ok;
  }, []);

  const retractLawVote = useCallback(async (lawId: string) => {
    const res = await fetch(`/api/laws/${lawId}/vote`, { method: "DELETE" });
    return res.ok;
  }, []);

  return { data, isLoading, error, voteElection, retractElectionVote, voteLaw, retractLawVote };
}
