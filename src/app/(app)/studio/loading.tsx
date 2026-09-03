import { Skeleton } from "@/components/ui/skeleton";

export default function StudioLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-8 w-24" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-24 rounded-sm" />
          <Skeleton className="h-9 w-40 rounded-sm" />
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        <Skeleton className="h-9 w-32 rounded-sm" />
        <Skeleton className="h-9 w-20 rounded-sm" />
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
