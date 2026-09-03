import { Skeleton } from "@/components/ui/skeleton";

export default function CharacterDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">
      <Skeleton className="relative aspect-[4/5] w-full max-w-sm mx-auto rounded-lg" />

      <div className="mt-6 flex flex-col items-center gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-5 w-24 mt-1" />
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-16 rounded-full" />
        ))}
      </div>

      <div className="mt-6 flex flex-col items-center gap-2 max-w-xl mx-auto">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <Skeleton className="h-11 w-48 rounded-sm" />
        <Skeleton className="h-4 w-32" />
      </div>

      <div className="mt-10">
        <div className="flex justify-center gap-2 mb-5">
          <Skeleton className="h-9 w-28 rounded-sm" />
          <Skeleton className="h-9 w-24 rounded-sm" />
        </div>
        <Skeleton className="h-40 w-full rounded-md" />
      </div>
    </div>
  );
}
