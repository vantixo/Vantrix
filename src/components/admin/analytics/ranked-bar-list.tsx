import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import { cn } from "@/lib/utils";

export interface RankedBarItem {
  key: string;
  label: string;
  value: number;
  /** Optional secondary line under the label (e.g. a second metric). */
  meta?: string;
  href?: string;
}

/**
 * A simple ranked list with proportional bars — the flat, borderless
 * alternative to a recharts bar chart that fits the "no lighter fill
 * surfaces, gold is a meaning color" system (see Card's doc comment):
 * each bar is a thin 6px track, not a filled panel, so it never competes
 * with a real Card as a surface.
 */
export function RankedBarList({
  items,
  format = (n: number) => n.toLocaleString(),
  emptyLabel = "No data yet.",
}: {
  items: RankedBarItem[];
  format?: (n: number) => string;
  emptyLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-text-tertiary py-6 text-center">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <RevealGroup className="space-y-3">
      {items.map((item) => {
        const pct = Math.max((item.value / max) * 100, 2);
        const Wrapper = item.href ? "a" : "div";
        return (
          <RevealItem key={item.key}>
            <Wrapper
              {...(item.href ? { href: item.href } : {})}
              className={cn(
                "block",
                item.href && "hover:opacity-80 transition-opacity ease-premium duration-150"
              )}
            >
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <span className="text-sm text-text-primary truncate">{item.label}</span>
                <span className="text-sm text-text-secondary tabular-nums shrink-0">
                  {format(item.value)}
                </span>
              </div>
              {item.meta && (
                <p className="text-[11px] text-text-tertiary -mt-1 mb-1.5">{item.meta}</p>
              )}
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gold-500/70"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </Wrapper>
          </RevealItem>
        );
      })}
    </RevealGroup>
  );
}
