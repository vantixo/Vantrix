import { Skeleton } from "@/components/ui/skeleton";

export default function ProfileLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-8">
      <div className="flex items-center gap-4">
        <Skeleton className="h-20 w-20 rounded-full shrink-0" />
        <div className="min-w-0 flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 max-w-md">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        <Skeleton className="h-28 w-full rounded-md" />
        <Skeleton className="h-28 w-full rounded-md" />
      </div>

      <Skeleton className="h-3 w-32 mt-4" />

      <div className="flex gap-3 mt-6">
        <Skeleton className="h-11 w-36 rounded-sm" />
        <Skeleton className="h-11 w-28 rounded-sm" />
      </div>
    </div>
  );
}
