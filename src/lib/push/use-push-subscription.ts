"use client";

/**
 * usePushSubscription
 *
 * Client-side state machine for browser push notifications: reports
 * whether the platform supports it, whether the user has already granted
 * permission and holds an active subscription, and exposes enable/disable
 * actions that talk to /api/push/subscribe and /api/push/unsubscribe.
 *
 * Deliberately has no opinion on UI — see push-opt-in.tsx for the surfaced
 * toggle. Kept separate so the same state can be driven from Settings and
 * from a first-run prompt without duplicating the subscribe logic.
 */
import { useCallback, useEffect, useState } from "react";
import { clientLogger } from "@/lib/logger.client";

export type PushStatus =
  | "unsupported"      // no Notification/PushManager API, or no VAPID key configured
  | "unknown"          // still checking
  | "denied"           // user (or a prior prompt) permanently declined at the OS/browser level
  | "disabled"         // supported, permission not yet granted / subscription not active
  | "enabled";         // active subscription on this device

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export function usePushSubscription() {
  const [status, setStatus] = useState<PushStatus>("unknown");
  const [busy, setBusy] = useState(false);

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !vapidKey) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "enabled" : "disabled");
    } catch {
      setStatus("disabled");
    }
  }, [vapidKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!vapidKey) return false;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "disabled");
        return false;
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        });
      }

      const json = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
          userAgent: navigator.userAgent,
        }),
      });
      if (!res.ok) throw new Error(`subscribe endpoint returned ${res.status}`);

      setStatus("enabled");
      return true;
    } catch (err) {
      clientLogger.warn("push: enable failed", { error: err instanceof Error ? err.message : String(err) });
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }, [vapidKey, refresh]);

  const disable = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint }),
        }).catch(() => undefined); // best-effort — local unsubscribe already succeeded
      }
      setStatus("disabled");
      return true;
    } catch (err) {
      clientLogger.warn("push: disable failed", { error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, enable, disable, refresh };
}
