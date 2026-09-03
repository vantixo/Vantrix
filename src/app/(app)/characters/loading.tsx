import { Skeleton } from "@/components/ui/skeleton";

export default function CharactersLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 md:px-8 py-6">
      <Skeleton className="h-8 w-40 mb-4" />

      <div className="flex gap-2 mb-4">
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-40 rounded-full" />
      </div>

      <Skeleton className="h-11 w-full rounded-sm mb-4" />

      <div className="flex gap-2 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-16 rounded-full" />
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {Array.from({ length: 15 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[3/4] w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
