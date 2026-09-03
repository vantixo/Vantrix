import { Skeleton } from "@/components/ui/skeleton";

export default function MatchDetailLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-2 h-6 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>

      <Skeleton className="mt-4 h-11 w-full rounded-sm" />

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-md" />
        <Skeleton className="h-48 w-full rounded-md" />
      </div>

      <div className="mt-8">
        <Skeleton className="mb-3 h-4 w-24" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-24 shrink-0 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
