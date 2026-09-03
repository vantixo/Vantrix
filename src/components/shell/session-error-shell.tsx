"use client";

import { AlertCircle } from "lucide-react";
import { RetryButton } from "@/components/ui/retry-button";

/**
 * Rendered by (app)/layout.tsx when getShellSession() throws — a genuine
 * failure (network/auth-service blip), not "no user." Distinct from that
 * case on purpose: redirecting to /login here would be wrong (the user
 * may well still be authenticated) and previously an uncaught throw here
 * took down the entire document via global-error.tsx, since error.tsx
 * boundaries can't catch errors thrown by their own segment's layout.
 * This has no Sidebar/TopBar (both need profile data we don't have) but
 * stays inside the normal document, unlike global-error.tsx.
 */
export function SessionErrorShell() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-base px-6 text-center">
      <AlertCircle className="h-8 w-8 text-text-tertiary" />
      <p className="text-text-primary">Couldn&rsquo;t load your session.</p>
      <p className="max-w-sm text-sm text-text-secondary">
        This is usually temporary. Your login is fine — try again in a moment.
      </p>
      <RetryButton />
    </div>
  );
}
