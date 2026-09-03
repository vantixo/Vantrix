import type { LucideIcon } from "lucide-react";

export function StatItem({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center px-4">
      <Icon className="h-5 w-5 text-gold-500" strokeWidth={1.75} />
      <div className="font-display text-2xl md:text-3xl text-text-primary tabular-nums">
        {value}
      </div>
      <div className="text-xs uppercase tracking-wider text-text-secondary">
        {label}
      </div>
    </div>
  );
}
