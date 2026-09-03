"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * UX AUDIT FIX (item 2): before this file existed, an unhandled throw in
 * any page under (app)/ (Dating, World, Studio, Digital Twin, Chat, ...)
 * propagated all the way to src/app/global-error.tsx, which replaces the
 * entire <html> document — Sidebar, TopBar, and BottomNav all disappear
 * along with whichever single page actually failed.
 *
 * error.tsx creates a boundary around this segment's {children} but is
 * itself rendered *inside* the parent layout, so (app)/layout.tsx's
 * Sidebar/TopBar/BottomNav stay mounted and the rest of the app (other
 * nav items, account menu, etc.) stays usable. Note this cannot catch a
 * throw from (app)/layout.tsx itself — that's what session-error-shell
 * handles (see layout.tsx).
 */
export default function AppSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <AlertCircle className="h-8 w-8 text-text-tertiary" />
      <p className="text-text-primary">This page couldn&rsquo;t load.</p>
      <p className="max-w-sm text-sm text-text-secondary">
        {error.message || "Something went wrong loading this page."}
      </p>
      <Button variant="secondary" size="sm" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
