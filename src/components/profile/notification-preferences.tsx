"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { clientLogger } from "@/lib/logger.client";
import {
  NOTIFICATION_CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_TYPES,
  type NotificationType,
} from "@/lib/notifications/types";

interface PreferenceRow {
  type: NotificationType;
  label: string;
  description: string;
  inApp: boolean;
  push: boolean;
  mutable: boolean;
}

/**
 * Per-type in-app/push toggles for all 14 inbox categories. Settings
 * previously only exposed the one blunt push on/off switch (PushOptIn,
 * which is really "is this device subscribed at all" — kept as-is above
 * this component, since it's a genuinely separate concern: browser
 * permission/subscription state vs. per-type routing preference). The
 * granular GET/PUT endpoints this reads from
 * (/api/notifications/preferences) already existed with no UI in front of
 * them at all.
 */
export function NotificationPreferences() {
  const [rows, setRows] = useState<PreferenceRow[] | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications/preferences")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { preferences: PreferenceRow[] }) => {
        if (!cancelled) setRows(data.preferences);
      })
      .catch((err) => {
        clientLogger.warn("notification-preferences: load failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(type: NotificationType, channel: "inApp" | "push") {
    if (!rows) return;
    const row = rows.find((r) => r.type === type);
    if (!row || !row.mutable) return;

    const nextValue = !row[channel];
    const key = `${type}:${channel}`;
    setPending((p) => new Set(p).add(key));
    setRows((prev) => prev!.map((r) => (r.type === type ? { ...r, [channel]: nextValue } : r)));

    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, [channel]: nextValue }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
    } catch (err) {
      clientLogger.warn("notification-preferences: update failed", {
        type,
        channel,
        error: err instanceof Error ? err.message : String(err),
      });
      // Roll back — a silently-failed preference change is worse than a
      // read-state toggle failing, since the user has no other signal
      // that the setting didn't actually take.
      setRows((prev) => prev!.map((r) => (r.type === type ? { ...r, [channel]: !nextValue } : r)));
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(key);
        return next;
      });
    }
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-text-tertiary py-2">Couldn&rsquo;t load notification preferences.</p>;
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-end gap-8 mb-2 pr-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary w-10 text-center">
          In-app
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary w-10 text-center">
          Push
        </span>
      </div>

      <div className="flex flex-col divide-y divide-border-hairline">
        {NOTIFICATION_CATEGORIES.map((category) => {
          const categoryRows = rows.filter((r) => (CATEGORY_TYPES[category] as readonly string[]).includes(r.type));
          if (categoryRows.length === 0) return null;
          return (
            <div key={category} className="py-3 first:pt-0">
              <div className="text-xs font-semibold text-gold-400 uppercase tracking-wide mb-2">
                {CATEGORY_LABELS[category]}
              </div>
              <div className="flex flex-col gap-2.5">
                {categoryRows.map((row) => (
                  <div key={row.type} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-text-primary flex items-center gap-1.5">
                        {row.label}
                        {!row.mutable && <Lock className="h-3 w-3 text-text-tertiary" />}
                      </div>
                      <div className="text-xs text-text-tertiary">{row.description}</div>
                    </div>
                    <div className="flex items-center gap-8 shrink-0">
                      <ToggleDot
                        checked={row.inApp}
                        disabled={!row.mutable || pending.has(`${row.type}:inApp`)}
                        onClick={() => toggle(row.type, "inApp")}
                        label={`Toggle in-app notifications for ${row.label}`}
                      />
                      <ToggleDot
                        checked={row.push}
                        disabled={!row.mutable || pending.has(`${row.type}:push`)}
                        onClick={() => toggle(row.type, "push")}
                        label={`Toggle push notifications for ${row.label}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToggleDot({
  checked,
  disabled,
  onClick,
  label,
}: {
  checked: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "w-10 h-5 rounded-full border transition-colors ease-premium relative shrink-0 disabled:opacity-40 disabled:cursor-not-allowed",
        checked ? "bg-gold-500 border-gold-500" : "bg-white/5 border-border-hairline"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-base transition-transform ease-premium",
          checked ? "translate-x-[22px]" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
