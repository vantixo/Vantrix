"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { SubscriptionInfo } from "@/lib/frontend/profile";

/**
 * PROFILE GAP FIX — the Premium page only ever pointed forward (start a
 * checkout); there was no "manage what I already have" surface anywhere,
 * even though both provider-specific self-serve routes already exist and
 * both their own file headers explain why that gap is costly (Stripe/
 * Paystack chargeback risk from users who can't find a cancel button).
 * This is that surface — provider-branching UI over the two existing
 * routes rather than a new one, since NOWPayments (crypto) has no
 * self-serve equivalent per §11's route map and falls back to a support
 * pointer instead of a dead button.
 */
export function SubscriptionManagement({ subscription }: { subscription: SubscriptionInfo }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isCancelled = subscription.status === "cancelled" || subscription.status === "canceled";

  async function manageStripe() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnUrl: `${window.location.origin}/profile/settings` }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) {
        setError(body.hint ?? body.error ?? "Couldn't open the billing portal.");
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Couldn't open the billing portal. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const [paddleUrls, setPaddleUrls] = useState<{ manageUrl: string | null; cancelUrl: string | null } | null>(null);

  // Paddle has no single bundled "portal session" like Stripe — it exposes
  // update-payment-method and cancel as two separate hosted deep links
  // (management_urls) per subscription. One fetch resolves both so the
  // buttons below don't each trigger their own round trip.
  async function loadPaddleUrls(): Promise<{ manageUrl: string | null; cancelUrl: string | null } | null> {
    if (paddleUrls) return paddleUrls;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/paddle/manage", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.hint ?? body.error ?? "Couldn't load billing management.");
        return null;
      }
      setPaddleUrls(body);
      return body;
    } catch {
      setError("Couldn't load billing management. Try again.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function managePaddle() {
    const urls = await loadPaddleUrls();
    if (urls?.manageUrl) window.location.href = urls.manageUrl;
  }

  async function cancelPaddle() {
    const urls = await loadPaddleUrls();
    // Paddle's own hosted cancel page handles the "are you sure?"
    // confirmation and end-of-period messaging — no window.confirm() here,
    // unlike cancelPaystack()'s in-app confirm, since that flow calls the
    // Cancel API directly rather than handing off to a Paddle-hosted page.
    if (urls?.cancelUrl) window.location.href = urls.cancelUrl;
  }

  async function cancelPaystack() {
    if (
      !window.confirm(
        "Cancel your subscription? You'll keep access until the end of the current billing period."
      )
    ) {
      return;
    }
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/billing/paystack/cancel", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.hint ?? body.error ?? "Couldn't cancel your subscription.");
        return;
      }
      setMessage(body.message ?? "Cancellation requested.");
    } catch {
      setError("Couldn't cancel your subscription. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (subscription.tier === "free" && !subscription.provider) {
    return (
      <div className="rounded-sm border border-border-hairline px-4 py-3.5">
        <div className="text-sm text-text-primary font-medium">Free plan</div>
        <p className="text-xs text-text-secondary mt-0.5">
          Upgrade any time from{" "}
          <Link href="/premium" className="text-gold-400 hover:text-gold-300 font-semibold">
            Premium
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-border-hairline px-4 py-3.5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-text-primary font-medium capitalize">
            {subscription.tier} plan
          </div>
          {subscription.expiresAt && (
            <p className="text-xs text-text-secondary mt-0.5">
              {isCancelled ? "Access ends" : "Renews"} {formatDate(subscription.expiresAt)}
            </p>
          )}
        </div>
        {subscription.status && (
          <span className="text-xs text-gold-400 uppercase tracking-wide font-semibold shrink-0">
            {subscription.status}
          </span>
        )}
      </div>

      {subscription.provider === "stripe" && !isCancelled && (
        <Button variant="secondary" size="sm" onClick={manageStripe} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Manage billing"}
        </Button>
      )}

      {subscription.provider === "paystack" && !isCancelled && (
        <Button variant="secondary" size="sm" onClick={cancelPaystack} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cancel subscription"}
        </Button>
      )}

      {subscription.provider === "paddle" && !isCancelled && (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={managePaddle} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Manage billing"}
          </Button>
          <Button variant="ghost" size="sm" onClick={cancelPaddle} disabled={loading}>
            Cancel subscription
          </Button>
        </div>
      )}

      {subscription.provider === "nowpayments" && (
        <p className="text-xs text-text-secondary">
          Paid by crypto — contact support to manage or cancel this subscription.
        </p>
      )}

      {isCancelled && (
        <p className="text-xs text-text-secondary">
          This subscription is cancelled and won&rsquo;t renew.
        </p>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
      {message && <p className="text-xs text-gold-400">{message}</p>}
    </div>
  );
}
