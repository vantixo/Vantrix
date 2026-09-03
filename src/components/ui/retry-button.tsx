"use client";

import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Re-runs the current route's Server Components (router.refresh()) so a
 * transient data-fetch failure can be retried without a hard reload.
 * Shared by the various "temporarily unavailable" states rather than each
 * one hand-rolling its own reload mechanism.
 */
export function RetryButton({ label = "Try again" }: { label?: string }) {
  const router = useRouter();
  return (
    <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
      <RotateCcw className="h-4 w-4" />
      {label}
    </Button>
  );
}
