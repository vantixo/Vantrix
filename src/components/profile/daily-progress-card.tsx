"use client";

import { useEffect, useState } from "react";
import { Flame, ShieldCheck, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface QuestItem {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  target: number;
  type: string;
  progress: number;
  completed: boolean;
}
interface UsageSnapshot {
  xp: { level: number; accumulated: number; threshold: number; pct: number };
  streak: { days: number; longest: number; shields: number };
  quests: {
    completed: number;
    total: number;
    bonusClaimed: boolean;
    bonusXp: number;
    items: QuestItem[];
  };
}

/**
 * GET /api/user/usage was built as a "consolidated HUD snapshot" (its own
 * docstring) — messages/tier/tokens are already shown on this page (see
 * getProfileSettings' cards above), but the route's xp/streak/quests
 * fields had no consumer anywhere in the app. StreakShieldPanel
 * (Settings) covers shield *activation* via a different, narrower route
 * (/api/user/streak-shield); this widget is read-only progress display,
 * sourced from the one route that already bundles all three consistently
 * (the route's own QUEST-MERGE-FIX comment describes fixing exactly this
 * kind of drift between a hand-rolled display and the real engine).
 */
export function DailyProgressCard() {
  const [data, setData] = useState<UsageSnapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/usage")
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null;

  if (!data) {
    return (
      <Card interactive={false} className="p-4 flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-text-secondary" />
      </Card>
    );
  }

  const { xp, streak, quests } = data;

  return (
    <Card interactive={false} className="p-4 mt-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-text-secondary">Level {xp.level}</span>
        <span className="text-xs text-text-tertiary tabular-nums">
          {xp.accumulated} / {xp.threshold} XP
        </span>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
        <div className="h-full bg-gold-fill" style={{ width: `${xp.pct}%` }} />
      </div>

      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-1.5 text-sm text-text-primary">
          <Flame className="h-4 w-4 text-gold-500" />
          {streak.days}-day streak
          {streak.longest > streak.days && (
            <span className="text-text-tertiary text-xs">(best {streak.longest})</span>
          )}
        </div>
        {streak.shields > 0 && (
          <div className="flex items-center gap-1 text-xs text-text-secondary">
            <ShieldCheck className="h-3.5 w-3.5 text-gold-400" />
            {streak.shields} shield{streak.shields === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {quests.items.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border-hairline">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-text-secondary uppercase tracking-wide">
              Daily quests
            </span>
            <span className="text-xs text-text-tertiary tabular-nums">
              {quests.completed} / {quests.total}
            </span>
          </div>
          <ul className="space-y-1.5">
            {quests.items.map((q) => (
              <li key={q.id} className="flex items-center gap-2 text-sm">
                {q.completed ? (
                  <CheckCircle2 className="h-4 w-4 text-gold-500 shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-text-tertiary shrink-0" />
                )}
                <span className={cn("truncate", q.completed ? "text-text-secondary" : "text-text-primary")}>
                  {q.title}
                </span>
                <span className="text-text-tertiary text-xs ml-auto shrink-0">
                  {q.progress}/{q.target}
                </span>
              </li>
            ))}
          </ul>
          {quests.completed >= quests.total && (
            <p className="text-xs text-gold-400 mt-2">
              {quests.bonusClaimed
                ? `Bonus claimed: +${quests.bonusXp} XP`
                : `All quests done — +${quests.bonusXp} bonus XP incoming`}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
