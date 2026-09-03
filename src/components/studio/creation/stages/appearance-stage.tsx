"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, Wand2, ImageOff, Lock, LockOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField, TextAreaField, SelectField } from "@/components/studio/builder/field-helpers";
import type { CharacterDraft, ImageStyle } from "../types";

const STYLES: Array<{ value: ImageStyle; label: string }> = [
  { value: "realistic", label: "Realistic" },
  { value: "anime", label: "Anime" },
  { value: "artistic", label: "Artistic" },
];

export function AppearanceStage({
  draft,
  onChange,
}: {
  draft: CharacterDraft;
  onChange: (patch: Partial<CharacterDraft>) => void;
}) {
  const [scenePrompt, setScenePrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locked = draft.identity_locked;

  async function generatePortrait() {
    const prompt = scenePrompt.trim() || draft.description.trim() || draft.personality.trim();
    if (!prompt) {
      setError("Add a quick note about their look, or fill in Description/Personality first.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/characters/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          style: draft.imageStyle,
          hair_color: draft.hair_color || undefined,
          eye_color: draft.eye_color || undefined,
          body_type: draft.body_type || undefined,
          skin_tone: draft.skin_tone || undefined,
          age: draft.age,
          occupation: draft.occupation || undefined,
          gender: draft.gender === "anime" ? undefined : draft.gender,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setError(body.error ?? "Couldn't generate a portrait. Try a different description.");
        return;
      }
      // A fresh generation invalidates any previous lock — the whole point
      // of identity_locked is "this specific portrait/prompt is canonical."
      onChange({ imageUrl: body.url, face_prompt: body.enrichedPrompt ?? "", identity_locked: false });
    } catch {
      setError("Couldn't generate a portrait. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg text-text-primary mb-1">Appearance</h2>
        <p className="text-sm text-text-tertiary">
          Set their look, generate a portrait, then lock it in as their canonical identity.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <TextField label="Hair" value={draft.hair_color} onChange={(v) => onChange({ hair_color: v })} maxLength={100} disabled={locked} />
        <TextField label="Eyes" value={draft.eye_color} onChange={(v) => onChange({ eye_color: v })} maxLength={100} disabled={locked} />
        <TextField label="Body type" value={draft.body_type} onChange={(v) => onChange({ body_type: v })} maxLength={100} disabled={locked} />
        <TextField label="Skin tone" value={draft.skin_tone} onChange={(v) => onChange({ skin_tone: v })} maxLength={100} disabled={locked} />
      </div>
      <TextAreaField label="Clothing" value={draft.clothing} onChange={(v) => onChange({ clothing: v })} maxLength={500} rows={2} disabled={locked} />
      <TextField
        label="Art style notes"
        value={draft.art_style}
        onChange={(v) => onChange({ art_style: v })}
        maxLength={100}
        placeholder="e.g. cinematic realism, golden-hour lighting"
        disabled={locked}
      />

      <Card interactive={false} className="p-4 space-y-3">
        <div className="flex gap-4">
          <div className="relative h-32 w-32 rounded-md overflow-hidden border border-border-hairline shrink-0 bg-base flex items-center justify-center">
            {draft.imageUrl ? (
              <Image src={draft.imageUrl} alt="" fill sizes="128px" className="object-cover" />
            ) : (
              <ImageOff className="h-6 w-6 text-text-tertiary" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <textarea
              value={scenePrompt}
              onChange={(e) => setScenePrompt(e.target.value)}
              placeholder="Describe the shot — a candid moment says more than a generic pose."
              rows={2}
              disabled={locked}
              className="w-full rounded-sm bg-base border border-interactive px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60 resize-none disabled:opacity-50"
            />
            <div className="flex flex-wrap gap-2">
              <SelectField
                label=""
                value={draft.imageStyle}
                onChange={(v) => onChange({ imageStyle: v as ImageStyle })}
                options={STYLES}
              />
              <Button type="button" variant="secondary" onClick={generatePortrait} disabled={generating || locked}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {draft.imageUrl ? "Regenerate" : "Generate Portrait"}
              </Button>
            </div>
          </div>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </Card>

      {draft.imageUrl && (
        <Card interactive={false} className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
              {locked ? <Lock className="h-3.5 w-3.5 text-gold-400" /> : <LockOpen className="h-3.5 w-3.5 text-text-tertiary" />}
              Visual Identity Lock
            </p>
            <p className="text-xs text-text-tertiary mt-0.5">
              {locked
                ? "Locked \u2014 this portrait is now their canonical reference for future generations."
                : "Lock in this portrait once you're happy with it. Appearance fields stay editable, but you'll get a warning before changing them."}
            </p>
          </div>
          <Button
            type="button"
            variant={locked ? "ghost" : "primary"}
            size="sm"
            onClick={() => onChange({ identity_locked: !locked })}
          >
            {locked ? "Unlock" : "Lock Identity"}
          </Button>
        </Card>
      )}
    </div>
  );
}
