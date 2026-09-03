"use client";

import { TextField, TextAreaField, SelectField } from "@/components/studio/builder/field-helpers";
import type { CharacterDraft, Gender } from "../types";

const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "anime", label: "Anime" },
  { value: "other", label: "Other" },
];

export function IdentityStage({
  draft,
  onChange,
}: {
  draft: CharacterDraft;
  onChange: (patch: Partial<CharacterDraft>) => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-display text-lg text-text-primary mb-1">Identity</h2>
        <p className="text-sm text-text-tertiary">Who they are, before anything else.</p>
      </div>

      <TextField label="Name" value={draft.name} onChange={(v) => onChange({ name: v })} maxLength={80} />

      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Age"
          value={String(draft.age)}
          onChange={(v) => {
            const n = Number(v.replace(/\D/g, ""));
            onChange({ age: Number.isFinite(n) ? Math.min(100, Math.max(18, n || 18)) : draft.age });
          }}
          maxLength={3}
        />
        <SelectField
          label="Gender"
          value={draft.gender}
          onChange={(v) => onChange({ gender: v as Gender })}
          options={GENDER_OPTIONS}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TextField label="Pronouns" value={draft.pronouns} onChange={(v) => onChange({ pronouns: v })} maxLength={50} placeholder="she/her" />
        <TextField label="Occupation" value={draft.occupation} onChange={(v) => onChange({ occupation: v })} maxLength={100} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TextField label="Origin" value={draft.origin} onChange={(v) => onChange({ origin: v })} maxLength={500} placeholder="Where they're from" />
        <TextField label="Category" value={draft.category} onChange={(v) => onChange({ category: v })} maxLength={50} placeholder="romance, fantasy…" />
      </div>

      <TextAreaField
        label="Description"
        value={draft.description}
        onChange={(v) => onChange({ description: v })}
        maxLength={1000}
        rows={4}
        placeholder="The short public bio shown on their character card."
      />
    </div>
  );
}
