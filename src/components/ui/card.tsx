import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Base card. Per FRONTEND_DIRECTIVE §1: same bg-base as the page, no
 * lighter surface fill. Elevation and separation come only from the
 * hairline border + shadow, brightened on hover (also border-only —
 * see §6, "subtle gold border brighten, no background change").
 */
export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { interactive?: boolean }
>(({ className, interactive = true, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "bg-base border border-border-hairline rounded-md shadow-card overflow-hidden",
      interactive &&
        "transition-[border-color,box-shadow] duration-200 ease-premium hover:border-gold-500/40",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";
