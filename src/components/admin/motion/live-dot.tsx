import { cn } from "@/lib/utils";

const COLOR: Record<"healthy" | "degraded" | "critical", string> = {
  healthy: "bg-emerald-400",
  degraded: "bg-gold-400",
  critical: "bg-danger",
};

/**
 * A radiating "signal" dot — the visual shorthand for "this number is
 * live," used next to ops status and anything polled in real time.
 * The ping ring uses the status color at low opacity so it reads as a
 * pulse of the dot itself rather than a generic loading spinner.
 */
export function LiveDot({
  status = "healthy",
  className,
}: {
  status?: "healthy" | "degraded" | "critical";
  className?: string;
}) {
  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      <span
        className={cn(
          "absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping",
          COLOR[status]
        )}
      />
      <span
        className={cn("relative inline-flex h-2 w-2 rounded-full", COLOR[status])}
      />
    </span>
  );
}
