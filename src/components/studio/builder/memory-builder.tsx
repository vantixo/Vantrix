"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { addSeedMemory, deleteSeedMemory } from "@/hooks/use-studio";

export interface SeedMemory {
  id: string;
  category: string;
  headline: string;
  content: string;
  importance: number;
  position: number;
}

const inputClass =
  "w-full rounded-sm bg-base border border-interactive px-3 h-10 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";

/**
 * Distinct from the other 4 builders — this is row-level CRUD against
 * character_seed_memories, not a single PATCH, matching
 * memories/route.ts's own GET/POST/PATCH/DELETE shape.
 */
export function MemoryBuilder({
  characterId,
  initial,
}: {
  characterId: string;
  initial: SeedMemory[];
}) {
  const [memories, setMemories] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ headline: "", content: "", category: "general", importance: 50 });
  const [error, setError] = useState<string | null>(null);

  async function addMemory() {
    if (!draft.headline.trim() || !draft.content.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const memory = await addSeedMemory(characterId, { ...draft, position: memories.length });
      setMemories((m) => [...m, memory]);
      setDraft({ headline: "", content: "", category: "general", importance: 50 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add memory.");
    } finally {
      setAdding(false);
    }
  }

  async function deleteMemory(id: string) {
    setMemories((m) => m.filter((x) => x.id !== id));
    deleteSeedMemory(characterId, id);
  }

  return (
    <div className="space-y-4">
      <Card interactive={false} className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          Add Memory
        </h3>
        <input
          value={draft.headline}
          onChange={(e) => setDraft((d) => ({ ...d, headline: e.target.value }))}
          placeholder="Headline"
          maxLength={120}
          className={inputClass}
        />
        <textarea
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          placeholder="What do they remember?"
          maxLength={2000}
          rows={2}
          className="w-full rounded-sm bg-base border border-interactive px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60 resize-none"
        />
        <div className="flex items-center gap-3">
          <input
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
            placeholder="Category"
            maxLength={50}
            className={inputClass + " max-w-[140px]"}
          />
          <div className="flex-1 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={draft.importance}
              onChange={(e) => setDraft((d) => ({ ...d, importance: Number(e.target.value) }))}
              className="flex-1 accent-gold-500"
            />
            <span className="text-xs text-gold-400 font-semibold tabular-nums w-8">
              {draft.importance}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            onClick={addMemory}
            disabled={adding || !draft.headline.trim() || !draft.content.trim()}
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </Card>

      {memories.length === 0 ? (
        <p className="text-sm text-text-tertiary text-center py-8">No seed memories yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {memories.map((m) => (
            <div key={m.id} className="flex items-start gap-3 rounded-md border border-border-hairline px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">{m.headline}</span>
                  <span className="text-[11px] text-text-tertiary uppercase">{m.category}</span>
                </div>
                <p className="text-xs text-text-secondary mt-1">{m.content}</p>
              </div>
              <span className="text-xs text-gold-400 font-semibold tabular-nums shrink-0">
                {m.importance}
              </span>
              <button
                onClick={() => deleteMemory(m.id)}
                className="text-text-tertiary hover:text-danger shrink-0"
                aria-label="Delete memory"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
