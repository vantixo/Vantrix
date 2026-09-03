import Link from "next/link";
import { Bot, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TwinGatedNotice() {
  return (
    <div className="mx-auto max-w-md text-center py-16">
      <div className="h-14 w-14 mx-auto rounded-full border border-gold-500/50 flex items-center justify-center">
        <Bot className="h-6 w-6 text-gold-500" strokeWidth={1.75} />
      </div>
      <h1 className="font-display text-2xl text-text-primary mt-4">Digital Twin</h1>
      <p className="text-text-secondary text-sm mt-2">
        Train an AI clone of your own texting style — tone, phrasing, humor, even how you
        argue a point — and let it draft replies as you. This is a premium feature.
      </p>
      <Button asChild className="mt-6">
        <Link href="/premium">
          <Crown className="h-4 w-4" /> Upgrade to Premium
        </Link>
      </Button>
    </div>
  );
}
