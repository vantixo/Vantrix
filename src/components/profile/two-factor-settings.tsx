"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Smartphone,
  Copy,
  Check,
  Trash2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clientLogger } from "@/lib/logger.client";
import { capture } from "@/lib/analytics/client";

/**
 * Two-factor authentication (TOTP) — Settings > Security.
 *
 * Built directly on Supabase Auth's own `auth.mfa` namespace (enroll /
 * challenge / verify / unenroll / listFactors), the same auth backend
 * every other login/signup flow in this app already goes through. See
 * lib/auth/mfa.ts's header comment for why this isn't a bespoke
 * implementation, and for the recovery-codes scope decision (Supabase
 * doesn't support them — a second enrolled factor is the supported
 * backup path, surfaced below once the first factor is verified).
 *
 * A max of 10 enrolled factors per account is a Supabase project setting
 * (MFA_MAX_ENROLLED_FACTORS), not something this component enforces
 * client-side — hitting it just surfaces Supabase's own error message.
 */

interface Factor {
  id: string;
  friendly_name: string | null;
  status: "verified" | "unverified";
  created_at: string;
}

type Step =
  | { name: "list" }
  | { name: "naming"; suggestedName: string }
  | {
      name: "enrolling";
      factorId: string;
      deviceName: string;
      qrCode: string;
      secret: string;
      code: string;
      error: string | null;
      submitting: boolean;
    };

