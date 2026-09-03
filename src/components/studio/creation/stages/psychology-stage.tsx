"use client";

import { TextField, TextAreaField, TagListField } from "@/components/studio/builder/field-helpers";
import type { CharacterDraft } from "../types";

export function PsychologyStage({
  draft,
  onChange,
}: {
  draft: CharacterDraft;
  onChange: (patch: Partial<CharacterDraft>) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg text-text-primary mb-1">Psychology & Backstory</h2>
        <p className="text-sm text-text-tertiary">What shaped them, and what they&rsquo;re still carrying.</p>
      </div>

      <TextAreaField label="Backstory" value={draft.backstory} onChange={(v) => onChange({ backstory: v })} maxLength={5000} rows={5} />
      <TextAreaField label="Scenario" value={draft.scenario} onChange={(v) => onChange({ scenario: v })} maxLength={2000} rows={3} />

      <div className="grid sm:grid-cols-2 gap-4">
        <TextAreaField label="Family background" value={draft.family_bg} onChange={(v) => onChange({ family_bg: v })} maxLength={2000} rows={3} />
        <TextAreaField label="Childhood background" value={draft.childhood_bg} onChange={(v) => onChange({ childhood_bg: v })} maxLength={2000} rows={3} />
      </div>

      <TagListField label="Secrets" value={draft.secrets} onChange={(v) => onChange({ secrets: v })} />
      <TagListField label="Friends" value={draft.friends_list} onChange={(v) => onChange({ friends_list: v })} />

      <TextAreaField
        label="Opening line"
        value={draft.opening_line}
        onChange={(v) => onChange({ opening_line: v })}
        maxLength={500}
        rows={2}
        placeholder="The first thing they'd say to someone they just matched with."
      />
    </div>
  );
}
