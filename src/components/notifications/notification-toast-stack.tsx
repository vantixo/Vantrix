"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useNotificationStore } from "@/lib/notifications/store";
import { getNotificationIcon, getNotificationIconClass } from "./notification-icon";
import { cn } from "@/lib/utils";

const AUTO_DISMISS_MS = 6000;

/**
 * App-wide equivalent of milestone-toast.tsx (chat.tsx keeps that one
 * as-is — it's a richer in-chat celebration card, not a generic toast,
 * see its own header). This one fires for anything in the notification
 * store's live toast queue — i.e. anything realtime just delivered while
 * the tab was open — regardless of which page the user is currently on,
 * so a gift, match, or reply doesn't go unnoticed until the next time
 * they happen to open the bell.
 *
 * Mounted once in NotificationCenterProvider (shell layout level).
 */
export function NotificationToastStack() {
  const toasts = useNotificationStore((s) => s.toasts);
  const dismissToast = useNotificationStore((s) => s.dismissToast);

  // Store caps this at insertion time (see store.ts) — every entry here
  // is rendered, so every toast reliably gets its own dismiss timer.
  return (
    <div className="pointer-events-none fixed top-16 right-3 z-50 flex flex-col gap-2 w-[calc(100vw-24px)] max-w-sm md:top-20 md:right-6">
      {toasts.map((t) => (
        <Toast key={t.toastId} toastId={t.toastId} type={t.type} title={t.title} body={t.body} ctaUrl={t.cta_url} onDismiss={dismissToast} />
      ))}
    </div>
  );
}

function Toast({
  toastId,
  type,
  title,
  body,
  ctaUrl,
  onDismiss,
}: {
  toastId: string;
  type: string;
  title: string;
  body: string | null;
  ctaUrl: string | null;
  onDismiss: (toastId: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toastId), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toastId, onDismiss]);

  const Icon = getNotificationIcon(type);
  const content = (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-md border border-border-hairline bg-base/95 px-3.5 py-3 shadow-card backdrop-blur animate-slide-in-top"
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", getNotificationIconClass(type, true))} strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-text-primary font-medium">{title}</div>
        {body && <div className="text-xs text-text-secondary mt-0.5 line-clamp-2">{body}</div>}
      </div>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDismiss(toastId);
        }}
        aria-label="Dismiss"
        className="shrink-0 text-text-tertiary hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return ctaUrl ? (
    <Link href={ctaUrl} onClick={() => onDismiss(toastId)}>
      {content}
    </Link>
  ) : (
    content
  );
}
