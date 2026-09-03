/**
 * Derives a lightweight trend indicator from a single time series by
 * comparing the average of the second half of the window against the
 * first half — e.g. for a 30-day series, the last 15 days vs. the first
 * 15. This avoids needing a second "previous period" RPC call for every
 * metric just to draw a KPI card arrow; it's a within-window trend, not a
 * true period-over-period comparison, and is only precise enough for "up
 * or down at a glance," which is what a KPI card arrow is for.
 *
 * Returns null when there isn't enough data (fewer than 4 points, or the
 * first half averages to zero) rather than a misleading /0 % change.
 */
export function trendFromSeries(values: number[]): number | null {
  if (values.length < 4) return null;

  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const firstAvg = avg(firstHalf);
  const secondAvg = avg(secondHalf);

  if (firstAvg === 0) return secondAvg > 0 ? 100 : null;

  return Math.round(((secondAvg - firstAvg) / firstAvg) * 1000) / 10;
}
