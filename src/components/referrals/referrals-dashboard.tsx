"use client";

import { useEffect, useState } from "react";
import { Loader2, Copy, Check, Coins, Users, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EmbedAssetsPanel } from "@/components/referrals/embed-assets-panel";

const inputClass =
  "w-full h-11 rounded-sm bg-base border border-interactive px-4 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60";

interface ReferralMe {
  class: "user" | "dev" | "influencer";
  status: string;
  code: string;
  referralLink: string;
  stats: {
    totalClicks: number;
    totalConversions: number;
    totalTokensEarned: number;
    commissionPendingNgn: number;
    commissionPayableNgn: number;
    commissionPaidNgn: number;
  };
}

const ngn = (n: number) => `₦${n.toLocaleString()}`;

export function ReferralsDashboard() {
  const [data, setData] = useState<ReferralMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/referrals/me")
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Couldn't load your referral dashboard.");
        setData(body);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Something went wrong."))
      .finally(() => setLoading(false));
  }, []);

  async function copyLink() {
    if (!data) return;
    await navigator.clipboard.writeText(data.referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-text-secondary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-center text-text-secondary py-16">
        {error ?? "Couldn't load your referral dashboard."}
      </p>
    );
  }

  const isCashClass = data.class !== "user";
  const isPendingApplication = isCashClass && data.status === "pending_review";
  const isApprovedCash = isCashClass && data.status === "active";

  return (
    <div className="space-y-8">
      {/* Referral link */}
      <div className="rounded-md border border-border-hairline p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wide text-text-secondary">
            Your referral link
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-gold-400">
            {data.class} tier
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={data.referralLink}
            className={cn(inputClass, "font-mono text-[13px] text-text-secondary")}
          />
          <Button variant="secondary" size="md" onClick={copyLink} className="shrink-0">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        {data.class === "user" && (
          <p className="text-xs text-text-tertiary mt-3">
            Every referred friend earns you a one-time Vantrix Coin bonus once they convert. Want cash
            commissions instead? Apply for the dev or influencer tier below.
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Clicks" value={data.stats.totalClicks.toLocaleString()} />
        <StatCard
          icon={TrendingUp}
          label="Conversions"
          value={data.stats.totalConversions.toLocaleString()}
        />
        {isCashClass ? (
          <>
            <StatCard
              icon={Coins}
              label="Payable"
              value={ngn(data.stats.commissionPayableNgn)}
            />
            <StatCard icon={Coins} label="Paid out" value={ngn(data.stats.commissionPaidNgn)} />
          </>
        ) : (
          <StatCard
            icon={Coins}
            label="Tokens earned"
            value={data.stats.totalTokensEarned.toLocaleString()}
          />
        )}
      </div>

      {isCashClass && (
        <div className="rounded-md border border-border-hairline p-5">
          <div className="text-sm text-text-secondary mb-1">Pending commission</div>
          <div className="text-2xl font-display text-text-primary tabular-nums">
            {ngn(data.stats.commissionPendingNgn)}
          </div>
          <p className="text-xs text-text-tertiary mt-2">
            Commission clears 14 days after a payment, to protect against refunds. Payouts run
            automatically once your payable balance passes the minimum threshold.
          </p>
        </div>
      )}

      {/* Application / status */}
      {!isCashClass && <ApplicationForm />}
      {isPendingApplication && (
        <div className="rounded-md border border-border-hairline p-5 text-sm text-text-secondary">
          Your application is under review. We&apos;ll notify you once it&apos;s approved.
        </div>
      )}
      {isApprovedCash && <BankDetailsForm />}
      {isApprovedCash && <EmbedAssetsPanel code={data.code} />}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-border-hairline p-4">
      <Icon className="h-4 w-4 text-gold-400 mb-2" />
      <div className="text-lg font-display text-text-primary tabular-nums">{value}</div>
      <div className="text-xs text-text-secondary mt-0.5">{label}</div>
    </div>
  );
}

function ApplicationForm() {
  const [open, setOpen] = useState(false);
  const [requestedClass, setRequestedClass] = useState<"dev" | "influencer">("dev");
  const [applicationNote, setApplicationNote] = useState("");
  const [socialProofUrl, setSocialProofUrl] = useState("");
  const [followerCount, setFollowerCount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/referrals/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedClass,
          applicationNote,
          socialProofUrl,
          followerCount: followerCount ? Number(followerCount) : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't submit your application.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Couldn't submit your application. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-md border border-border-hairline p-5 text-sm text-text-secondary">
        Application submitted — we&apos;ll review it and notify you once it&apos;s approved.
      </div>
    );
  }

  if (!open) {
    return (
      <div className="rounded-md border border-border-hairline p-5">
        <div className="text-sm font-medium text-text-primary mb-1">Want cash commissions?</div>
        <p className="text-xs text-text-secondary mb-4">
          Apply for the dev or influencer tier to earn cash instead of Vantrix Coin. Both require
          manual review — influencer requires at least 5,000 followers.
        </p>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Apply now
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-border-hairline p-5 space-y-4">
      <div className="text-sm font-medium text-text-primary">Apply for a cash-commission tier</div>

      <div className="flex gap-2">
        {(["dev", "influencer"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setRequestedClass(c)}
            className={cn(
              "flex-1 h-10 rounded-sm border text-sm font-medium capitalize transition-colors ease-premium",
              requestedClass === c
                ? "border-gold-500 text-gold-400 bg-gold-500/5"
                : "border-border-hairline text-text-secondary hover:text-text-primary"
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {requestedClass === "influencer" && (
        <div>
          <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
            Follower count
          </label>
          <input
            type="number"
            min={0}
            required
            value={followerCount}
            onChange={(e) => setFollowerCount(e.target.value)}
            className={inputClass}
            placeholder="5000"
          />
        </div>
      )}

      <div>
        <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
          Social / portfolio link
        </label>
        <input
          type="url"
          required
          value={socialProofUrl}
          onChange={(e) => setSocialProofUrl(e.target.value)}
          className={inputClass}
          placeholder="https://"
        />
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
          Tell us why you&apos;re a good fit
        </label>
        <textarea
          required
          minLength={20}
          maxLength={2000}
          rows={3}
          value={applicationNote}
          onChange={(e) => setApplicationNote(e.target.value)}
          className="w-full rounded-sm bg-base border border-interactive px-4 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-gold-500/60 resize-none"
        />
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit application"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface Bank {
  code: string;
  name: string;
}

function BankDetailsForm() {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/referrals/verify-bank")
      .then((res) => res.json())
      .then((body) => setBanks(body.banks ?? []))
      .catch(() => {});
  }, []);

  async function resolve() {
    if (accountNumber.length !== 10 || !bankCode) return;
    setResolving(true);
    setError(null);
    setResolvedName(null);
    try {
      const res = await fetch("/api/referrals/verify-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber, bankCode }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't verify that account.");
        return;
      }
      setResolvedName(body.accountName);
    } catch {
      setError("Couldn't verify that account.");
    } finally {
      setResolving(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/referrals/bank-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountNumber, bankCode }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't save your bank details.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Couldn't save your bank details.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border-hairline p-5 space-y-4">
      <div className="text-sm font-medium text-text-primary">Payout bank account</div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
          Bank
        </label>
        <select
          value={bankCode}
          onChange={(e) => {
            setBankCode(e.target.value);
            setResolvedName(null);
          }}
          className={cn(inputClass)}
        >
          <option value="">Select a bank</option>
          {banks.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
          Account number
        </label>
        <div className="flex items-center gap-2">
          <input
            value={accountNumber}
            onChange={(e) => {
              setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10));
              setResolvedName(null);
            }}
            maxLength={10}
            className={inputClass}
            placeholder="10-digit NUBAN"
          />
          <Button
            type="button"
            variant="secondary"
            size="md"
            disabled={resolving || accountNumber.length !== 10 || !bankCode}
            onClick={resolve}
            className="shrink-0"
          >
            {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
          </Button>
        </div>
      </div>

      {resolvedName && (
        <p className="text-sm text-gold-400">
          Is this you? <span className="font-semibold">{resolvedName}</span>
        </p>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={saving || !resolvedName} onClick={save}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save bank details"}
        </Button>
        {saved && !saving && (
          <span className="flex items-center gap-1 text-sm text-gold-400">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
