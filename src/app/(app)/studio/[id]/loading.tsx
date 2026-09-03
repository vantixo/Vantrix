import { Skeleton } from "@/components/ui/skeleton";

export default function EditCharacterLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 md:px-8 py-6">
      <Skeleton className="mb-4 h-4 w-20" />

      <div className="flex items-center gap-4 mb-6">
        <Skeleton className="h-16 w-16 rounded-md" />
        <div className="min-w-0 flex-1">
          <Skeleton className="mb-2 h-6 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="h-9 w-20 rounded-sm" />
      </div>

      <Skeleton className="mb-6 h-10 w-full rounded-md" />

      <div className="flex gap-2 mb-6">
        <Skeleton className="h-9 w-20 rounded-sm" />
        <Skeleton className="h-9 w-28 rounded-sm" />
      </div>

      <div className="flex flex-col gap-4">
        <Skeleton className="h-11 w-full rounded-sm" />
        <Skeleton className="h-11 w-full rounded-sm" />
        <Skeleton className="h-28 w-full rounded-sm" />
      </div>
    </div>
  );
}
