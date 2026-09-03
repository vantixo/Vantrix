import { AlertCircle } from "lucide-react";
import { RetryButton } from "@/components/ui/retry-button";

/**
 * For sections where the fetch itself failed (network/backend error),
 * as opposed to succeeding with zero results. Several pages were
 * previously collapsing both cases into the same "nothing here" empty
 * state, which reads as "you have no matches / your world is quiet"
 * when the real story is "we couldn't load this right now" — misleading
 * in a way that looks like a real, if sparse, account state.
 */
export function UnavailableState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-border-hairline py-16 text-center">
      <AlertCircle className="h-10 w-10 text-text-tertiary" />
      <p className="text-text-secondary">{message}</p>
      <RetryButton />
    </div>
  );
}
