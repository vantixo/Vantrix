import { Skeleton } from "@/components/ui/skeleton";

export default function ChatLoading() {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-border-hairline px-4 py-3 sticky top-0 bg-base z-10">
        <Skeleton className="h-5 w-5 rounded-xs" />
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <Skeleton className="h-4 w-32" />
      </div>

      <div className="flex flex-col gap-4 px-4 py-6">
        <div className="flex justify-start">
          <Skeleton className="h-14 w-2/3 max-w-xs rounded-md" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-10 w-1/2 max-w-xs rounded-md" />
        </div>
        <div className="flex justify-start">
          <Skeleton className="h-20 w-3/4 max-w-sm rounded-md" />
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-10 w-2/5 max-w-xs rounded-md" />
        </div>
        <div className="flex justify-start">
          <Skeleton className="h-12 w-1/2 max-w-xs rounded-md" />
        </div>
      </div>
    </div>
  );
}
