"use client";

import { useEffect, useState } from "react";
import { Pencil, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCharacterPage } from "@/hooks/use-character-page";

/**
 * Surfaces the relationship route's nickname customization (previously
 * built, never wired to anything). Collapsed by default so it doesn't
 * compete with Start Chat for attention on first view — matches the
 * route's own "genuinely user-facing but secondary" framing.
 */
export function CharacterNicknameEditor({ characterId }: { characterId: string }) {
  const { getRelationship, updateRelationship } = useCharacterPage();
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ok" | "unauthorized" | "error">("idle");
  const [nicknameForUser, setNicknameForUser] = useState("");
  const [userNicknameForCharacter, setUserNicknameForCharacter] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || loadState !== "idle") return;
    setLoadState("loading");
    getRelationship(characterId).then((result) => {
      if (result.status === "ok") {
        setNicknameForUser(result.data.nicknameForUser ?? "");
        setUserNicknameForCharacter(result.data.userNicknameForCharacter ?? "");
      }
      setLoadState(result.status === "ok" ? "ok" : result.status);
    });
  }, [open, loadState, characterId, getRelationship]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const ok = await updateRelationship(characterId, {
      nicknameForUser: nicknameForUser.trim() || null,
      userNicknameForCharacter: userNicknameForCharacter.trim() || null,
    });
    setSaving(false);
    if (ok) {
      setSaved(true);
    } else {
      setError("Couldn't save. Try again.");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-text-tertiary hover:text-text-secondary mx-auto"
      >
        <Pencil className="h-3 w-3" strokeWidth={1.75} />
        Customize names
      </button>
    );
  }

  return (
    <div className="mx-auto max-w-sm rounded-md border border-border-hairline p-4">
      {loadState === "loading" ? (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
        </div>
      ) : loadState === "unauthorized" ? (
        <p className="text-center text-xs text-text-secondary">
          Sign in to customize what you call each other.
        </p>
      ) : loadState === "error" ? (
        <p className="text-center text-xs text-text-secondary">
          Couldn&apos;t load this right now. Try again shortly.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-left">
            <span className="text-xs text-text-tertiary">What they call you</span>
            <input
              value={nicknameForUser}
              onChange={(e) => {
                setNicknameForUser(e.target.value);
                setSaved(false);
              }}
              maxLength={40}
              placeholder="e.g. Firefly"
              className="rounded-sm bg-base border border-interactive px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60"
            />
          </label>
          <label className="flex flex-col gap-1 text-left">
            <span className="text-xs text-text-tertiary">What you call them</span>
            <input
              value={userNicknameForCharacter}
              onChange={(e) => {
                setUserNicknameForCharacter(e.target.value);
                setSaved(false);
              }}
              maxLength={40}
              placeholder="e.g. their name"
              className="rounded-sm bg-base border border-interactive px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60"
            />
          </label>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : saved ? (
                <Check className="h-4 w-4" />
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
