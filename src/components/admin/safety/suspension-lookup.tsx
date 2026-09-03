"use client";

import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LiveDot } from "@/components/admin/motion/live-dot";
import { checkSuspension, liftSuspension } from "@/lib/frontend/admin-safety";

export function SuspensionLookup() {
  const [userId, setUserId] = useState("");
  const [result, setResult] = useState<{ userId: string; suspended: boolean } | null>(null);
  const [checking, setChecking] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim()) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const suspended = await checkSuspension(userId.trim());
      setResult({ userId: userId.trim(), suspended });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      setChecking(false);
    }
  }

  async function lift() {
    if (!result) return;
    setLifting(true);
    try {
      await liftSuspension(result.userId);
      setResult({ ...result, suspended: false });
    } finally {
      setLifting(false);
    }
  }

  return (
    <Card interactive={false} className="p-5 max-w-lg">
      <p className="text-sm font-medium text-text-primary mb-3">
        Check a user&apos;s suspension status
      </p>
      <form onSubmit={check} className="flex gap-2 mb-4">
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="User UUID"
          className="flex-1 h-10 px-3 rounded-sm bg-base border border-border-hairline text-sm text-text-primary font-mono placeholder:text-text-tertiary placeholder:font-sans focus:border-gold-500/60 outline-none"
        />
        <Button type="submit" variant="secondary" size="sm" disabled={checking}>
          {checking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
        </Button>
      </form>

      {error && <p className="text-sm text-danger">{error}</p>}

      {result && (
        <div className="flex items-center justify-between gap-3 border-t border-border-hairline pt-4">
          <div className="flex items-center gap-2">
            <LiveDot status={result.suspended ? "critical" : "healthy"} />
            <span className="text-sm text-text-primary">
              {result.suspended ? "Currently suspended" : "Not suspended"}
            </span>
          </div>
          {result.suspended && (
            <Button size="sm" variant="destructive" onClick={lift} disabled={lifting}>
              {lifting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Lift Suspension
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
