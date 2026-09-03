"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { PaywallModal } from "@/components/paywall/paywall-modal";
import { ERROR_CODE_TO_UPGRADE_REASON, type UpgradeReason } from "@/lib/tiers/config";

interface PaywallState {
  open: boolean;
  reason: UpgradeReason;
  characterName?: string;
  usageStat?: { used: number; limit: number };
}

interface PaywallContextValue {
  /** Open the shared paywall modal directly with a known reason. */
  openPaywall: (
    reason: UpgradeReason,
    opts?: { characterName?: string; usageStat?: { used: number; limit: number } }
  ) => void;
  /**
   * Open the paywall from an API error body's `code` field (see each
   * route's documented response codes, e.g. RATE_LIMIT_EXCEEDED,
   * PREMIUM_CHARACTER_REQUIRED, INSUFFICIENT_TOKENS). Returns true if the
   * code was gate-related and the modal was opened, false otherwise — so
   * call sites can fall back to a plain inline error for codes that aren't
   * upgrade-related (e.g. CONTENT_POLICY_VIOLATION, IMAGE_PROVIDER_DOWN).
   */
  openPaywallForError: (
    code: string | undefined,
    opts?: {
      characterName?: string;
      reasonOverride?: UpgradeReason;
      usageStat?: { used: number; limit: number };
    }
  ) => boolean;
  closePaywall: () => void;
}

const PaywallContext = createContext<PaywallContextValue | null>(null);

/**
 * Mounted once in the root layout (see app/layout.tsx). Every gated
 * surface — chat limits, image/video generation, LoRA training, Digital
 * Twin, locked characters, dating swipes — calls usePaywall() instead of
 * rendering its own upgrade link/copy, so there is exactly one paywall
 * component in the app (paywall-modal.tsx) and one source of truth for
 * which error codes mean "show the paywall" (tiers/config.ts's
 * ERROR_CODE_TO_UPGRADE_REASON).
 *
 * Needs the signed-in user's current tier (for the modal's "already have
 * this" copy and analytics) — pass it down from server-rendered session
 * data via <PaywallProvider currentTier={...}> in (app)/layout.tsx rather
 * than each call site re-fetching it.
 */
export function PaywallProvider({
  currentTier,
  children,
}: {
  currentTier: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<PaywallState>({ open: false, reason: "messages" });

  const openPaywall = useCallback<PaywallContextValue["openPaywall"]>((reason, opts) => {
    setState({ open: true, reason, characterName: opts?.characterName, usageStat: opts?.usageStat });
  }, []);

  const openPaywallForError = useCallback<PaywallContextValue["openPaywallForError"]>(
    (code, opts) => {
      if (!code) return false;
      const reason = opts?.reasonOverride ?? ERROR_CODE_TO_UPGRADE_REASON[code];
      if (!reason) return false;
      setState({ open: true, reason, characterName: opts?.characterName, usageStat: opts?.usageStat });
      return true;
    },
    []
  );

  const closePaywall = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
  }, []);

  const value = useMemo(
    () => ({ openPaywall, openPaywallForError, closePaywall }),
    [openPaywall, openPaywallForError, closePaywall]
  );

  return (
    <PaywallContext.Provider value={value}>
      {children}
      <PaywallModal
        open={state.open}
        onOpenChange={(open) => setState((s) => ({ ...s, open }))}
        reason={state.reason}
        currentTier={currentTier}
        characterName={state.characterName}
        usageStat={state.usageStat}
      />
    </PaywallContext.Provider>
  );
}

export function usePaywall(): PaywallContextValue {
  const ctx = useContext(PaywallContext);
  if (!ctx) {
    throw new Error("usePaywall() must be used within <PaywallProvider>");
  }
  return ctx;
}
