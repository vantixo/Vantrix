import { Users, MessageCircle, Sparkles, ShieldCheck } from "lucide-react";
import { StatItem } from "@/components/ui/stat-item";

/**
 * §3.2 — 4 items, icon + value + label. There is no aggregate "platform
 * stats" endpoint in the API map (§11 lists discovery, character, chat
 * routes, nothing that rolls up global counts), so — same as most
 * companion-app landing strips — this is marketing copy, not a live
 * query. If/when a real aggregate exists it's a one-line swap to fetch
 * it; deliberately not querying `characters`/`conversations` COUNT(*)
 * directly here just to make this section "real," since an unindexed
 * full-table count on every Home render would be a bad trade for a
 * strip that's decorative by nature.
 */
const STATS = [
  { icon: Users, value: "250K+", label: "Active Users" },
  { icon: MessageCircle, value: "18M+", label: "Messages" },
  { icon: Sparkles, value: "1,200+", label: "Companions" },
  { icon: ShieldCheck, value: "100%", label: "Secure & Private" },
];

export function StatsStrip() {
  return (
    <section className="px-4 md:px-8 py-10">
      <div className="max-w-7xl mx-auto flex items-center justify-between md:justify-center md:gap-16 border-y border-border-hairline py-6">
        {STATS.map((s) => (
          <StatItem key={s.label} icon={s.icon} value={s.value} label={s.label} />
        ))}
      </div>
    </section>
  );
}
