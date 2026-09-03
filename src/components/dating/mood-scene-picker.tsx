"use client";

import { useEffect, useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Lock, Loader2, ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MOOD_ROOMS, type MoodRoom } from "@/lib/characters/scene-data";
import { useGenerateScene } from "@/hooks/use-generate-scene";
import { usePaywall } from "@/components/paywall/paywall-provider";

const ERROR_MESSAGES: Record<string, string> = {
  INSUFFICIENT_TOKENS: "Not enough Vantrix Coin for a scene — top up to continue.",
  TIER_LOCKED: "This room needs a higher tier — upgrade to unlock it.",
  NO_LORA_MODEL: "This character isn't set up for scene generation yet.",
  CONTENT_POLICY_VIOLATION: "That prompt was rejected by content moderation.",
  RATE_LIMIT_EXCEEDED: "Too many images right now — try again in a minute.",
  DAILY_LIMIT_EXCEEDED: "Daily scene limit reached for your plan.",
  GENERATION_FAILED: "Scene generation is temporarily unavailable — please try again.",
};

export function MoodScenePicker({
  matchId,
  userTier,
}: {
  matchId: string;
  userTier: string;
}) {
  const isPremium = userTier.toLowerCase() !== "free";
  const [selected, setSelected] = useState<MoodRoom | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const { generateScene, isGenerating, error, clearError } = useGenerateScene(matchId);
  const { openPaywall, openPaywallForError } = usePaywall();

  // Surface the shared paywall automatically for any tier-gated failure
  // (a locked room selected via the custom-prompt path, or a race where
  // tier changed mid-session) instead of only the small inline red text.
  useEffect(() => {
    if (error?.code) openPaywallForError(error.code);
  }, [error?.code, openPaywallForError]);

  async function handleGenerate() {
    if (!selected && !useCustom) return;
    if (useCustom && customPrompt.trim().length === 0) return;
    const result = await generateScene(
      useCustom
        ? { customPrompt: customPrompt.trim() }
        : { moodRoomId: selected!.id }
    );
    if (result) setResultUrl(result.url);
  }

  return (
    <div>
      {resultUrl && (
        <div className="relative mb-4 aspect-[3/4] w-full max-w-xs overflow-hidden rounded-md border border-gold-500/30">
          <Image src={resultUrl} alt="Generated scene" fill sizes="(max-width: 400px) 100vw, 320px" className="object-cover" />
        </div>
      )}

      {error && (
        <p className="mb-3 rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {ERROR_MESSAGES[error.code ?? ""] ?? error.error}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {MOOD_ROOMS.map((room) => {
          const locked = room.minTier === "premium" && !isPremium;
          const isSelected = !useCustom && selected?.id === room.id;
          return (
            <button
              key={room.id}
              onClick={() => {
                if (locked) {
                  openPaywall("images");
                  return;
                }
                clearError();
                setUseCustom(false);
                setSelected(room);
                setResultUrl(null);
              }}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-md border p-3 text-center transition-colors ease-premium",
                locked
                  ? "border-border-hairline opacity-40 hover:opacity-60 cursor-pointer"
                  : isSelected
                  ? "border-gold-500 bg-gold-500/10"
                  : "border-border-hairline hover:border-gold-500/40"
              )}
            >
              {locked && (
                <Lock className="absolute right-2 top-2 h-3 w-3 text-text-tertiary" />
              )}
              <span className="text-2xl">{room.emoji}</span>
              <span className="line-clamp-1 text-xs text-text-primary">{room.label}</span>
              <span className="line-clamp-1 text-[10px] text-text-tertiary">
                {room.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 border-t border-border-hairline pt-4">
        <button
          onClick={() => {
            clearError();
            setUseCustom((v) => !v);
            setResultUrl(null);
          }}
          className="mb-2 text-xs font-medium text-gold-400 hover:text-gold-300"
        >
          {useCustom ? "Choose a mood room instead" : "Or write a custom scene"}
        </button>
        {useCustom && (
          <textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            maxLength={500}
            placeholder="Describe the scene you want to see..."
            rows={2}
            className="w-full resize-none rounded-sm border border-interactive bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 focus:outline-none"
          />
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button
          size="sm"
          onClick={handleGenerate}
          disabled={isGenerating || (!selected && !useCustom) || (useCustom && !customPrompt.trim())}
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
          Generate Scene · 15 coins
        </Button>
      </div>
    </div>
  );
}
