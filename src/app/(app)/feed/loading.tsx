import { Skeleton } from "@/components/ui/skeleton";

export default function FeedLoading() {
  return (
    <div className="mx-auto max-w-[520px] py-4">
      <div className="flex gap-4 px-4 md:px-0 py-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5 shrink-0">
            <Skeleton className="h-16 w-16 rounded-full" />
            <Skeleton className="h-2.5 w-10 rounded-xs" />
          </div>
        ))}
      </div>

      <div className="flex gap-2 px-4 md:px-0 mb-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-20 rounded-full shrink-0" />
        ))}
      </div>

      <div className="flex flex-col gap-4 px-4 md:px-0">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-md border border-border-hairline overflow-hidden">
            <div className="flex items-center gap-2.5 p-3">
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <Skeleton className="h-3.5 w-28 rounded-xs" />
            </div>
            <Skeleton className="aspect-[4/5] w-full rounded-none" />
            <div className="p-4 flex flex-col gap-2">
              <Skeleton className="h-4 w-16 rounded-xs" />
              <Skeleton className="h-3.5 w-3/4 rounded-xs" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
