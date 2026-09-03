"use client";

import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { usePushSubscription } from "@/lib/push/use-push-subscription";
import { cn } from "@/lib/utils";

/**
 * Surfaced toggle for usePushSubscription — the hook itself says "see
 * push-opt-in.tsx for the surfaced toggle" in its own header comment,
 * which referenced a component that didn't exist yet. This is that
 * component, mounted in Settings alongside the rest of account
 * preferences (§11 routes this whole cluster under Profile/Account).
 */
export function PushOptIn() {
  const { status, busy, enable, disable } = usePushSubscription();

  if (status === "unsupported") {
    return (
      <div className="flex items-center justify-between gap-3 py-3">
        <div>
          <p className="text-sm font-medium text-text-primary">Push notifications</p>
          <p className="text-xs text-text-tertiary mt-0.5">
            Not supported on this browser or device.
          </p>
        </div>
        <BellOff className="h-4 w-4 text-text-tertiary shrink-0" />
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="flex items-center justify-between gap-3 py-3">
        <div>
          <p className="text-sm font-medium text-text-primary">Push notifications</p>
          <p className="text-xs text-text-tertiary mt-0.5">
            Blocked at the browser level. Enable notifications for this site in your browser
            settings to turn this back on.
          </p>
        </div>
        <BellOff className="h-4 w-4 text-text-tertiary shrink-0" />
      </div>
    );
  }

  const enabled = status === "enabled";

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div>
        <p className="text-sm font-medium text-text-primary">Push notifications</p>
        <p className="text-xs text-text-tertiary mt-0.5">
          {enabled
            ? "You'll get alerts for messages, matches, and world events."
            : "Get alerts for messages, matches, and world events."}
        </p>
      </div>
      <button
        onClick={() => (enabled ? disable() : enable())}
        disabled={busy || status === "unknown"}
        role="switch"
        aria-checked={enabled}
        aria-label="Toggle push notifications"
        className={cn(
          "shrink-0 flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ease-premium",
          enabled
            ? "border-gold-500/50 text-gold-400 hover:border-gold-400"
            : "border-border-hairline text-text-secondary hover:text-text-primary"
        )}
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : enabled ? (
          <BellRing className="h-3.5 w-3.5" />
        ) : (
          <Bell className="h-3.5 w-3.5" />
        )}
        {enabled ? "On" : "Off"}
      </button>
    </div>
  );
}
