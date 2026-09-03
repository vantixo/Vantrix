"use client";

import { SafeImage as Image } from "@/components/ui/safe-image";
import { Sparkles } from "lucide-react";
import type { CharacterDraft } from "./types";
import { overallCompleteness } from "./completeness";

/**
 * Always-visible center panel — the doc's "character canvas." Reflects
 * whatever's been filled in so far, including before a portrait exists,
 * so the studio never feels like a blank form.
 */
export function CharacterCanvas({ draft }: { draft: CharacterDraft }) {
  const completeness = overallCompleteness(draft);
  const traits = [
    { label: "Warmth", value: draft.char_warmth },
    { label: "Openness", value: draft.char_openness },
    { label: "Adventure", value: draft.char_adventure },
    { label: "Depth", value: draft.char_depth },
  ];

  return (
    <div className="flex flex-col items-center text-center gap-5 py-8 px-4">
      <div className="relative h-56 w-56 rounded-md overflow-hidden border border-border-hairline bg-white/[0.02] flex items-center justify-center shrink-0">
        {draft.imageUrl ? (
          <Image src={draft.imageUrl} alt={draft.name || "Character portrait"} fill sizes="224px" className="object-cover" />
        ) : (
          <Sparkles className="h-8 w-8 text-text-tertiary" />
        )}
        {draft.identity_locked && draft.imageUrl && (
          <span className="absolute bottom-2 right-2 rounded-sm bg-black/60 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-400 border border-gold-500/40">
            Identity Locked
          </span>
        )}
      </div>

      <div>
        <h2 className="font-display text-xl text-text-primary">
          {draft.name || "Unnamed Character"}
        </h2>
        {(draft.occupation || draft.archetype) && (
          <p className="text-sm text-text-secondary mt-0.5">
            {[draft.occupation, draft.archetype].filter(Boolean).join(" \u00b7 ")}
          </p>
        )}
      </div>

      {draft.description && (
        <p className="text-sm text-text-tertiary max-w-xs line-clamp-3">{draft.description}</p>
      )}

      {draft.opening_line && (
        <p className="text-sm italic text-text-secondary max-w-xs">
          &ldquo;{draft.opening_line}&rdquo;
        </p>
      )}

      <div className="w-full max-w-[220px] space-y-2 pt-2">
        {traits.map((t) => (
          <div key={t.label} className="flex items-center gap-2">
            <span className="text-[11px] text-text-tertiary w-16 text-left shrink-0">{t.label}</span>
            <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full bg-gold-500/70" style={{ width: `${t.value}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="w-full max-w-[220px] pt-4 border-t border-border-hairline">
        <div className="flex items-center justify-between text-[11px] text-text-tertiary mb-1.5">
          <span>Character completeness</span>
          <span className="text-gold-400 font-semibold tabular-nums">{completeness}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div className="h-full bg-gold-500 transition-[width] duration-300 ease-premium" style={{ width: `${completeness}%` }} />
        </div>
      </div>
    </div>
  );
}
