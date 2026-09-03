import { Users, Sparkles, MessageSquare, Megaphone, ShieldAlert, UserCheck } from "lucide-react";
import { getAdminOverview } from "@/lib/frontend/admin";
import { AdminStatCard } from "@/components/admin/admin-stat-card";
import { OpsHealthPanel } from "@/components/admin/ops-health-panel";
import { RecentUsersTable } from "@/components/admin/recent-users-table";
import { RevealGroup } from "@/components/admin/motion/reveal";

export default async function AdminOverviewPage() {
  const { stats, ops, recentUsers } = await getAdminOverview();

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-16">
      <div>
        <h2 className="font-display text-2xl mb-1">Overview</h2>
        <p className="text-text-secondary text-sm">
          Platform health and activity, live.
        </p>
      </div>

      <RevealGroup className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <AdminStatCard icon={Users} label="Users" value={stats.users} />
        <AdminStatCard icon={Sparkles} label="Characters" value={stats.characters} />
        <AdminStatCard icon={MessageSquare} label="Conversations" value={stats.conversations} />
        <AdminStatCard icon={Megaphone} label="Active Ads" value={stats.ads} />
        <AdminStatCard
          icon={UserCheck}
          label="Pending Review"
          value={stats.pendingCharacters}
          accent={stats.pendingCharacters > 0}
          href="/admin/characters"
        />
        <AdminStatCard
          icon={ShieldAlert}
          label="Safety Queue"
          value={stats.pendingSafetyReviews}
          accent={stats.pendingSafetyReviews > 0}
          href="/admin/safety"
        />
      </RevealGroup>

      <section>
        <h3 className="font-display text-xl mb-4">System Health</h3>
        <OpsHealthPanel ops={ops} />
      </section>

      <section>
        <h3 className="font-display text-xl mb-4">Recent Signups</h3>
        <RecentUsersTable users={recentUsers} />
      </section>
    </div>
  );
}
