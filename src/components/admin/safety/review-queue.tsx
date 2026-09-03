"use client";

import { useState, useEffect, useCallback } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Loader2 } from "lucide-react";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface QueueAction {
  label: string;
  status: string;
  variant?: "primary" | "secondary" | "destructive" | "ghost";
}

interface ReviewQueueProps<T extends { id: string; created_at: string; status: string }> {
  fetcher: (status: string) => Promise<T[]>;
  onReview: (id: string, status: string, notes?: string) => Promise<void>;
  actions: QueueAction[];
  renderBody: (item: T) => React.ReactNode;
  renderMeta?: (item: T) => React.ReactNode;
  emptyLabel?: string;
  /** Whether to show a notes field before the action buttons. */
  withNotes?: boolean;
}

/**
 * Drives all five review queues (abuse signals, crisis events, reply
 * guard, keyword hits — revocation flags uses its own simpler variant
 * below since it has a different action shape). Each queue defaults to
 * status=pending and removes an item from the list optimistically the
 * moment an action is taken, since the route itself is the source of
 * truth for what "reviewed" means per queue.
 */
export function ReviewQueue<
  T extends { id: string; created_at: string; status: string },
>({
  fetcher,
  onReview,
  actions,
  renderBody,
  renderMeta,
  emptyLabel = "Queue is clear.",
  withNotes = false,
}: ReviewQueueProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setIsLoading(true);
    fetcher("pending")
      .then(setItems)
      .finally(() => setIsLoading(false));
  }, [fetcher]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAction(id: string, status: string) {
    setBusyId(id);
    try {
      await onReview(id, status, notes[id]);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      // Leave the item in place — the badge below the buttons will show
      // the same actions again, which functions as an implicit retry.
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) {
    return <p className="text-text-secondary text-sm">Loading…</p>;
  }
  if (items.length === 0) {
    return (
      <p className="text-text-tertiary text-sm py-8 text-center border border-border-hairline rounded-md">
        {emptyLabel}
      </p>
    );
  }

  return (
    <RevealGroup className="space-y-3">
      {items.map((item) => (
        <RevealItem key={item.id}>
          <Card interactive={false} className="p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <span className="text-xs text-text-tertiary">
                {formatDistanceToNowStrict(new Date(item.created_at), {
                  addSuffix: true,
                })}
              </span>
              {renderMeta?.(item)}
            </div>
            <div className="text-sm text-text-primary mb-3">{renderBody(item)}</div>

            {withNotes && (
              <input
                value={notes[item.id] ?? ""}
                onChange={(e) =>
                  setNotes((prev) => ({ ...prev, [item.id]: e.target.value }))
                }
                placeholder="Notes (optional)"
                className="w-full h-9 px-3 mb-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none"
              />
            )}

            <div className="flex flex-wrap gap-2">
              {actions.map((a) => (
                <Button
                  key={a.status}
                  size="sm"
                  variant={a.variant ?? "secondary"}
                  disabled={busyId === item.id}
                  onClick={() => handleAction(item.id, a.status)}
                  className={cn(busyId === item.id && "opacity-60")}
                >
                  {busyId === item.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  {a.label}
                </Button>
              ))}
            </div>
          </Card>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}
