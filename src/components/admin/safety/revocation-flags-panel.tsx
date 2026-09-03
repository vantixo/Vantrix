"use client";

import { useState, useEffect } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Loader2 } from "lucide-react";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchRevocationFlags,
  clearRevocationFlag,
  type RevocationFlag,
} from "@/lib/frontend/admin-safety";

export function RevocationFlagsPanel() {
  const [flags, setFlags] = useState<RevocationFlag[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    fetchRevocationFlags("pending")
      .then(setFlags)
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  async function clear(id: string) {
    setBusyId(id);
    try {
      await clearRevocationFlag(id, "Cleared by admin — resolved in user's favor");
      setFlags((prev) => prev.filter((f) => f.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  if (isLoading) return <p className="text-text-secondary text-sm">Loading…</p>;
  if (flags.length === 0) {
    return (
      <p className="text-text-tertiary text-sm py-8 text-center border border-border-hairline rounded-md">
        No pending revocation flags.
      </p>
    );
  }

  return (
    <RevealGroup className="space-y-3">
      {flags.map((f) => {
        const graceEnds = new Date(f.grace_period_ends_at);
        const isPastGrace = graceEnds.getTime() < Date.now();
        return (
          <RevealItem key={f.id}>
            <Card interactive={false} className="p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-xs text-text-tertiary">
                  {formatDistanceToNowStrict(new Date(f.created_at), { addSuffix: true })}
                </span>
                <span className="text-xs font-semibold text-gold-400 capitalize">
                  {f.provider} · {f.reason}
                </span>
              </div>
              <p className="text-sm text-text-primary mb-1">
                User <span className="font-mono text-xs">{f.user_id.slice(0, 8)}</span>
              </p>
              <p
                className={
                  isPastGrace
                    ? "text-xs text-danger mb-3"
                    : "text-xs text-text-secondary mb-3"
                }
              >
                Grace period {isPastGrace ? "expired" : "ends"}{" "}
                {formatDistanceToNowStrict(graceEnds, { addSuffix: true })}
                {isPastGrace ? " — will auto-downgrade on next sweep" : ""}
              </p>
              <Button
                size="sm"
                variant="primary"
                disabled={busyId === f.id}
                onClick={() => clear(f.id)}
              >
                {busyId === f.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Clear Flag
              </Button>
            </Card>
          </RevealItem>
        );
      })}
    </RevealGroup>
  );
}
