import { formatDistanceToNowStrict } from "date-fns";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import type { RecentUser } from "@/lib/frontend/admin";

export function RecentUsersTable({ users }: { users: RecentUser[] }) {
  return (
    <div className="border border-border-hairline rounded-md overflow-hidden">
      <RevealGroup>
        {users.map((u) => (
          <RevealItem key={u.id}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border-hairline last:border-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary truncate">
                  {u.username ?? u.id.slice(0, 8)}
                </p>
                <p className="text-xs text-text-tertiary">
                  {u.created_at
                    ? formatDistanceToNowStrict(new Date(u.created_at), {
                        addSuffix: true,
                      })
                    : "—"}
                  {u.country ? ` · ${u.country}` : ""}
                </p>
              </div>
              {u.role === "admin" && (
                <span className="text-[10px] uppercase tracking-wide text-gold-500 font-bold shrink-0">
                  Admin
                </span>
              )}
              <span className="text-xs text-text-secondary capitalize shrink-0">
                {u.tier}
              </span>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </div>
  );
}
