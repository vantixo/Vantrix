import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-lg px-4 md:px-8 py-8 space-y-8">
      <div>
        <Skeleton className="h-7 w-28 mb-6" />

        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full shrink-0" />
          <Skeleton className="h-9 w-32 rounded-sm" />
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <Skeleton className="h-11 w-full rounded-sm" />
          <Skeleton className="h-11 w-full rounded-sm" />
          <Skeleton className="h-24 w-full rounded-sm" />
        </div>
      </div>

      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="border-t border-border-hairline pt-6">
          <Skeleton className="h-4 w-32 mb-3" />
          <Skeleton className="h-16 w-full rounded-sm" />
        </div>
      ))}
    </div>
  );
}
