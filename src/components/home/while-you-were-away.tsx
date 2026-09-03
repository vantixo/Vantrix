"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import Link from "next/link";
import {
  Sparkles,
  Users,
  Compass,
  Target,
  MapPin,
  Heart,
  TrendingUp,
  Activity,
  X,
} from "lucide-react";
import { cn, resolveImageSrc } from "@/lib/utils";

export interface FeedEntry {
  id: string;
  character_id: string;
  content: string;
  entry_type: string;
  is_read: boolean;
  created_at: string;
  character: { id: string; name: string; image_url: string | null } | null;
}

const ENTRY_ICONS: Record<string, typeof Sparkles> = {
  activity: Activity,
  social: Users,
  discovery: Compass,
  goal_progress: Target,
  location_change: MapPin,
  relationship_change: Heart,
  wealth_change: TrendingUp,
  status_change: Sparkles,
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * "Users should come back to a world that has been living without them" —
 * feed-builder.ts's own tagline. That system had zero UI surface anywhere
 * (getUserFeed had zero callers, no GET route existed). This is that
 * surface: a dismissible section on Home showing what characters have
 * been up to since the user's last visit.
 */
export function WhileYouWereAway({ initialEntries }: { initialEntries: FeedEntry[] }) {
  const [entries, setEntries] = useState(initialEntries);
  const [dismissing, setDismissing] = useState(false);

  if (entries.length === 0) return null;

  async function dismissAll() {
    setDismissing(true);
    setEntries([]);
    try {
      await fetch("/api/user/feed/mark-read", { method: "POST" });
    } catch {
      // best-effort — entries stay dismissed client-side regardless
    } finally {
      setDismissing(false);
    }
  }

  async function dismissOne(entryId: string, characterId: string) {
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    try {
      await fetch("/api/user/feed/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterId }),
      });
    } catch {
      // best-effort
    }
  }

  return (
    <section className="px-4 md:px-8 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-xl md:text-2xl text-text-primary">
            While You Were Away
          </h2>
          <button
            onClick={dismissAll}
            disabled={dismissing}
            className="text-sm font-semibold text-gold-400 hover:text-gold-300 transition-colors ease-premium disabled:opacity-40"
          >
            Dismiss all
          </button>
        </div>

        <div className="space-y-2">
          {entries.map((entry) => {
            const Icon = ENTRY_ICONS[entry.entry_type] ?? Sparkles;
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-start gap-3 rounded-sm border border-border-hairline bg-base px-4 py-3"
                )}
              >
                <Link href={`/characters/${entry.character_id}`} className="relative shrink-0">
                  <Image
                    src={resolveImageSrc(entry.character?.image_url)}
                    alt={entry.character?.name ?? "Character"}
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-full object-cover"
                  />
                  <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-base border border-border-hairline">
                    <Icon className="h-2.5 w-2.5 text-gold-400" />
                  </span>
                </Link>

                <div className="flex-1 min-w-0">
                  <Link
                    href={`/characters/${entry.character_id}`}
                    className="text-sm font-medium text-text-primary hover:text-gold-400 transition-colors ease-premium"
                  >
                    {entry.character?.name ?? "Someone"}
                  </Link>
                  <p className="text-sm text-text-secondary mt-0.5">{entry.content}</p>
                  <p className="text-xs text-text-tertiary mt-1">{timeAgo(entry.created_at)}</p>
                </div>

                <button
                  onClick={() => dismissOne(entry.id, entry.character_id)}
                  aria-label="Dismiss"
                  className="shrink-0 text-text-tertiary hover:text-text-primary transition-colors ease-premium p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
