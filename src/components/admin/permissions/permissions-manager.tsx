"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Shield } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  fetchModeratorPermissions,
  grantPermission,
  revokePermission,
  type AdminPermission,
  type ModeratorPermissionsRow,
} from "@/lib/frontend/admin-permissions";

const PERMISSION_LABELS: Record<AdminPermission, string> = {
  "users.disable": "Disable / re-enable user accounts",
  "users.tokens_adjust": "Adjust user token balances",
  "users.bulk_actions": "Run bulk actions on users",
  "characters.moderate": "Approve / reject characters",
  "content.publish": "Publish / reject generated content",
  "referrals.approve": "Approve / reject referral partner applications",
  "crisis.review": "Review crisis-flagged conversations",
  "abuse.review": "Review abuse-signal queue",
  "reply_guard.review": "Review reply guard queue",
  "reports.review": "Review user-submitted content reports",
  "permissions.manage": "Grant or revoke moderator permissions",
};

export function PermissionsManager() {
  const [moderators, setModerators] = useState<ModeratorPermissionsRow[]>([]);
  const [allPermissions, setAllPermissions] = useState<AdminPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null); // `${moderatorId}:${permission}`

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchModeratorPermissions();
      setModerators(data.moderators);
      setAllPermissions(data.allPermissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load permissions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggle(moderatorId: string, permission: AdminPermission, granted: boolean) {
    const key = `${moderatorId}:${permission}`;
    setPending(key);
    setError(null);
    // Optimistic update
    setModerators((prev) =>
      prev.map((m) =>
        m.moderator_id !== moderatorId
          ? m
          : {
              ...m,
              permissions: granted
                ? m.permissions.filter((p) => p !== permission)
                : [...m.permissions, permission],
            },
      ),
    );
    try {
      if (granted) {
        await revokePermission(moderatorId, permission);
      } else {
        await grantPermission(moderatorId, permission);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
      load(); // revert to server truth on failure
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-tertiary">
          Full admins hold every permission implicitly and aren&apos;t listed here — this table only scopes
          moderator-role accounts.
        </p>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!loading && moderators.length === 0 && !error && (
        <p className="text-text-tertiary text-sm py-12 text-center border border-border-hairline rounded-md">
          No moderator-role accounts yet.
        </p>
      )}

      <div className="space-y-4">
        {moderators.map((mod) => (
          <Card key={mod.moderator_id} interactive={false} className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-4 w-4 text-gold-500" strokeWidth={1.75} />
              <p className="font-medium text-text-primary">
                {mod.display_name || mod.username || mod.moderator_id.slice(0, 8)}
              </p>
              {mod.username && <span className="text-xs text-text-tertiary">@{mod.username}</span>}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              {allPermissions.map((perm) => {
                const granted = mod.permissions.includes(perm);
                const key = `${mod.moderator_id}:${perm}`;
                const busy = pending === key;
                return (
                  <label
                    key={perm}
                    className={
                      "flex items-center gap-2.5 rounded-sm border px-3 py-2.5 text-sm cursor-pointer transition-colors ease-premium " +
                      (granted
                        ? "border-gold-500/40 bg-gold-500/5 text-text-primary"
                        : "border-border-hairline text-text-secondary hover:border-gold-500/25")
                    }
                  >
                    <input
                      type="checkbox"
                      checked={granted}
                      disabled={busy}
                      onChange={() => toggle(mod.moderator_id, perm, granted)}
                      className="accent-gold-500"
                    />
                    {busy ? <Loader2 className="h-3 w-3 animate-spin shrink-0" /> : null}
                    <span className="leading-tight">{PERMISSION_LABELS[perm]}</span>
                  </label>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
