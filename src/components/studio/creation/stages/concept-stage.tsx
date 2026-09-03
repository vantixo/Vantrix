"use client";

import { useState } from "react";
import { Loader2, Wand2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField, TextAreaField } from "@/components/studio/builder/field-helpers";
import { generateCharacterConcept, type ConceptGenerationError } from "@/hooks/use-studio";
import type { CharacterDraft, Gender } from "../types";

const GENDER_OPTIONS: Array<{ value: Gender | ""; label: string }> = [
  { value: "", label: "Let the AI decide" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "anime", label: "Anime" },
  { value: "other", label: "Other" },
];

// Server response's `concept` is a validated superset of CharacterDraft's
// author-facing fields (see generate-concept/route.ts's conceptSchema) —
// this maps it onto the draft 1:1, converting the two nested objects
// (traits/voice) into the draft's flat char_* columns and voice shape.
function applyConceptToDraft(draft: CharacterDraft, concept: Record<string, unknown>, prompt: string): CharacterDraft {
  const c = concept as {
    name: string; age: number; pronouns: string; occupation: string; origin: string; category: string;
    description: string; personality: string; archetype: string; attachment_style: string; love_language: string;
    traits: { openness: number; warmth: number; adventure: number; depth: number };
    values_list: string[]; fears: string[]; flaws: string[]; dreams: string[]; current_goal: string; daily_routine: string[];
    backstory: string; scenario: string; family_bg: string; childhood_bg: string; secrets: string[]; friends_list: string[];
    opening_line: string; speech_style: string;
    voice: { tone: number; energy: number; formality: number; humor: number };
    speech_uses: string[]; speech_avoids: string[];
    hair_color: string; eye_color: string; body_type: string; skin_tone: string; art_style: string; clothing: string;
    tags: string[];
  };
  return {
    ...draft,
    name: c.name, age: c.age, pronouns: c.pronouns, occupation: c.occupation, origin: c.origin,
    category: c.category, description: c.description,
    personality: c.personality, archetype: c.archetype, attachment_style: c.attachment_style, love_language: c.love_language,
    char_openness: c.traits.openness, char_warmth: c.traits.warmth, char_adventure: c.traits.adventure, char_depth: c.traits.depth,
    values_list: c.values_list, fears: c.fears, flaws: c.flaws, dreams: c.dreams,
    current_goal: c.current_goal, daily_routine: c.daily_routine,
    backstory: c.backstory, scenario: c.scenario, family_bg: c.family_bg, childhood_bg: c.childhood_bg,
    secrets: c.secrets, friends_list: c.friends_list, opening_line: c.opening_line,
    speech_style: c.speech_style, voice: c.voice, speech_uses: c.speech_uses, speech_avoids: c.speech_avoids,
    hair_color: c.hair_color, eye_color: c.eye_color, body_type: c.body_type, skin_tone: c.skin_tone,
    art_style: c.art_style, clothing: c.clothing, tags: c.tags,
    creation_prompt: prompt, usedAI: true,
  };
}

export function ConceptStage({
  draft,
  onChange,
  onContinue,
}: {
  draft: CharacterDraft;
  onChange: (draft: CharacterDraft) => void;
  onContinue: () => void;
}) {
  const [prompt, setPrompt] = useState(draft.creation_prompt);
  const [gender, setGender] = useState<Gender | "">("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function build() {
    if (prompt.trim().length < 10) {
      setError("Give it at least a sentence to work with.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const result = await generateCharacterConcept({
        prompt: prompt.trim(),
        gender: gender || undefined,
        refineOf: draft.usedAI ? (draft as unknown as Record<string, unknown>) : undefined,
      });
      onChange(applyConceptToDraft(draft, result.concept, result.prompt));
    } catch (err) {
      const e = err as ConceptGenerationError;
      setError(e.message || "Couldn't build a character from that. Try rephrasing.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg text-text-primary mb-1">Create Someone</h2>
        <p className="text-sm text-text-tertiary">
          Describe the person you want to meet. Vantrix will draft their identity, personality,
          psychology, voice, and appearance — you refine everything from there.
        </p>
      </div>

      <Card interactive={false} className="p-4 space-y-4">
        <TextAreaField
          label="Description"
          value={prompt}
          onChange={setPrompt}
          maxLength={500}
          rows={4}
          placeholder="A mysterious woman who studies forgotten civilizations, emotionally guarded but deeply loyal, loves astronomy and old books, dry sense of humor."
        />
        <SelectField
          label="Gender"
          value={gender}
          onChange={(v) => setGender(v as Gender | "")}
          options={GENDER_OPTIONS as Array<{ value: string; label: string }>}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="button" onClick={build} disabled={generating || prompt.trim().length < 10} className="w-full">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {draft.usedAI ? "Regenerate" : "Build Character"}
        </Button>
      </Card>

      {draft.usedAI && draft.name && (
        <div className="flex items-center justify-between rounded-md border border-gold-500/30 bg-gold-500/5 px-4 py-3">
          <p className="text-sm text-text-secondary">
            Drafted <span className="text-gold-400 font-semibold">{draft.name}</span>. Every field is
            editable in the stages ahead.
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={onContinue}>
            Continue
          </Button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border-hairline" />
        <span className="text-xs text-text-tertiary uppercase tracking-wide">or</span>
        <div className="h-px flex-1 bg-border-hairline" />
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="w-full flex items-center justify-center gap-2 rounded-sm border border-border-hairline py-3 text-sm font-medium text-text-secondary hover:text-text-primary hover:border-interactive transition-colors ease-premium"
      >
        <PenLine className="h-4 w-4" />
        Start from scratch
      </button>
    </div>
  );
}
