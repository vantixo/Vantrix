export interface BgLedgerTask {
  label: string;
  success_count: number;
  fail_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  last_user_id: string | null;
  updated_at: string;
}

export async function fetchBgLedger(): Promise<{
  tasks: BgLedgerTask[];
  totals: { success: number; fail: number };
  ts: string;
}> {
  const res = await fetch("/api/admin/bg-ledger");
  if (!res.ok) throw new Error("Failed to load background task ledger");
  return res.json();
}

export interface CircuitStats {
  circuits: Record<string, { state: string; [key: string]: unknown }>;
  queue: { depths: { high: number; normal: number; low: number }; total: number };
  ts: string;
}

export async function fetchCircuitStats(): Promise<CircuitStats> {
  const res = await fetch("/api/admin/circuit-stats");
  if (!res.ok) throw new Error("Failed to load circuit stats");
  return res.json();
}

export interface BackfillSummary {
  [key: string]: unknown;
}

export async function triggerUniverseImageBackfill(): Promise<BackfillSummary> {
  const res = await fetch("/api/admin/backfill-universe-images", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Backfill failed");
  }
  return res.json();
}

export function waitlistExportUrl(format: "csv" | "json"): string {
  return `/api/admin/waitlist-export?format=${format}`;
}
