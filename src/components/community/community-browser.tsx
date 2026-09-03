"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { FilterPillGroup } from "@/components/ui/filter-pills";
import { CommunityRowCard } from "./community-row-card";
import { cn } from "@/lib/utils";
import type { Community } from "@/types/community";

const TYPE_FILTERS = [
  { value: "all", label: "All" },
  { value: "general", label: "General" },
  { value: "creator", label: "Creator Hub" },
];

/**
 * Filters client-side against the single list already fetched server-side
 * (community/list caps at 80 rows with revalidate=60 — small and cheap
 * enough to not need a debounced server round-trip per keystroke).
 */
export function CommunityBrowser({ initial }: { initial: Community[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initial.filter((c) => {
      if (type !== "all" && c.type !== type) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [initial, query, type]);

  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search communities"
          className={cn(
            "w-full h-11 rounded-sm bg-base border border-interactive pl-10 pr-4 text-sm",
            "text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60"
          )}
        />
      </div>

      <FilterPillGroup
        options={TYPE_FILTERS}
        value={type}
        onChange={setType}
        className="mb-4"
      />

      {filtered.length === 0 ? (
        <p className="text-sm text-text-tertiary py-12 text-center">
          No communities match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-2.5">
          {filtered.map((c) => (
            <CommunityRowCard key={c.slug} community={c} />
          ))}
        </div>
      )}
    </div>
  );
}
