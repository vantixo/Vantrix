import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <div className="flex items-center justify-between mb-4 gap-3">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-20" />
      </div>

      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-16 rounded-full" />
          ))}
        </div>
        <Skeleton className="h-8 w-24 rounded-full shrink-0" />
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-md border border-border-hairline px-3 py-3">
            <Skeleton className="h-9 w-9 rounded-full shrink-0" />
            <div className="min-w-0 flex-1 flex flex-col gap-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
