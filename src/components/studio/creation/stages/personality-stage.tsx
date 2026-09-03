"use client";

import { TextField, TextAreaField, TagListField, SliderField } from "@/components/studio/builder/field-helpers";
import type { CharacterDraft } from "../types";

export function PersonalityStage({
  draft,
  onChange,
}: {
  draft: CharacterDraft;
  onChange: (patch: Partial<CharacterDraft>) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg text-text-primary mb-1">Personality Engine</h2>
        <p className="text-sm text-text-tertiary">
          The trait constellation drives how they actually behave in conversation — not just how
          they&rsquo;re described.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <TextField label="Archetype" value={draft.archetype} onChange={(v) => onChange({ archetype: v })} maxLength={200} />
        <TextField label="Attachment style" value={draft.attachment_style} onChange={(v) => onChange({ attachment_style: v })} maxLength={200} />
      </div>
      <TextField label="Love language" value={draft.love_language} onChange={(v) => onChange({ love_language: v })} maxLength={200} />

      <TextAreaField
        label="Personality"
        value={draft.personality}
        onChange={(v) => onChange({ personality: v })}
        maxLength={2000}
        rows={4}
        placeholder="Give them a real contradiction — e.g. confident professionally but avoidant emotionally."
      />

      <div>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Trait Constellation
        </h3>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
          <SliderField label="Warmth" value={draft.char_warmth} onChange={(v) => onChange({ char_warmth: v })} />
          <SliderField label="Openness" value={draft.char_openness} onChange={(v) => onChange({ char_openness: v })} />
          <SliderField label="Adventure" value={draft.char_adventure} onChange={(v) => onChange({ char_adventure: v })} />
          <SliderField label="Depth" value={draft.char_depth} onChange={(v) => onChange({ char_depth: v })} />
        </div>
      </div>

      <TagListField label="Values" value={draft.values_list} onChange={(v) => onChange({ values_list: v })} />
      <TagListField label="Fears" value={draft.fears} onChange={(v) => onChange({ fears: v })} />
      <TagListField label="Flaws" value={draft.flaws} onChange={(v) => onChange({ flaws: v })} />
      <TagListField label="Dreams" value={draft.dreams} onChange={(v) => onChange({ dreams: v })} />

      <TextField label="Current goal" value={draft.current_goal} onChange={(v) => onChange({ current_goal: v })} maxLength={500} />
      <TagListField label="Daily routine" value={draft.daily_routine} onChange={(v) => onChange({ daily_routine: v })} />
    </div>
  );
}
