import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { AnimatedCounter } from "@/components/admin/motion/animated-counter";
import { RevealItem } from "@/components/admin/motion/reveal";
import { Card } from "@/components/ui/card";

export function AdminStatCard({
  icon: Icon,
  label,
  value,
  accent,
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  /** Renders the count in gold instead of white — reserved for numbers
   *  that need attention (pending queues), per §1's "gold means meaning". */
  accent?: boolean;
  href?: string;
}) {
  const content = (
    <Card interactive={Boolean(href)} className="p-5">
      <div className="flex items-center justify-between mb-3">
        <Icon
          className={accent ? "h-4 w-4 text-gold-500" : "h-4 w-4 text-text-tertiary"}
          strokeWidth={1.75}
        />
      </div>
      <div
        className={
          accent
            ? "font-display text-3xl text-gold-400 tabular-nums"
            : "font-display text-3xl text-text-primary tabular-nums"
        }
      >
        <AnimatedCounter value={value} />
      </div>
      <p className="text-xs text-text-secondary mt-1">{label}</p>
    </Card>
  );

  return <RevealItem>{href ? <Link href={href}>{content}</Link> : content}</RevealItem>;
}
