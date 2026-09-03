"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * Not in the original §4 component inventory, but two of the pages added
 * in this pass (Studio: My Characters / Market, World: Overview /
 * Locations / Factions) need a section switcher and shouldn't each
 * hand-roll one. Follows the same "gold = active, ghost = inactive"
 * rule as FilterPillGroup, just underline-styled instead of pill-styled
 * so it reads as a page-level section switch rather than a content
 * filter.
 */
export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        "flex gap-6 border-b border-border-hairline overflow-x-auto no-scrollbar",
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "shrink-0 -mb-px px-1 py-3 text-sm font-semibold text-text-secondary border-b-2 border-transparent transition-colors duration-150 ease-premium",
        "data-[state=active]:text-gold-400 data-[state=active]:border-gold-500",
        "hover:text-text-primary outline-none",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("outline-none animate-fade-in", className)}
      {...props}
    />
  );
}
