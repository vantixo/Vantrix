"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Check, X, Loader2, EyeOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RevealItem } from "@/components/admin/motion/reveal";
import type { PendingCharacter } from "@/lib/frontend/admin-characters";

export function CharacterModerationCard({
  character,
  onResolved,
}: {
  character: PendingCharacter;
  onResolved: (id: string) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function decide(active: boolean) {
    setBusy(active ? "approve" : "reject");
    setError(null);
    try {
      const res = await fetch(`/api/admin/characters/${character.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          active,
          moderation_note: note || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      onResolved(character.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(null);
    }
  }

  return (
    <RevealItem>
      <Card interactive={false} className="p-4 flex flex-col sm:flex-row gap-4">
        <div className="relative w-full sm:w-28 aspect-[3/4] sm:aspect-square rounded-sm overflow-hidden shrink-0 border border-border-hairline">
          {character.image_url ? (
            <Image
              src={character.image_url}
              alt={character.name}
              fill
              sizes="112px"
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-white/5" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="font-medium text-text-primary">
              {character.name}, {character.age}
            </p>
            <span className="text-xs text-text-tertiary capitalize">
              {character.gender}
            </span>
            {character.is_nsfw && <Badge variant="outline">NSFW</Badge>}
            {character.visibility_requested === "private" && (
              <span className="flex items-center gap-1 text-xs text-text-tertiary">
                <EyeOff className="h-3 w-3" /> Requested private
              </span>
            )}
          </div>
          <p className="text-xs text-text-tertiary mb-2">
            by {character.creator_username ?? "unknown"}
          </p>
          <p className="text-sm text-text-secondary line-clamp-2 mb-3">
            {character.description}
          </p>

          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Moderation note (optional)"
            className="w-full h-9 px-3 mb-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none"
          />

          {error && <p className="text-sm text-danger mb-2">{error}</p>}

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={busy !== null}
              onClick={() => decide(true)}
            >
              {busy === "approve" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => decide(false)}
            >
              {busy === "reject" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <X className="h-3.5 w-3.5" />
              )}
              Reject
            </Button>
          </div>
        </div>
      </Card>
    </RevealItem>
  );
}
