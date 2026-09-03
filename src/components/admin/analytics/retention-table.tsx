import { format, parseISO } from "date-fns";
import type { RetentionCohort } from "@/lib/admin/analytics";
import { cn } from "@/lib/utils";

/** Gold-tinted cell background scaled by retention %, so the shape of drop-off reads at a glance. */
function cellClass(pct: number | null): string {
  if (pct === null) return "text-text-tertiary";
  if (pct >= 50) return "bg-gold-500/25 text-text-primary";
  if (pct >= 25) return "bg-gold-500/14 text-text-primary";
  if (pct >= 10) return "bg-gold-500/[0.07] text-text-secondary";
  return "text-text-tertiary";
}

export function RetentionTable({ cohorts }: { cohorts: RetentionCohort[] }) {
  if (cohorts.length === 0) {
    return <p className="text-xs text-text-tertiary py-6 text-center">No cohorts in this window yet.</p>;
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-xs min-w-[420px]">
        <thead>
          <tr className="text-text-tertiary text-left">
            <th className="font-normal pb-2 px-1">Cohort week</th>
            <th className="font-normal pb-2 px-1 text-right">Size</th>
            <th className="font-normal pb-2 px-1 text-right">Week 0</th>
            <th className="font-normal pb-2 px-1 text-right">Week 1</th>
            <th className="font-normal pb-2 px-1 text-right">Week 2</th>
            <th className="font-normal pb-2 px-1 text-right">Week 3</th>
          </tr>
        </thead>
        <tbody>
          {cohorts.map((c) => (
            <tr key={c.cohort_week} className="border-t border-border-hairline">
              <td className="py-2 px-1 text-text-secondary whitespace-nowrap">
                {format(parseISO(c.cohort_week), "MMM d")}
              </td>
              <td className="py-2 px-1 text-right tabular-nums text-text-secondary">{c.cohort_size}</td>
              {[c.week_0, c.week_1, c.week_2, c.week_3].map((pct, i) => (
                <td key={i} className={cn("py-2 px-1 text-right tabular-nums rounded-xs", cellClass(pct))}>
                  {pct !== null && pct !== undefined ? `${pct}%` : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
