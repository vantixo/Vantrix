import { Skeleton } from "@/components/ui/skeleton";

export default function LocationDetailLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 md:px-8 py-6">
      <Skeleton className="aspect-[16/7] w-full rounded-lg" />
      <div className="mt-5">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-72" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </div>
      <Skeleton className="h-24 w-full rounded-md mt-6" />
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        <Skeleton className="h-28 w-full rounded-md" />
        <Skeleton className="h-28 w-full rounded-md" />
      </div>
      <div className="mt-8">
        <Skeleton className="h-4 w-32 mb-3" />
        <Skeleton className="h-40 w-full rounded-md" />
        <div className="grid grid-cols-3 gap-3 mt-3">
          <Skeleton className="aspect-video w-full rounded-md" />
          <Skeleton className="aspect-video w-full rounded-md" />
          <Skeleton className="aspect-video w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}
