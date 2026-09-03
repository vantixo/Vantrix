"use client";

import { useState } from "react";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { setCharacterVisibility } from "@/hooks/use-studio";

export function VisibilityToggle({
  characterId,
  isPublic,
  canGoPublic,
}: {
  characterId: string;
  isPublic: boolean;
  canGoPublic: boolean;
}) {
  const [pub, setPub] = useState(isPublic);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (loading) return;
    const next = !pub;
    // Approval-gated in the other direction only: going public requires
    // moderation_status === 'approved' (canSetVisibility, see
    // visibility/route.ts) — going private is always allowed, so only
    // block the public-bound flip client-side.
    if (next && !canGoPublic) {
      setError("Waiting on moderation approval before this can go public.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await setCharacterVisibility(characterId, next ? "public" : "private");
      setPub(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update visibility.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={toggle}
        disabled={loading}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ease-premium",
          pub
            ? "border-gold-500/50 text-gold-400 hover:border-gold-400"
            : "border-border-hairline text-text-secondary hover:text-text-primary"
        )}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : pub ? (
          <Eye className="h-3.5 w-3.5" />
        ) : (
          <EyeOff className="h-3.5 w-3.5" />
        )}
        {pub ? "Public" : "Private"}
      </button>
      {error && <p className="text-[11px] text-danger max-w-[160px] text-right">{error}</p>}
    </div>
  );
}
