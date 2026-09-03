"use client";

import { useEffect, useState } from "react";
import { Loader2, Vote } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DailyWorldChoice {
  id: string;
  locationName: string | null;
  prompt: string;
  context: string | null;
  optionALabel: string;
  optionBLabel: string;
  resolved: boolean;
  resolvedOption: "a" | "b" | null;
}
interface DailyChoiceTally {
  votesA: number;
  votesB: number;
  votesTotal: number;
}

/**
 * §2.5-adjacent pass: GET/POST /api/universe/daily-choice — a complete,
 * idempotent voting mechanic (one vote/day, tally hidden until you vote,
 * to avoid bandwagon effects — see src/lib/universe/daily-choice.ts's own
 * docstring) — had zero frontend consumer anywhere in the app. Placed in
 * the World page's Overview tab, above Active Events, since it's a daily
 * "front door" mechanic rather than a per-location/faction drill-down.
 *
 * Self-contained fetch-on-mount + local vote state, same shape as
 * LegendsPanel/StatusPanel, but with a real mutation (POST) — closer to
 * GovernancePanel's vote/retract pattern than either read-only panel.
 */
export function DailyChoiceCard() {
  const [choice, setChoice] = useState<DailyWorldChoice | null | undefined>(undefined);
  const [userVote, setUserVote] = useState<"a" | "b" | null>(null);
  const [tally, setTally] = useState<DailyChoiceTally | null>(null);
  const [voting, setVoting] = useState<"a" | "b" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/universe/daily-choice")
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setChoice(body.choice ?? null);
        setUserVote(body.userVote?.option ?? null);
        setTally(body.tally ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load today's world choice.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function vote(option: "a" | "b") {
    if (!choice || userVote || voting) return;
    setVoting(option);
    try {
      const res = await fetch("/api/universe/daily-choice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choiceId: choice.id, option }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Vote failed — please try again.");
        return;
      }
      setUserVote(body.option ?? option);
      setTally(body.tally ?? null);
    } catch {
      setError("Vote failed — please try again.");
    } finally {
      setVoting(null);
    }
  }

  if (choice === undefined) {
    return (
      <div className="flex items-center justify-center py-8 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  // No active choice today — not an error, just nothing to render.
  if (choice === null) return null;

  const pctA = tally && tally.votesTotal > 0 ? Math.round((tally.votesA / tally.votesTotal) * 100) : 0;
  const pctB = tally ? 100 - pctA : 0;
  const hasVoted = Boolean(userVote) || choice.resolved;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-2">
        <Vote className="h-4 w-4 text-gold-500 shrink-0" />
        <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
          Today&apos;s World Choice
          {choice.locationName ? ` · ${choice.locationName}` : ""}
        </span>
      </div>

      <p className="text-text-primary text-[15px] font-semibold">{choice.prompt}</p>
      {choice.context && (
        <p className="text-text-secondary text-sm mt-1.5">{choice.context}</p>
      )}

      {error && <p className="text-sm text-danger mt-2">{error}</p>}

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {(["a", "b"] as const).map((opt) => {
          const label = opt === "a" ? choice.optionALabel : choice.optionBLabel;
          const pct = opt === "a" ? pctA : pctB;
          const isMine = userVote === opt;
          const isResolved = choice.resolved && choice.resolvedOption === opt;

          if (!hasVoted) {
            return (
              <Button
                key={opt}
                variant="secondary"
                size="lg"
                disabled={voting !== null}
                onClick={() => vote(opt)}
                className="justify-start h-auto py-3 px-4 text-left whitespace-normal"
              >
                {voting === opt ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : null}
                {label}
              </Button>
            );
          }

          return (
            <div
              key={opt}
              className={cn(
                "relative rounded-sm border px-4 py-3 overflow-hidden",
                isMine ? "border-gold-500" : "border-border-hairline"
              )}
            >
              <div
                className="absolute inset-y-0 left-0 bg-gold-500/10"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
              <div className="relative flex items-center justify-between gap-2">
                <span className="text-sm text-text-primary">
                  {label}
                  {isMine && <span className="text-gold-400"> · your vote</span>}
                  {isResolved && <span className="text-gold-400"> · won</span>}
                </span>
                {tally && <span className="text-sm font-semibold text-text-secondary">{pct}%</span>}
              </div>
            </div>
          );
        })}
      </div>

      {tally && (
        <p className="text-xs text-text-tertiary mt-3">
          {tally.votesTotal.toLocaleString()} vote{tally.votesTotal === 1 ? "" : "s"} cast today.
        </p>
      )}
    </Card>
  );
}
