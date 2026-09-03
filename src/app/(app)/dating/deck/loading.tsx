import { Skeleton } from "@/components/ui/skeleton";

export default function DatingDeckLoading() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-6">
      <div className="mb-4 flex w-full items-center justify-between">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="aspect-[3/4.3] w-full rounded-lg" />
      <div className="mt-6 flex items-center gap-4">
        <Skeleton className="h-14 w-14 rounded-full" />
        <Skeleton className="h-16 w-16 rounded-full" />
        <Skeleton className="h-14 w-14 rounded-full" />
      </div>
    </div>
  );
}
