"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { format, parseISO } from "date-fns";

/**
 * One series in a TrendChart. `variant` controls how it reads visually —
 * per FRONTEND_DIRECTIVE §1, gold is a meaning color reserved for the one
 * thing that matters most on a given chart, so at most one series per
 * chart should be "primary". Everything else renders as a thin neutral
 * line so it reads as context, not competition.
 */
export interface TrendSeries {
  key: string;
  label: string;
  variant?: "primary" | "muted" | "danger";
  /** Render as a dashed line instead of solid — for a secondary/context series. */
  dashed?: boolean;
}

const VARIANT_STROKE: Record<NonNullable<TrendSeries["variant"]>, string> = {
  primary: "rgb(var(--gold-500))",
  muted: "#808080",
  danger: "#E5484D",
};

function CustomTooltip({
  active,
  payload,
  label,
  series,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number }[];
  label?: string;
  series: TrendSeries[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xs border border-border-hairline bg-base px-3 py-2 shadow-card">
      <p className="text-[11px] text-text-tertiary mb-1">
        {label ? format(parseISO(label), "MMM d, yyyy") : ""}
      </p>
      {series.map((s) => {
        const point = payload.find((p) => p.dataKey === s.key);
        if (!point) return null;
        const variant = s.variant ?? "muted";
        return (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span
              className="h-1.5 w-1.5 rounded-full shrink-0"
              style={{ background: VARIANT_STROKE[variant] }}
            />
            <span className="text-text-secondary">{s.label}</span>
            <span className="text-text-primary tabular-nums ml-auto pl-3">
              {point.value.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Generic time-series chart: the primary series (if any) renders as a
 * gold line with a soft low-opacity gradient fill beneath it — a
 * conventional charting device, not a "large decorative fill" (the area
 * under a thin line is the data, not chrome). Muted/danger series render
 * as plain lines with no fill, so they read as context around the one
 * number gold is marking as meaningful.
 */
export function TrendChart({
  data,
  series,
  height = 220,
  xKey = "day",
}: {
  data: Record<string, string | number>[];
  series: TrendSeries[];
  height?: number;
  xKey?: string;
}) {
  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-text-tertiary"
        style={{ height }}
      >
        No data in this window yet.
      </div>
    );
  }

  // Thin out x-axis ticks on longer ranges so labels don't collide.
  const tickInterval = data.length > 45 ? Math.ceil(data.length / 8) : Math.ceil(data.length / 10);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="trendGoldFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--gold-500))" stopOpacity={0.22} />
            <stop offset="100%" stopColor="rgb(var(--gold-500))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis
          dataKey={xKey}
          tickFormatter={(v: string) => format(parseISO(v), "MMM d")}
          interval={tickInterval}
          tick={{ fill: "#808080", fontSize: 11 }}
          axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "#808080", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={36}
          allowDecimals={false}
        />
        <Tooltip content={<CustomTooltip series={series} />} cursor={{ stroke: "rgba(255,255,255,0.12)" }} />
        {series.map((s) => {
          const variant = s.variant ?? "muted";
          const stroke = VARIANT_STROKE[variant];
          if (variant === "primary") {
            return (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={stroke}
                strokeWidth={2}
                fill="url(#trendGoldFill)"
                dot={false}
                activeDot={{ r: 3.5, fill: stroke, strokeWidth: 0 }}
              />
            );
          }
          return (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={stroke}
              strokeWidth={1.5}
              strokeDasharray={s.dashed ? "3 3" : undefined}
              dot={false}
              activeDot={{ r: 3, fill: stroke, strokeWidth: 0 }}
              fillOpacity={0}
            />
          );
        })}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
