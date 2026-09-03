"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { Loader2, Check, X, Sparkles, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/studio/builder/field-helpers";
import {
  generateImageBatch,
  saveCharacterFields,
  type BatchImageSpec,
  type BatchImageResult,
} from "@/hooks/use-studio";
import { resolveImageSrc } from "@/lib/utils";

const TOKEN_PER_IMAGE = 4;
const MAX_BATCH = 64;

const ART_STYLES = ["realistic", "anime", "artistic"] as const;
const ANGLES = ["portrait", "full_body", "close_up", "over_shoulder", "selfie"] as const;

interface PendingResult extends BatchImageResult {
  status: "pending" | "done" | "failed";
}

/**
 * The Gallery tab: generates via POST /api/images/generate-batch (streamed
 * NDJSON, see generateImageBatch in use-studio.ts) into a scratch grid the
 * creator can pick from, then PATCHes the chosen URLs onto the character's
 * public gallery_image_urls — the two-step "generate a bunch, keep the
 * good ones" flow the route's own MAX_IMAGES=64/PARALLELISM=8 batching was
 * built for. Saved gallery entries live separately below and can be
 * removed independently of any given generation run.
 */
export function ImageGalleryTab({
  characterId,
  initialGalleryUrls,
}: {
  characterId: string;
  initialGalleryUrls: string[];
}) {
  const router = useRouter();

  // Saved (persisted) gallery state
  const [savedUrls, setSavedUrls] = useState<string[]>(initialGalleryUrls);
  const [removing, setRemoving] = useState<string | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);

  // Generation form state
  const [count, setCount] = useState(4);
  const [outfit, setOutfit] = useState("");
  const [pose, setPose] = useState("");
  const [background, setBackground] = useState("");
  const [expression, setExpression] = useState("");
  const [style, setStyle] = useState<(typeof ART_STYLES)[number]>("realistic");
  const [angle, setAngle] = useState<(typeof ANGLES)[number]>("portrait");
  const [consistencyMode, setConsistencyMode] = useState(true);

  // Generation run state
  const [results, setResults] = useState<PendingResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const clampedCount = Math.max(1, Math.min(MAX_BATCH, count || 1));
  const estimatedCost = clampedCount * TOKEN_PER_IMAGE;

  async function handleGenerate() {
    setGenError(null);
    setResults([]);
    setSelected(new Set());
    setGenerating(true);

    const specs: BatchImageSpec[] = Array.from({ length: clampedCount }, (_, i) => ({
      id: `spec-${Date.now()}-${i}`,
      outfit: outfit || undefined,
      pose: pose || undefined,
      background: background || undefined,
      expression: expression || undefined,
      style,
      angle,
    }));
    setResults(specs.map((s) => ({ specId: s.id, url: "", failed: false, status: "pending" })));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await generateImageBatch(
        characterId,
        specs,
        consistencyMode,
        (result) => {
          setResults((prev) =>
            prev.map((r) =>
              r.specId === result.specId
                ? { ...result, status: result.failed ? "failed" : "done" }
                : r
            )
          );
        },
        controller.signal
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        setGenError(err instanceof Error ? err.message : "Batch generation failed.");
      }
    } finally {
      setGenerating(false);
    }
  }

  function toggleSelected(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function handleAddSelected() {
    if (selected.size === 0) return;
    setAdding(true);
    setGenError(null);
    try {
      const merged = [...savedUrls, ...Array.from(selected)];
      await saveCharacterFields(characterId, { gallery_image_urls: merged });
      setSavedUrls(merged);
      setResults((prev) => prev.filter((r) => !selected.has(r.url)));
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Couldn't save to gallery.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveSaved(url: string) {
    setRemoving(url);
    setSavedError(null);
    const next = savedUrls.filter((u) => u !== url);
    try {
      await saveCharacterFields(characterId, { gallery_image_urls: next });
      setSavedUrls(next);
      router.refresh();
    } catch (err) {
      setSavedError(err instanceof Error ? err.message : "Couldn't remove image.");
    } finally {
      setRemoving(null);
    }
  }

  const doneCount = results.filter((r) => r.status === "done").length;
  const failedCount = results.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-8">
      {/* ── Generator ────────────────────────────────────────────────── */}
      <div className="rounded-md border border-border-hairline p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gold-400" />
          <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
            Batch Generate
          </h3>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <TextField label="Outfit" value={outfit} onChange={setOutfit} maxLength={200} placeholder="e.g. red evening dress" />
          <TextField label="Pose" value={pose} onChange={setPose} maxLength={200} placeholder="e.g. leaning against a wall" />
          <TextField label="Background" value={background} onChange={setBackground} maxLength={200} placeholder="e.g. rooftop at sunset" />
          <TextField label="Expression" value={expression} onChange={setExpression} maxLength={100} placeholder="e.g. playful smile" />
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Style</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as (typeof ART_STYLES)[number])}
              className="w-full h-11 rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary focus:outline-none focus:border-gold-500/60"
            >
              {ART_STYLES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Angle</label>
            <select
              value={angle}
              onChange={(e) => setAngle(e.target.value as (typeof ANGLES)[number])}
              className="w-full h-11 rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary focus:outline-none focus:border-gold-500/60"
            >
              {ANGLES.map((a) => (
                <option key={a} value={a}>{a.replace("_", " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">
              Count ({clampedCount})
            </label>
            <input
              type="range"
              min={1}
              max={MAX_BATCH}
              value={clampedCount}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full accent-gold-500 mt-3"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={consistencyMode}
            onChange={(e) => setConsistencyMode(e.target.checked)}
            className="accent-gold-500"
          />
          Keep this character&apos;s face/identity consistent across the batch
        </label>

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-text-tertiary">
            {clampedCount} image{clampedCount === 1 ? "" : "s"} · {estimatedCost} VC
          </p>
          <Button variant="primary" size="sm" onClick={handleGenerate} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating {doneCount + failedCount}/{results.length}…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Generate
              </>
            )}
          </Button>
        </div>

        {genError && <p className="text-xs text-danger">{genError}</p>}

        {results.length > 0 && (
          <div className="pt-2 space-y-3">
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {results.map((r) => (
                <button
                  key={r.specId}
                  type="button"
                  disabled={r.status !== "done"}
                  onClick={() => r.url && toggleSelected(r.url)}
                  className={`relative aspect-square rounded-sm overflow-hidden border transition-colors ease-premium ${
                    r.url && selected.has(r.url)
                      ? "border-gold-500 ring-2 ring-gold-500/50"
                      : "border-border-hairline"
                  }`}
                >
                  {r.status === "pending" && (
                    <div className="flex h-full w-full items-center justify-center bg-white/[0.03]">
                      <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
                    </div>
                  )}
                  {r.status === "failed" && (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white/[0.03] text-danger">
                      <ImageOff className="h-5 w-5" />
                      <span className="text-[10px]">
                        {r.timedOut ? "Timed out" : "Failed"}
                      </span>
                    </div>
                  )}
                  {r.status === "done" && r.url && (
                    <>
                      <Image src={resolveImageSrc(r.url)} alt="" fill sizes="150px" className="object-cover" />
                      {selected.has(r.url) && (
                        <div className="absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gold-fill text-[#160F02]">
                          <Check className="h-3 w-3" />
                        </div>
                      )}
                    </>
                  )}
                </button>
              ))}
            </div>

            {failedCount > 0 && !generating && (
              <p className="text-xs text-text-tertiary">
                {failedCount} image{failedCount === 1 ? "" : "s"} failed — tokens for those were refunded.
              </p>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs text-text-tertiary">
                {selected.size} selected
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddSelected}
                disabled={selected.size === 0 || adding}
              >
                {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Add {selected.size > 0 ? selected.size : ""} to gallery
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Saved gallery ────────────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-text-secondary uppercase tracking-wide mb-3">
          Public Gallery ({savedUrls.length})
        </h3>
        {savedError && <p className="text-xs text-danger mb-2">{savedError}</p>}
        {savedUrls.length === 0 ? (
          <p className="text-sm text-text-tertiary">
            No images saved yet — generate a batch above and add your favorites.
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {savedUrls.map((url) => (
              <div key={url} className="relative aspect-square rounded-sm overflow-hidden border border-border-hairline group">
                <Image src={resolveImageSrc(url)} alt="" fill sizes="150px" className="object-cover" />
                <button
                  type="button"
                  onClick={() => handleRemoveSaved(url)}
                  disabled={removing === url}
                  aria-label="Remove from gallery"
                  className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity ease-premium disabled:opacity-100"
                >
                  {removing === url ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
