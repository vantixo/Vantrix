"use client";

import { useState } from "react";
import { Loader2, Wand2, Video, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useCharacterJobPolling,
  trainCharacterLora,
  animateCharacterPortrait,
  type StudioActionError,
} from "@/hooks/use-studio";
import { usePaywall } from "@/components/paywall/paywall-provider";

/**
 * Both Train LoRA and Animate are fire-and-poll (see each route's own
 * docstring — completion lands via a Fal webhook, not this response), so
 * the only way this UI learns a job finished is by re-fetching the
 * character. GET /api/characters/:id (already used for the builder tabs)
 * doubles as that status source — the routes' own comments say as much
 * ("the client polls GET /api/characters/:id... no new polling endpoint
 * needed").
 */
export function CharacterActions({
  characterId,
  initialLoraStatus,
  initialLoraError,
  initialVideoStatus,
  initialVideoError,
}: {
  characterId: string;
  initialLoraStatus: string | null;
  initialLoraError: string | null;
  initialVideoStatus: string;
  initialVideoError: string | null;
}) {
  const [loraStatus, setLoraStatus] = useState(initialLoraStatus);
  const [loraError, setLoraError] = useState(initialLoraError);
  const [videoStatus, setVideoStatus] = useState(initialVideoStatus);
  const [videoError, setVideoError] = useState(initialVideoError);
  const [starting, setStarting] = useState<"lora" | "video" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { openPaywallForError } = usePaywall();

  const loraBusy = loraStatus === "queued" || loraStatus === "in_progress";
  const videoBusy = videoStatus === "processing";

  useCharacterJobPolling(characterId, loraBusy || videoBusy, (status) => {
    setLoraStatus(status.lora_training_status);
    setLoraError(status.lora_training_error);
    setVideoStatus(status.video_status);
    setVideoError(status.video_error);
  });

  async function trainLora() {
    setStarting("lora");
    setActionError(null);
    try {
      await trainCharacterLora(characterId);
      setLoraStatus("queued");
      setLoraError(null);
    } catch (err) {
      const code = (err as StudioActionError)?.code;
      // LoRA training is a Premium-only feature (canTrainLoRA in
      // tiers/config.ts) — a gated failure here means "not subscribed,"
      // not "something broke," so it gets the paywall, not an inline error.
      if (!openPaywallForError(code, { reasonOverride: "lora" })) {
        setActionError(err instanceof Error ? err.message : "Couldn't start training.");
      }
    } finally {
      setStarting(null);
    }
  }

  async function animate() {
    setStarting("video");
    setActionError(null);
    try {
      await animateCharacterPortrait(characterId);
      setVideoStatus("processing");
      setVideoError(null);
    } catch (err) {
      // NOTE: /api/characters/:id/animate is not currently tier-gated (no
      // requirePlan() call, no `code` in its error responses — see the
      // route itself) — its failures are rate-limit/provider issues, not
      // paywall-relevant, so this stays a plain inline error unless/until
      // that route adds a real Premium gate with a matching error code.
      setActionError(err instanceof Error ? err.message : "Couldn't start animation.");
    } finally {
      setStarting(null);
    }
  }

  return (
    <div className="rounded-md border border-border-hairline p-4 space-y-4">
      <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
        Actions
      </h3>

      <div className="flex flex-wrap gap-3">
        <div>
          <Button variant="secondary" size="sm" onClick={trainLora} disabled={loraBusy || starting === "lora"}>
            {starting === "lora" || loraBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Wand2 className="h-4 w-4" />
            )}
            {loraBusy ? "Training…" : "Train LoRA"}
          </Button>
          {loraStatus === "completed" && !loraBusy && (
            <p className="text-xs text-gold-400 mt-1">Trained</p>
          )}
          {loraError && !loraBusy && <p className="text-xs text-danger mt-1 max-w-[220px]">{loraError}</p>}
        </div>

        <div>
          <Button variant="secondary" size="sm" onClick={animate} disabled={videoBusy || starting === "video"}>
            {starting === "video" || videoBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Video className="h-4 w-4" />
            )}
            {videoBusy ? "Animating…" : "Animate Portrait"}
          </Button>
          {videoStatus === "completed" && !videoBusy && (
            <p className="text-xs text-gold-400 mt-1">Animated</p>
          )}
          {videoError && !videoBusy && <p className="text-xs text-danger mt-1 max-w-[220px]">{videoError}</p>}
        </div>

        <Button variant="ghost" size="sm" asChild>
          <a href={`/api/characters/${characterId}/export`} download>
            <Download className="h-4 w-4" /> Export
          </a>
        </Button>
      </div>

      {actionError && <p className="text-xs text-danger">{actionError}</p>}
    </div>
  );
}
