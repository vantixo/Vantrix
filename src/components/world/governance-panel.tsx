"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, Vote, ScrollText, ThumbsUp, ThumbsDown, X, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, resolveImageSrc } from "@/lib/utils";
import {
  useGovernance,
  type Election,
  type LawProposal,
} from "@/hooks/use-governance";

export function GovernancePanel() {
  const { data, isLoading, error, voteElection, retractElectionVote, voteLaw, retractLawVote } =
    useGovernance();

  if (error) {
    return <p className="text-sm text-text-tertiary py-8 text-center">{error}</p>;
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const { elections, electionResults, laws, lawResults } = data;

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3 flex items-center gap-2">
          <Vote className="h-4 w-4 text-gold-500" /> Elections
        </h2>
        {elections.length === 0 ? (
          <p className="text-sm text-text-tertiary">No elections underway right now.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {elections.map((e) => (
              <ElectionCard
                key={e.id}
                election={e}
                onVote={voteElection}
                onRetract={retractElectionVote}
              />
            ))}
          </div>
        )}
        {electionResults.length > 0 && (
          <div className="mt-4 space-y-2">
            {electionResults.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-sm border border-border-hairline px-3.5 py-2.5 text-sm"
              >
                <Trophy className="h-4 w-4 text-gold-400 shrink-0" />
                <span className="text-text-secondary flex-1">
                  <span className="text-text-primary font-medium">
                    {r.winner?.name ?? "A candidate"}
                  </span>{" "}
                  won the election in {r.location?.name ?? "an unknown location"}.
                </span>
                {r.my_candidate_id && (
                  <span
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wide shrink-0",
                      r.my_candidate_id === r.winner?.id ? "text-gold-400" : "text-text-tertiary"
                    )}
                  >
                    {r.my_candidate_id === r.winner?.id ? "You won" : "You voted"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3 flex items-center gap-2">
          <ScrollText className="h-4 w-4 text-gold-500" /> Law Proposals
        </h2>
        {laws.length === 0 ? (
          <p className="text-sm text-text-tertiary">No laws are up for a vote right now.</p>
        ) : (
          <div className="space-y-3">
            {laws.map((l) => (
              <LawCard key={l.id} law={l} onVote={voteLaw} onRetract={retractLawVote} />
            ))}
          </div>
        )}
        {lawResults.length > 0 && (
          <div className="mt-4 space-y-2">
            {lawResults.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-3 rounded-sm border border-border-hairline px-3.5 py-2.5 text-sm"
              >
                <ScrollText className="h-4 w-4 text-text-tertiary shrink-0" />
                <span className="text-text-secondary flex-1">
                  <span className="text-text-primary font-medium">{r.title}</span>{" "}
                  {r.status === "passed" ? "passed" : "was rejected"}
                  {r.location?.name ? ` in ${r.location.name}` : ""}.
                </span>
                {r.my_position && (
                  <span
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wide shrink-0",
                      (r.my_position === "support") === (r.status === "passed")
                        ? "text-gold-400"
                        : "text-text-tertiary"
                    )}
                  >
                    You {r.my_position}ed
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ElectionCard({
  election,
  onVote,
  onRetract,
}: {
  election: Election;
  onVote: (electionId: string, candidateId: string) => Promise<boolean>;
  onRetract: (electionId: string) => Promise<boolean>;
}) {
  const [myVote, setMyVote] = useState(election.my_vote);
  const [pending, setPending] = useState<string | null>(null);
  const canVote = election.status === "campaigning";

  async function vote(candidateId: string) {
    setPending(candidateId);
    try {
      if (await onVote(election.id, candidateId)) setMyVote(candidateId);
    } finally {
      setPending(null);
    }
  }

  async function retract() {
    setPending("retract");
    try {
      if (await onRetract(election.id)) setMyVote(null);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-md border border-border-hairline p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-text-primary">
          {election.location?.name ?? "Unknown location"}
        </span>
        <span
          className={cn(
            "text-xs uppercase tracking-wide font-semibold",
            canVote ? "text-gold-400" : "text-text-tertiary"
          )}
        >
          {election.status}
        </span>
      </div>

      <div className="space-y-2">
        {election.candidates.map((c) => {
          const isMine = myVote === c.id;
          return (
            <div
              key={c.id}
              className={cn(
                "flex items-center gap-3 rounded-sm border px-3 py-2 transition-colors ease-premium",
                isMine ? "border-gold-500/60 bg-gold-500/5" : "border-border-hairline"
              )}
            >
              {c.character ? (
                <Image
                  src={resolveImageSrc(c.character.image_url)}
                  alt=""
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-white/5 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm text-text-primary truncate">
                  {c.character?.name ?? "Independent"}
                </div>
                {c.platform && (
                  <div className="text-xs text-text-tertiary truncate">{c.platform}</div>
                )}
              </div>
              <span className="text-xs text-gold-400 tabular-nums shrink-0">
                {Math.round(c.polling)}%
              </span>
              {canVote && (
                <Button
                  variant={isMine ? "secondary" : "ghost"}
                  size="sm"
                  disabled={pending !== null}
                  onClick={() => vote(c.id)}
                  className="shrink-0 h-8 px-3 text-xs"
                >
                  {pending === c.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isMine ? (
                    "Voted"
                  ) : (
                    "Vote"
                  )}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {canVote && myVote && (
        <button
          onClick={retract}
          disabled={pending !== null}
          className="mt-3 flex items-center gap-1 text-xs text-text-tertiary hover:text-danger transition-colors ease-premium"
        >
          <X className="h-3 w-3" /> Retract vote
        </button>
      )}
    </div>
  );
}

function LawCard({
  law,
  onVote,
  onRetract,
}: {
  law: LawProposal;
  onVote: (lawId: string, position: "support" | "oppose") => Promise<boolean>;
  onRetract: (lawId: string) => Promise<boolean>;
}) {
  const [myVote, setMyVote] = useState(law.my_vote);
  const [pending, setPending] = useState<"support" | "oppose" | "retract" | null>(null);

  async function vote(position: "support" | "oppose") {
    setPending(position);
    try {
      if (await onVote(law.id, position)) setMyVote(position);
    } finally {
      setPending(null);
    }
  }

  async function retract() {
    setPending("retract");
    try {
      if (await onRetract(law.id)) setMyVote(null);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-md border border-border-hairline p-4">
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">{law.title}</div>
          <div className="text-xs text-text-tertiary mt-0.5">
            {law.location?.name ?? "Unknown location"} · {law.category}
          </div>
        </div>
        <span className="text-xs text-gold-400 tabular-nums shrink-0">
          {Math.round(law.support)}% support
        </span>
      </div>

      <p className="text-sm text-text-secondary mt-2 mb-3">{law.description}</p>

      <div className="flex items-center gap-2">
        <Button
          variant={myVote === "support" ? "secondary" : "ghost"}
          size="sm"
          disabled={pending !== null}
          onClick={() => vote("support")}
          className="h-8 px-3 text-xs gap-1.5"
        >
          {pending === "support" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ThumbsUp className="h-3.5 w-3.5" />
          )}
          Support
        </Button>
        <Button
          variant={myVote === "oppose" ? "secondary" : "ghost"}
          size="sm"
          disabled={pending !== null}
          onClick={() => vote("oppose")}
          className="h-8 px-3 text-xs gap-1.5"
        >
          {pending === "oppose" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ThumbsDown className="h-3.5 w-3.5" />
          )}
          Oppose
        </Button>
        {myVote && (
          <button
            onClick={retract}
            disabled={pending !== null}
            className="flex items-center gap-1 text-xs text-text-tertiary hover:text-danger transition-colors ease-premium ml-1"
          >
            <X className="h-3 w-3" /> Retract
          </button>
        )}
      </div>
    </div>
  );
}
