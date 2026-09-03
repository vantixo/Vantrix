"use client";

import { TextField, TagListField, SliderField, SelectField } from "@/components/studio/builder/field-helpers";
import { VOICE_LIBRARY } from "@/lib/ai/voice-library";
import type { CharacterDraft } from "../types";

const VOICE_OPTIONS = [
  { value: "", label: "Auto (matches gender + archetype)" },
  ...VOICE_LIBRARY.map((v) => ({
    value: v.id,
    label: `${v.name} (${v.gender === "female" ? "F" : "M"}) \u2014 ${v.description}`,
  })),
];

export function VoiceStage({
  draft,
  onChange,
}: {
  draft: CharacterDraft;
  onChange: (patch: Partial<CharacterDraft>) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg text-text-primary mb-1">Voice</h2>
        <p className="text-sm text-text-tertiary">
          They shouldn&rsquo;t only look different — they should sound different, on the page and out loud.
        </p>
      </div>

      <TextField
        label="Speech style"
        value={draft.speech_style}
        onChange={(v) => onChange({ speech_style: v })}
        maxLength={200}
        placeholder="Short, reflective, dry wit"
      />

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        <SliderField label="Tone (calm \u2192 energetic)" value={draft.voice.tone} onChange={(v) => onChange({ voice: { ...draft.voice, tone: v } })} />
        <SliderField label="Energy" value={draft.voice.energy} onChange={(v) => onChange({ voice: { ...draft.voice, energy: v } })} />
        <SliderField label="Formality" value={draft.voice.formality} onChange={(v) => onChange({ voice: { ...draft.voice, formality: v } })} />
        <SliderField label="Humor" value={draft.voice.humor} onChange={(v) => onChange({ voice: { ...draft.voice, humor: v } })} />
      </div>

      <TagListField
        label="Speech patterns — uses"
        value={draft.speech_uses}
        onChange={(v) => onChange({ speech_uses: v })}
        placeholder="subtle sarcasm, thoughtful questions"
      />
      <TagListField
        label="Speech patterns — avoids"
        value={draft.speech_avoids}
        onChange={(v) => onChange({ speech_avoids: v })}
        placeholder="excessive emojis, generic compliments"
      />

      <SelectField
        label="Voice"
        value={draft.elevenlabs_voice_id}
        onChange={(v) => onChange({ elevenlabs_voice_id: v })}
        options={VOICE_OPTIONS}
        hint="You'll be able to preview this out loud in Creator Studio once your companion exists."
      />
    </div>
  );
}
