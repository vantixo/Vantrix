"use client";

import { useEffect, useState } from "react";
import { Loader2, Brain, Heart, Sparkles, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { momentLabel } from "@/lib/ai/moment-labels";
import type { PriorityMemory } from "@/lib/ai/priority-memory";

const SOURCE_ICON: Record<PriorityMemory["source"], typeof Brain> = {
  memory_graph: Brain,
  user_facts: Heart,
  manual: Sparkles,
};

/** Title-cases a user_facts category ('pain_point' -> 'Pain point') for
 *  display — mirrors momentLabel's readable-fallback shape for
 *  memory_graph categories without pretending fact categories are moments. */
function factCategoryLabel(category: string): string {
  const spaced = category.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function headlineFor(memory: PriorityMemory): string {
  if (memory.source === "memory_graph") return momentLabel(memory.category);
  if (memory.source === "user_facts") return factCategoryLabel(memory.category);
  return memory.headline;
}

/**
 * Backs GET /api/memories/priority — see that route's own doc comment
 * ("User-facing endpoint backing a 'memories' UI page") and
 * priority-memory.ts's header comment (item 1: "Shown directly to the
 * user"). Nothing in this codebase rendered it before this component.
 *
 * `initialMemories` is the server-rendered first paint (page.tsx calls
 * getPriorityMemories directly per this project's §10 convention); this
 * component only re-fetches client-side when the keyword filter changes.
 */
export function MemoriesPanel({
  characterId,
  characterName,
  initialMemories,
}: {
  characterId: string;
  characterName: string;
  initialMemories: PriorityMemory[];
}) {
  const [memories, setMemories] = useState<PriorityMemory[]>(initialMemories);
  const [activeKeyword, setActiveKeyword] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // First paint already came from the server via initialMemories — only
    // hit the API route once a filter is actually applied/cleared.
    if (activeKeyword === null) {
      setMemories(initialMemories);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ characterId, keyword: activeKeyword });
    fetch(`/api/memories/priority?${params.toString()}`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setMemories(body.memories ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load memories.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKeyword, characterId]);

  const allKeywords = Array.from(
    new Set(initialMemories.flatMap((m) => m.keywords))
  ).slice(0, 12);

  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      {allKeywords.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {activeKeyword && (
            <button
              onClick={() => setActiveKeyword(null)}
              className="flex items-center gap-1 rounded-xs border border-gold-500/50 bg-gold-500/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-gold-400"
            >
              {activeKeyword} <X className="h-3 w-3" />
            </button>
          )}
          {allKeywords
            .filter((k) => k !== activeKeyword)
            .map((k) => (
              <button key={k} onClick={() => setActiveKeyword(k)}>
                <Badge variant="outline" className="cursor-pointer hover:border-gold-400 hover:text-gold-300">
                  {k}
                </Badge>
              </button>
            ))}
        </div>
      )}

      {error && <p className="py-8 text-center text-sm text-text-tertiary">{error}</p>}

      {loading && (
        <div className="flex items-center justify-center py-16 text-text-secondary">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {!loading && !error && memories.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border-hairline py-16 text-center">
          <Brain className="h-8 w-8 text-text-tertiary" />
          <p className="max-w-xs text-sm text-text-secondary">
            {activeKeyword
              ? `Nothing tagged "${activeKeyword}" yet.`
              : `You haven't built up any memories with ${characterName} yet — keep talking and she'll start remembering what matters.`}
          </p>
        </div>
      )}

      {!loading && !error && memories.length > 0 && (
        <div className="flex flex-col gap-3">
          {memories.map((m) => {
            const Icon = SOURCE_ICON[m.source] ?? Sparkles;
            return (
              <Card key={m.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      m.source === "memory_graph" ? "bg-gold-500/10" : "bg-white/5"
                    )}
                  >
                    <Icon className="h-4 w-4 text-gold-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">
                      {headlineFor(m)}
                    </p>
                    <p className="mt-1 text-sm text-text-secondary">{m.content}</p>
                    {m.keywords.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.keywords.map((k) => (
                          <button key={k} onClick={() => setActiveKeyword(k)}>
                            <Badge variant="outline" className="cursor-pointer hover:border-gold-400 hover:text-gold-300">
                              {k}
                            </Badge>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
