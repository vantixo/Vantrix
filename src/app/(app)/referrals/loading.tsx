import { Skeleton } from "@/components/ui/skeleton";

export default function ReferralsLoading() {
  return (
    <div className="mx-auto max-w-lg px-4 md:px-8 py-8">
      <Skeleton className="h-7 w-28 mb-1" />
      <Skeleton className="h-4 w-64 mb-6" />

      <div className="space-y-8">
        <div className="rounded-md border border-border-hairline p-5">
          <div className="flex items-center justify-between mb-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-14" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-11 flex-1 rounded-sm" />
            <Skeleton className="h-11 w-11 rounded-sm shrink-0" />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
