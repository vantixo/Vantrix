"use client";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-base text-text-primary min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <p className="font-display text-2xl mb-2">Something went wrong</p>
        <p className="text-text-secondary mb-8 max-w-sm text-sm">
          {error.message || "An unexpected error occurred."}
        </p>
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      </body>
    </html>
  );
}
