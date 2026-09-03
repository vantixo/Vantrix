"use client";

import { useRouter, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const RANGES = [
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;

/**
 * Changing the range is a real data change (every RPC re-runs with a
 * different p_days), so this navigates rather than holding client state —
 * per FRONTEND_DIRECTIVE §10, the Server Component re-fetches directly
 * rather than the client re-requesting its own route.
 */
export function RangeSelector({ current }: { current: number }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 rounded-xs border border-border-hairline p-0.5">
      {RANGES.map((r) => (
        <button
          key={r.days}
          onClick={() => router.push(`${pathname}?days=${r.days}`)}
          className={cn(
            "px-2.5 py-1 text-xs font-medium rounded-[4px] transition-colors ease-premium duration-150",
            current === r.days
              ? "bg-white/[0.08] text-gold-400"
              : "text-text-tertiary hover:text-text-secondary"
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
