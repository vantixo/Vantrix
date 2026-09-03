"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Check, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { resolveImageSrc, cn } from "@/lib/utils";
import { SCENE_GENRES_CLIENT, formatGenreLabel, type SceneGenreClient } from "@/lib/universe/scene-genres.client";
import type { LocationResident } from "@/types/universe-views";
import type { LocationScene } from "@/lib/universe/world-atlas";

const MAX_CAST = 6;

const selectClass =
  "w-full h-11 rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary focus:outline-none focus:border-gold-500/60";
const textareaClass =
  "w-full rounded-sm bg-base border border-interactive px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60 resize-none";

// Mirrors the API's own error codes (see composeUniverseScene /
// api/universe/scenes/route.ts) with copy a visitor can act on, instead of
// surfacing the raw machine code string.
function friendlyError(code?: string): string {
  if (!code) return "Couldn't compose that scene. Try again.";
  if (code.startsWith("characters_not_resident_here")) {
    return "One or more selected characters no longer live here — refresh the page and try again.";
  }
  switch (code) {
    case "location_not_found":
      return "This location couldn't be found.";
    case "faction_not_found":
      return "That faction couldn't be found.";
    case "invalid_genre":
      return "Pick a valid genre.";
    case "at_least_one_character_required":
      return "Pick at least one character for the scene.";
    case "too_many_characters_max_6":
      return `Scenes can have at most ${MAX_CAST} characters.`;
    case "one_or_more_characters_not_found":
      return "One of the selected characters no longer exists.";
    case "unauthenticated":
      return "Sign in to compose a scene.";
    default:
      return "Couldn't compose that scene. Try again.";
  }
}

export function SceneBuilder({
  locationSlug,
  residents,
  factions,
  onCreated,
}: {
  locationSlug: string;
  residents: LocationResident[];
  factions: { id: string; name: string; slug: string }[];
  onCreated: (scene: LocationScene) => void;
}) {
  const [cast, setCast] = useState<Set<string>>(new Set());
  const [factionSlug, setFactionSlug] = useState("");
  const [genre, setGenre] = useState<SceneGenreClient>("slice-of-life");
  const [customDirection, setCustomDirection] = useState("");
  const [generateVideo, setGenerateVideo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleCast(id: string) {
    setCast((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_CAST) {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cast.size === 0) {
      setError("Pick at least one character for the scene.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/universe/scenes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationSlug,
          factionSlug: factionSlug || undefined,
          characterIds: Array.from(cast),
          genre,
          customDirection: customDirection.trim() || undefined,
          generateVideo,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) {
        setError(friendlyError(body.error));
        return;
      }

      const tiedFaction = factions.find((f) => f.slug === factionSlug);
      onCreated({
        id: body.sceneId,
        genre,
        image_url: body.imageUrl ?? null,
        video_url: body.videoUrl ?? null,
        status: "complete",
        created_at: new Date().toISOString(),
        faction_id: tiedFaction?.id ?? null,
        character_ids: Array.from(cast),
      });
      setCustomDirection("");
    } catch {
      setError("Couldn't reach the scene composer. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-2">
          Cast ({cast.size}/{MAX_CAST})
        </label>
        <div className="flex flex-wrap gap-2">
          {residents.map((r) => {
            const selected = cast.has(r.id);
            const disabled = !selected && cast.size >= MAX_CAST;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => toggleCast(r.id)}
                disabled={disabled}
                className={cn(
                  "flex items-center gap-2 rounded-full border pl-1 pr-3 py-1 transition-colors ease-premium",
                  selected
                    ? "border-gold-500 bg-gold-500/10"
                    : "border-border-hairline hover:border-gold-500/40",
                  disabled && "opacity-40"
                )}
              >
                <div className="relative h-7 w-7 rounded-full overflow-hidden shrink-0">
                  <Image src={resolveImageSrc(r.image_url)} alt={r.name} fill sizes="28px" className="object-cover" />
                  {selected && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Check className="h-3.5 w-3.5 text-gold-300" />
                    </div>
                  )}
                </div>
                <span className="text-sm text-text-primary">{r.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1.5">Genre</label>
          <select value={genre} onChange={(e) => setGenre(e.target.value as SceneGenreClient)} className={selectClass}>
            {SCENE_GENRES_CLIENT.map((g) => (
              <option key={g} value={g}>{formatGenreLabel(g)}</option>
            ))}
          </select>
        </div>

        {factions.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Faction (optional)</label>
            <select value={factionSlug} onChange={(e) => setFactionSlug(e.target.value)} className={selectClass}>
              <option value="">No faction</option>
              {factions.map((f) => (
                <option key={f.id} value={f.slug}>{f.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-1.5">
          Direction (optional)
        </label>
        <textarea
          value={customDirection}
          onChange={(e) => setCustomDirection(e.target.value)}
          placeholder="e.g. a tense standoff just after sundown"
          maxLength={300}
          rows={2}
          className={textareaClass}
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={generateVideo}
          onChange={(e) => setGenerateVideo(e.target.checked)}
          className="h-4 w-4 accent-gold-500"
        />
        Also generate a short video (takes longer)
      </label>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button type="submit" disabled={submitting || cast.size === 0} className="w-full sm:w-auto">
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Composing{generateVideo ? " — this can take a minute" : "…"}
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4" /> Compose Scene
          </>
        )}
      </Button>
    </form>
  );
}
