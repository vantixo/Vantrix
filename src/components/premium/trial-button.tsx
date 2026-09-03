"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PREMIUM_TRIAL_DAYS } from "@/lib/tiers/limits";

/**
 * Starts the {PREMIUM_TRIAL_DAYS}-day Premium free trial via POST /api/payments/stripe/trial
 * (see that route for the fail-closed NSFW gate + trial_used check —
 * this component surfaces its error codes but enforces nothing itself,
 * same division of labor as CheckoutButton).
 */
export function TrialButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payments/stripe/trial", { method: "POST" });
      const body = await res.json();
      if (!res.ok || !body.url) {
        if (body.code === "CARD_PAYMENT_NOT_ALLOWED") {
          setError("Card payments aren't available on this account — the free trial requires a card on file.");
        } else if (body.code === "TRIAL_ALREADY_USED") {
          setError("You've already used your free trial on this account.");
        } else {
          setError(body.error ?? "Couldn't start your trial. Try again.");
        }
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Couldn't start your trial. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={className}>
      <Button variant="primary" size="lg" onClick={start} disabled={loading} className="w-full">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-1.5" />
            Start your {PREMIUM_TRIAL_DAYS}-day free trial
          </>
        )}
      </Button>
      {error && <p className="text-xs text-danger mt-1.5 text-center">{error}</p>}
    </div>
  );
}
