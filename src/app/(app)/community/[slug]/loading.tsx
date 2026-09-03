import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function CommunityDetailLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 md:px-8 py-6">
      <Link
        href="/community"
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary mb-4"
      >
        <ChevronLeft className="h-4 w-4" /> Community
      </Link>

      <Skeleton className="h-7 w-48 mb-2" />
      <Skeleton className="h-4 w-64 mb-6" />

      <div className="flex gap-2 mb-5">
        <Skeleton className="h-9 w-16 rounded-full" />
        <Skeleton className="h-9 w-20 rounded-full" />
        <Skeleton className="h-9 w-16 rounded-full" />
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
