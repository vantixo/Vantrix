"use client";

import { useCallback, useEffect, useState } from "react";
import type { TwinHistoryEntry } from "@/lib/digital-twin/engine";

/**
 * FRONTEND_DIRECTIVE §10 domain hook for digital-twin/*. Standard
 * `{ data, isLoading, error }` read shape — history-panel.tsx no longer
 * owns its own useEffect/fetch, just consumes this and applies optimistic
 * removal (delete/clear) to the returned data via setData, same as any
 * other list component would.
 */
export function useDigitalTwinHistory() {
  const [data, setData] = useState<TwinHistoryEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/digital-twin/history")
      .then((r) => (r.ok ? r.json() : { history: [] }))
      .then((body) => {
        if (!cancelled) setData(body.history ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Couldn't load history.");
          setData([]);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const deleteEntry = useCallback(async (id: string) => {
    setData((prev) => (prev ? prev.filter((e) => e.id !== id) : prev));
    await fetch(`/api/digital-twin/history?id=${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const clearAll = useCallback(async () => {
    setData([]);
    await fetch("/api/digital-twin/history", { method: "DELETE" }).catch(() => {});
  }, []);

  return { data, isLoading, error, deleteEntry, clearAll };
}
