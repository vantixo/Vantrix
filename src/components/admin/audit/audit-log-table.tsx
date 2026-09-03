"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchAuditLog, type AdminAuditLogRow } from "@/lib/frontend/admin-audit";

const TARGET_TYPES = ["user", "character", "content_queue_item", "referral_partner", "moderator_permission"];

export function AuditLogTable() {
  const [entries, setEntries] = useState<AdminAuditLogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetType, setTargetType] = useState<string>("");

  async function load(reset: boolean) {
    if (reset) setLoading(true);
    setError(null);
    try {
      const before = reset ? undefined : entries[entries.length - 1]?.created_at;
      const data = await fetchAuditLog({ targetType: targetType || undefined, before });
      setEntries((prev) => (reset ? data.entries : [...prev, ...data.entries]));
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit log");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetType]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <FilterPill active={targetType === ""} onClick={() => setTargetType("")}>
          All
        </FilterPill>
        {TARGET_TYPES.map((t) => (
          <FilterPill key={t} active={targetType === t} onClick={() => setTargetType(t)}>
            {t.replace(/_/g, " ")}
          </FilterPill>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => load(true)} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {!loading && entries.length === 0 && !error && (
        <p className="text-text-tertiary text-sm py-12 text-center border border-border-hairline rounded-md">
          No audit log entries{targetType ? ` for ${targetType.replace(/_/g, " ")}` : ""}.
        </p>
      )}

      {entries.length > 0 && (
        <Card interactive={false} className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-tertiary text-xs uppercase tracking-wide border-b border-border-hairline">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Admin</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Target</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border-hairline last:border-0 align-top">
                  <td className="px-3 py-2 text-xs text-text-tertiary whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-text-secondary whitespace-nowrap">
                    {e.admin_username ?? e.admin_id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline">{e.action}</Badge>
                  </td>
                  <td className="px-3 py-2 text-text-primary">
                    <span className="text-text-tertiary">{e.target_type}</span>
                    <br />
                    <span className="text-xs">{e.target_label ?? e.target_id.slice(0, 8)}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-tertiary max-w-xs truncate font-mono">
                    {Object.keys(e.metadata ?? {}).length > 0 ? JSON.stringify(e.metadata) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="secondary"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              load(false);
            }}
          >
            {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "h-8 px-3 rounded-full text-xs font-medium capitalize transition-colors ease-premium " +
        (active
          ? "bg-gold-500 text-[#160F02]"
          : "border border-border-hairline text-text-secondary hover:text-text-primary hover:border-gold-500/40")
      }
    >
      {children}
    </button>
  );
}
