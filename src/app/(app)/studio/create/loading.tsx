import { Skeleton } from "@/components/ui/skeleton";

export default function CreateCharacterLoading() {
  return (
    <div className="min-h-screen bg-base flex flex-col">
      <div className="flex items-center justify-between border-b border-border-hairline px-4 md:px-8 py-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-5 w-5 rounded-sm" />
      </div>
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[200px_1fr] lg:grid-cols-[220px_320px_1fr] gap-6 lg:gap-8 px-4 md:px-8 py-6 max-w-7xl mx-auto w-full">
        <div className="flex md:flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 md:w-full shrink-0 rounded-sm" />
          ))}
        </div>
        <div className="hidden lg:block">
          <Skeleton className="h-[420px] w-full rounded-md" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-11 w-full rounded-sm" />
          <Skeleton className="h-11 w-full rounded-sm" />
          <Skeleton className="h-28 w-full rounded-sm" />
        </div>
      </div>
    </div>
  );
}
