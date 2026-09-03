"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { saveCharacterFields, addSeedMemory } from "@/hooks/use-studio";
import type { CharacterDraft } from "../types";
import { canPublish } from "../completeness";

/** Trims a value for the initial POST, which caps several fields lower than the later PATCH does. */
function cap(value: string, max: number): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

export function PreviewStage({ draft }: { draft: CharacterDraft }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const ready = canPublish(draft);

  async function publish() {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    setWarning(null);

    try {
      // Step 1 — create the character with the short/base field set the
      // creation schema accepts. This is the only step that charges tokens
      // and submits for moderation, so it happens once, deliberately, here
      // — not earlier in the wizard.
      const createRes = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          age: draft.age,
          gender: draft.gender,
          category: draft.category.trim() || "romance",
          description: draft.description.trim(),
          personality: cap(draft.personality, 500),
          backstory: cap(draft.backstory, 800),
          scenario: cap(draft.scenario, 500),
          speech_style: cap(draft.speech_style, 50),
          occupation: cap(draft.occupation, 100),
          pronouns: cap(draft.pronouns, 50),
          creation_prompt: draft.usedAI ? cap(draft.creation_prompt, 500) : undefined,
          image_url: draft.imageUrl,
          tags: draft.tags,
          is_nsfw: draft.is_nsfw,
          dating_enabled: draft.dating_enabled,
          visibility: draft.visibility,
        }),
      });
      const createBody = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        setError(createBody.error ?? "Couldn't create the character.");
        setSubmitting(false);
        return;
      }
      const characterId: string = createBody.character.id;

      // From here on, the character exists and has been charged/submitted
      // — a failure in the following steps shouldn't look like a full
      // failure to the creator, since retrying step 1 would double-create.
      try {
        // Step 2 — the rich fields (full-length personality/backstory,
        // psychology, voice, appearance) that the create schema doesn't
        // carry. Real PATCH route, same one Creator Studio already uses.
        await saveCharacterFields(characterId, {
          personality: draft.personality.trim() || undefined,
          archetype: draft.archetype.trim() || undefined,
          attachment_style: draft.attachment_style.trim() || undefined,
          love_language: draft.love_language.trim() || undefined,
          char_openness: draft.char_openness,
          char_warmth: draft.char_warmth,
          char_adventure: draft.char_adventure,
          char_depth: draft.char_depth,
          values_list: draft.values_list,
          fears: draft.fears,
          flaws: draft.flaws,
          dreams: draft.dreams,
          current_goal: draft.current_goal.trim() || undefined,
          daily_routine: draft.daily_routine,

          backstory: draft.backstory.trim() || undefined,
          scenario: draft.scenario.trim() || undefined,
          origin: draft.origin.trim() || undefined,
          occupation: draft.occupation.trim() || undefined,
          family_bg: draft.family_bg.trim() || undefined,
          childhood_bg: draft.childhood_bg.trim() || undefined,
          secrets: draft.secrets,
          friends_list: draft.friends_list,
          opening_line: draft.opening_line.trim() || undefined,

          speech_style: draft.speech_style.trim() || undefined,
          voice_profile: draft.voice,
          elevenlabs_voice_id: draft.elevenlabs_voice_id || undefined,

          hair_color: draft.hair_color.trim() || undefined,
          eye_color: draft.eye_color.trim() || undefined,
          body_type: draft.body_type.trim() || undefined,
          skin_tone: draft.skin_tone.trim() || undefined,
          art_style: draft.art_style.trim() || undefined,
          clothing: draft.clothing.trim() || undefined,
          face_prompt: draft.face_prompt || undefined,
          identity_locked: draft.identity_locked,
        });

        // Step 3 — flush any locally-drafted seed memories now that a real
        // character_id exists.
        for (let i = 0; i < draft.memories.length; i++) {
          const m = draft.memories[i];
          await addSeedMemory(characterId, {
            headline: m.headline,
            content: m.content,
            category: m.category || "general",
            importance: m.importance,
            position: i,
          });
        }
      } catch (detailErr) {
        // Character already exists at this point — don't block the
        // creator from reaching it, just be honest that some detail
        // didn't save.
        setWarning(
          detailErr instanceof Error
            ? `Your character was created, but: ${detailErr.message} You can finish it in Creator Studio.`
            : "Your character was created, but some details couldn't be saved. You can finish them in Creator Studio.",
        );
      }

      router.push(`/studio/${characterId}`);
    } catch {
      setError("Something went wrong creating your character. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-lg text-text-primary mb-1">Preview</h2>
        <p className="text-sm text-text-tertiary">One last look before they come to life.</p>
      </div>

      <Card interactive={false} className="p-6 flex flex-col items-center text-center gap-3">
        <div className="relative h-40 w-40 rounded-md overflow-hidden border border-border-hairline bg-base">
          {draft.imageUrl && <Image src={draft.imageUrl} alt="" fill sizes="160px" className="object-cover" />}
        </div>
        <h3 className="font-display text-xl text-text-primary">{draft.name || "Unnamed"}</h3>
        <p className="text-sm text-text-secondary">
          {[draft.occupation, draft.archetype].filter(Boolean).join(" \u00b7 ")}
        </p>
        {draft.opening_line && (
          <p className="text-sm italic text-text-tertiary max-w-sm">&ldquo;{draft.opening_line}&rdquo;</p>
        )}
      </Card>

      {!ready && (
        <p className="text-sm text-danger text-center">
          Name, description, and a portrait are required before you can create your companion.
        </p>
      )}
      {error && <p className="text-sm text-danger text-center">{error}</p>}
      {warning && <p className="text-sm text-gold-400 text-center">{warning}</p>}

      <Button type="button" onClick={publish} disabled={!ready || submitting} className="w-full">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        Create Companion
      </Button>
    </div>
  );
}
