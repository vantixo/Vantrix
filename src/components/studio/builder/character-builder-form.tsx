"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Check, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TextField, TextAreaField, TagListField, SliderField, JsonField, SelectField } from "./field-helpers";
import { saveCharacterFields } from "@/hooks/use-studio";
import { useVoicePlayback } from "@/hooks/use-voice-playback";
import type { EditableCharacter } from "@/lib/frontend/studio-edit";
import { VOICE_LIBRARY } from "@/lib/ai/voice-library";

const VOICE_OPTIONS = [
  { value: "", label: "Auto (matches character's gender + archetype)" },
  ...VOICE_LIBRARY.map((v) => ({
    value: v.id,
    label: `${v.name} (${v.gender === "female" ? "F" : "M"}) — ${v.description}`,
  })),
];

// Fixed sample line spoken for every audition — short enough to stay cheap
// (still costs the normal 2-token TTS charge, see /api/voice/tts) while
// carrying enough tone signal (a light exclamation) for the voice's
// stability/style shaping to be audible in the preview.
const AUDITION_TEXT = "Hey, it's me. This is what I actually sound like!";

/**
 * One state object covering the 36 Brain+Knowledge+Voice+Appearance fields
 * patchSchema.strict() in characters/[id]/route.ts accepts — .strict()
 * means an unlisted key fails the whole request, so the payload built on
 * save is deliberately limited to this set, nothing broader like
 * id/creator_id/moderation fields. Gallery is the schema's other field
 * group but isn't part of this form — it has its own tab/save call, see
 * components/studio/gallery/image-gallery-tab.tsx.
 */
function toFormState(c: EditableCharacter) {
  return {
    personality: c.personality ?? "",
    archetype: c.archetype ?? "",
    attachment_style: c.attachment_style ?? "",
    love_language: c.love_language ?? "",
    char_openness: c.char_openness,
    char_warmth: c.char_warmth,
    char_adventure: c.char_adventure,
    char_depth: c.char_depth,
    values_list: c.values_list ?? [],
    fears: c.fears ?? [],
    flaws: c.flaws ?? [],
    dreams: c.dreams ?? [],
    current_goal: c.current_goal ?? "",
    daily_routine: c.daily_routine ?? [],
    backstory: c.backstory ?? "",
    scenario: c.scenario ?? "",
    origin: c.origin ?? "",
    occupation: c.occupation ?? "",
    family_bg: c.family_bg ?? "",
    childhood_bg: c.childhood_bg ?? "",
    secrets: c.secrets ?? [],
    friends_list: c.friends_list ?? [],
    opening_line: c.opening_line ?? "",
    speech_style: c.speech_style ?? "",
    elevenlabs_voice_id: c.elevenlabs_voice_id ?? "",
    voice_profile: JSON.stringify(c.voice_profile ?? {}, null, 2),
    writing_style: JSON.stringify(c.writing_style ?? {}, null, 2),
    hair_color: c.hair_color ?? "",
    eye_color: c.eye_color ?? "",
    body_type: c.body_type ?? "",
    skin_tone: c.skin_tone ?? "",
    art_style: c.art_style ?? "",
    clothing: c.clothing ?? "",
    face_prompt: c.face_prompt ?? "",
    generation_style: c.generation_style ?? "",
  };
}

type FormState = ReturnType<typeof toFormState>;

