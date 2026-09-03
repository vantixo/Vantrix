import { CheckCircle2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function PremiumSuccessLoading() {
  return (
    <div className="mx-auto max-w-md px-4 md:px-8 py-20 text-center">
      <CheckCircle2 className="h-12 w-12 text-gold-500 mx-auto" strokeWidth={1.5} />
      <Skeleton className="h-7 w-40 mx-auto mt-4" />
      <div className="mt-2 flex flex-col items-center gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="h-14 w-40 rounded-sm mx-auto mt-6" />
    </div>
  );
}
