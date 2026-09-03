import { MessagesSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function CommunityLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 md:px-8 py-6">
      <div className="flex items-center gap-2 mb-4">
        <MessagesSquare className="h-5 w-5 text-gold-500" strokeWidth={1.75} />
        <h1 className="font-display text-2xl text-text-primary">Community</h1>
      </div>

      <Skeleton className="h-11 w-full rounded-sm mb-4" />

      <div className="flex gap-2 mb-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-full shrink-0" />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
