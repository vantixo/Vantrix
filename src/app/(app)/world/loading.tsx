import { Globe2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function WorldLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6">
      <div className="flex items-center gap-2 mb-4">
        <Globe2 className="h-5 w-5 text-gold-500" strokeWidth={1.75} />
        <h1 className="font-display text-2xl text-text-primary">World</h1>
      </div>

      <Skeleton className="h-[52px] w-full rounded-md" />

      <div className="mt-6 flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-sm" />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[4/3] w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
