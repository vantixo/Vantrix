import { Skeleton } from "@/components/ui/skeleton";

export default function DatingWorldLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 md:px-8 py-6">
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>

      <Skeleton className="mb-4 aspect-[16/9] w-full rounded-md sm:aspect-[21/9]" />

      <section className="mb-8">
        <Skeleton className="mb-3 h-4 w-36" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-[168px] shrink-0 rounded-md sm:w-[200px]" />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-14" />
        </div>
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-[168px] shrink-0 rounded-md sm:w-[200px]" />
          ))}
        </div>
      </section>
    </div>
  );
}
