"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, Wand2, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const inputClass =
  "w-full h-11 rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";
const textareaClass =
  "w-full rounded-sm bg-base border border-interactive px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60 resize-none";

const STYLES = [
  { value: "realistic", label: "Realistic" },
  { value: "anime", label: "Anime" },
  { value: "artistic", label: "Artistic" },
] as const;

/**
 * §11 Studio's creation flow, built against the two real routes that
 * back it: POST /api/characters/generate-image (returns an R2 `url` —
 * the only kind of URL characters/route.ts's ALLOWED_IMAGE_HOSTS check
 * will accept from a fresh creation) then POST /api/characters with
 * that url attached. Portrait generation gates the rest of the form
 * since image_url is required and must come from that allowlist — there's
 * no "upload your own" path here because the backend doesn't expose one
 * outside the LoRA/import pipeline.
 */
export function CreateCharacterForm() {
  const router = useRouter();

  // Portrait fields
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<(typeof STYLES)[number]["value"]>("realistic");
  const [hairColor, setHairColor] = useState("");
  const [eyeColor, setEyeColor] = useState("");
  const [genImgGender, setGenImgGender] = useState<"female" | "male" | "non-binary" | "">("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // Character fields
  const [name, setName] = useState("");
  const [age, setAge] = useState(21);
  const [gender, setGender] = useState<"female" | "male" | "anime" | "other">("female");
  const [category, setCategory] = useState("romance");
  const [description, setDescription] = useState("");
  const [personality, setPersonality] = useState("");
  const [occupation, setOccupation] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [isNsfw, setIsNsfw] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function generatePortrait() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setImageError(null);
    try {
      const res = await fetch("/api/characters/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          style,
          hair_color: hairColor || undefined,
          eye_color: eyeColor || undefined,
          age,
          occupation: occupation || undefined,
          gender: genImgGender || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setImageError(body.error ?? "Couldn't generate a portrait. Try a different prompt.");
        return;
      }
      setImageUrl(body.url);
    } catch {
      setImageError("Couldn't generate a portrait. Try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!imageUrl) {
      setSubmitError("Generate a portrait before creating your companion.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10);

      const res = await fetch("/api/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          age,
          gender,
          category,
          description,
          personality: personality || undefined,
          occupation: occupation || undefined,
          image_url: imageUrl,
          tags,
          is_nsfw: isNsfw,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setSubmitError(
          body.code === "FORBIDDEN"
            ? "Creating companions requires Premium."
            : body.error ?? "Couldn't create your companion."
        );
        return;
      }
      router.push("/studio");
      router.refresh();
    } catch {
      setSubmitError("Couldn't create your companion. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-8">
      {/* Portrait */}
      <section>
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Portrait
        </h2>
        <div className="flex gap-4">
          <div className="relative h-32 w-32 rounded-md overflow-hidden border border-border-hairline shrink-0 bg-base flex items-center justify-center">
            {imageUrl ? (
              <Image src={imageUrl} alt="" fill sizes="128px" className="object-cover" />
            ) : (
              <ImageOff className="h-6 w-6 text-text-tertiary" />
            )}
          </div>
          <div className="flex-1 space-y-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe your companion's look…"
              rows={2}
              className={textareaClass}
            />
            <div className="flex flex-wrap gap-2">
              <select value={style} onChange={(e) => setStyle(e.target.value as typeof style)} className={cn(inputClass, "w-auto")}>
                {STYLES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <input
                value={hairColor}
                onChange={(e) => setHairColor(e.target.value)}
                placeholder="Hair color"
                className={cn(inputClass, "w-32")}
              />
              <input
                value={eyeColor}
                onChange={(e) => setEyeColor(e.target.value)}
                placeholder="Eye color"
                className={cn(inputClass, "w-32")}
              />
              <Button type="button" variant="secondary" onClick={generatePortrait} disabled={generating || !prompt.trim()}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {imageUrl ? "Regenerate" : "Generate Portrait"}
              </Button>
            </div>
            {imageError && <p className="text-xs text-danger">{imageError}</p>}
          </div>
        </div>
      </section>

      {/* Character details */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          Details
        </h2>

        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required className={inputClass} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Age">
            <input
              type="number"
              min={18}
              max={100}
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
              className={inputClass}
            />
          </Field>
          <Field label="Gender">
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as typeof gender)}
              className={inputClass}
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="anime">Anime</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Category">
            <input value={category} onChange={(e) => setCategory(e.target.value)} maxLength={50} className={inputClass} />
          </Field>
          <Field label="Occupation">
            <input value={occupation} onChange={(e) => setOccupation(e.target.value)} maxLength={100} className={inputClass} />
          </Field>
        </div>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            minLength={10}
            maxLength={1000}
            rows={3}
            required
            className={textareaClass}
          />
        </Field>

        <Field label="Personality (optional)">
          <textarea
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            maxLength={500}
            rows={2}
            className={textareaClass}
          />
        </Field>

        <Field label="Tags (comma-separated)">
          <input
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="witty, adventurous, loyal"
            className={inputClass}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={isNsfw}
            onChange={(e) => setIsNsfw(e.target.checked)}
            className="h-4 w-4 accent-gold-500"
          />
          Mark as NSFW
        </label>
      </section>

      {submitError && <p className="text-sm text-danger">{submitError}</p>}

      <Button type="submit" size="lg" disabled={submitting} className="w-full">
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Companion"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary mb-1.5">{label}</label>
      {children}
    </div>
  );
}
