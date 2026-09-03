"use client";

import { useEffect, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { AlertCircle, Loader2, Play, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { resolveImageSrc, resolveVideoSrc, timeAgo } from "@/lib/utils";
import { formatGenreLabel } from "@/lib/universe/scene-genres.client";
import type { LocationResident } from "@/types/universe-views";
import type { LocationScene } from "@/lib/universe/world-atlas";

const MAX_AVATAR_STACK = 4;

export function SceneGallery({
  scenes,
  residents,
  factions,
}: {
  scenes: LocationScene[];
  residents: LocationResident[];
  factions: { id: string; name: string; slug: string }[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const residentById = new Map(residents.map((r) => [r.id, r]));
  const factionById = new Map(factions.map((f) => [f.id, f]));
  const openScene = scenes.find((s) => s.id === openId) ?? null;

  if (scenes.length === 0) {
    return (
      <p className="text-sm text-text-tertiary">
        No scenes composed here yet — build one above.
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {scenes.map((scene) => {
          const cast = scene.character_ids.map((id) => residentById.get(id)).filter((r): r is LocationResident => !!r);
          const faction = scene.faction_id ? factionById.get(scene.faction_id) : undefined;
          const failed = scene.status === "failed";
          const pending = scene.status === "generating_image" || scene.status === "generating_video";

          return (
            <Card
              key={scene.id}
              interactive={!failed}
              className="relative aspect-video overflow-hidden"
              onClick={() => !failed && !pending && setOpenId(scene.id)}
              role={!failed && !pending ? "button" : undefined}
              tabIndex={!failed && !pending ? 0 : undefined}
            >
              {scene.image_url && !failed ? (
                <Image src={resolveImageSrc(scene.image_url)} alt={formatGenreLabel(scene.genre)} fill sizes="240px" className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-white/[0.03]">
                  {failed ? (
                    <AlertCircle className="h-5 w-5 text-danger" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
                  )}
                </div>
              )}

              {scene.video_url && !failed && (
                <div className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
                  <Play className="h-3 w-3 fill-current" />
                </div>
              )}

              <div className="absolute top-1.5 left-1.5">
                <Badge variant="outline" className="normal-case">{formatGenreLabel(scene.genre)}</Badge>
              </div>

              {faction && (
                <div className="absolute bottom-1.5 left-1.5">
                  <Badge variant="outline" className="normal-case">{faction.name}</Badge>
                </div>
              )}

              {cast.length > 0 && (
                <div className="absolute bottom-1.5 right-1.5 flex -space-x-2">
                  {cast.slice(0, MAX_AVATAR_STACK).map((r) => (
                    <div key={r.id} className="relative h-6 w-6 rounded-full overflow-hidden border border-black/60">
                      <Image src={resolveImageSrc(r.image_url)} alt={r.name} fill sizes="24px" className="object-cover" />
                    </div>
                  ))}
                  {cast.length > MAX_AVATAR_STACK && (
                    <div className="relative h-6 w-6 rounded-full border border-black/60 bg-black/70 flex items-center justify-center text-[10px] text-white">
                      +{cast.length - MAX_AVATAR_STACK}
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {openScene && (
        <SceneLightbox
          scene={openScene}
          cast={openScene.character_ids.map((id) => residentById.get(id)).filter((r): r is LocationResident => !!r)}
          faction={openScene.faction_id ? factionById.get(openScene.faction_id) : undefined}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

function SceneLightbox({
  scene,
  cast,
  faction,
  onClose,
}: {
  scene: LocationScene;
  cast: LocationResident[];
  faction: { id: string; name: string; slug: string } | undefined;
  onClose: () => void;
}) {
  const videoSrc = resolveVideoSrc(scene.video_url);

  // Escape-to-close for keyboard users — the backdrop-tap/stopPropagation
  // split below already handles pointer dismissal, this covers the
  // keyboard-only path (matches media-lightbox.tsx's overlay pattern).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${formatGenreLabel(scene.genre)} scene`}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
        <div className="relative aspect-video w-full rounded-lg overflow-hidden border border-border-hairline bg-black">
          {videoSrc ? (
            <video src={videoSrc} controls autoPlay loop playsInline className="h-full w-full object-contain" />
          ) : (
            <Image src={resolveImageSrc(scene.image_url)} alt={formatGenreLabel(scene.genre)} fill sizes="640px" className="object-contain" />
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge className="normal-case">{formatGenreLabel(scene.genre)}</Badge>
          {faction && <Badge variant="outline" className="normal-case">{faction.name}</Badge>}
          <span className="text-xs text-text-tertiary">{timeAgo(scene.created_at)}</span>
        </div>
        {cast.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 text-sm text-text-secondary">
            <Users className="h-3.5 w-3.5 shrink-0" />
            {cast.map((r) => r.name).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
