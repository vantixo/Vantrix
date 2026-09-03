/**
 * Merges two or more day-keyed series (each already covering the same
 * date range, just from separate RPCs) into one row-per-day array for a
 * multi-series TrendChart. Assumes all inputs share the same `day` values
 * in the same order (true for every admin_*_series RPC — they all
 * generate_series over the same p_days window), but falls back to a
 * lookup join rather than assuming identical array indices, so a gap in
 * one series doesn't silently misalign the rest.
 */
export function mergeSeriesByDay<T extends { day: string }>(
  base: T[],
  ...others: { data: Record<string, unknown>[]; keys: string[] }[]
): Record<string, string | number>[] {
  return base.map((row) => {
    const merged: Record<string, string | number> = { ...row };
    for (const { data, keys } of others) {
      const match = data.find((d) => d.day === row.day);
      for (const key of keys) {
        merged[key] = (match?.[key] as number | undefined) ?? 0;
      }
    }
    return merged;
  });
}
