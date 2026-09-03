import { Skeleton } from "@/components/ui/skeleton";

export default function FactionDetailLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">
      <Skeleton className="aspect-[16/7] w-full rounded-lg" />
      <div className="mt-5">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
        <Skeleton className="mt-4 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </div>
    </div>
  );
}
