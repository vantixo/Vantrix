"use client";

import { useState } from "react";
import { SafeImage as Image } from "@/components/ui/safe-image";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Check,
  X,
  RotateCcw,
  Loader2,
  ImageIcon,
  MessageSquare,
  Video,
  Clock,
  DollarSign,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RevealItem } from "@/components/admin/motion/reveal";
import { cn } from "@/lib/utils";
import {
  reviewContentQueueItem,
  type ContentQueueItem,
} from "@/lib/frontend/admin-content-queue-client";

const CONTENT_TYPE_ICON = { image: ImageIcon, chat_line: MessageSquare, video: Video } as const;

const STATUS_STYLE: Record<string, string> = {
  queued: "text-text-tertiary",
  generating: "text-gold-400",
  pending_review: "text-gold-400",
  published: "text-success",
  rejected: "text-text-tertiary",
  failed: "text-danger",
};

const MIN_TIERS = ["free", "spark", "basic", "premium", "elite", "enterprise"] as const;

export function ContentQueueItemCard({
  item,
  onUpdated,
}: {
  item: ContentQueueItem;
  onUpdated: (item: ContentQueueItem) => void;
}) {
  const [busy, setBusy] = useState<"publish" | "reject" | "retry" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [editedText, setEditedText] = useState(item.result_text ?? "");
  const [isPremium, setIsPremium] = useState(true);
  const [minTier, setMinTier] = useState<(typeof MIN_TIERS)[number]>("premium");
  const [displayOrder, setDisplayOrder] = useState(0);

  const Icon = CONTENT_TYPE_ICON[item.content_type];
  const inFlight = item.status === "queued" || item.status === "generating";
  // Generation runs inline and normally resolves within seconds (video:
  // up to ~200s) — a row still "queued"/"generating" past 5 minutes means
  // a prior invocation crashed or hit its platform timeout mid-flight,
  // not that it's still legitimately working.
  const isStuck = inFlight && Date.now() - new Date(item.created_at).getTime() > 5 * 60 * 1000;

  async function act(action: "publish" | "reject" | "retry") {
    setBusy(action);
    setError(null);
    try {
      const updated = await reviewContentQueueItem(item.id, {
        ...(action === "publish"
          ? { action, isPremium, minTier, displayOrder, resultText: item.content_type === "chat_line" ? editedText : undefined }
          : action === "reject"
            ? { action, notes: rejectNote || undefined }
            : { action }),
      } as Parameters<typeof reviewContentQueueItem>[1]);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <RevealItem>
      <Card interactive={false} className="p-4 flex flex-col sm:flex-row gap-4">
        <Preview item={item} inFlight={inFlight} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <p className="font-medium text-text-primary truncate">{item.character_name}</p>
            <span className="flex items-center gap-1 text-xs text-text-tertiary capitalize">
              <Icon className="h-3 w-3" /> {item.content_type.replace("_", " ")}
            </span>
            <span className={cn("text-xs font-semibold capitalize", STATUS_STYLE[item.status])}>
              {item.status.replace("_", " ")}
            </span>
            {item.triggered_by === "cron" && <Badge variant="outline">cron</Badge>}
          </div>

          <div className="flex items-center gap-3 text-[11px] text-text-tertiary mb-2">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDistanceToNowStrict(new Date(item.created_at), { addSuffix: true })}
            </span>
            {item.cost_usd != null && (
              <span className="flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                {item.cost_usd.toFixed(3)}
              </span>
            )}
          </div>

          {item.prompt_input && (
            <p className="text-xs text-text-tertiary mb-2 line-clamp-1">Prompt: {item.prompt_input}</p>
          )}

          {item.content_type === "chat_line" && item.status === "pending_review" && (
            <textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              rows={Math.min(6, Math.max(3, (item.result_text ?? "").split("\n").length))}
              className="w-full px-3 py-2 mb-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none resize-y"
            />
          )}
          {item.content_type === "chat_line" && item.status !== "pending_review" && item.result_text && (
            <p className="text-sm text-text-secondary whitespace-pre-line mb-3 line-clamp-4">{item.result_text}</p>
          )}

          {item.status === "failed" && item.error && (
            <p className="text-sm text-danger mb-3">{item.error}</p>
          )}
          {item.status === "rejected" && item.error && (
            <p className="text-xs text-text-tertiary mb-3">Rejection note: {item.error}</p>
          )}

          {error && <p className="text-sm text-danger mb-2">{error}</p>}

          {inFlight && !isStuck && (
            <p className="text-xs text-text-tertiary flex items-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> In progress — this list refreshes when you reload.
            </p>
          )}
          {isStuck && (
            <div className="space-y-2">
              <p className="text-xs text-text-tertiary">
                Still &quot;{item.status}&quot; after 5+ minutes — likely crashed mid-run.
              </p>
              <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => act("retry")}>
                {busy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Retry
              </Button>
            </div>
          )}

          {item.status === "pending_review" && (
            <div className="space-y-2">
              {item.content_type !== "chat_line" && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5 text-text-secondary">
                    <input
                      type="checkbox"
                      checked={isPremium}
                      onChange={(e) => setIsPremium(e.target.checked)}
                      className="accent-gold-500"
                    />
                    Premium
                  </label>
                  <select
                    value={minTier}
                    onChange={(e) => setMinTier(e.target.value as (typeof MIN_TIERS)[number])}
                    className="h-7 px-2 rounded-xs bg-base border border-border-hairline text-text-primary outline-none"
                  >
                    {MIN_TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(Number(e.target.value))}
                    className="h-7 w-16 px-2 rounded-xs bg-base border border-border-hairline text-text-primary outline-none"
                    aria-label="Display order"
                  />
                </div>
              )}

              {showReject && (
                <input
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Rejection note (optional)"
                  className="w-full h-9 px-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none"
                />
              )}

              <div className="flex gap-2">
                <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => act("publish")}>
                  {busy === "publish" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Publish
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy !== null}
                  onClick={() => (showReject ? act("reject") : setShowReject(true))}
                >
                  {busy === "reject" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  {showReject ? "Confirm reject" : "Reject"}
                </Button>
              </div>
            </div>
          )}

          {item.status === "failed" && (
            <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => act("retry")}>
              {busy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Retry
            </Button>
          )}
        </div>
      </Card>
    </RevealItem>
  );
}

