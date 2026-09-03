import { Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Phase 1 Immersive UI Upgrade §2/§15 "PremiumBadge" primitive. This is a
 * pure extraction, not a new visual — byte-identical markup to what
 * companion-card.tsx and characters/[id]/page.tsx already render inline
 * (`<Badge variant="outline"><Crown .../>Premium</Badge>`), so swapping
 * either of those call sites to this component is a zero-visual-diff
 * refactor whenever that cleanup happens; not required to do it in the
 * same pass. Reuses the existing gold-monochrome Badge (see badge.tsx's
 * own §9.4 note: "no secondary accent color for badges") rather than
 * introducing a second premium treatment.
 */
export function PremiumBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={className}>
      <Crown className="h-3 w-3 mr-1" strokeWidth={2} />
      Premium
    </Badge>
  );
}
