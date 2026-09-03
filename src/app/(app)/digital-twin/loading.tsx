import { Bot } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function DigitalTwinLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <div className="flex items-center gap-2 mb-1">
        <Bot className="h-5 w-5 text-gold-500" strokeWidth={1.75} />
        <h1 className="font-display text-2xl text-text-primary">Digital Twin</h1>
      </div>
      <Skeleton className="mb-6 h-4 w-80 max-w-full" />

      <div className="flex items-center justify-between mb-5">
        <Skeleton className="h-6 w-16 rounded-sm" />
        <Skeleton className="h-8 w-20 rounded-sm" />
      </div>

      <div className="flex gap-2 mb-6">
        <Skeleton className="h-9 w-16 rounded-sm" />
        <Skeleton className="h-9 w-20 rounded-sm" />
        <Skeleton className="h-9 w-20 rounded-sm" />
      </div>

      <Skeleton className="h-64 w-full rounded-md" />
    </div>
  );
}
