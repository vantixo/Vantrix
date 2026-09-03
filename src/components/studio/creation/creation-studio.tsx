"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StageRail } from "./stage-rail";
import { CharacterCanvas } from "./character-canvas";
import { STAGES, emptyDraft, type CharacterDraft, type StageId } from "./types";
import { ConceptStage } from "./stages/concept-stage";
import { IdentityStage } from "./stages/identity-stage";
import { PersonalityStage } from "./stages/personality-stage";
import { PsychologyStage } from "./stages/psychology-stage";
import { VoiceStage } from "./stages/voice-stage";
import { AppearanceStage } from "./stages/appearance-stage";
import { MemoryStage } from "./stages/memory-stage";
import { PreviewStage } from "./stages/preview-stage";

const STAGE_ORDER: StageId[] = STAGES.map((s) => s.id);

export function CreationStudio() {
  const [draft, setDraft] = useState<CharacterDraft>(emptyDraft());
  const [activeStage, setActiveStage] = useState<StageId>("concept");
  const [furthestIndex, setFurthestIndex] = useState(0);

  function patch(p: Partial<CharacterDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  function goToStage(stage: StageId) {
    setActiveStage(stage);
  }

  function advance(next: StageId) {
    const idx = STAGE_ORDER.indexOf(next);
    setFurthestIndex((f) => Math.max(f, idx));
    setActiveStage(next);
  }

  const currentIndex = STAGE_ORDER.indexOf(activeStage);
  const canGoBack = currentIndex > 0;
  const nextStage = STAGE_ORDER[currentIndex + 1];

  return (
    <div className="min-h-screen bg-base flex flex-col">
      <header className="flex items-center justify-between border-b border-border-hairline px-4 md:px-8 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <span className="font-display text-sm tracking-wide text-text-tertiary">VANTRIX</span>
          <span className="text-text-tertiary/40">/</span>
          <span className="font-display text-sm text-text-primary">Create Character</span>
        </div>
        <Link href="/studio" className="text-text-tertiary hover:text-text-primary transition-colors ease-premium">
          <X className="h-5 w-5" />
        </Link>
      </header>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[200px_1fr] lg:grid-cols-[220px_320px_1fr] gap-6 lg:gap-8 px-4 md:px-8 py-6 max-w-7xl mx-auto w-full">
        <div className="md:order-1">
          <StageRail draft={draft} activeStage={activeStage} onSelect={goToStage} furthestIndex={furthestIndex} />
        </div>

        <div className="hidden lg:block lg:order-2">
          <div className="sticky top-6 rounded-md border border-border-hairline bg-white/[0.015]">
            <CharacterCanvas draft={draft} />
          </div>
        </div>

        <main className="md:order-3 lg:order-3 min-w-0">
          {activeStage === "concept" && (
            <ConceptStage draft={draft} onChange={setDraft} onContinue={() => advance("identity")} />
          )}
          {activeStage === "identity" && <IdentityStage draft={draft} onChange={patch} />}
          {activeStage === "personality" && <PersonalityStage draft={draft} onChange={patch} />}
          {activeStage === "psychology" && <PsychologyStage draft={draft} onChange={patch} />}
          {activeStage === "voice" && <VoiceStage draft={draft} onChange={patch} />}
          {activeStage === "appearance" && <AppearanceStage draft={draft} onChange={patch} />}
          {activeStage === "memory" && <MemoryStage draft={draft} onChange={patch} />}
          {activeStage === "preview" && <PreviewStage draft={draft} />}

          {activeStage !== "concept" && activeStage !== "preview" && (
            <div className="flex items-center justify-between pt-6 mt-8 border-t border-border-hairline">
              <Button
                type="button"
                variant="ghost"
                onClick={() => canGoBack && setActiveStage(STAGE_ORDER[currentIndex - 1])}
                disabled={!canGoBack}
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <Button type="button" onClick={() => nextStage && advance(nextStage)}>
                Continue
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
