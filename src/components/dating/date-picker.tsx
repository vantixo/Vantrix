"use client";

import { useState } from "react";
import { Lock, Loader2, CalendarCheck, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DATE_CATALOGUE, isDateUnlocked } from "@/lib/dating/constants";
import { useFirstDate } from "@/hooks/use-first-date";
import type { ActiveDateSession } from "@/lib/frontend/dating";

const ERROR_MESSAGES: Record<string, string> = {
  DATE_LOCKED: "Reach a higher tier with this match to unlock that date.",
  INSUFFICIENT_TOKENS: "Not enough Vantrix Coin for this date — top up to continue.",
  CONTENT_POLICY_VIOLATION: "That request was rejected by content moderation.",
  RATE_LIMIT_EXCEEDED: "Too many requests right now — try again in a minute.",
};

type LiveSession = { id: string; dateName: string; openingScene: string };

export function DatePicker({
  matchId,
  matchTier,
  initialActiveSession,
  onBondChange,
}: {
  matchId: string;
  matchTier: string;
  initialActiveSession: ActiveDateSession | null;
  onBondChange?: (newBond: number) => void;
}) {
  const { startDate, completeDate, isStarting, isCompleting, error, clearError } =
    useFirstDate(matchId);

  const [live, setLive] = useState<LiveSession | null>(
    initialActiveSession
      ? {
          id: initialActiveSession.id,
          dateName:
            DATE_CATALOGUE.find((d) => d.type === initialActiveSession.date_type)?.name ??
            initialActiveSession.date_type,
          openingScene: initialActiveSession.opening_scene,
        }
      : null
  );
  const [customPrompt, setCustomPrompt] = useState("");
  const [pendingCustom, setPendingCustom] = useState(false);
  const [recap, setRecap] = useState("");
  const [completedMsg, setCompletedMsg] = useState<string | null>(null);

  async function handlePick(type: string) {
    clearError();
    if (type === "custom" && !pendingCustom) {
      setPendingCustom(true);
      return;
    }
    const result = await startDate(type, type === "custom" ? customPrompt.trim() : undefined);
    if (result) {
      setLive({ id: result.sessionId, dateName: result.dateName, openingScene: result.openingScene });
      setPendingCustom(false);
      setCustomPrompt("");
    }
  }

  async function handleComplete() {
    if (!live) return;
    const result = await completeDate(live.id, recap.trim() || undefined);
    if (result) {
      onBondChange?.(result.newBond);
      setCompletedMsg(
        result.milestoneAwarded === "first_date"
          ? "Date complete — first date milestone unlocked!"
          : "Date complete — that moment is now part of your history together."
      );
      setLive(null);
      setRecap("");
    }
  }

  if (completedMsg) {
    return (
      <p className="flex items-center gap-2 rounded-sm border border-gold-500/30 bg-gold-500/5 px-3 py-2 text-sm text-gold-400">
        <Sparkles className="h-4 w-4 shrink-0" /> {completedMsg}
      </p>
    );
  }

  if (live) {
    return (
      <div className="rounded-md border border-gold-500/30 bg-gold-500/5 p-4">
        <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-gold-400">
          <CalendarCheck className="h-4 w-4" /> {live.dateName} — in progress
        </p>
        <p className="mb-3 text-sm text-text-primary">{live.openingScene}</p>
        <p className="mb-2 text-xs text-text-tertiary">
          Keep chatting to live it out, then wrap it up here whenever you&apos;re ready.
        </p>
        <textarea
          value={recap}
          onChange={(e) => setRecap(e.target.value)}
          maxLength={500}
          placeholder="How did it go? (optional recap)"
          rows={2}
          className="w-full resize-none rounded-sm border border-interactive bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 focus:outline-none"
        />
        {error && (
          <p className="mt-2 text-sm text-danger">{ERROR_MESSAGES[error.code ?? ""] ?? error.error}</p>
        )}
        <Button size="sm" className="mt-3" onClick={handleComplete} disabled={isCompleting}>
          {isCompleting && <Loader2 className="h-4 w-4 animate-spin" />}
          End Date
        </Button>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <p className="mb-3 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {ERROR_MESSAGES[error.code ?? ""] ?? error.error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DATE_CATALOGUE.map((date) => {
          const unlocked = isDateUnlocked(date.tier, matchTier);
          return (
            <button
              key={date.type}
              disabled={!unlocked || isStarting}
              onClick={() => handlePick(date.type)}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors ease-premium",
                unlocked
                  ? "border-border-hairline hover:border-gold-500/40"
                  : "border-border-hairline opacity-40"
              )}
            >
              {!unlocked && <Lock className="absolute right-2 top-2 h-3 w-3 text-text-tertiary" />}
              <span className="text-2xl">{date.emoji}</span>
              <span className="line-clamp-1 text-xs text-text-primary">{date.name}</span>
              <span className="text-[11px] text-gold-400">{date.tokens}c</span>
            </button>
          );
        })}
      </div>

      {pendingCustom && (
        <div className="mt-4 border-t border-border-hairline pt-4">
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            maxLength={300}
            placeholder="Set the scene — where are you, what's the vibe?"
            rows={2}
            autoFocus
            className="w-full resize-none rounded-sm border border-interactive bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 focus:outline-none"
          />
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              onClick={() => handlePick("custom")}
              disabled={isStarting || customPrompt.trim().length === 0}
            >
              {isStarting && <Loader2 className="h-4 w-4 animate-spin" />}
              Start Date
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPendingCustom(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {isStarting && !pendingCustom && (
        <p className="mt-3 flex items-center gap-2 text-sm text-text-tertiary">
          <Loader2 className="h-4 w-4 animate-spin" /> Setting the scene...
        </p>
      )}
    </div>
  );
}
