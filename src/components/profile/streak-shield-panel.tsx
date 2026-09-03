"use client";

import { useEffect, useState } from "react";
import { Flame, Shield, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ShieldStatus {
  hasShield: boolean;
  shieldsMax: number;
  currentStreak: number;
  longestStreak: number;
  streakAtRisk: boolean;
  hoursSinceCheckin: number | null;
  tier: string;
}

/**
 * No existing streak UI anywhere in the app to hang this off of, so it
 * lives here in Settings — GET/POST /api/user/streak-shield were already
 * fully built server-side (consume_streak_shield RPC is row-locked/atomic)
 * with zero frontend caller.
 */
export function StreakShieldPanel() {
  const [status, setStatus] = useState<ShieldStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/user/streak-shield");
      if (res.ok) setStatus(await res.json());
    } catch {
      // silent — panel just won't render meaningfully
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function activateShield() {
    setActivating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/user/streak-shield", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't activate your shield.");
        return;
      }
      setMessage(body.message ?? "Shield activated.");
      await load();
    } catch {
      setError("Couldn't activate your shield. Try again.");
    } finally {
      setActivating(false);
    }
  }

  if (!loaded) {
    return <div className="h-16 animate-pulse rounded-sm bg-white/[0.03]" />;
  }

  if (!status) {
    return (
      <p className="text-xs text-text-tertiary py-3">
        Couldn&rsquo;t load your streak status.
      </p>
    );
  }

  return (
    <div className="py-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-gold-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-text-primary">
              {status.currentStreak}-day streak
            </p>
            <p className="text-xs text-text-tertiary mt-0.5">
              Longest: {status.longestStreak} days · {status.tier} plan
            </p>
          </div>
        </div>
        {status.hasShield ? (
          <span className="flex items-center gap-1.5 rounded-full border border-gold-500/50 px-3 py-1.5 text-xs font-semibold text-gold-400 shrink-0">
            <ShieldCheck className="h-3.5 w-3.5" />
            Shield ready
          </span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full border border-border-hairline px-3 py-1.5 text-xs font-semibold text-text-secondary shrink-0">
            <Shield className="h-3.5 w-3.5" />
            No shield
          </span>
        )}
      </div>

      {status.streakAtRisk && (
        <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2.5">
          <p className="text-xs text-danger">
            It&rsquo;s been {status.hoursSinceCheckin}h since your last check-in — your
            streak is at risk.
          </p>
        </div>
      )}

      {status.hasShield && (
        <Button
          onClick={activateShield}
          disabled={activating}
          variant="secondary"
          size="sm"
          className="w-full"
        >
          {activating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Shield className="h-3.5 w-3.5" />
          )}
          Activate shield now
        </Button>
      )}

      {!status.hasShield && status.shieldsMax === 0 && (
        <p className="text-xs text-text-tertiary">
          Upgrade your plan to earn streak shields that protect a missed day.
        </p>
      )}

      {message && <p className={cn("text-xs text-gold-400")}>{message}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