function Preview({ item, inFlight }: { item: ContentQueueItem; inFlight: boolean }) {
  const base = "relative w-full sm:w-32 aspect-square rounded-sm overflow-hidden shrink-0 border border-border-hairline bg-white/5";

  if (inFlight) {
    return (
      <div className={cn(base, "flex items-center justify-center")}>
        <Loader2 className="h-5 w-5 text-text-tertiary animate-spin" />
      </div>
    );
  }

  if (item.content_type === "image" && item.result_url) {
    return (
      <a href={item.result_url} target="_blank" rel="noreferrer" className={base}>
        <Image src={item.result_url} alt={item.character_name} fill sizes="128px" className="object-cover" />
      </a>
    );
  }

  if (item.content_type === "video" && item.result_url) {
    return (
      <a href={item.result_url} target="_blank" rel="noreferrer" className={cn(base, "flex items-center justify-center")}>
        <video src={item.result_url} className="absolute inset-0 h-full w-full object-cover" muted playsInline />
        <Video className="relative h-5 w-5 text-white drop-shadow" />
      </a>
    );
  }

  return (
    <div className={cn(base, "flex items-center justify-center")}>
      {item.character_image_url ? (
        <Image src={item.character_image_url} alt={item.character_name} fill sizes="128px" className="object-cover opacity-60" />
      ) : (
        <MessageSquare className="h-5 w-5 text-text-tertiary" />
      )}
    </div>
  );
}
