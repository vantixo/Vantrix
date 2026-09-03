import { Skeleton } from "@/components/ui/skeleton";

export default function DatingMatchesLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 rounded-md border border-border-hairline p-3"
          >
            <Skeleton className="h-16 w-16 shrink-0 rounded-md" />
            <div className="flex-1">
              <Skeleton className="mb-2 h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
