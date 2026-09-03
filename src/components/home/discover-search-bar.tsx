"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";

/**
 * Reference-image parity pass: the screenshot's hero leads with a large
 * "Who do you want to meet today?" search field before any card row.
 * FRONTEND_DIRECTIVE §3.1 didn't call this out explicitly, so it never
 * shipped — added here rather than folded into Hero so it can sit above
 * the fold on both layouts without disturbing Hero's existing desktop
 * grid / mobile carousel split (kept intact per prior documented intent).
 * Submits to /characters?q= — the existing search-backed browse route
 * (use-character-search.ts) rather than introducing a new endpoint.
 */
export function DiscoverSearchBar() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = value.trim();
    router.push(q ? `/characters?q=${encodeURIComponent(q)}` : "/characters");
  }

  return (
    <form
      onSubmit={onSubmit}
      className="flex items-center gap-2 w-full rounded-md border border-border-hairline bg-black/40 px-4 py-3 mt-5 focus-within:border-gold-500/50 transition-colors ease-premium"
    >
      <Search className="h-4 w-4 text-text-tertiary shrink-0" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search by name, personality, scenario..."
        className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
      />
      <button
        type="button"
        aria-label="Filters"
        className="shrink-0 text-text-tertiary hover:text-gold-400 transition-colors ease-premium"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </button>
    </form>
  );
}