export function CharacterBuilderForm({ character }: { character: EditableCharacter }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toFormState(character));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [jsonError, setJsonError] = useState<{ voice: boolean; writing: boolean }>({
    voice: false,
    writing: false,
  });

  // Voice audition — reuses the same hook chat playback uses (cache-first
  // ElevenLabs call, circuit-breaker fallback to Web Speech, single active
  // playback) rather than duplicating audio-element/fetch logic here. Keyed
  // by a fixed id scoped to this character so it can never collide with a
  // MessageBubble's messageId if both hooks somehow shared audio state.
  const auditionId = `voice-audition:${character.id}`;
  const { play: playAudition, playingId: auditionPlayingId, loadingId: auditionLoadingId, error: auditionError } =
    useVoicePlayback();
  const isAuditioning = auditionLoadingId === auditionId;
  const isPlayingAudition = auditionPlayingId === auditionId;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save() {
    let voiceProfile: Record<string, unknown>;
    let writingStyle: Record<string, unknown>;
    try {
      voiceProfile = JSON.parse(form.voice_profile || "{}");
      setJsonError((e) => ({ ...e, voice: false }));
    } catch {
      setJsonError((e) => ({ ...e, voice: true }));
      setError("Voice profile isn't valid JSON.");
      return;
    }
    try {
      writingStyle = JSON.parse(form.writing_style || "{}");
      setJsonError((e) => ({ ...e, writing: false }));
    } catch {
      setJsonError((e) => ({ ...e, writing: true }));
      setError("Writing style isn't valid JSON.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await saveCharacterFields(character.id, {
        ...form,
        voice_profile: voiceProfile,
        writing_style: writingStyle,
      });
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <Tabs defaultValue="brain">
        <TabsList>
          <TabsTrigger value="brain">Brain</TabsTrigger>
          <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>

        <TabsContent value="brain" className="pt-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField label="Archetype" value={form.archetype} onChange={(v) => set("archetype", v)} maxLength={200} />
            <TextField label="Attachment style" value={form.attachment_style} onChange={(v) => set("attachment_style", v)} maxLength={200} />
          </div>
          <TextField label="Love language" value={form.love_language} onChange={(v) => set("love_language", v)} maxLength={200} />
          <TextAreaField label="Personality" value={form.personality} onChange={(v) => set("personality", v)} maxLength={2000} rows={4} />
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
            <SliderField label="Openness" value={form.char_openness} onChange={(v) => set("char_openness", v)} />
            <SliderField label="Warmth" value={form.char_warmth} onChange={(v) => set("char_warmth", v)} />
            <SliderField label="Adventure" value={form.char_adventure} onChange={(v) => set("char_adventure", v)} />
            <SliderField label="Depth" value={form.char_depth} onChange={(v) => set("char_depth", v)} />
          </div>
          <TagListField label="Values" value={form.values_list} onChange={(v) => set("values_list", v)} />
          <TagListField label="Fears" value={form.fears} onChange={(v) => set("fears", v)} />
          <TagListField label="Flaws" value={form.flaws} onChange={(v) => set("flaws", v)} />
          <TagListField label="Dreams" value={form.dreams} onChange={(v) => set("dreams", v)} />
          <TextField label="Current goal" value={form.current_goal} onChange={(v) => set("current_goal", v)} maxLength={500} />
          <TagListField label="Daily routine" value={form.daily_routine} onChange={(v) => set("daily_routine", v)} />
        </TabsContent>

        <TabsContent value="knowledge" className="pt-6 space-y-5">
          <TextAreaField label="Backstory" value={form.backstory} onChange={(v) => set("backstory", v)} maxLength={5000} rows={5} />
          <TextAreaField label="Scenario" value={form.scenario} onChange={(v) => set("scenario", v)} maxLength={2000} rows={3} />
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField label="Origin" value={form.origin} onChange={(v) => set("origin", v)} maxLength={500} />
            <TextField label="Occupation" value={form.occupation} onChange={(v) => set("occupation", v)} maxLength={200} />
          </div>
          <TextAreaField label="Family background" value={form.family_bg} onChange={(v) => set("family_bg", v)} maxLength={2000} rows={3} />
          <TextAreaField label="Childhood background" value={form.childhood_bg} onChange={(v) => set("childhood_bg", v)} maxLength={2000} rows={3} />
          <TagListField label="Secrets" value={form.secrets} onChange={(v) => set("secrets", v)} />
          <TagListField label="Friends" value={form.friends_list} onChange={(v) => set("friends_list", v)} />
          <TextAreaField label="Opening line" value={form.opening_line} onChange={(v) => set("opening_line", v)} maxLength={500} rows={2} />
        </TabsContent>

        <TabsContent value="voice" className="pt-6 space-y-5">
          <TextField label="Speech style" value={form.speech_style} onChange={(v) => set("speech_style", v)} maxLength={200} />

          <div>
            <div className="grid sm:grid-cols-[1fr_auto] gap-3 sm:items-end">
              <SelectField
                label="Voice"
                value={form.elevenlabs_voice_id}
                onChange={(v) => set("elevenlabs_voice_id", v)}
                options={VOICE_OPTIONS}
                hint="This is what actually speaks for the character in voice messages — separate from the writing style below."
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  playAudition(
                    auditionId,
                    AUDITION_TEXT,
                    character.id,
                    form.elevenlabs_voice_id || undefined
                  )
                }
                disabled={isAuditioning}
                aria-label={isPlayingAudition ? "Stop preview" : "Preview voice"}
              >
                {isAuditioning ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isPlayingAudition ? (
                  <Square className="h-4 w-4" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
                Preview
              </Button>
            </div>
            {/* Auditions the currently-selected dropdown value immediately —
                including a not-yet-saved change — via the route's explicit
                voiceId override, so switching the dropdown and previewing
                doesn't require Save first. "Auto" previews with no voiceId,
                i.e. whatever this character would actually get today
                (their own elevenlabs_voice_id, or the gender/archetype
                default if they don't have one yet). */}
            {auditionError && <p className="text-xs text-danger mt-1.5">{auditionError}</p>}
          </div>

          <JsonField label="Voice profile" value={form.voice_profile} onChange={(v) => set("voice_profile", v)} invalid={jsonError.voice} />
          <JsonField label="Writing style" value={form.writing_style} onChange={(v) => set("writing_style", v)} invalid={jsonError.writing} />
        </TabsContent>

        <TabsContent value="appearance" className="pt-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <TextField label="Hair color" value={form.hair_color} onChange={(v) => set("hair_color", v)} maxLength={100} />
            <TextField label="Eye color" value={form.eye_color} onChange={(v) => set("eye_color", v)} maxLength={100} />
            <TextField label="Body type" value={form.body_type} onChange={(v) => set("body_type", v)} maxLength={100} />
            <TextField label="Skin tone" value={form.skin_tone} onChange={(v) => set("skin_tone", v)} maxLength={100} />
            <TextField label="Art style" value={form.art_style} onChange={(v) => set("art_style", v)} maxLength={100} />
            <TextField label="Generation style" value={form.generation_style} onChange={(v) => set("generation_style", v)} maxLength={200} />
          </div>
          <TextAreaField label="Clothing" value={form.clothing} onChange={(v) => set("clothing", v)} maxLength={500} rows={2} />
          <TextAreaField
            label="Face reference prompt"
            value={form.face_prompt}
            onChange={(v) => set("face_prompt", v)}
            maxLength={1000}
            rows={3}
          />
        </TabsContent>
      </Tabs>

      {/* Sticky save bar — one PATCH covers whichever tab was edited, so
          save lives outside the tab content rather than duplicated per
          tab. `sticky` (not `fixed`) so it stays correctly offset from
          the sidebar for free — it's laid out inside the already-offset
          main content column, only its vertical position sticks.
          bottom-16 (not bottom-0) on mobile reserves room for
          bottom-nav.tsx's fixed bar so the two never overlap; desktop
          has no bottom nav so it reverts to flush bottom-0. */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0 -mx-4 md:-mx-8 mt-8 border-t border-border-hairline bg-base px-4 md:px-8 py-3 flex items-center gap-3 justify-end">
        {error && <p className="text-sm text-danger mr-auto">{error}</p>}
        {saved && !saving && !error && (
          <span className="flex items-center gap-1 text-sm text-gold-400">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
