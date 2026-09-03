"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import {
  fetchKeywordWatchlist,
  addKeyword,
  toggleKeyword,
  deleteKeyword,
  type KeywordWatchlistEntry,
} from "@/lib/frontend/admin-safety";
import { cn } from "@/lib/utils";

export function KeywordWatchlistManager() {
  const [entries, setEntries] = useState<KeywordWatchlistEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [isRegex, setIsRegex] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    fetchKeywordWatchlist()
      .then(setEntries)
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!keyword.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addKeyword({ keyword, isRegex });
      setKeyword("");
      setIsRegex(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add keyword");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggle(entry: KeywordWatchlistEntry) {
    setEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, active: !e.active } : e))
    );
    await toggleKeyword(entry.id, !entry.active).catch(load);
  }

  async function remove(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await deleteKeyword(id).catch(load);
  }

  return (
    <div>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2 mb-5">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="Add a keyword or regex…"
          className="flex-1 min-w-[200px] h-10 px-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary placeholder:text-text-tertiary focus:border-gold-500/60 outline-none"
        />
        <label className="flex items-center gap-1.5 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={isRegex}
            onChange={(e) => setIsRegex(e.target.checked)}
            className="accent-gold-500"
          />
          Regex
        </label>
        <Button type="submit" variant="primary" size="sm" disabled={submitting}>
          {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add
        </Button>
      </form>
      {error && <p className="text-sm text-danger mb-4">{error}</p>}

      {isLoading ? (
        <p className="text-text-secondary text-sm">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-text-tertiary text-sm py-6 text-center border border-border-hairline rounded-md">
          No keywords watched yet.
        </p>
      ) : (
        <RevealGroup className="space-y-2">
          {entries.map((entry) => (
            <RevealItem key={entry.id}>
              <Card interactive={false} className="p-3 flex items-center gap-3">
                <button
                  onClick={() => toggle(entry)}
                  className={cn(
                    "h-5 w-9 rounded-full relative transition-colors ease-premium shrink-0",
                    entry.active ? "bg-gold-500" : "bg-white/10"
                  )}
                  aria-label={entry.active ? "Deactivate" : "Activate"}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-base transition-transform ease-premium",
                      entry.active ? "translate-x-4" : "translate-x-0.5"
                    )}
                  />
                </button>
                <span className="text-sm text-text-primary font-mono flex-1 truncate">
                  {entry.keyword}
                </span>
                {entry.is_regex && (
                  <span className="text-[10px] uppercase text-gold-500 font-bold shrink-0">
                    Regex
                  </span>
                )}
                <button
                  onClick={() => remove(entry.id)}
                  aria-label="Delete keyword"
                  className="h-7 w-7 flex items-center justify-center rounded-xs text-text-tertiary hover:text-danger hover:bg-danger/10 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>
      )}
    </div>
  );
}
