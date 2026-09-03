import { Coins } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function TokensLoading() {
  return (
    <div className="mx-auto max-w-4xl px-4 md:px-8 py-10">
      <div className="text-center">
        <div className="h-14 w-14 mx-auto rounded-full border border-gold-500/50 flex items-center justify-center">
          <Coins className="h-6 w-6 text-gold-500" strokeWidth={1.75} />
        </div>
        <h1 className="font-display text-2xl text-text-primary mt-4">Vantrix Coin</h1>
        <Skeleton className="h-4 w-32 mx-auto mt-2" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-8">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