async function postMfaEvent(event: "enrolled" | "disabled", factorName: string) {
  try {
    await fetch("/api/auth/mfa/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, factorName }),
    });
  } catch (err) {
    // Best-effort — the security_alert notification is a nice-to-have
    // confirmation, not the source of truth for whether MFA changed
    // (Supabase's own auth.mfa_factors row is). Never block the UI on it.
    clientLogger.warn("two-factor-settings: mfa event notify failed", {
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function TwoFactorSettings() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: "list" });
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadFactors() {
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setLoadError(error.message);
      setFactors([]);
      return;
    }
    setLoadError(null);
    setFactors(
      data.totp.map((f) => ({
        id: f.id,
        friendly_name: f.friendly_name ?? null,
        status: f.status,
        created_at: f.created_at,
      }))
    );
  }

  useEffect(() => {
    loadFactors();
  }, []);

  const verifiedCount = factors?.filter((f) => f.status === "verified").length ?? 0;

  function startNaming() {
    setStep({ name: "naming", suggestedName: verifiedCount === 0 ? "Authenticator app" : "Backup device" });
  }

  async function startEnrollment(name: string) {
    const deviceName = name.trim() || "Authenticator app";
    const supabase = createClient();
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: deviceName,
    });
    if (error || !data) {
      setStep({ name: "list" });
      setLoadError(error?.message ?? "Couldn't start enrollment.");
      return;
    }
    setStep({
      name: "enrolling",
      factorId: data.id,
      deviceName,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
      code: "",
      error: null,
      submitting: false,
    });
  }

  async function cancelEnrollment() {
    if (step.name !== "enrolling") return;
    const supabase = createClient();
    // Best-effort cleanup of the unverified factor so it doesn't linger
    // and count against the account's enrollment limit.
    await supabase.auth.mfa.unenroll({ factorId: step.factorId }).catch(() => {});
    setStep({ name: "list" });
    loadFactors();
  }

  async function submitVerification() {
    if (step.name !== "enrolling") return;
    const { factorId, code } = step;
    if (code.trim().length < 6) {
      setStep({ ...step, error: "Enter the 6-digit code from your authenticator app." });
      return;
    }
    setStep({ ...step, submitting: true, error: null });

    const supabase = createClient();
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
    if (challengeError || !challenge) {
      setStep({ ...step, submitting: false, error: challengeError?.message ?? "Couldn't verify — try again." });
      return;
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    });
    if (verifyError) {
      setStep({ ...step, submitting: false, error: verifyError.message });
      return;
    }

    const deviceName = step.deviceName;
    await loadFactors();
    setStep({ name: "list" });
    capture("mfa_enrolled", { factor_type: "totp", total_factors: verifiedCount + 1 });
    postMfaEvent("enrolled", deviceName);
  }

  async function removeFactor(factor: Factor) {
    setRemovingId(factor.id);
    setRemoveError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    setRemovingId(null);
    setConfirmRemoveId(null);
    if (error) {
      setRemoveError(error.message);
      return;
    }
    await loadFactors();
    capture("mfa_disabled", { factor_type: "totp", remaining_factors: Math.max(0, verifiedCount - 1) });
    postMfaEvent("disabled", factor.friendly_name ?? "authenticator app");
  }

  function copySecret(secret: string) {
    navigator.clipboard?.writeText(secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (factors === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-text-tertiary">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading security settings…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div
        className={cn(
          "flex items-start gap-3 rounded-sm border px-4 py-3.5",
          verifiedCount > 0
            ? "border-gold-500/30 bg-gold-500/5"
            : "border-border-hairline"
        )}
      >
        {verifiedCount > 0 ? (
          <ShieldCheck className="h-5 w-5 text-gold-400 shrink-0 mt-0.5" />
        ) : (
          <ShieldAlert className="h-5 w-5 text-text-tertiary shrink-0 mt-0.5" />
        )}
        <div>
          <p className="text-sm font-medium text-text-primary">
            {verifiedCount > 0
              ? `Two-factor authentication is on${verifiedCount > 1 ? ` (${verifiedCount} devices)` : ""}`
              : "Two-factor authentication is off"}
          </p>
          <p className="text-xs text-text-secondary mt-0.5">
            {verifiedCount > 0
              ? "You'll be asked for a code from your authenticator app when signing in."
              : "Add an authenticator app (Google Authenticator, 1Password, Authy, ...) for an extra layer of protection at sign-in."}
          </p>
        </div>
      </div>

      {loadError && <p className="text-sm text-danger">{loadError}</p>}

      {factors.length > 0 && (
        <div className="flex flex-col divide-y divide-border-hairline">
          {factors.map((factor) => (
            <div key={factor.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <Smartphone className="h-4 w-4 text-text-tertiary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-text-primary flex items-center gap-1.5">
                    {factor.friendly_name || "Authenticator app"}
                    {factor.status === "unverified" && (
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary bg-white/[0.04] rounded-full px-1.5 py-0.5">
                        Incomplete
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text-tertiary">
                    Added {new Date(factor.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {confirmRemoveId === factor.id ? (
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    onClick={() => removeFactor(factor)}
                    disabled={removingId === factor.id}
                    variant="destructive"
                    size="sm"
                  >
                    {removingId === factor.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Confirm"
                    )}
                  </Button>
                  <Button onClick={() => setConfirmRemoveId(null)} variant="ghost" size="sm">
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => setConfirmRemoveId(factor.id)}
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-text-tertiary hover:text-danger"
                  aria-label={`Remove ${factor.friendly_name ?? "authenticator app"}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {removeError && <p className="text-sm text-danger">{removeError}</p>}

      {step.name === "list" && (
        <div>
          <Button onClick={startNaming} variant="secondary" size="sm">
            {verifiedCount > 0 ? "Add another device" : "Set up two-factor authentication"}
          </Button>
          {verifiedCount === 1 && (
            <p className="text-xs text-text-tertiary mt-2">
              Consider adding a second device as backup — if you lose access to this one, you&apos;ll
              need it (or support) to sign in again.
            </p>
          )}
        </div>
      )}

      {step.name === "naming" && (
        <div className="rounded-sm border border-border-hairline p-4 space-y-3">
          <p className="text-sm font-medium text-text-primary">Name this device</p>
          <NameForm
            defaultValue={step.suggestedName}
            onCancel={() => setStep({ name: "list" })}
            onSubmit={startEnrollment}
          />
        </div>
      )}

      {step.name === "enrolling" && (
        <div className="rounded-sm border border-border-hairline p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-text-primary">Scan this QR code</p>
            <button
              onClick={cancelEnrollment}
              aria-label="Cancel setup"
              className="text-text-tertiary hover:text-text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-xs text-text-secondary">
            Scan with your authenticator app, or enter the code manually below.
          </p>

          <div className="flex justify-center py-2">
            {/* Supabase returns the QR as an inline SVG data URI — safe to render directly. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={step.qrCode}
              alt="Two-factor authentication QR code"
              width={176}
              height={176}
              className="rounded-sm bg-white p-2"
            />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-sm bg-base border border-border-hairline px-3 py-2">
            <code className="text-xs text-text-secondary break-all">{step.secret}</code>
            <button
              onClick={() => copySecret(step.secret)}
              aria-label="Copy secret"
              className="shrink-0 text-text-tertiary hover:text-gold-400"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-gold-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide text-text-secondary mb-1.5">
              6-digit code
            </label>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={step.code}
              onChange={(e) =>
                setStep({ ...step, code: e.target.value.replace(/\D/g, ""), error: null })
              }
              onKeyDown={(e) => e.key === "Enter" && submitVerification()}
              placeholder="000000"
              className="w-full h-11 px-3.5 rounded-sm bg-base border border-interactive text-text-primary text-[15px] tracking-[0.3em] text-center focus:outline-none focus:border-gold-500/60"
            />
          </div>

          {step.error && <p className="text-sm text-danger">{step.error}</p>}

          <div className="flex gap-2">
            <Button onClick={submitVerification} disabled={step.submitting} size="sm">
              {step.submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verify & enable"}
            </Button>
            <Button onClick={cancelEnrollment} variant="ghost" size="sm">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NameForm({
  defaultValue,
  onCancel,
  onSubmit,
}: {
  defaultValue: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(defaultValue);
  return (
    <>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder="e.g. iPhone, 1Password"
        className="w-full h-11 px-3.5 rounded-sm bg-base border border-interactive text-text-primary text-[15px] focus:outline-none focus:border-gold-500/60"
      />
      <div className="flex gap-2">
        <Button onClick={() => onSubmit(name)} size="sm">
          Continue
        </Button>
        <Button onClick={onCancel} variant="ghost" size="sm">
          Cancel
        </Button>
      </div>
    </>
  );
}
