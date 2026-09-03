"use client";

import { useEffect, useState } from "react";
import { Heart, Loader2, X } from "lucide-react";
import { MILESTONE_LABEL, MILESTONE_EMOJI } from "@/lib/dating/milestone-labels";

/**
 * WIRE-FIX (2026-08-20): GET /api/dating/milestones?matchId=... was fully
 * built (auth, per-user scoping, matchId filter) but had zero callers —
 * match/[id]/page.tsx only ever showed the 3 most recent milestones via
 * the matches route's own embedded `milestones_log` (deliberately capped
 * there, see that route's `.slice(0, 3)`). This drawer is the "view all"
 * entry point for that dedicated endpoint. Mirrors gift-drawer.tsx's
 * bottom-sheet pattern rather than introducing a new modal primitive.
 *
 * Also surfaces `description` and `bond_bonus`, which exist on the
 * dating_milestones table (see 20240101_production.sql) and this route's
 * `select('*')`, but were never rendered anywhere — the matches route's
 * embed only selects match_id/milestone_type/created_at.
 *
 * A11Y PASS (this revision): mirrors gift-drawer.tsx's overlay pixel-for-
 * pixel, which means it also mirrored gift-drawer's accessibility gaps —
 * no `role`/`aria-modal` for assistive tech, no way to dismiss via
 * backdrop tap, and no Escape-to-close for keyboard users. Brought up to
 * the same standard as media-lightbox.tsx's overlay (this app's other
 * dialog-on-top-of-content pattern): `role="dialog"` + `aria-modal` +
 * `aria-label` on the overlay, backdrop `onClick` closes (with the panel
 * itself stopping propagation so a tap inside doesn't also dismiss it),
 * and a window-level Escape listener scoped to while `open` is true.
 */

interface FullMilestone {
  id: string;
  match_id: string;
  milestone_type: string | null;
  milestone: string | null;
  description: string | null;
  bond_bonus: number;
  achieved_at: string;
  created_at: string;
}

export function AllMilestonesDrawer({
  matchId,
  totalCount,
}: {
  matchId: string;
  totalCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [milestones, setMilestones] = useState<FullMilestone[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function handleOpen() {
    setOpen(true);
    if (milestones) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dating/milestones?matchId=${encodeURIComponent(matchId)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw new Error(body?.error ?? "Couldn't load milestone history.");
      setMilestones(body.milestones ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load milestone history.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={handleOpen}
        className="text-xs font-medium text-gold-400 hover:text-gold-300"
      >
        View all {totalCount} milestones
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="All milestones"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-lg border border-border-hairline bg-base p-4 sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-base text-text-primary">All milestones</h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-text-secondary hover:text-text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {loading && (
              <p className="flex items-center gap-2 py-8 text-sm text-text-tertiary">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </p>
            )}

            {error && !loading && (
              <p className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            {milestones && !loading && (
              <div className="flex flex-col gap-2">
                {milestones.map((m) => {
                  const key = m.milestone_type ?? m.milestone ?? "";
                  return (
                    <div
                      key={m.id}
                      className="flex items-start gap-3 rounded-sm border border-border-hairline px-3 py-2 text-sm"
                    >
                      <span className="mt-0.5 shrink-0" aria-hidden>
                        {MILESTONE_EMOJI[key] ?? "\u{1F49B}"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-text-primary">
                            {MILESTONE_LABEL[key] ?? key}
                          </span>
                          <span className="shrink-0 text-xs text-text-tertiary">
                            {new Date(m.achieved_at ?? m.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {m.description && (
                          <p className="mt-0.5 text-xs text-text-secondary">{m.description}</p>
                        )}
                        {m.bond_bonus > 0 && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-gold-400">
                            <Heart className="h-3 w-3" /> +{m.bond_bonus} bond
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
