"use client";

import { useMemo, useState } from "react";
import { Sparkles, Loader2, ImageIcon, MessageSquare, Video, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FilterPillGroup } from "@/components/ui/filter-pills";
import { enqueueContentGeneration, type ContentQueueItem } from "@/lib/frontend/admin-content-queue-client";
import type { ContentQueueCharacter } from "@/lib/frontend/admin-content-queue";

const CONTENT_TYPE_OPTIONS = [
  { value: "image", label: "Image", icon: <ImageIcon className="h-3.5 w-3.5" /> },
  { value: "chat_line", label: "Chat Lines", icon: <MessageSquare className="h-3.5 w-3.5" /> },
  { value: "video", label: "Video", icon: <Video className="h-3.5 w-3.5" /> },
];

export function GenerateContentPanel({
  characters,
  onGenerated,
}: {
  characters: ContentQueueCharacter[];
  onGenerated: (item: ContentQueueItem) => void;
}) {
  const [search, setSearch] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [contentType, setContentType] = useState<"image" | "chat_line" | "video">("chat_line");
  const [promptInput, setPromptInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const filteredCharacters = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter((c) => c.name.toLowerCase().includes(q));
  }, [characters, search]);

  const selected = characters.find((c) => c.id === characterId) ?? null;
  const ineligible =
    selected &&
    ((contentType === "image" && !selected.has_lora) ||
      (contentType === "video" && !selected.has_canon_sheet));

  async function handleGenerate() {
    if (!characterId) {
      setError("Pick a character first.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await enqueueContentGeneration({
        characterId,
        contentType,
        promptInput: promptInput.trim() || undefined,
      });
      if (!result.success || !result.item) {
        setError(result.error ?? "Generation failed");
        return;
      }
      onGenerated(result.item);
      setNotice(
        result.item.status === "pending_review"
          ? "Generated — awaiting review below."
          : `Landed in status "${result.item.status}".`,
      );
      setPromptInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card interactive={false} className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-gold-500" strokeWidth={1.75} />
        <h3 className="font-display text-lg">Generate content</h3>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs text-text-tertiary mb-1 block">Character</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search characters…"
            className="w-full h-9 px-3 mb-2 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none"
          />
          <select
            value={characterId}
            onChange={(e) => setCharacterId(e.target.value)}
            className="w-full h-9 px-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary focus:border-gold-500/60 outline-none"
          >
            <option value="">Select a character…</option>
            {filteredCharacters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {!c.has_lora && !c.has_canon_sheet ? " (chat lines only)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-text-tertiary mb-1 block">Content type</label>
          <FilterPillGroup options={CONTENT_TYPE_OPTIONS} value={contentType} onChange={(v) => setContentType(v as typeof contentType)} />
        </div>
      </div>

      <div className="mb-3">
        <label className="text-xs text-text-tertiary mb-1 block">
          Prompt override <span className="text-text-tertiary/70">(optional — leave blank for a rotating default)</span>
        </label>
        <input
          value={promptInput}
          onChange={(e) => setPromptInput(e.target.value)}
          placeholder={
            contentType === "chat_line"
              ? "opening_line or reply_variety"
              : "scene / motion prompt"
          }
          className="w-full h-9 px-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none"
        />
      </div>

      {ineligible && (
        <div className="flex items-start gap-2 text-xs text-gold-400 mb-3">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            {selected!.name} has no {contentType === "image" ? "trained LoRA" : "canon reference sheet"} yet —
            this run will fail.
          </span>
        </div>
      )}

      {error && <p className="text-sm text-danger mb-3">{error}</p>}
      {notice && !error && <p className="text-sm text-gold-400 mb-3">{notice}</p>}

      <Button size="sm" variant="primary" disabled={busy || !characterId} onClick={handleGenerate}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {busy
          ? contentType === "video"
            ? "Generating… up to a few minutes"
            : "Generating…"
          : "Generate"}
      </Button>
    </Card>
  );
}
