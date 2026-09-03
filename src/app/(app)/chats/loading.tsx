import { Skeleton } from "@/components/ui/skeleton";

export default function ChatsLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <Skeleton className="h-7 w-24 mb-4" />

      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-md border border-border-hairline px-3 py-3"
          >
            <Skeleton className="h-12 w-12 rounded-full shrink-0" />
            <div className="min-w-0 flex-1 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-8" />
              </div>
              <Skeleton className="h-3.5 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
