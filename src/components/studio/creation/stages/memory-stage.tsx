"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { safeRandomUUID } from "@/lib/utils";
import type { CharacterDraft, DraftMemory } from "../types";

const inputClass =
  "w-full rounded-sm bg-base border border-interactive px-3 h-10 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";

/**
 * Same shape as Creator Studio's MemoryBuilder, but everything here stays
 * local until the character is actually created — character_seed_memories
 * rows require a real character_id (FK), and we don't want to create the
 * character (which charges tokens and submits it for moderation) before
 * the creator has finished the whole wizard. Preview stage flushes
 * draft.memories to real POST /api/characters/:id/memories calls right
 * after creation succeeds.
 */
export function MemoryStage({
  draft,
  onChange,
}: {
  draft: CharacterDraft;
  onChange: (patch: Partial<CharacterDraft>) => void;
}) {
  const [entry, setEntry] = useState({ headline: "", content: "", category: "general", importance: 50 });

  function addMemory() {
    if (!entry.headline.trim() || !entry.content.trim()) return;
    const memory: DraftMemory = { key: safeRandomUUID(), ...entry };
    onChange({ memories: [...draft.memories, memory] });
    setEntry({ headline: "", content: "", category: "general", importance: 50 });
  }

  function removeMemory(key: string) {
    onChange({ memories: draft.memories.filter((m) => m.key !== key) });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg text-text-primary mb-1">Memory Architecture</h2>
        <p className="text-sm text-text-tertiary">
          Seed a few memories — these become real long-term memories, not just prompt text, from
          their very first conversation.
        </p>
      </div>

      <Card interactive={false} className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">Add Memory</h3>
        <input
          value={entry.headline}
          onChange={(e) => setEntry((d) => ({ ...d, headline: e.target.value }))}
          placeholder="Headline"
          maxLength={120}
          className={inputClass}
        />
        <textarea
          value={entry.content}
          onChange={(e) => setEntry((d) => ({ ...d, content: e.target.value }))}
          placeholder="What do they remember?"
          maxLength={2000}
          rows={2}
          className="w-full rounded-sm bg-base border border-interactive px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60 resize-none"
        />
        <div className="flex items-center gap-3">
          <input
            value={entry.category}
            onChange={(e) => setEntry((d) => ({ ...d, category: e.target.value }))}
            placeholder="Category"
            maxLength={50}
            className={inputClass + " max-w-[140px]"}
          />
          <div className="flex-1 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={entry.importance}
              onChange={(e) => setEntry((d) => ({ ...d, importance: Number(e.target.value) }))}
              className="flex-1 accent-gold-500"
            />
            <span className="text-xs text-gold-400 font-semibold tabular-nums w-8">{entry.importance}</span>
          </div>
          <Button type="button" size="sm" onClick={addMemory} disabled={!entry.headline.trim() || !entry.content.trim()}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </Card>

      {draft.memories.length === 0 ? (
        <p className="text-sm text-text-tertiary text-center py-8">
          No seed memories yet — optional, but a favorite memory or a secret goes a long way.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {draft.memories.map((m) => (
            <div key={m.key} className="flex items-start gap-3 rounded-md border border-border-hairline px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">{m.headline}</span>
                  <span className="text-[11px] text-text-tertiary uppercase">{m.category}</span>
                </div>
                <p className="text-xs text-text-secondary mt-1">{m.content}</p>
              </div>
              <span className="text-xs text-gold-400 font-semibold tabular-nums shrink-0">{m.importance}</span>
              <button onClick={() => removeMemory(m.key)} className="text-text-tertiary hover:text-danger shrink-0" aria-label="Delete memory">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
