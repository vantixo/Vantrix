"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/admin/motion/live-dot";
import { RevealGroup, RevealItem } from "@/components/admin/motion/reveal";
import {
  fetchBgLedger,
  fetchCircuitStats,
  triggerUniverseImageBackfill,
  waitlistExportUrl,
  type BgLedgerTask,
  type CircuitStats,
} from "@/lib/frontend/admin-ops";

/**
 * Surfaces four admin capabilities that had working API routes but no UI
 * at all: the background-task success/fail ledger, a detailed circuit
 * breaker + queue-depth view (the dashboard only shows a summary), the
 * waitlist CSV/JSON export, and the universe-image backfill sweep.
 */
export function OpsConsole() {
  return (
    <div className="space-y-10">
      <CircuitSection />
      <BgLedgerSection />
      <section className="grid sm:grid-cols-2 gap-6">
        <WaitlistExportCard />
        <BackfillCard />
      </section>
    </div>
  );
}

function CircuitSection() {
  const [stats, setStats] = useState<CircuitStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      setStats(await fetchCircuitStats());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-xl">Circuits & Queue</h3>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error && <p className="text-sm text-danger mb-3">{error}</p>}

      {stats && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <Card interactive={false} className="p-4">
              <p className="text-xs uppercase tracking-wide text-text-tertiary mb-1">Queue — High</p>
              <p className="font-display text-2xl tabular-nums">{stats.queue.depths.high}</p>
            </Card>
            <Card interactive={false} className="p-4">
              <p className="text-xs uppercase tracking-wide text-text-tertiary mb-1">Queue — Normal</p>
              <p className="font-display text-2xl tabular-nums">{stats.queue.depths.normal}</p>
            </Card>
            <Card interactive={false} className="p-4">
              <p className="text-xs uppercase tracking-wide text-text-tertiary mb-1">Queue — Low</p>
              <p className="font-display text-2xl tabular-nums">{stats.queue.depths.low}</p>
            </Card>
          </div>

          <RevealGroup className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {Object.entries(stats.circuits).map(([name, c]) => (
              <RevealItem key={name}>
                <div className="flex items-center gap-2.5 rounded-sm border border-border-hairline px-3 py-2.5">
                  <LiveDot
                    status={c.state === "closed" ? "healthy" : c.state === "half-open" ? "degraded" : "critical"}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-text-primary truncate capitalize">{name}</p>
                    <p className="text-[11px] text-text-tertiary capitalize">{String(c.state)}</p>
                  </div>
                </div>
              </RevealItem>
            ))}
          </RevealGroup>
        </div>
      )}
    </section>
  );
}

function BgLedgerSection() {
  const [tasks, setTasks] = useState<BgLedgerTask[]>([]);
  const [totals, setTotals] = useState({ success: 0, fail: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchBgLedger();
      setTasks(data.tasks);
      setTotals(data.totals);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <section>
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display text-xl">Background Task Ledger</h3>
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>
      <p className="text-text-secondary text-sm mb-4">
        Fire-and-forget job success/fail counts, worst-offender first. {totals.success.toLocaleString()} succeeded ·{" "}
        {totals.fail.toLocaleString()} failed overall.
      </p>

      {error && <p className="text-sm text-danger mb-3">{error}</p>}

      {!loading && tasks.length === 0 && !error && (
        <p className="text-text-tertiary text-sm py-8 text-center border border-border-hairline rounded-md">
          No ledger entries yet.
        </p>
      )}

      {tasks.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border-hairline">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-text-tertiary text-xs uppercase tracking-wide border-b border-border-hairline">
                <th className="px-3 py-2 font-medium">Task</th>
                <th className="px-3 py-2 font-medium text-right">Success</th>
                <th className="px-3 py-2 font-medium text-right">Fail</th>
                <th className="px-3 py-2 font-medium">Last failure</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.label} className="border-b border-border-hairline last:border-0">
                  <td className="px-3 py-2 font-mono text-xs text-text-primary">{t.label}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                    {t.success_count.toLocaleString()}
                  </td>
                  <td
                    className={
                      "px-3 py-2 text-right tabular-nums " +
                      (t.fail_count > 0 ? "text-danger font-medium" : "text-text-secondary")
                    }
                  >
                    {t.fail_count.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-text-tertiary max-w-xs truncate">
                    {t.last_error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WaitlistExportCard() {
  return (
    <Card interactive={false} className="p-5">
      <h3 className="font-display text-lg mb-1">Waitlist Export</h3>
      <p className="text-text-secondary text-sm mb-4">Download the full waitlist for outreach or analysis.</p>
      <div className="flex gap-2">
        <Button asChild size="sm" variant="secondary">
          <a href={waitlistExportUrl("csv")} download>
            <Download className="h-3.5 w-3.5" /> CSV
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <a href={waitlistExportUrl("json")} download>
            <Download className="h-3.5 w-3.5" /> JSON
          </a>
        </Button>
      </div>
    </Card>
  );
}

function BackfillCard() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const summary = await triggerUniverseImageBackfill();
      setResult(JSON.stringify(summary));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backfill failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card interactive={false} className="p-5">
      <h3 className="font-display text-lg mb-1">Universe Image Backfill</h3>
      <p className="text-text-secondary text-sm mb-4">
        Generates images for every location/faction/character still missing one. Safe to run repeatedly.
      </p>
      <Button size="sm" variant="secondary" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
        Run backfill
      </Button>
      {error && <p className="text-sm text-danger mt-3">{error}</p>}
      {result && <p className="text-xs text-text-tertiary mt-3 font-mono break-all">{result}</p>}
    </Card>
  );
}
