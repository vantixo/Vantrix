import { cn } from "@/lib/utils";

/**
 * §9.4 resolved: fully gold-monochrome. No secondary accent color for
 * badges/likes — the directive's "no mixed accent colors" rule (§1)
 * applies to these by default; a chart-only accent would be a separate,
 * explicit decision later, not a default extended here.
 */
export function Badge({
  children,
  variant = "solid",
  className,
}: {
  children: React.ReactNode;
  variant?: "solid" | "outline";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-xs px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase font-sans",
        variant === "solid"
          ? "bg-gold-500 text-[#160F02]"
          : "border border-gold-500/50 text-gold-400 bg-black/40 backdrop-blur-sm",
        className
      )}
    >
      {children}
    </span>
  );
}
